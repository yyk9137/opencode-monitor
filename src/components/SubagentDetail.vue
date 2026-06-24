<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  watch,
  type Ref,
} from 'vue'
import {
  AlertTriangle,
  ArrowLeft,
  ArrowLeftRight,
  Brain,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Circle,
  Clock,
  FileDiff,
  FileX,
  Globe,
  Loader2,
  Pencil,
  Redo2,
  Search,
  StopCircle,
  Terminal,
  Undo2,
  Workflow,
  Wrench,
  X,
  XCircle,
} from 'lucide-vue-next'
import FileIcon from '@/components/FileIcon.vue'
import MarkdownContent from '@/components/MarkdownContent.vue'
import '@/assets/markdown.css'
import type { Component } from 'vue'
import { useSessionStore } from '@/stores/session'
import { useSessionActions } from '@/composables/useSessionActions'

function toolIcon(tool: string): Component {
  if (['read','glob','grep','ast_grep_search','aft_outline','aft_zoom','aft_search','aft_inspect'].includes(tool))
    return Search
  if (['edit','write','apply_patch','aft_refactor','ast_grep_replace','aft_import'].includes(tool))
    return Pencil
  if (['aft_delete'].includes(tool))
    return FileX
  if (['aft_move'].includes(tool))
    return ArrowLeftRight
  if (['bash','bash_write','bash_status','bash_watch','bash_kill'].includes(tool))
    return Terminal
  if (['webfetch'].includes(tool))
    return Globe
  if (tool === 'thinking' || tool === 'reasoning')
    return Brain
  return Wrench
}

const CARD_TOOLS = new Set([
  'edit','write','apply_patch','aft_refactor','ast_grep_replace','aft_import',
  'aft_delete','aft_move',
  'bash','bash_write','bash_status','bash_watch','bash_kill'
])
function isCardTool(tool: string): boolean { return CARD_TOOLS.has(tool) }

function extractFilePath(_tool: string, input: unknown): string | null {
  if (typeof input !== 'object' || !input) return null
  const obj = input as Record<string, unknown>
  const str = (k: string) => (k in obj && typeof obj[k] === 'string' ? obj[k] as string : null)
  // read / edit / write / apply_patch / aft_zoom / aft_outline / aft_inspect
  return str('filePath')
    // grep
    ?? str('path')
    // glob
    ?? str('pattern')
    // ast_grep_search / ast_grep_replace (paths array, take first)
    ?? (Array.isArray(obj.paths) && obj.paths.length ? String(obj.paths[0]) : null)
}

import { useSessionMessages } from '@/composables/useSessionMessages'
import { fetch as httpFetch } from '@tauri-apps/plugin-http'
import type {
  FileDiff as FileDiffInfo,
  InferredState,
  MessagePart,
  ReasoningPart,
  SessionNode,
  StuckAlert,
  SubtaskPart,
  TextPart,
  ToolPart,
} from '@/types'

const store = useSessionStore()
const { fetchParts } = useSessionMessages()
// Rebind the composable's reactive state with explicit non-null Ref types.
// vue-tsc applies a "destructure-might-be-undefined" rule to properties
// pulled from composables — explicit type annotations here give the
// template the precise types it needs (Set<string>, FileDiffInfo[]) without
// forcing `!` assertions at every callsite.
const sessionActions = useSessionActions()
const inFlight: Record<string, boolean> = sessionActions.inFlight
const revertedMessageIds: Ref<Set<string>> = sessionActions.revertedMessageIds as Ref<Set<string>>
const diffFiles: Ref<FileDiffInfo[]> = sessionActions.diffFiles as Ref<FileDiffInfo[]>
const revert = sessionActions.revert
const unrevert = sessionActions.unrevert
const abortSession = sessionActions.abortSession
const viewDiff = sessionActions.viewDiff
// `fork` is exposed by the composable and wired into parts-actions in a
// later iteration; mark consumed so the noUnusedLocals rule stays happy.
void sessionActions.fork

// ─── Active view: tabs are the only view model ────────────────────────
// Browser-tab model: there is no separate "selected" concept. The right
// pane renders whatever `activeTabId` points at, period.

interface ActiveView {
  session: SessionNode
  isParent: boolean
}

const activeView = computed<ActiveView | null>(() => {
  const tabId = store.activeTabId
  if (!tabId) return null
  const node = store.sessions.get(tabId)
  if (!node) return null
  // Look up tree node for children info. Use the store node directly for
  // messages (not the tree shallow copy) so that addMessagePart/flushDeltas
  // updates are reflected in activeView.session.messages and trigger the
  // displayParts computed. Merge children from the tree into the node so
  // that template code using activeView.session.children works correctly.
  const treeNode = store.tree.find(n => n.id === tabId)
  return {
    session: treeNode ? { ...node, children: treeNode.children } : node,
    isParent: treeNode ? treeNode.children.length > 0 : false,
  }
})

const stuckAlertMap = computed<Map<string, StuckAlert>>(() => {
  const m = new Map<string, StuckAlert>()
  for (const a of store.stuckAlerts) m.set(a.sessionID, a)
  return m
})

const isCurrentlyStuck = computed<{ elapsed: number } | null>(() => {
  if (!activeView.value) return null
  const alert = stuckAlertMap.value.get(activeView.value.session.id)
  if (!alert) return null
  return { elapsed: alert.stuckDuration }
})

// ─── Child stats (only meaningful in parent view) ──────────────────────

const childStats = computed(() => {
  const view = activeView.value
  if (!view || !view.isParent) return null
  const children = view.session.children
  let running = 0
  let completed = 0
  let error = 0
  let stuck = 0
  for (const c of children) {
    if (stuckAlertMap.value.has(c.id)) stuck++
    if (c.inferredState === 'running') running++
    else if (c.inferredState === 'completed') completed++
    else if (c.inferredState === 'error') error++
  }
  return { running, completed, error, stuck, total: children.length }
})

// ─── Body mode: stream (default) | children | diff ────────────────────
// The right pane has three interchangeable bodies sharing the same vertical
// slot below the header. `stream` is the part list, `children` is the parent
// subagent grid (Zed-style), `diff` shows file changes for revert context.

type BodyMode = 'stream' | 'children' | 'diff'
const bodyMode = ref<BodyMode>('stream')

// Watch for "open child list" signal from SessionTree badge clicks
watch(
  () => store.showChildListSignal,
  (signal) => {
    if (!signal) return
    // Signal format: "sessionId:timestamp"
    const sid = signal.split(':')[0]
    if (store.activeTabId === sid) {
      // Check if this session has children by looking at tree (not sessions map,
      // which always has children: [])
      const treeNode = store.tree.find(n => n.id === sid)
      if (treeNode && treeNode.children.length > 0) {
        bodyMode.value = 'children'
      }
    }
  },
)

// Auto-reset to stream whenever the active tab changes — opening another tab
// (e.g. from the sidebar) should not leave the child-list or diff overlay in a
// stale state pointing at the old parent.
watch(
  () => store.activeTabId,
  () => { bodyMode.value = 'stream' },
)

function toggleChildList(): void {
  bodyMode.value = bodyMode.value === 'children' ? 'stream' : 'children'
}

async function openChildFromList(childId: string): Promise<void> {
  await store.openTab(childId)
  bodyMode.value = 'stream'
}

// ─── Streaming: scroll behaviour ──────────────────────────────────────

const streamRef = ref<HTMLElement | null>(null)

// ─── Backfill legacy parts when entering a session ────────────────────

const backfilledParts = shallowRef<MessagePart[]>([])

watch(
  () => activeView.value?.session.id,
  async (newId) => {
    backfilledParts.value = []
    if (!newId) return
    const view = activeView.value
    if (!view) return
    // Always fetch historical parts from legacy API — live SSE parts
    // only cover activity since monitor started, not before.
    try {
      const fetched = await fetchParts(newId)
      backfilledParts.value = fetched
    } catch {
      // API not available or session not found — silently ignore
    }
  },
  { immediate: true },
)

// ─── Display pipeline: merge backfill + live, dedup by part.id ────────

const displayParts = computed<MessagePart[]>(() => {
  const liveParts = activeView.value?.session.messages ?? []
  const seen = new Map<string, MessagePart>()

  // Backfill first (historical, in chronological order from API).
  // Live parts second: updates overwrite existing entries (Map.set),
  // new parts are appended at the end (chronologically after backfill).
  for (const p of [...backfilledParts.value, ...liveParts]) {
    if (!p.id) continue  // defensive: skip malformed parts
    const existing = seen.get(p.id)
    if (!existing) {
      seen.set(p.id, p)
      continue
    }
    // For text parts, keep the version with more content.
    // During streaming, the live version grows via deltas and will be
    // longer than the backfill snapshot.
    if (p.type === 'text' && existing.type === 'text') {
      if (((p as TextPart).text?.length ?? 0) >= ((existing as TextPart).text?.length ?? 0)) {
        seen.set(p.id, p)
      }
    } else {
      // Non-text parts: live version is always newer (status updates etc.)
      seen.set(p.id, p)
    }
  }

  return Array.from(seen.values())
  // No sort needed — backfill API returns chronological order, and
  // Map preserves insertion order. Updated entries keep their original
  // position; new live parts are appended at the end.
})

// ─── Revert affordances ────────────────────────────────────────────────
// A user text part is revertable when the session is NOT currently running
// (revert is rejected with 409 busy otherwise) and the part itself is a
// non-synthetic text body — synthetic messages (system reminders, agent
// switches) aren't authored by the user and shouldn't be revertable.

function canRevert(part: MessagePart): boolean {
  if (!activeView.value) return false
  // Block revert unless we're confident the session is NOT running.
  // 'unknown' means we couldn't determine state during bootstrap —
  // the opencode API returns 409 for running sessions, so be defensive.
  const state = activeView.value.session.inferredState
  if (state === 'running' || state === 'unknown') return false
  return part.type === 'text' && !(part as TextPart).synthetic
}

async function handleRevert(part: MessagePart): Promise<void> {
  if (!activeView.value) return
  await revert(activeView.value.session.id, part.messageID)
}

// Hide step-start and step-finish entirely (kept in data for state inference).
// Also hide synthetic text parts that contain ONLY system injection markers
// (temporal comments, internal_reminder tags) — these are not user-visible
// content in Zed and shouldn't appear in the monitor either.
const visibleParts = computed<MessagePart[]>(() => {
  return displayParts.value.filter(
    (p) =>
      p.type !== 'step-start' &&
      p.type !== 'step-finish' &&
      !isSyntheticText(p),
  )
})

// ─── Auto-stick to bottom while streaming ──────────────────────────────

let stickToBottom = true

function onScroll(event: Event): void {
  const el = event.target as HTMLElement
  const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
  stickToBottom = distanceFromBottom < 32
}

watch(visibleParts, async () => {
  if (!stickToBottom) return
  await nextTick()
  const el = streamRef.value
  if (el) el.scrollTop = el.scrollHeight
})

onMounted(() => {
  nextTick(() => {
    const el = streamRef.value
    if (el) el.scrollTop = el.scrollHeight
  })
})

// ─── Thinking (reasoning) collapse — Zed reference: thread_view.rs ─────

const expandedReasoning = ref<Set<string>>(new Set())
const initialReasoningAutoExpand = ref(false)

watch(displayParts, () => {
  if (initialReasoningAutoExpand.value) return
  const first = displayParts.value.find((p) => p.type === 'reasoning')
  if (first) {
    expandedReasoning.value = new Set([first.id])
    initialReasoningAutoExpand.value = true
  }
}, { immediate: true })

function toggleReasoning(partId: string): void {
  const next = new Set(expandedReasoning.value)
  if (next.has(partId)) next.delete(partId)
  else next.add(partId)
  expandedReasoning.value = next
}

// ─── Tool output collapse ──────────────────────────────────────────────

const expandedToolBodies = ref<Set<string>>(new Set())

function toggleToolBody(partId: string): void {
  const next = new Set(expandedToolBodies.value)
  if (next.has(partId)) next.delete(partId)
  else next.add(partId)
  expandedToolBodies.value = next
}

// ─── Subtask inline card expand ────────────────────────────────────────

const expandedSubtasks = ref<Set<string>>(new Set())

function toggleSubtask(partId: string): void {
  const next = new Set(expandedSubtasks.value)
  if (next.has(partId)) next.delete(partId)
  else next.add(partId)
  expandedSubtasks.value = next
  // Fetch child parts on expand if store has none
  const part = displayParts.value.find(p => p.id === partId)
  if (part && next.has(partId)) {
    const sid = (part as SubtaskPart).sessionID ?? taskChildSessionId(part as ToolPart)
    if (sid && childPartsOf(sid).length === 0 && !(fetchedChildParts.value.has(sid))) {
      fetchChildParts(sid)
    }
  }
}

// ─── Task result (text parts containing <task> XML) collapse ───────────

const expandedTaskResults = ref<Set<string>>(new Set())

function toggleTaskResult(partId: string): void {
  const next = new Set(expandedTaskResults.value)
  if (next.has(partId)) next.delete(partId)
  else next.add(partId)
  expandedTaskResults.value = next
}

function isTaskResultText(part: MessagePart): boolean {
  if (part.type !== 'text') return false
  const text = (part as TextPart).text || ''
  return /<task\s+id\s*=/i.test(text) && /state\s*=\s*["'](?:completed|running)["']/i.test(text)
}

// ─── System injection filtering ─────────────────────────────────────────
// The magic-context system injects temporal markers (<!-- +7m -->) and
// internal reminders (<internal_reminder>...</internal_reminder>) into the
// text stream. These are system-internal and should not be displayed to the
// user. Zed strips them; the monitor must do the same.
function stripSystemInjections(text: string): string {
  return text
    // Remove HTML comments (temporal markers like <!-- +7m -->, <!-- +3d 4h -->)
    .replace(/<!--\s*\+[0-9]+[a-z\s]*-->/gi, '')
    // Remove <internal_reminder>...</internal_reminder> blocks
    .replace(/<internal_reminder>[\s\S]*?<\/internal_reminder>/gi, '')
    // Remove <session-history> blocks if present
    .replace(/<session-history>[\s\S]*?<\/session-history>/gi, '')
    // Clean up excessive blank lines left behind
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function isSyntheticText(part: MessagePart): boolean {
  if (part.type !== 'text') return false
  const text = (part as TextPart).text || ''
  // A part is synthetic (system-injected) if it ONLY contains system markers
  // and no visible content after stripping.
  // NOTE: Empty text is NOT synthetic — it may be a newly created text part
  // that hasn't received its first delta yet. Filtering it out would cause
  // the part to disappear from the DOM until the first delta arrives, then
  // reappear — which can confuse Vue's v-for key tracking.
  if (text.length === 0) return false
  return stripSystemInjections(text).length === 0
}

function taskResultSummary(text: string): string {
  // Extract <summary> content from <task> XML
  const match = text.match(/<summary>(.*?)<\/summary>/s)
  if (match) return match[1].trim()
  // Fallback: first line of <task_result>
  const resultMatch = text.match(/<task_result>([\s\S]*?)<\/task_result>/)
  if (resultMatch) {
    const firstLine = resultMatch[1].trim().split('\n')[0]
    return firstLine.slice(0, 120) + (firstLine.length > 120 ? '…' : '')
  }
  return text.slice(0, 80) + '…'
}

function taskResultBody(text: string): string {
  // Extract <task_result> content
  const match = text.match(/<task_result>([\s\S]*?)<\/task_result>/)
  if (match) return match[1].trim()
  // Return everything after <summary>
  const summaryEnd = text.indexOf('</summary>')
  if (summaryEnd !== -1) return text.slice(summaryEnd + 10).trim()
  return text
}

function taskResultState(text: string): string {
  const match = text.match(/state\s*=\s*["'](\w+)["']/)
  return match ? match[1] : 'completed'
}

function openSubtaskTab(part: SubtaskPart): void {
  store.openTab(part.sessionID)
  toggleSubtask(part.id)
  if (expandedSubtasks.value.has(part.id) && childPartsOf(part.sessionID).length === 0) {
    fetchChildParts(part.sessionID)
  }
}

// ─── Task tool → subagent card helpers ────────────────────────────────
// When the orchestrator calls the `task` tool, OpenCode creates a child session.
// The tool part's state.metadata.sessionId points to the child session.

function taskChildSessionId(part: ToolPart): string | null {
  // Try state.metadata.sessionId first
  const meta = part.state?.metadata as Record<string, unknown> | undefined
  const sid = (meta?.sessionId as string) ?? null
  if (sid) return sid
  // Fallback: extract from output XML (<task id="..." state="..."> or single quotes)
  const output = part.state?.output as string | undefined
  if (output) {
    const match = output.match(/<task\s+id\s*=\s*["']([^"']+)["']/)
    if (match) return match[1]
  }
  return null
}

function taskChildState(part: ToolPart): InferredState {
  const sid = taskChildSessionId(part)
  if (sid) {
    const node = childNode(sid)
    if (node) {
      // Use the child session's inferred state from the store
      if (node.inferredState === 'running') return 'running'
      if (node.inferredState === 'completed') return 'completed'
      if (node.inferredState === 'error') return 'error'
    }
    // Check if there's a <task state="completed"> text part for this child
    // in the current display parts — that means the subagent finished
    for (const p of displayParts.value) {
      if (p.type === 'text') {
        const text = (p as TextPart).text || ''
        if (text.includes(`id="${sid}"`) || text.includes(`id='${sid}'`)) {
          if (text.includes('state="completed"') || text.includes("state='completed'")) {
            return 'completed'
          }
          if (text.includes('state="error"') || text.includes("state='error'")) {
            return 'error'
          }
        }
      }
    }
  }
  // Fallback: check the tool part's output XML for state
  const output = part.state?.output as string | undefined
  if (output) {
    const stateMatch = output.match(/state\s*=\s*["'](\w+)["']/)
    if (stateMatch) {
      if (stateMatch[1] === 'running') return 'running'
      if (stateMatch[1] === 'completed') return 'completed'
      if (stateMatch[1] === 'error') return 'error'
    }
  }
  // Last resort
  if (part.state?.status === 'error') return 'error'
  return 'running'
}

function taskChildAgent(part: ToolPart): string {
  // Check tool input first — this is the most reliable source for subagent_type
  // because it's set at task creation time and never changes.
  const input = part.state?.input
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    const subagentType = (input as Record<string, unknown>).subagent_type
    if (typeof subagentType === 'string' && subagentType !== 'unknown') return subagentType
  }
  // Fallback 1: read from tool input metadata (SSE parts)
  const meta = part.state?.metadata as Record<string, unknown> | undefined
  const fromMeta = meta?.subagent_type ?? meta?.subagentType ?? meta?.agent
  if (typeof fromMeta === 'string' && fromMeta !== 'unknown') return fromMeta
  // Fallback 2: check store for child session, but skip 'unknown' (placeholder)
  const sid = taskChildSessionId(part)
  if (sid) {
    const node = childNode(sid)
    if (node?.agent && node.agent !== 'unknown') return node.agent
  }
  // Fallback 3: input is a plain string — use first 30 chars as descriptor
  if (typeof input === 'string' && input.length > 0) {
    return input.slice(0, 30).replace(/\s+/g, ' ').trim() || 'subagent'
  }
  // Fallback 4: extract agent from output XML
  const output = part.state?.output
  if (typeof output === 'string') {
    const agentMatch = output.match(/agent\s*=\s*["']([^"']+)["']/)
    if (agentMatch) return agentMatch[1]
  }
  return 'subagent'
}

function taskChildParts(part: ToolPart): MessagePart[] {
  const sid = taskChildSessionId(part)
  if (!sid) return []
  const storeParts = childPartsOf(sid)
  if (storeParts.length > 0) return storeParts
  return fetchedChildParts.value.get(sid) ?? []
}

async function openTaskTab(part: ToolPart): Promise<void> {
  const sid = taskChildSessionId(part)
  if (sid) {
    await store.openTab(sid)
  }
}

// ─── Fetch child session parts for card preview ───────────────────────

const fetchedChildParts = shallowRef<Map<string, MessagePart[]>>(new Map())
const fetchingChildParts = new Set<string>()  // prevent concurrent fetches

async function fetchChildParts(sessionId: string): Promise<void> {
  if (fetchingChildParts.has(sessionId)) return
  fetchingChildParts.add(sessionId)
  try {
    const parts = await fetchParts(sessionId)
    const map = new Map(fetchedChildParts.value)
    map.set(sessionId, parts)
    fetchedChildParts.value = map
  } catch {
    // silently fail
  } finally {
    fetchingChildParts.delete(sessionId)
  }
}

// Auto-fetch child session parts when task tool parts appear in display.
// Debounced to avoid running on every delta flush (60fps during streaming).
// The periodic 3s interval (line ~613) handles running child session updates.
let childFetchDebounce: ReturnType<typeof setTimeout> | null = null
watch(displayParts, () => {
  if (childFetchDebounce) clearTimeout(childFetchDebounce)
  childFetchDebounce = setTimeout(() => {
    for (const part of displayParts.value) {
      if (part.type === 'tool' && (part as ToolPart).tool === 'task') {
        const sid = taskChildSessionId(part as ToolPart)
        if (sid) {
          const childNode = store.sessions.get(sid)
          // If child session not in store, fetch it from API and add it
          if (!childNode) {
            fetchChildSession(sid)
          }
          const isRunning = !childNode || childNode.inferredState === 'running' || childNode.inferredState === 'unknown'
          // Fetch if not yet fetched, or if child is still running (to get updates)
          if (!fetchedChildParts.value.has(sid) || isRunning) {
            fetchChildParts(sid)
          }
        }
      }
    }
  }, 500)
}, { immediate: true })

// Fetch a child session's info from the API and add it to the store
const fetchedSessionIds = new Set<string>()
async function fetchChildSession(sessionId: string): Promise<void> {
  if (fetchedSessionIds.has(sessionId)) return
  if (store.sessions.has(sessionId)) return
  fetchedSessionIds.add(sessionId)
  // Multi-instance: child sessions belong to the same server as the parent
  // session whose message stream contains the tool part that referenced them.
  const view = activeView.value
  const url = view?.session.instanceUrl || store.baseUrl
  try {
    const response = await httpFetch(`${url}/api/session/${sessionId}`)
    if (response.ok) {
      const body = await response.json()
      // API returns { data: SessionV2Info } for single session queries
      const sessionInfo = body.data
      if (sessionInfo && sessionInfo.id === sessionId) {
        store.addSession(sessionInfo, url)
      }
    }
  } catch {
    // silently fail
  }
}

function stateColor(status: string): string {
  switch (status) {
    case 'pending':   return 'var(--warning)'
    case 'running':   return 'var(--success)'
    case 'completed': return 'var(--text-muted)'
    default:          return 'var(--text-muted)'
  }
}

// ─── Reactive clock so relative timestamps re-render every second ──────

const now = ref(Date.now())
let clockInterval: number | null = null

onMounted(() => {
  clockInterval = window.setInterval(() => {
    now.value = Date.now()
    // Re-fetch running child sessions to get streaming updates
    for (const part of displayParts.value) {
      if (part.type === 'tool' && (part as ToolPart).tool === 'task') {
        const sid = taskChildSessionId(part as ToolPart)
        if (sid) {
          const childNode = store.sessions.get(sid)
          const isRunning = !childNode || childNode.inferredState === 'running' || childNode.inferredState === 'unknown'
          if (isRunning) {
            fetchChildParts(sid)  // fetchChildParts has dedup via fetchingChildParts set
          }
        }
      }
    }
  }, 3000)  // poll every 3 seconds for running children
})

onBeforeUnmount(() => {
  if (clockInterval !== null) {
    clearInterval(clockInterval)
    clockInterval = null
  }
})

function relativeAge(timestamp: number | null | undefined): string {
  if (!timestamp) return '—'
  return formatDuration(Math.max(0, now.value - timestamp))
}

// ─── Display helpers ───────────────────────────────────────────────────

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  if (totalSeconds < 1) return 'just now'
  if (totalSeconds < 60) return `${totalSeconds}s`
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  if (m < 60) return s ? `${m}m ${s}s` : `${m}m`
  const h = Math.floor(m / 60)
  const rm = m % 60
  return rm ? `${h}h ${rm}m` : `${h}h`
}

function reasoningDurationLabel(part: ReasoningPart): string {
  if (part.time?.start && part.time?.end) {
    const start = new Date(part.time.start).getTime()
    const end = new Date(part.time.end).getTime()
    const seconds = Math.max(0, (end - start) / 1000)
    if (seconds < 1) return 'for < 1s'
    if (seconds < 60) return `for ${seconds.toFixed(1)}s`
    const m = Math.floor(seconds / 60)
    const s = Math.round(seconds % 60)
    return `for ${m}m ${s}s`
  }
  return '…'
}

function toolStatusText(status: ToolPart['state']['status'] | undefined): string {
  switch (status) {
    case 'pending':   return 'pending'
    case 'running':   return 'running'
    case 'completed': return 'completed'
    case 'error':     return 'error'
    default:          return 'pending'
  }
}

function toolStatusKey(status: ToolPart['state']['status'] | undefined): string {
  return status ?? 'pending'
}

function childNode(sessionId: string): SessionNode | null {
  return store.sessions.get(sessionId) ?? null
}

function childStateOf(sessionId: string): InferredState {
  return childNode(sessionId)?.inferredState ?? 'unknown'
}

function childAgentOf(sessionId: string, fallback?: string): string {
  return childNode(sessionId)?.agent || fallback || 'subagent'
}

function childLastActivity(sessionId: string): number | null {
  return childNode(sessionId)?.lastEventTime ?? null
}

function childPartsOf(sessionId: string): MessagePart[] {
  return childNode(sessionId)?.messages ?? []
}

function tabStatusClass(sessionId: string): string {
  if (stuckAlertMap.value.has(sessionId)) return 'stuck'
  const node = store.sessions.get(sessionId)
  if (!node) return 'unknown'
  return node.inferredState
}

// ─── Tab actions ───────────────────────────────────────────────────────

function activateTab(sessionId: string): void {
  store.setActiveTab(sessionId)
}

function closeTab(sessionId: string, event: Event): void {
  event.stopPropagation()
  store.closeTab(sessionId)
}

// ─── Render helpers for tool output (handles string | object | undefined) ─

function toolOutputText(state: ToolPart['state'] | undefined): string {
  if (!state) return ''
  const out = state.output
  if (typeof out === 'string') return out
  if (out === undefined || out === null) return state.error ?? ''
  try {
    return JSON.stringify(out, null, 2)
  } catch {
    return String(out)
  }
}
</script>

<template>
  <section class="detail-pane">
    <!-- ─── Empty state ────────────────────────────────────────── -->
    <div v-if="!activeView" class="empty-state">
      <div class="empty-frame">
        <Terminal :size="22" class="empty-icon" />
        <p class="empty-title">No session selected</p>
        <p class="empty-hint">
          Click a session in the tree on the left to open it as a tab.
        </p>
      </div>
    </div>

    <template v-else>
      <!-- ─── Tab bar (browser-like) ─────────────────────────── -->
      <nav v-if="store.openTabs.length > 0" class="tab-bar" role="tablist">
        <div
          v-for="tab in store.openTabs"
          :key="tab.sessionId"
          role="tab"
          tabindex="0"
          class="tab"
          :data-parent="tab.isParent ? 'true' : 'false'"
          :class="{ active: store.activeTabId === tab.sessionId }"
          :aria-selected="store.activeTabId === tab.sessionId ? 'true' : 'false'"
          @click="activateTab(tab.sessionId)"
          @keydown.enter="activateTab(tab.sessionId)"
        >
          <Workflow v-if="tab.isParent" :size="10" class="tab-parent-icon" />
          <span class="tab-dot" :data-state="tabStatusClass(tab.sessionId)" />
          <span class="tab-label" :title="`${tab.agent} · ${tab.model}`">{{ tab.title || tab.sessionId.slice(0, 8) }}</span>
          <button
            type="button"
            class="tab-close"
            :aria-label="`Close ${tab.title || 'tab'}`"
            @click="closeTab(tab.sessionId, $event)"
          >
            <X :size="10" />
          </button>
        </div>
      </nav>

      <!-- ─── Header strip ─────────────────────────────────────── -->
      <header class="detail-header">
        <div class="header-row">
          <span class="agent-chip">
            <Terminal :size="11" />
            <span class="agent-name">{{ activeView.session.agent || 'core' }}</span>
            <span class="agent-model">{{ activeView.session.raw?.model?.modelID || activeView.session.raw?.model?.id || '' }}</span>
          </span>
          <span class="session-id" :title="activeView.session.id">
            {{ activeView.session.id.slice(0, 8) }}
          </span>
          <span
            v-if="activeView.session.inferredState !== 'completed'"
            class="status-dot"
            :data-state="activeView.session.inferredState"
            :data-stuck="isCurrentlyStuck ? 'true' : 'false'"
          />
          <span class="duration">
            <Clock :size="11" />
            {{ relativeAge(activeView.session.lastEventTime) }}
          </span>

          <!-- ─── Header actions: restore reverses; abort halts running sessions ─── -->
          <div class="header-actions">
            <button
              v-if="revertedMessageIds.size > 0"
              type="button"
              class="header-action-btn"
              title="Restore reverted messages"
              aria-label="Restore reverted messages"
              @click="unrevert(activeView.session.id)"
            >
              <Redo2 :size="11" />
            </button>
            <button
              v-if="activeView.session.inferredState === 'running'"
              type="button"
              class="header-action-btn header-action-btn--danger"
              title="Abort session"
              aria-label="Abort session"
              :disabled="inFlight[`${activeView.session.id}:abort`]"
              :aria-busy="inFlight[`${activeView.session.id}:abort`] ? 'true' : 'false'"
              @click="abortSession(activeView.session.id)"
            >
              <Loader2
                v-if="inFlight[`${activeView.session.id}:abort`]"
                :size="11"
                class="spin"
              />
              <StopCircle v-else :size="11" />
            </button>
          </div>
        </div>

        <div v-if="isCurrentlyStuck" class="stuck-banner">
          <AlertTriangle :size="13" />
          <span class="stuck-text">
            Stuck for <strong>{{ formatDuration(isCurrentlyStuck.elapsed) }}</strong>
            <span class="stuck-meta">— last event <code>{{ activeView.session.lastEventType }}</code></span>
          </span>
        </div>

        <div v-if="activeView.isParent && childStats" class="parent-summary-wrap">
          <button
            type="button"
            class="parent-summary"
            :class="{ active: bodyMode === 'children' }"
            :aria-expanded="bodyMode === 'children' ? 'true' : 'false'"
            :aria-controls="`child-list-${activeView.session.id}`"
            :title="bodyMode === 'children' ? 'Hide subagent list' : 'Show subagent list'"
            @click="toggleChildList"
          >
            <span class="summary-label">
              {{ childStats.total }} subagent{{ childStats.total === 1 ? '' : 's' }}
            </span>
            <span v-if="childStats.running > 0" class="summary-stat" data-tone="success">
              <Circle :size="7" />
              {{ childStats.running }} running
            </span>
            <span v-if="childStats.completed > 0" class="summary-stat" data-tone="muted">
              <CheckCircle2 :size="10" />
              {{ childStats.completed }} done
            </span>
            <span v-if="childStats.error > 0" class="summary-stat" data-tone="error">
              <XCircle :size="10" />
              {{ childStats.error }} error
            </span>
            <span v-if="childStats.stuck > 0" class="summary-stat" data-tone="warning">
              <AlertTriangle :size="10" />
              {{ childStats.stuck }} stuck
            </span>
            <span class="summary-toggle-glyph">
              <ChevronDown
                v-if="bodyMode === 'children'"
                :size="11"
              />
              <ChevronRight v-else :size="11" />
            </span>
          </button>
        </div>
      </header>

      <!-- ─── Body: message stream OR child list overlay OR diff ──────── -->
      <div
        v-if="bodyMode === 'stream'"
        ref="streamRef"
        class="tab-body message-stream"
        @scroll="onScroll"
      >
        <div v-if="visibleParts.length === 0" class="stream-empty">
          <p v-if="activeView.isParent" class="empty-hint">
            No messages yet. Subagent activity will appear as <code>subtask</code> parts arrive.
          </p>
          <p v-else class="empty-hint">
            No messages yet. Waiting for activity from <code>{{ activeView.session.agent }}</code>.
          </p>
        </div>

        <ol v-else class="parts">
          <li
            v-for="part in visibleParts"
            :key="part.id"
            class="part"
            :data-type="part.type"
          >
            <span class="part-marker" />

            <div class="part-body">
              <!-- ─── Text ─────────────────────────────────────── -->
              <MarkdownContent
                v-if="part.type === 'text' && !isTaskResultText(part)"
                class="text-part"
                :class="{ 'text-part--reverted': revertedMessageIds.has(part.messageID) }"
                :data-synthetic="(part as TextPart).synthetic ? 'true' : 'false'"
                :text="stripSystemInjections((part as TextPart).text || '')"
              />

              <!-- ─── Task result (text containing <task> XML) ──── -->
              <div
                v-else-if="part.type === 'text' && isTaskResultText(part)"
                class="task-result-block"
                :data-state="taskResultState((part as TextPart).text || '')"
              >
                <button
                  type="button"
                  class="task-result-toggle"
                  :aria-expanded="expandedTaskResults.has(part.id) ? 'true' : 'false'"
                  @click="toggleTaskResult(part.id)"
                >
                  <component
                    :is="expandedTaskResults.has(part.id) ? ChevronUp : ChevronDown"
                    :size="12"
                  />
                  <span class="task-result-summary">{{ taskResultSummary(stripSystemInjections((part as TextPart).text || '')) }}</span>
                </button>
                <div v-show="expandedTaskResults.has(part.id)" class="task-result-body">
                  <MarkdownContent :text="taskResultBody(stripSystemInjections((part as TextPart).text || ''))" />
                </div>
              </div>

              <!-- ─── Tool (non-task) ─────────────────────────── -->
              <div v-else-if="part.type === 'tool' && (part as ToolPart).tool !== 'task'" class="tool-part" :class="{ 'tool-part--card': isCardTool((part as ToolPart).tool), 'tool-part--inline': !isCardTool((part as ToolPart).tool) }">
                <div class="tool-header" :class="{ 'tool-header--card': isCardTool((part as ToolPart).tool) }">
                  <FileIcon v-if="extractFilePath((part as ToolPart).tool, (part as ToolPart).state?.input)" :file-name="extractFilePath((part as ToolPart).tool, (part as ToolPart).state?.input)!" :size="12" class="tool-header-icon" />
                  <component v-else :is="toolIcon((part as ToolPart).tool)" :size="12" class="tool-header-icon" />
                  <span class="tool-name">{{ (part as ToolPart).tool || 'tool' }}</span>
                  <span class="tool-state" :data-status="toolStatusKey((part as ToolPart).state?.status)">
                    <Loader2 v-if="(part as ToolPart).state?.status === 'running'" :size="10" class="spin" />
                    <CheckCircle2 v-else-if="(part as ToolPart).state?.status === 'completed'" :size="10" />
                    <XCircle v-else-if="(part as ToolPart).state?.status === 'error'" :size="10" />
                    <Circle v-else :size="10" />
                    {{ toolStatusText((part as ToolPart).state?.status) }}
                  </span>
                  <button
                    v-if="(part as ToolPart).state?.output || (part as ToolPart).state?.error"
                    type="button"
                    class="tool-toggle"
                    :aria-expanded="expandedToolBodies.has(part.id) ? 'true' : 'false'"
                    @click="toggleToolBody(part.id)"
                  >
                    <component
                      :is="expandedToolBodies.has(part.id) ? ChevronUp : ChevronDown"
                      :size="11"
                    />
                    {{ expandedToolBodies.has(part.id) ? 'hide' : 'output' }}
                  </button>
                </div>
                <div
                  v-if="expandedToolBodies.has(part.id) && ((part as ToolPart).state?.output || (part as ToolPart).state?.error)"
                  class="tool-body"
                >
                  <MarkdownContent :text="toolOutputText((part as ToolPart).state)" />
                </div>
              </div>

              <!-- ─── Task tool → inline subagent card ─────────── -->
              <article
                v-else-if="part.type === 'tool' && (part as ToolPart).tool === 'task'"
                class="subagent-card"
                :data-state="taskChildState(part as ToolPart)"
              >
                <button
                  type="button"
                  class="card-header"
                  @click="openTaskTab(part as ToolPart)"
                >
                  <span class="card-status">
                    <Loader2
                      v-if="taskChildState(part as ToolPart) === 'running'"
                      :size="12"
                      class="spin"
                    />
                    <CheckCircle2
                      v-else-if="taskChildState(part as ToolPart) === 'completed'"
                      :size="12"
                    />
                    <XCircle
                      v-else-if="taskChildState(part as ToolPart) === 'error'"
                      :size="12"
                    />
                    <Circle v-else :size="12" />
                  </span>
                  <span class="card-title">{{ taskChildAgent(part as ToolPart) }}</span>
                  <span class="card-expand-toggle" @click.stop="toggleSubtask(part.id)">
                    <component
                      :is="expandedSubtasks.has(part.id) ? ChevronUp : ChevronDown"
                      :size="11"
                    />
                  </span>
                </button>
                <div
                  v-show="expandedSubtasks.has(part.id)"
                  class="card-preview"
                >
                  <!-- Show child parts if available -->
                  <ul v-if="taskChildParts(part as ToolPart).length > 0" class="child-part-list">
                    <li
                      v-for="childPart in taskChildParts(part as ToolPart).slice(-8)"
                      :key="childPart.id"
                      class="child-part"
                      :data-type="childPart.type"
                    >
                      <template v-if="childPart.type === 'text'">
                        <MarkdownContent class="child-text" :text="stripSystemInjections((childPart as TextPart).text || '').slice(-240)" />
                      </template>
                      <template v-else-if="childPart.type === 'tool'">
                        <span class="child-tool">
                          <span class="child-tool-name">{{ (childPart as ToolPart).tool || 'tool' }}</span>
                          <span class="child-tool-state" :style="{ color: stateColor(toolStatusKey((childPart as ToolPart).state?.status)) }">
                            {{ toolStatusText((childPart as ToolPart).state?.status) }}
                          </span>
                        </span>
                      </template>
                      <template v-else-if="childPart.type === 'reasoning'">
                        <span class="child-other muted small">thinking…</span>
                      </template>
                      <template v-else>
                        <span class="child-other muted small">· {{ childPart.type }}</span>
                      </template>
                    </li>
                  </ul>
                  <!-- If no child parts, show the task tool's own output (result summary) -->
                  <MarkdownContent v-else-if="toolOutputText((part as ToolPart).state)" class="child-text task-result" :text="toolOutputText((part as ToolPart).state)" />
                  <p v-else class="child-empty muted small">
                    No output yet.
                  </p>
                </div>
              </article>

              <!-- ─── Reasoning (Zed-style thinking collapse) ────── -->
              <div v-else-if="part.type === 'reasoning'" class="thinking">
                <button
                  type="button"
                  class="thinking-toggle"
                  :aria-expanded="expandedReasoning.has(part.id) ? 'true' : 'false'"
                  @click="toggleReasoning(part.id)"
                >
                  <component
                    :is="expandedReasoning.has(part.id) ? ChevronUp : ChevronDown"
                    :size="12"
                  />
                  <span>Thinking {{ reasoningDurationLabel(part as ReasoningPart) }}</span>
                </button>
                <div v-show="expandedReasoning.has(part.id)" class="thinking-body">
                  <MarkdownContent :text="(part as ReasoningPart).text || ''" />
                </div>
              </div>

              <!-- ─── Subtask → inline subagent card ────────────── -->
              <article
                v-else-if="part.type === 'subtask'"
                class="subagent-card"
                :data-state="childStateOf((part as SubtaskPart).sessionID)"
              >
                <button
                  type="button"
                  class="card-header"
                  @click="openSubtaskTab(part as SubtaskPart)"
                >
                  <span class="card-status">
                    <Loader2
                      v-if="childStateOf((part as SubtaskPart).sessionID) === 'running'"
                      :size="12"
                      class="spin"
                    />
                    <CheckCircle2
                      v-else-if="childStateOf((part as SubtaskPart).sessionID) === 'completed'"
                      :size="12"
                    />
                    <XCircle
                      v-else-if="childStateOf((part as SubtaskPart).sessionID) === 'error'"
                      :size="12"
                    />
                    <Circle v-else :size="11" />
                  </span>
                  <span class="card-title">
                    {{ childAgentOf((part as SubtaskPart).sessionID, (part as SubtaskPart).summary) }}
                  </span>
                  <span class="card-time">
                    {{ relativeAge(childLastActivity((part as SubtaskPart).sessionID) ?? activeView?.session.lastEventTime ?? null) }}
                  </span>
                  <component
                    :is="expandedSubtasks.has(part.id) ? ChevronUp : ChevronDown"
                    :size="11"
                    class="card-chevron"
                  />
                </button>

                <div v-if="expandedSubtasks.has(part.id)" class="card-preview">
                  <ol
                    v-if="childPartsOf((part as SubtaskPart).sessionID).length > 0"
                    class="preview-list"
                  >
                    <li
                      v-for="cp in childPartsOf((part as SubtaskPart).sessionID).slice(-8)"
                      :key="cp.id"
                      class="preview-item"
                      :data-type="cp.type"
                    >
                      <span v-if="cp.type === 'text'" class="preview-text">
                        {{ stripSystemInjections((cp as TextPart).text || '').trim() }}
                      </span>
                      <span v-else-if="cp.type === 'tool'" class="preview-tool">
                        <span class="preview-tool-name">{{ (cp as ToolPart).tool || 'tool' }}</span>
                        <span
                          class="preview-tool-status"
                          :data-status="toolStatusKey((cp as ToolPart).state?.status)"
                        >
                          {{ toolStatusText((cp as ToolPart).state?.status) }}
                        </span>
                      </span>
                      <span v-else-if="cp.type === 'reasoning'" class="preview-other">thinking</span>
                      <span v-else class="preview-other">{{ cp.type }}</span>
                    </li>
                  </ol>
                  <p v-else class="preview-empty">No messages yet.</p>
                </div>
              </article>

              <!-- ─── Unknown / file / snapshot / etc. — keep visible as faint chip ─ -->
              <span v-else class="generic-chip">{{ part.type }}</span>
            </div>

            <!-- ─── Per-part action bar (revert / view diff) ─────────── -->
            <div
              v-if="canRevert(part)"
              class="part-actions"
              role="group"
              aria-label="Message actions"
            >
              <button
                type="button"
                class="part-action-btn"
                title="View file changes"
                aria-label="View file changes"
                @click="viewDiff(activeView.session.id, part.messageID); bodyMode = 'diff'"
              >
                <FileDiff :size="11" />
              </button>
              <button
                type="button"
                class="part-action-btn part-action-btn--warning"
                title="Revert this message"
                aria-label="Revert this message"
                :disabled="inFlight[`${activeView.session.id}:revert:${part.messageID}`]"
                :aria-busy="inFlight[`${activeView.session.id}:revert:${part.messageID}`] ? 'true' : 'false'"
                @click="handleRevert(part)"
              >
                <Loader2
                  v-if="inFlight[`${activeView.session.id}:revert:${part.messageID}`]"
                  :size="11"
                  class="spin"
                />
                <Undo2 v-else :size="11" />
              </button>
            </div>
          </li>
        </ol>
      </div>

      <!-- ─── Child-list overlay (parent sessions only) ───────── -->
      <div
        v-else-if="bodyMode === 'children'"
        :id="`child-list-${activeView.session.id}`"
        class="tab-body child-list-pane"
        role="region"
        :aria-label="`Subagents of ${activeView.session.agent}`"
      >
        <header class="child-list-header">
          <button
            type="button"
            class="back-to-messages"
            aria-label="Back to message stream"
            @click="toggleChildList"
          >
            <ArrowLeft :size="11" />
            <span>Back to messages</span>
          </button>
          <span class="child-list-meta">
            {{ activeView.session.children.length }} subagent{{ activeView.session.children.length === 1 ? '' : 's' }}
            <span class="dot-sep">·</span>
            click any to open in a new tab
          </span>
        </header>

        <ul v-if="activeView.session.children.length > 0" class="child-list">
          <li
            v-for="child in activeView.session.children"
            :key="child.id"
            class="child-row"
            :data-state="tabStatusClass(child.id)"
            @click="openChildFromList(child.id)"
          >
            <span
              class="child-row-dot"
              :data-state="tabStatusClass(child.id)"
              :aria-label="child.inferredState"
            />
            <span class="child-row-agent">{{ child.agent || 'subagent' }}</span>
            <span class="child-row-model">{{ child.raw?.model?.modelID || child.raw?.model?.id || '' }}</span>
            <span class="child-row-title" :title="child.title">
              {{ child.title || child.id.slice(0, 8) }}
            </span>
            <span class="child-row-time">
              <Clock :size="10" />
              {{ relativeAge(child.lastEventTime) }}
            </span>
          </li>
        </ul>
        <div v-else class="child-list-empty">
          <p class="empty-hint">
            This session has no subagents yet.
          </p>
        </div>
      </div>

      <!-- ─── Diff panel: changes from this message (revert context) ─────── -->
      <div
        v-else-if="bodyMode === 'diff'"
        class="tab-body diff-pane"
        role="region"
        aria-label="File changes"
      >
        <header class="diff-header">
          <button
            type="button"
            class="back-to-messages"
            aria-label="Back to messages"
            @click="bodyMode = 'stream'"
          >
            <ArrowLeft :size="11" />
            <span>Back to messages</span>
          </button>
          <span class="diff-meta">{{ diffFiles.length }} files changed</span>
        </header>

        <ul v-if="diffFiles.length > 0" class="diff-list">
          <li
            v-for="file in diffFiles"
            :key="file.path"
            class="diff-row"
            :data-status="file.status"
          >
            <span class="diff-status" :data-status="file.status" />
            <span class="diff-path">{{ file.path }}</span>
            <span class="diff-stats">
              <span class="diff-additions">+{{ file.additions }}</span>
              <span class="diff-deletions">-{{ file.deletions }}</span>
            </span>
          </li>
        </ul>
        <p v-else class="empty-hint" style="padding: var(--space-24);">No file changes.</p>
      </div>
    </template>
  </section>
</template>

<style scoped>
/* ─── Detail pane scaffold ──────────────────────────────────────────── */

.detail-pane {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg-editor);
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  user-select: none;
}

/* ─── Empty state ───────────────────────────────────────────────────── */

.empty-state {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-24);
}

.empty-frame {
  text-align: center;
  max-width: 320px;
}

.empty-icon {
  color: var(--text-placeholder);
  margin-bottom: var(--space-12);
}

.empty-title {
  font-size: var(--font-size-ui);
  color: var(--text-muted);
  margin-bottom: var(--space-6);
  font-weight: 500;
}

.empty-hint {
  font-size: var(--font-size-small);
  color: var(--text-placeholder);
  line-height: 1.5;
}

.empty-hint code,
.preview-empty code {
  font-family: var(--font-mono);
  color: var(--text-muted);
  background: var(--bg-element);
  padding: 1px var(--space-4);
  border-radius: var(--radius-xs);
}

/* ─── Tab bar (Zed-style horizontal tabs) ───────────────────────────── */

.tab-bar {
  height: 32px;
  display: flex;
  align-items: stretch;
  background: var(--bg-panel);
  border-bottom: 1px solid var(--border-variant);
  padding: 0 var(--space-4);
  overflow-x: auto;
  overflow-y: hidden;
  flex-shrink: 0;
  user-select: none;
}

.tab {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: var(--space-6);
  padding: 0 var(--space-8) 0 var(--space-12);
  background: var(--bg-element);
  border: none;
  border-right: 1px solid var(--border-variant);
  color: var(--text-muted);
  font-family: var(--font-ui);
  font-size: var(--font-size-small);
  cursor: pointer;
  min-width: 0;
  max-width: 200px;
  transition:
    background var(--duration-fast) var(--ease-out-quint),
    color var(--duration-fast) var(--ease-out-quint);
}

.tab:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.tab.active {
  background: var(--bg-selected);
  color: var(--text-primary);
}

.tab.active::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 2px;
  background: var(--text-accent);
}

.tab-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--text-placeholder);
  flex-shrink: 0;
}

.tab-dot[data-state='running'] {
  background: var(--success);
  animation: pulse-tab-running 2.2s var(--ease-out-quint) infinite;
}

.tab-dot[data-state='completed'] {
  background: var(--text-placeholder);
  opacity: 0.4;
}

.tab-dot[data-state='error'] {
  background: var(--error);
}

.tab-dot[data-state='stuck'] {
  background: var(--warning);
  animation: pulse-tab-warning 1.4s var(--ease-out-quint) infinite;
}

.tab-dot[data-state='unknown'] {
  background: var(--text-placeholder);
}

.tab-label {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tab-parent-icon {
  color: var(--text-accent);
  flex-shrink: 0;
  opacity: 0.85;
}

.tab[data-parent='true'] {
  /* A subdued accent-wash on parent tabs so they read as "containers"
     of other sessions at a glance — without competing with the active
     underline. */
  background-image: linear-gradient(
    to right,
    rgba(230, 180, 80, 0.06) 0,
    rgba(230, 180, 80, 0.06) 100%
  );
}

.tab[data-parent='true'].active {
  background-image: linear-gradient(
    to right,
    rgba(230, 180, 80, 0.10) 0,
    rgba(230, 180, 80, 0.10) 100%
  );
}

.tab-close {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  background: transparent;
  border: none;
  border-radius: var(--radius-xs);
  color: var(--text-placeholder);
  cursor: pointer;
  opacity: 0.55;
  transition:
    background var(--duration-fast) var(--ease-out-quint),
    color var(--duration-fast) var(--ease-out-quint),
    opacity var(--duration-fast) var(--ease-out-quint);
}

.tab:hover .tab-close {
  opacity: 1;
}

.tab-close:hover {
  background: var(--bg-active);
  color: var(--error);
}

@keyframes pulse-tab-running {
  0%, 100% {
    box-shadow: 0 0 0 1.5px rgba(112, 191, 86, 0.30);
    transform: scale(1);
  }
  50% {
    box-shadow: 0 0 0 4px rgba(112, 191, 86, 0.05);
    transform: scale(1.08);
  }
}

@keyframes pulse-tab-warning {
  0%, 100% {
    box-shadow: 0 0 0 1.5px rgba(230, 180, 80, 0.35);
    transform: scale(1);
  }
  50% {
    box-shadow: 0 0 0 6px rgba(230, 180, 80, 0.06);
    transform: scale(1.12);
  }
}

/* ─── Detail header ─────────────────────────────────────────────────── */

.detail-header {
  display: flex;
  flex-direction: column;
  gap: var(--space-8);
  padding: var(--space-12) var(--space-24) var(--space-12);
  background: var(--bg-app);
  border-bottom: 1px solid var(--border-variant);
  flex-shrink: 0;
}

.header-row {
  display: flex;
  align-items: center;
  gap: var(--space-12);
  flex-wrap: wrap;
  min-height: 24px;
}

.agent-chip {
  display: inline-flex;
  align-items: center;
  gap: var(--space-4);
  padding: 2px var(--space-8);
  background: var(--bg-element);
  border-radius: var(--radius-xs);
  color: var(--text-primary);
}

.agent-chip svg {
  color: var(--text-muted);
  flex-shrink: 0;
}

.agent-name {
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 500;
  text-transform: lowercase;
  letter-spacing: 0.02em;
}

.agent-model {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--text-placeholder);
  margin-left: var(--space-4);
  padding-left: var(--space-4);
  border-left: 1px solid var(--border-variant);
}

.session-id {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--text-placeholder);
}

.status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}

.status-dot[data-state='running'] {
  background: var(--success);
  box-shadow: 0 0 0 1.5px rgba(112, 191, 86, 0.25);
  animation: pulse-header-running 2.2s var(--ease-out-quint) infinite;
}

.status-dot[data-state='error'] {
  background: var(--error);
  box-shadow: 0 0 0 1.5px rgba(217, 87, 87, 0.25);
}

.status-dot[data-state='stuck'] {
  background: var(--warning);
  animation: pulse-header-warning 1.4s var(--ease-out-quint) infinite;
}

.status-dot[data-state='unknown'] {
  background: var(--text-placeholder);
  opacity: 0.55;
}

.duration {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: var(--space-4);
  color: var(--text-placeholder);
  font-family: var(--font-mono);
  font-size: 11px;
}

@keyframes pulse-header-running {
  0%, 100% {
    box-shadow: 0 0 0 1.5px rgba(112, 191, 86, 0.25);
    transform: scale(1);
  }
  50% {
    box-shadow: 0 0 0 4px rgba(112, 191, 86, 0.04);
    transform: scale(1.06);
  }
}

@keyframes pulse-header-warning {
  0%, 100% {
    box-shadow: 0 0 0 1.5px rgba(230, 180, 80, 0.35);
    transform: scale(1);
  }
  50% {
    box-shadow: 0 0 0 6px rgba(230, 180, 80, 0.05);
    transform: scale(1.10);
  }
}

/* ─── Stuck banner ──────────────────────────────────────────────────── */

.stuck-banner {
  display: flex;
  align-items: center;
  gap: var(--space-8);
  padding: var(--space-8) var(--space-12);
  background: rgba(230, 180, 80, 0.07);
  border: 1px solid rgba(230, 180, 80, 0.30);
  border-radius: var(--radius-sm);
  color: var(--warning);
  font-size: var(--font-size-small);
}

.stuck-text strong {
  font-weight: 600;
  color: var(--warning);
}

.stuck-meta {
  margin-left: var(--space-4);
  color: var(--text-muted);
  font-size: 11px;
}

.stuck-meta code {
  font-family: var(--font-mono);
  font-size: var(--font-size-code);
  background: var(--bg-element);
  padding: 1px var(--space-4);
  border-radius: var(--radius-xs);
  color: var(--text-muted);
}

/* ─── Parent subagent stats (clickable — toggles child list) ─────── */

.parent-summary-wrap {
  margin-top: var(--space-4);
}

.parent-summary {
  /* reset button defaults */
  appearance: none;
  background: transparent;
  border: 1px solid var(--border-variant);
  border-radius: var(--radius-sm);
  padding: var(--space-6) var(--space-12);
  /* layout */
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-8);
  font-family: var(--font-ui);
  font-size: var(--font-size-small);
  color: var(--text-muted);
  cursor: pointer;
  user-select: none;
  text-align: left;
  /* transition */
  transition:
    background var(--duration-fast) var(--ease-out-quint),
    border-color var(--duration-fast) var(--ease-out-quint),
    color var(--duration-fast) var(--ease-out-quint),
    box-shadow var(--duration-fast) var(--ease-out-quint);
}

.parent-summary:hover {
  background: var(--bg-hover);
  border-color: var(--border);
  color: var(--text-primary);
}

.parent-summary:focus-visible {
  outline: none;
  border-color: var(--border-focused);
  box-shadow: 0 0 0 1px var(--border-focused);
}

.parent-summary.active {
  background: var(--bg-selected);
  border-color: rgba(230, 180, 80, 0.35);
  color: var(--text-primary);
  box-shadow:
    inset 0 0 0 1px rgba(230, 180, 80, 0.30),
    0 0 0 0 transparent;
}

.parent-summary.active .summary-label {
  color: var(--text-accent);
}

.summary-toggle-glyph {
  margin-left: auto;
  color: var(--text-placeholder);
  display: inline-flex;
  align-items: center;
  transition: transform var(--duration-fast) var(--ease-out-quint);
}

.parent-summary:hover .summary-toggle-glyph {
  color: var(--text-muted);
}

.summary-label {
  font-family: var(--font-ui);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  font-size: 10px;
  color: var(--text-placeholder);
  transition: color var(--duration-fast) var(--ease-out-quint);
}

.summary-stat {
  display: inline-flex;
  align-items: center;
  gap: var(--space-4);
  padding: 2px var(--space-8);
  background: var(--bg-element);
  border-radius: var(--radius-xs);
  font-family: var(--font-mono);
  font-size: 10px;
}

.summary-stat[data-tone='success'] { color: var(--success); }
.summary-stat[data-tone='error']   { color: var(--error); }
.summary-stat[data-tone='warning'] { color: var(--warning); }
.summary-stat[data-tone='muted']   { color: var(--text-muted); }

/* ─── Child-list overlay (replaces message stream for parents) ────── */

/* Shared body class for the two interchangeable tabs of the right pane.
   Both the message stream and the child-list panel carry this — its job
   is to fill the remaining vertical space below the header. */
.tab-body {
  flex: 1;
  min-height: 0;
}

.child-list-pane {
  display: flex;
  flex-direction: column;
  /* Slide-in entrance: comes from +18px on the right, fades in. Becomes
     static once mounted. Uses will-change to keep paint cheap on the
     entrance frame. The animation is short (200ms) so it reads as
     "appear" rather than "travel". */
  animation: child-list-slide var(--duration-slow) var(--ease-out-quint);
  will-change: transform, opacity;
}

@keyframes child-list-slide {
  from {
    opacity: 0;
    transform: translateX(18px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}

.child-list-header {
  display: flex;
  align-items: center;
  gap: var(--space-8);
  padding: var(--space-8) var(--space-24);
  background: var(--bg-app);
  border-bottom: 1px solid var(--border-variant);
  flex-shrink: 0;
}

.back-to-messages {
  display: inline-flex;
  align-items: center;
  gap: var(--space-6);
  background: transparent;
  border: 1px solid var(--border-variant);
  border-radius: var(--radius-sm);
  padding: 2px var(--space-8);
  color: var(--text-muted);
  font-family: var(--font-ui);
  font-size: var(--font-size-small);
  cursor: pointer;
  transition:
    background var(--duration-fast) var(--ease-out-quint),
    border-color var(--duration-fast) var(--ease-out-quint),
    color var(--duration-fast) var(--ease-out-quint);
}

.back-to-messages:hover {
  background: var(--bg-hover);
  border-color: var(--border);
  color: var(--text-primary);
}

.back-to-messages:focus-visible {
  outline: none;
  border-color: var(--border-focused);
  box-shadow: 0 0 0 1px var(--border-focused);
}

.child-list-meta {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--text-placeholder);
  letter-spacing: 0.02em;
}

.child-list-meta .dot-sep {
  margin: 0 var(--space-4);
}

.child-list {
  list-style: none;
  margin: 0;
  padding: 0;
  flex: 1;
  overflow-y: auto;
  user-select: none;
}

.child-row {
  display: grid;
  grid-template-columns: 12px auto auto 1fr auto;
  align-items: center;
  gap: var(--space-12);
  height: 40px;
  padding: 0 var(--space-24);
  border: none;
  border-bottom: 1px solid var(--border-variant);
  background: transparent;
  cursor: pointer;
  transition:
    background var(--duration-fast) var(--ease-out-quint),
    border-color var(--duration-fast) var(--ease-out-quint);
  font-family: var(--font-ui);
  text-align: left;
}

.child-row:hover {
  background: var(--bg-hover);
}

.child-row:focus-visible {
  outline: none;
  background: var(--bg-selected);
  box-shadow: inset 2px 0 0 0 var(--border-focused);
}

.child-row:last-child {
  border-bottom: none;
}

.child-row-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--text-placeholder);
  flex-shrink: 0;
}

.child-row-dot[data-state='running']  { background: var(--success); animation: pulse-running-child 2.2s var(--ease-out-quint) infinite; }
.child-row-dot[data-state='completed'] { background: var(--text-muted); }
.child-row-dot[data-state='error']    { background: var(--error); }
.child-row-dot[data-state='stuck']    { background: var(--warning); animation: pulse-warning-child 1.4s var(--ease-out-quint) infinite; }
.child-row-dot[data-state='unknown']  { background: var(--text-placeholder); opacity: 0.4; }

.child-row-agent {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-primary);
  background: var(--bg-element);
  padding: 1px var(--space-6);
  border-radius: var(--radius-xs);
  text-transform: lowercase;
  letter-spacing: 0.02em;
}

.child-row-model {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--text-placeholder);
  white-space: nowrap;
}

.child-row-title {
  font-family: var(--font-ui);
  font-size: var(--font-size-ui);
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

.child-row-time {
  display: inline-flex;
  align-items: center;
  gap: var(--space-4);
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--text-placeholder);
  flex-shrink: 0;
  background: var(--bg-app);
  padding: 1px var(--space-6);
  border-radius: var(--radius-xs);
}

.child-list-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-24);
}

@keyframes pulse-running-child {
  0%, 100% { box-shadow: 0 0 0 1.5px rgba(112, 191, 86, 0.25); }
  50%      { box-shadow: 0 0 0 4px rgba(112, 191, 86, 0.05); }
}

@keyframes pulse-warning-child {
  0%, 100% { box-shadow: 0 0 0 1.5px rgba(230, 180, 80, 0.32); }
  50%      { box-shadow: 0 0 0 6px rgba(230, 180, 80, 0.06); }
}

/* ─── Message stream ────────────────────────────────────────────────── */

.message-stream {
  flex: 1;
  overflow-y: auto;
  padding: var(--space-12) var(--space-24) var(--space-24);
  user-select: text;
}

.stream-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  user-select: none;
}

.parts {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.part {
  display: grid;
  grid-template-columns: 18px 1fr;
  gap: var(--space-8);
  padding: var(--space-2) 0;
  min-width: 0;
}

.part-marker {
  width: 6px;
  height: 6px;
  margin-top: 10px;
  border-radius: 50%;
  background: var(--text-placeholder);
  justify-self: center;
  opacity: 0.5;
}

.part[data-type='text'] .part-marker { background: var(--info); }
.part[data-type='tool'] .part-marker { background: var(--success); }
.part[data-type='reasoning'] .part-marker { background: rgba(141, 147, 158, 0.6); }
.part[data-type='subtask'] .part-marker { background: var(--text-accent); }

.part-body {
  min-width: 0;
}

/* ─── Text part ─────────────────────────────────────────────────────── */

.text-part {
  font-size: var(--font-size-code);
  line-height: 1.55;
  color: var(--text-primary);
  word-break: break-word;
  margin: 0;
  padding: var(--space-6) var(--space-12);
  border-radius: var(--radius-sm);
  background: var(--bg-panel);
  user-select: text;
}

.text-part[data-synthetic='true'] {
  color: var(--text-muted);
  font-style: italic;
}

/* ─── Task result block (collapsible <task> XML) ─────────────────────── */

.task-result-block {
  background: var(--bg-panel);
  border: 1px solid var(--border-variant);
  border-radius: var(--radius-sm);
  overflow: hidden;
}

.task-result-toggle {
  display: flex;
  align-items: center;
  gap: var(--space-6);
  padding: var(--space-6) var(--space-12);
  background: transparent;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  font-family: var(--font-ui);
  font-size: var(--font-size-small);
  width: 100%;
  text-align: left;
  transition: background var(--duration-fast) var(--ease-out-quint);
}

.task-result-toggle:hover {
  background: var(--bg-hover);
}

.task-result-summary {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.task-result-body {
  padding: var(--space-4) var(--space-12);
  border-top: 1px solid var(--border-variant);
}

.task-result-body pre {
  font-family: var(--font-mono);
  font-size: var(--font-size-code);
  line-height: 1.55;
  color: var(--text-primary);
  white-space: pre-wrap;
  word-break: break-word;
  margin: 0;
  user-select: text;
  max-height: 400px;
  overflow-y: auto;
}

.task-result-block[data-state='completed'] .task-result-toggle {
  color: var(--success);
}

.task-result-block[data-state='error'] .task-result-toggle {
  color: var(--error);
}

.task-result-block[data-state='running'] .task-result-toggle {
  color: var(--info);
}

/* ─── Tool part ─────────────────────────────────────────────────────── */

.tool-part {
  background: var(--bg-panel);
  border: 1px solid var(--border-variant);
  border-radius: var(--radius-sm);
  overflow: hidden;
}

.tool-row {
  display: flex;
  align-items: center;
  gap: var(--space-8);
  padding: var(--space-8) var(--space-12);
  flex-wrap: wrap;
}

.tool-name {
  font-family: var(--font-mono);
  font-size: var(--font-size-code);
  color: var(--text-primary);
  font-weight: 500;
}

.tool-state {
  display: inline-flex;
  align-items: center;
  gap: var(--space-4);
  padding: 1px var(--space-6);
  font-family: var(--font-mono);
  font-size: 10px;
  border-radius: var(--radius-xs);
  background: var(--bg-element);
  text-transform: lowercase;
}

.tool-state[data-status='pending']   { color: var(--warning); }
.tool-state[data-status='running']   { color: var(--info); }
.tool-state[data-status='completed'] { color: var(--success); }
.tool-state[data-status='error']     { color: var(--error); }

.spin {
  animation: spin 1s linear infinite;
}

.tool-toggle {
  margin-left: auto;
  background: transparent;
  border: none;
  color: var(--text-placeholder);
  font-family: var(--font-ui);
  font-size: 11px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px var(--space-4);
  border-radius: var(--radius-xs);
  transition: background var(--duration-fast) var(--ease-out-quint);
  user-select: none;
}

.tool-toggle:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.tool-body {
  padding: var(--space-8) var(--space-12);
  background: var(--bg-editor);
  border-top: 1px solid var(--border-variant);
}

.tool-body pre {
  margin: 0;
  font-family: var(--font-mono);
  font-size: var(--font-size-code);
  color: var(--text-muted);
  white-space: pre-wrap;
  word-break: break-word;
  user-select: text;
}

/* ─── Thinking Block (Zed-aligned) ─── */

.thinking {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.thinking-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  height: 18px;
  padding-right: 4px;
  position: relative;
  cursor: pointer;
  background: none;
  border: none;
}

.thinking-toggle-left {
  display: flex;
  align-items: center;
  gap: 6px;
  overflow: hidden;
}

.thinking-toggle-icon {
  color: var(--text-muted);
  flex-shrink: 0;
}

.thinking-toggle-label {
  font-size: 13px;
  color: var(--text-muted);
}

.thinking-toggle-disclosure {
  opacity: 0;
  transition: opacity 150ms var(--ease-out-quint);
  color: var(--text-muted);
}

.thinking-toggle:hover .thinking-toggle-disclosure {
  opacity: 1;
}

.thinking-body {
  margin-left: 6px;
  padding-left: 14px;
  padding-top: 8px;
  border-left: 1px solid var(--border);
  max-height: 256px;
  overflow: hidden;
  position: relative;
}

/* Zed-style bottom gradient mask — fades into panel bg */
.thinking-body::after {
  content: '';
  position: absolute;
  inset: auto 0 0 0;
  height: 32px;
  background: linear-gradient(
    180deg,
    rgb(20 24 33 / 0) 0%,
    rgb(20 24 33 / 0.85) 100%
  );
  pointer-events: none;
}

/* ─── Inline subagent card (Zed pattern) ────────────────────────────── */

.subagent-card {
  border: 1px solid var(--border-variant);
  border-radius: var(--radius-md);
  overflow: hidden;
  background: var(--bg-panel);
  transition: border-color var(--duration-fast) var(--ease-out-quint);
}

.subagent-card:hover {
  border-color: var(--border);
}

.subagent-card[data-state='error'] {
  border: 1px dashed rgba(217, 87, 87, 0.45);
}

.subagent-card[data-state='running'] {
  border-color: rgba(112, 191, 86, 0.30);
}

.card-header {
  display: grid;
  grid-template-columns: 16px 1fr auto;
  align-items: center;
  gap: var(--space-8);
  width: 100%;
  height: 32px;
  padding: 0 var(--space-12);
  background: var(--bg-element);
  border: none;
  border-bottom: 1px solid var(--border-variant);
  font-family: var(--font-ui);
  font-size: var(--font-size-small);
  color: var(--text-primary);
  text-align: left;
  cursor: pointer;
  user-select: none;
  transition: background var(--duration-fast) var(--ease-out-quint);
}

.card-expand-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  color: var(--text-muted);
  border-radius: var(--radius-xs);
  flex-shrink: 0;
}

.card-expand-toggle:hover {
  background: var(--bg-active);
  color: var(--text-primary);
}

.subagent-card.expanded .card-header,
.card-header:hover {
  background: var(--bg-hover);
}

.card-status {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
}

.subagent-card[data-state='running'] .card-status { color: var(--success); }
.subagent-card[data-state='completed'] .card-status { color: var(--success); }
.subagent-card[data-state='error'] .card-status { color: var(--error); }

.card-title {
  font-weight: 500;
  font-family: var(--font-mono);
  font-size: 11px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--text-primary);
}

.card-time {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--text-placeholder);
  padding: 1px var(--space-6);
  background: var(--bg-app);
  border-radius: var(--radius-xs);
}

.card-chevron {
  color: var(--text-placeholder);
  flex-shrink: 0;
}

.card-preview {
  background: var(--bg-editor);
  max-height: 220px;
  overflow-y: auto;
  padding: var(--space-8) var(--space-12);
  user-select: text;
}

.preview-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.preview-item {
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1.45;
  padding-left: var(--space-8);
  border-left: 2px solid var(--border-variant);
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--text-muted);
}

.preview-item[data-type='text'] { border-left-color: rgba(89, 194, 255, 0.35); color: var(--text-muted); }
.preview-item[data-type='tool'] { border-left-color: rgba(112, 191, 86, 0.30); color: var(--text-muted); }
.preview-item[data-type='reasoning'] { border-left-color: rgba(141, 147, 158, 0.40); color: var(--text-placeholder); }

.preview-text {
  display: block;
}

.preview-tool {
  display: inline-flex;
  align-items: center;
  gap: var(--space-6);
}

.preview-tool-name {
  color: var(--text-primary);
}

.preview-tool-status {
  font-size: 10px;
  text-transform: lowercase;
  padding: 1px var(--space-4);
  background: var(--bg-element);
  border-radius: var(--radius-xs);
}

.preview-tool-status[data-status='pending']   { color: var(--warning); }
.preview-tool-status[data-status='running']   { color: var(--info); }
.preview-tool-status[data-status='completed'] { color: var(--success); }
.preview-tool-status[data-status='error']     { color: var(--error); }

.preview-other {
  font-style: italic;
  color: var(--text-placeholder);
  text-transform: lowercase;
}

.preview-empty {
  font-size: var(--font-size-small);
  color: var(--text-placeholder);
  margin: 0;
}

/* ─── Generic chip (unhandled part types) ───────────────────────────── */

.generic-chip {
  display: inline-flex;
  align-items: center;
  padding: 2px var(--space-8);
  background: var(--bg-element);
  border: 1px solid var(--border-variant);
  border-radius: var(--radius-xs);
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--text-placeholder);
  text-transform: lowercase;
  user-select: none;
}

/* ─── Header actions (undo / abort) ─────────────────────────────────────── */
/* Right-aligned action cluster in the detail-header. Sits flush to the right
   edge, just past the duration span. Border-left creates a visual divider
   between the session metadata and the action affordances. */

.header-actions {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  padding-left: var(--space-12);
  border-left: 1px solid var(--border-variant);
}

.header-action-btn {
  width: 24px;
  height: 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  border-radius: var(--radius-xs);
  color: var(--text-muted);
  cursor: pointer;
  transition:
    background var(--duration-fast) var(--ease-out-quint),
    color var(--duration-fast) var(--ease-out-quint);
}

.header-action-btn:hover {
  background: var(--bg-hover);
}

.header-action-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.header-action-btn:focus-visible {
  outline: none;
  box-shadow: 0 0 0 1px var(--border-focused);
}

.header-action-btn--danger:hover {
  color: var(--error);
}

/* ─── Per-part action bar (revert / diff) ─────────────────────────────────- */
/* Anchored to the .part li on hover. Hidden by default and translated 1px
   up to read as "appearing into view" on hover/focus. Provides a single
   locus for typing-related affordances (revert, view changes). */

.part { position: relative; }

.part-actions {
  position: absolute;
  top: 4px;
  right: 4px;
  display: flex;
  gap: 2px;
  opacity: 0;
  pointer-events: none;
  transform: translateY(-1px);
  transition:
    opacity var(--duration-fast) var(--ease-out-quint),
    transform var(--duration-fast) var(--ease-out-quint);
}

.part:hover .part-actions,
.part:focus-within .part-actions {
  opacity: 1;
  pointer-events: auto;
  transform: translateY(0);
}

.part-action-btn {
  width: 22px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-panel);
  border: 1px solid transparent;
  border-radius: var(--radius-xs);
  color: var(--text-muted);
  cursor: pointer;
  transition:
    background var(--duration-fast) var(--ease-out-quint),
    color var(--duration-fast) var(--ease-out-quint),
    border-color var(--duration-fast) var(--ease-out-quint);
}

.part-action-btn:hover {
  background: var(--bg-hover);
  border-color: var(--border-variant);
  color: var(--text-primary);
}

.part-action-btn:focus-visible {
  outline: none;
  box-shadow: 0 0 0 1px var(--border-focused);
}

.part-action-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.part-action-btn--warning {
  color: rgba(230, 180, 80, 0.65);
}

.part-action-btn--warning:hover {
  color: var(--warning);
  border-color: rgba(230, 180, 80, 0.45);
}

/* ─── Ghost state for reverted messages ──────────────────────────────────── */
/* Strikethrough + dimmed text read as "this message has been undone" without
   hiding it entirely. Keeping it visible preserves the user's historical
   context — they can still see what was asked, just struck out. */

.text-part--reverted {
  text-decoration: line-through;
  color: var(--text-placeholder);
  opacity: 0.6;
}

/* ─── Diff panel (third body mode) ─────────────────────────────────────── */
/* Reuses the .tab-body scaffold used by the message stream and child list.
   The slide-in animation is shared so transitions feel consistent across
   body switches. */

.diff-pane {
  display: flex;
  flex-direction: column;
  animation: child-list-slide var(--duration-slow) var(--ease-out-quint);
}

.diff-header {
  display: flex;
  align-items: center;
  gap: var(--space-12);
  padding: var(--space-8) var(--space-24);
  border-bottom: 1px solid var(--border-variant);
  background: var(--bg-panel);
  flex-shrink: 0;
}

/* Diff-pane-scoped back-to-messages: borderless variant. The child-list
   version uses a bordered button; we keep that styling there by scoping
   the borderless rule to .diff-pane (higher specificity). */
.diff-pane .back-to-messages {
  display: inline-flex;
  align-items: center;
  gap: var(--space-4);
  background: transparent;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  font-family: var(--font-ui);
  font-size: var(--font-size-small);
  padding: 0;
  transition: color var(--duration-fast) var(--ease-out-quint);
}

.diff-pane .back-to-messages:hover {
  color: var(--text-primary);
  background: transparent;
}

.diff-meta {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--text-placeholder);
  margin-left: auto;
}

.diff-list {
  list-style: none;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  flex: 1;
  user-select: text;
}

.diff-row {
  display: grid;
  grid-template-columns: 12px 1fr auto;
  align-items: center;
  gap: var(--space-12);
  height: 32px;
  padding: 0 var(--space-24);
  border-bottom: 1px solid var(--border-variant);
  font-family: var(--font-mono);
  font-size: 11px;
  transition: background var(--duration-fast) var(--ease-out-quint);
}

.diff-row:hover {
  background: var(--bg-hover);
}

.diff-status {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.diff-status[data-status='added']    { background: var(--vc-added, #7fd962); }
.diff-status[data-status='modified'] { background: var(--vc-modified, #ffb454); }
.diff-status[data-status='deleted']  { background: var(--vc-deleted, #e26b73); }
.diff-status[data-status='renamed']  { background: var(--info, #59c2ff); }

.diff-path {
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

.diff-stats {
  display: inline-flex;
  gap: var(--space-4);
  font-size: 10px;
}

.diff-additions { color: var(--success, #7fd962); }
.diff-deletions { color: var(--error, #e26b73); }

/* ─── Animations (shared) ───────────────────────────────────────────── */

@keyframes spin {
  from { transform: rotate(0deg); }
  to   { transform: rotate(360deg); }
}

.tool-header-icon {
  flex-shrink: 0;
  color: var(--text-muted);
  opacity: 0.7;
}

/* ─── Tool Call Card/Inline Layout (Zed-aligned) ─── */

.tool-part {
  margin: 6px 0;
}

.tool-part--card {
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-editor);
  overflow: hidden;
}

.tool-part--card.tool-part--failed {
  border-style: dashed;
}

.tool-part--inline {
  margin: 4px 0;
}

.tool-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  position: relative;
  width: 100%;
}

.tool-header--card {
  padding: 2px;
  border-radius: 5px 5px 0 0;
  background: var(--bg-element);
}

.tool-header-left {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 18px;
  font-size: 13px;
  overflow: hidden;
}

.tool-header-icon {
  color: var(--text-muted);
  flex-shrink: 0;
}

.tool-header-name {
  font-family: var(--font-mono);
  font-size: 13px;
  color: var(--text-muted);
}

.tool-header-gradient {
  position: absolute;
  top: 0;
  right: 0;
  width: 48px;
  height: 100%;
  background: linear-gradient(
    90deg,
    transparent 0%,
    var(--bg-element) 100%
  );
  pointer-events: none;
}

.tool-disclosure {
  opacity: 0;
  transition: opacity 150ms var(--ease-out-quint);
  color: var(--text-muted);
}

.tool-header:hover .tool-disclosure {
  opacity: 1;
}

.tool-body {
  margin-left: 6px;
  padding: 8px 14px;
  border-left: 1px solid var(--border);
  border-top: 1px solid var(--border);
}
</style>
