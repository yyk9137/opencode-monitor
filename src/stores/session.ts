import { defineStore } from 'pinia'
import { ref, shallowRef, computed } from 'vue'
import { fetch } from '@tauri-apps/plugin-http'
import type {
  SessionV2Info,
  SessionListResponse,
  SessionNode,
  StuckAlert,
  InferredState,
  FinishReason,
  MessagePartUpdatedEvent,
  MessagePartDeltaEvent,
  TextPart,
  FileDiff,
  RevertResult,
  ForkResult,
  AbortResult,
  MessagePart,
} from '@/types'

export interface InstanceConnection {
  url: string
  port: number
  projectDir?: string
  version?: string
  connected: boolean
}

export const useSessionStore = defineStore('session', () => {
  // ── State ──────────────────────────────────────────────────────────────
  const sessions = shallowRef<Map<string, SessionNode>>(new Map())
  const connectionStatus = ref<'disconnected' | 'connecting' | 'connected'>('disconnected')
  const stuckAlerts = ref<StuckAlert[]>([])
  const stuckThresholdMs = ref<number>(5 * 60 * 1000)
  // ── Multi-instance ──────────────────────────────────────────────────────
  // Discovered + connected instances. Populated by useInstanceScanner and
  // updated as SSE events come in. Each session is tagged with the URL of
  // the instance that owns it (SessionNode.instanceUrl).
  const instances = ref<InstanceConnection[]>([])
  // baseUrl is kept as a backward-compatibility alias: callers that haven't
  // been refactored to use a session's instanceUrl still resolve against
  // the first known instance (or the OpenCode default).
  const baseUrl = computed<string>(() => instances.value[0]?.url ?? 'http://localhost:4096')
  const cwdFilter = ref<string | null>(null)  // --cwd CLI arg: filter sessions by location.directory

  // ── Tab state for browser-like multi-tab system ──────────────────────
  // Every accessible session lives here: top-level sessions AND child
  // subagent sessions. The single "active" signal is `activeTabId` — the
  // tree highlights by it, the titlebar reflects it, the detail pane
  // renders from it. Clicking a tree node is `openTab()`.
  interface OpenTab {
    sessionId: string
    title: string      // session/task title for tab label
    agent: string      // agent type (explorer, fixer, etc.)
    model: string      // model name (e.g. "step-3.7-flash")
    isParent: boolean  // true if this session has its own children
  }
  const openTabs = ref<OpenTab[]>([])
  const activeTabId = ref<string | null>(null)
  // Signal for SubagentDetail to show child list when a parent session's badge is clicked
  const showChildListSignal = ref<string | null>(null)

  // ── Delta coalescing buffer ────────────────────────────────────────────
  const deltaBuffer: MessagePartDeltaEvent[] = []
  let rafId: number | null = null

  function flushDeltas(): void {
    rafId = null
    const map = new Map(sessions.value)
    for (const { sessionID, partID, delta } of deltaBuffer) {
      const node = map.get(sessionID)
      if (!node) continue
      // Create new messages array with updated text (immutable)
      const newMessages = node.messages.map((p) => {
        if (p.id === partID && p.type === 'text') {
          const currentText = (p as TextPart).text ?? ''
          // Idempotency: if the server already delivered this exact suffix
          // via message.part.updated, don't append it again.
          if (currentText.endsWith(delta)) return p
          return { ...p, text: currentText + delta } as TextPart
        }
        return p
      })
      map.set(sessionID, {
        ...node,
        messages: newMessages,
        lastEventTime: Date.now(),
        lastEventType: 'message.part.delta',
      })
    }
    deltaBuffer.length = 0
    sessions.value = map
  }

  // ── Actions ────────────────────────────────────────────────────────────

  function addSession(info: SessionV2Info, instanceUrl?: string): void {
    const map = new Map(sessions.value)
    // Normalize empty-string parentID to null (API returns "" for top-level).
    const parentID = info.parentID || null
    // Use API's time.updated as lastEventTime for pre-existing sessions,
    // so stuck detection measures real idle time, not time since bootstrap.
    const apiUpdatedMs = typeof info.time?.updated === 'number'
      ? info.time.updated
      : typeof info.time?.updated === 'string'
        ? new Date(info.time.updated).getTime()
        : Date.now()
    const existing = map.get(info.id)
    const node: SessionNode = {
      id: info.id,
      parentID,
      directory: info.location.directory,
      title: info.title,
      agent: info.agent,
      inferredState: existing?.inferredState ?? 'unknown',
      lastEventTime: apiUpdatedMs,
      lastEventType: 'session.created',
      lastFinishReason: existing?.lastFinishReason ?? null,
      messages: existing?.messages ?? [],
      children: [],
      raw: { ...info, parentID },
      // Tag the session with its owning instance so child-session fetches
      // and prompt sends hit the correct server. If the session already
      // exists, preserve its current tag (don't overwrite unless missing).
      instanceUrl: existing?.instanceUrl ?? instanceUrl ?? '',
    }
    map.set(info.id, node)
    sessions.value = map
  }

  function updateSession(info: Partial<SessionV2Info> & { sessionID: string }): void {
    const map = new Map(sessions.value)
    const existing = map.get(info.sessionID)
    if (!existing) return

    const { sessionID: _sid, ...rest } = info as typeof info & { sessionID: string }
    void _sid

    const raw: SessionV2Info = { ...existing.raw, ...rest }

    const updated: SessionNode = {
      ...existing,
      title: rest.title ?? existing.title,
      agent: rest.agent ?? existing.agent,
      lastEventTime: Date.now(),
      lastEventType: 'session.updated',
      raw,
    }
    if (rest.location) {
      updated.directory = rest.location.directory
    }

    // Merge optional numeric/token fields from rest into raw
    if (typeof rest.cost === 'number') raw.cost = rest.cost
    if (rest.tokens) {
      raw.tokens = { ...raw.tokens, ...rest.tokens }
    }

    map.set(info.sessionID, updated)
    sessions.value = map
  }

  function addMessagePart(event: MessagePartUpdatedEvent): void {
    const map = new Map(sessions.value)
    const node = map.get(event.sessionID)
    if (!node) return

    // message.part.updated carries the canonical full state for this part.
    // Any deltas still coalescing in the RAF buffer are now stale and would
    // duplicate the tail if flushed after this replacement.
    if (event.part.type === 'text' && event.part.id) {
      for (let i = deltaBuffer.length - 1; i >= 0; i--) {
        if (
          deltaBuffer[i].sessionID === event.sessionID &&
          deltaBuffer[i].partID === event.part.id
        ) {
          deltaBuffer.splice(i, 1)
        }
      }
    }

    // Immutable messages array update
    const partId = event.part.id
    const existingIdx = node.messages.findIndex((p) => p.id === partId)
    const newMessages = existingIdx >= 0
      ? node.messages.map((p, i) => i === existingIdx ? event.part : p)
      : [...node.messages, event.part]

    // ── State inference (design doc §5.7) ──────────────────────────────
    // Signal A: step-finish part carries `reason` field (handled in useEventStream).
    // Here we handle activity-based transitions: unknown→running, completed→running.
    let newInferredState = node.inferredState

    // Receiving new parts means the session is active again.
    // Transition both 'unknown' and 'completed' to 'running'.
    if (node.inferredState === 'unknown' || node.inferredState === 'completed') {
      newInferredState = 'running'
    }

    // HIGH-2 fix: replace node with new object (not in-place mutation)
    const updatedNode: SessionNode = {
      ...node,
      messages: newMessages,
      inferredState: newInferredState,
      lastEventTime: Date.now(),
      lastEventType: 'message.part.updated',
    }
    map.set(event.sessionID, updatedNode)

    // Signal B: parent received <task id="..." state="..."> synthetic message
    // → update ALL referenced child sessions' inferredState (may contain multiple tags)
    if (event.part.type === 'text' && (event.part as TextPart).text) {
      const text = (event.part as TextPart).text
      const taskPattern = /<task\s+id=["']([^"']+)["']\s+state=["'](\w+)["']/g
      for (const m of text.matchAll(taskPattern)) {
        const childId = m[1]
        const taskState = m[2]
        const child = map.get(childId)
        if (child && (taskState === 'completed' || taskState === 'error')) {
          // HIGH-2 fix: replace child with new object too
          map.set(childId, {
            ...child,
            inferredState: taskState === 'completed' ? 'completed' : 'error',
            lastEventTime: Date.now(),
            lastEventType: 'task.completed',
          })
        }
      }
    }

    sessions.value = map
  }

  function appendMessageDelta(event: MessagePartDeltaEvent): void {
    deltaBuffer.push(event)
    if (rafId === null) {
      rafId = requestAnimationFrame(flushDeltas)
    }
  }

  function setConnectionStatus(status: 'disconnected' | 'connecting' | 'connected'): void {
    connectionStatus.value = status
  }

  // ── Multi-instance actions ────────────────────────────────────────────

  function setInstances(next: InstanceConnection[]): void {
    // Preserve any current 'connected' state for entries whose URL matches.
    const prevConnected = new Map(
      instances.value.map((i) => [i.url, i.connected] as const),
    )
    instances.value = next.map((i) => ({
      ...i,
      connected: prevConnected.get(i.url) ?? i.connected,
    }))
  }

  function addInstance(inst: InstanceConnection): void {
    if (instances.value.some((i) => i.url === inst.url)) return
    instances.value = [...instances.value, inst]
  }

  function removeInstance(url: string): void {
    instances.value = instances.value.filter((i) => i.url !== url)
  }

  function setInstanceConnected(url: string, connected: boolean): void {
    instances.value = instances.value.map((i) =>
      i.url === url ? { ...i, connected } : i,
    )
  }

  function backfillState(sessionId: string, inferredState: InferredState, finishReason: FinishReason): void {
    const map = new Map(sessions.value)
    const node = map.get(sessionId)
    if (!node) return
    const updated: SessionNode = {
      ...node,
      inferredState,
      lastFinishReason: finishReason ?? node.lastFinishReason,
      lastEventTime: Date.now(),
      lastEventType: 'backfill',
    }
    map.set(sessionId, updated)
    sessions.value = map
  }

  // Replace a session's accumulated parts (used after revert/unrevert to
  // reflect the post-revert conversation from the server). shallowRef must
  // be reassigned to trigger reactivity — mutating the inner array is NOT
  // enough.
  function setMessages(sessionId: string, messages: MessagePart[]): void {
    const map = new Map(sessions.value)
    const node = map.get(sessionId)
    if (!node) return
    map.set(sessionId, {
      ...node,
      messages,
      lastEventTime: Date.now(),
      lastEventType: 'set-messages',
    })
    sessions.value = map
  }

  function setStuckThreshold(ms: number): void {
    stuckThresholdMs.value = ms
  }

  // ── Tab actions ──────────────────────────────────────────────────────

  async function openTab(sessionId: string): Promise<void> {
    let node: SessionNode | undefined = sessions.value.get(sessionId)
    if (!node) {
      // Session not in store — try to fetch it from each known instance.
      // (Multi-instance: a child session may live on a server other than
      // the one whose URL we have cached.)
      for (const inst of instances.value) {
        try {
          const response = await fetch(`${inst.url}/api/session/${sessionId}`)
          if (response.ok) {
            const body: SessionListResponse = await response.json()
            const infos = body.data ?? []
            const sessionInfo = infos.find((s: SessionV2Info) => s.id === sessionId)
            if (sessionInfo) {
              addSession(sessionInfo, inst.url)
              node = sessions.value.get(sessionId)
              break
            }
          }
        } catch {
          // try next instance
        }
      }
    }
    // If still no node, create a minimal placeholder so the tab can open
    if (!node) {
      const minimalInfo: SessionV2Info = {
        id: sessionId,
        parentID: '',
        title: sessionId.slice(0, 8),
        agent: 'unknown',
        model: { providerID: '', modelID: 'unknown' },
        time: { created: Date.now(), updated: Date.now() },
        location: { directory: '' },
      } as unknown as SessionV2Info
      addSession(minimalInfo)
      node = sessions.value.get(sessionId)
    }
    if (!node) return

    // A session is "parent" iff it itself has children — i.e. some other
    // session declares this id as parentID. The tab bar will render a
    // different affordance for these.
    const isParent = node.children.length > 0 ||
      Array.from(sessions.value.values()).some(s => s.parentID === sessionId)

    if (!openTabs.value.find(t => t.sessionId === sessionId)) {
      openTabs.value.push({
        sessionId,
        title: node.title || sessionId.slice(0, 8),
        agent: node.agent || 'unknown',
        model: node.raw?.model?.modelID || node.raw?.model?.id || 'unknown',
        isParent,
      })
    } else {
      // Refresh isParent flag in case child count changed since first open
      const idx = openTabs.value.findIndex(t => t.sessionId === sessionId)
      if (idx >= 0 && openTabs.value[idx]!.isParent !== isParent) {
        openTabs.value[idx] = { ...openTabs.value[idx]!, isParent }
      }
    }
    activeTabId.value = sessionId
  }

  function closeTab(sessionId: string): void {
    const closingIdx = openTabs.value.findIndex(t => t.sessionId === sessionId)
    if (closingIdx < 0) return
    openTabs.value = openTabs.value.filter(t => t.sessionId !== sessionId)

    if (activeTabId.value === sessionId) {
      // Browser-like behavior: when closing the active tab, fall back to
      // the tab immediately to its left (the "previous" tab). If none, use
      // the first remaining. If no tabs remain, clear the active tab.
      if (openTabs.value.length === 0) {
        activeTabId.value = null
      } else {
        const fallbackIdx = Math.min(closingIdx - 1, openTabs.value.length - 1)
        const next = openTabs.value[fallbackIdx < 0 ? 0 : fallbackIdx]
        activeTabId.value = next ? next.sessionId : null
      }
    }
  }

  function setActiveTab(sessionId: string): void {
    if (!openTabs.value.find(t => t.sessionId === sessionId)) return
    activeTabId.value = sessionId
  }

  async function openChildList(sessionId: string): Promise<void> {
    // Open the session as a tab (if not already open) and signal to show child list
    await openTab(sessionId)
    showChildListSignal.value = sessionId + ':' + Date.now()
  }

  // ── Legacy alias kept for backward API stability ─────────────────────
  // Some external callers (PromptInput, App.vue) historically used
  // `selectSession`. With the browser-tab model, "selecting" a session
  // means "open it as a tab and focus it". `selectSession` is now a
  // synonym for `openTab` — no separate `selectedSessionId` flag exists.
  function selectSession(id: string | null): Promise<void> | void {
    if (id === null) return
    return openTab(id)
  }

  // ── Computed ───────────────────────────────────────────────────────────

  const tree = computed<SessionNode[]>(() => {
    const all = Array.from(sessions.value.values())
    // Filter by cwd if --cwd was provided.
    // Normalize paths: strip trailing separators, unify to backslash,
    // lowercase for case-insensitive comparison (Windows is case-insensitive).
    const cwd = cwdFilter.value
    let filtered = cwd
      ? all.filter(s => {
          const normalize = (p: string) => p.replace(/[\\/]+$/, '').replace(/\//g, '\\').toLowerCase()
          const sessionDir = normalize(s.directory)
          const normalizedCwd = normalize(cwd)
          return sessionDir === normalizedCwd || sessionDir.startsWith(normalizedCwd + '\\')
        })
      : all
    // If cwd filter matches nothing, show all sessions (better UX than empty list)
    if (filtered.length === 0 && all.length > 0) {
      filtered = all
    }
    const childrenMap = new Map<string, SessionNode[]>()
    const topLevel: SessionNode[] = []

    for (const session of filtered) {
      const node: SessionNode = { ...session, children: [] }
      // API returns parentID as empty string "" for top-level sessions, not null.
      // Treat both null and "" as top-level.
      if (!session.parentID) {
        topLevel.push(node)
      } else {
        const key = session.parentID
        if (!childrenMap.has(key)) {
          childrenMap.set(key, [])
        }
        childrenMap.get(key)!.push(node)
      }
    }

    for (const node of topLevel) {
      node.children = childrenMap.get(node.id) ?? []
    }

    // Promote orphaned children to top-level — their parent session
    // might not be in the filtered set (e.g. parent is from another project,
    // or was truncated by the server's session limit).
    const topLevelIds = new Set(topLevel.map(n => n.id))
    for (const [parentId, children] of childrenMap) {
      if (!topLevelIds.has(parentId)) {
        topLevel.push(...children)
      }
    }

    return topLevel
  })

  const stuckSessions = computed<SessionNode[]>(() => {
    const threshold = Date.now() - stuckThresholdMs.value
    const result: SessionNode[] = []
    for (const session of sessions.value.values()) {
      // Only 'running' sessions can be stuck — 'unknown' sessions finished
      // before the monitor connected and shouldn't be flagged. The
      // useStuckDetection composable verifies 'running' sessions via API
      // before raising alerts, so this computed is kept in sync with its
      // results via the stuckAlerts store field.
      if (
        session.inferredState === 'running' &&
        session.lastEventTime < threshold
      ) {
        result.push(session)
      }
    }
    return result
  })

  // ── Undo/Redo actions ───────────────────────────────────────────────
  // URL resolution: every action resolves the instance URL from
  // sessions.get(sessionId)?.instanceUrl ?? baseUrl.value — NOT from baseUrl
  // directly, because baseUrl may point to a different instance in multi-instance mode.

  async function revertMessage(sessionId: string, messageID: string, partID?: string): Promise<RevertResult> {
    const node = sessions.value.get(sessionId)
    const url = node?.instanceUrl ?? baseUrl.value
    try {
      const body: Record<string, string> = { messageID }
      if (partID) body.partID = partID
      const response = await fetch(`${url}/session/${sessionId}/revert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (response.ok) {
        const session = await response.json() as SessionV2Info
        backfillState(sessionId, 'completed', null)
        return { ok: true, session }
      }
      if (response.status === 409) return { ok: false, error: 'busy' }
      if (response.status === 404) return { ok: false, error: 'not-found' }
      if (response.status === 400) return { ok: false, error: 'bad-request' }
      return { ok: false, error: 'network' }
    } catch {
      return { ok: false, error: 'network' }
    }
  }

  async function unrevertSession(sessionId: string): Promise<RevertResult> {
    const node = sessions.value.get(sessionId)
    const url = node?.instanceUrl ?? baseUrl.value
    try {
      const response = await fetch(`${url}/session/${sessionId}/unrevert`, {
        method: 'POST',
      })
      if (response.ok) {
        const session = await response.json() as SessionV2Info
        return { ok: true, session }
      }
      if (response.status === 409) return { ok: false, error: 'busy' }
      if (response.status === 404) return { ok: false, error: 'not-found' }
      return { ok: false, error: 'network' }
    } catch {
      return { ok: false, error: 'network' }
    }
  }

  async function abortSession(sessionId: string): Promise<AbortResult> {
    const node = sessions.value.get(sessionId)
    const url = node?.instanceUrl ?? baseUrl.value
    try {
      const response = await fetch(`${url}/session/${sessionId}/abort`, {
        method: 'POST',
      })
      if (response.ok) {
        backfillState(sessionId, 'error', null)
        return { ok: true }
      }
      return { ok: false, error: `HTTP ${response.status}` }
    } catch {
      return { ok: false, error: 'network' }
    }
  }

  async function forkSession(sessionId: string, messageID?: string): Promise<ForkResult> {
    const node = sessions.value.get(sessionId)
    const url = node?.instanceUrl ?? baseUrl.value
    try {
      const body: Record<string, string> = {}
      if (messageID) body.messageID = messageID
      const response = await fetch(`${url}/session/${sessionId}/fork`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (response.ok) {
        const session = await response.json() as SessionV2Info
        addSession(session, url)
        return { ok: true, session, instanceUrl: url }
      }
      return { ok: false, error: `HTTP ${response.status}` }
    } catch {
      return { ok: false, error: 'network' }
    }
  }

  async function getSessionDiff(sessionId: string, messageID?: string): Promise<FileDiff[]> {
    const node = sessions.value.get(sessionId)
    const url = node?.instanceUrl ?? baseUrl.value
    try {
      const params = messageID ? `?messageID=${encodeURIComponent(messageID)}` : ''
      const response = await fetch(`${url}/session/${sessionId}/diff${params}`)
      if (!response.ok) return []
      const raw = await response.json() as Array<Record<string, unknown>>
      // Map API field names to our FileDiff interface:
      // API uses 'file'/'patch', we use 'path'/'content'
      return raw.map(d => ({
        path: (d.path as string) ?? (d.file as string) ?? '',
        status: (d.status as FileDiff['status']) ?? 'modified',
        additions: (d.additions as number) ?? 0,
        deletions: (d.deletions as number) ?? 0,
        content: (d.content as string) ?? (d.patch as string) ?? undefined,
        file: d.file as string | undefined,
        patch: d.patch as string | undefined,
      })) as FileDiff[]
    } catch {
      return []
    }
  }

  return {
    // state
    sessions,
    connectionStatus,
    stuckAlerts,
    stuckThresholdMs,
    baseUrl,
    instances,
    cwdFilter,
    openTabs,
    activeTabId,
    showChildListSignal,
    // actions
    addSession,
    updateSession,
    addMessagePart,
    appendMessageDelta,
    setConnectionStatus,
    selectSession,
    backfillState,
    setMessages,
    setStuckThreshold,
    openTab,
    closeTab,
    setActiveTab,
    openChildList,
    setInstances,
    addInstance,
    removeInstance,
    setInstanceConnected,
    revertMessage,
    unrevertSession,
    abortSession,
    forkSession,
    getSessionDiff,
    // computed
    tree,
    stuckSessions,
  }
})
