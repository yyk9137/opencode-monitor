import { ref } from 'vue'
import { fetch } from '@tauri-apps/plugin-http'
import { invoke } from '@tauri-apps/api/core'
import { useSessionStore } from '@/stores/session'
import type {
  SSEEvent,
  SessionV2Info,
  SessionListResponse,
  SessionCreatedEvent,
  SessionUpdatedEvent,
  MessagePartUpdatedEvent,
  MessagePartDeltaEvent,
  FinishReason,
} from '@/types'

interface UseEventStreamReturn {
  connected: ReturnType<typeof ref<boolean>>
  connectAll: (urls: string[]) => void
  disconnectAll: () => void
  reconnect: () => void
}

const MAX_RECONNECT_DELAY = 30000

interface ConnState {
  url: string
  es: EventSource | null
  timer: ReturnType<typeof setTimeout> | null
  attempts: number
  markedConnected: boolean  // tracks whether we've fired setInstanceConnected(true)
}

export function useEventStream(): UseEventStreamReturn {
  const store = useSessionStore()
  const connected = ref(false)
  const connections = new Map<string, ConnState>()

  function updateAggregateStatus(): void {
    const anyOpen = Array.from(connections.values()).some((s) => s.es !== null)
    connected.value = anyOpen
    store.setConnectionStatus(anyOpen ? 'connected' : 'disconnected')
  }

  function scheduleReconnect(state: ConnState): void {
    if (state.timer) clearTimeout(state.timer)
    const delay = Math.min(1000 * Math.pow(2, state.attempts), MAX_RECONNECT_DELAY)
    state.timer = setTimeout(() => {
      state.attempts++
      connectInstance(state.url)
    }, delay)
  }

  // Pulls the canonical session list from one instance after the SSE
  // handshake completes. Catches up on sessions created before we connected.
  async function reconcileInstance(url: string): Promise<void> {
    try {
      // Use directory filter if we know the project dir for this instance
      const inst = store.instances.find(i => i.url === url)
      const dir = inst?.projectDir
      const sessionUrl = dir
        ? `${url}/api/session?directory=${encodeURIComponent(dir)}`
        : `${url}/api/session`
      console.log(`[reconcile] ${url} projectDir=${dir ?? 'none'} → ${sessionUrl}`)
      invoke('write_debug_log', { lines: `[reconcile] ${url} projectDir=${dir ?? 'none'} → ${sessionUrl}` }).catch(() => {})
      const response = await fetch(sessionUrl)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const body: SessionListResponse = await response.json()

      for (const sessionInfo of body.data) {
        if (!store.sessions.has(sessionInfo.id)) {
          store.addSession(sessionInfo, url)
        }
      }

      // Clean up stale sessions: if the monitor's store has sessions tagged
      // to this instance that no longer exist on the server (e.g. after an
      // opencode restart or external abort), mark them as 'error' so they
      // stop being flagged as running/stuck.
      const serverSessionIds = new Set(body.data.map((s) => s.id))
      for (const [sessionId, node] of store.sessions.entries()) {
        if (
          node.instanceUrl === url &&
          !serverSessionIds.has(sessionId) &&
          (node.inferredState === 'running' || node.inferredState === 'unknown')
        ) {
          store.backfillState(sessionId, 'error', null)
        }
      }

      // Backfill unknown sessions during disconnect window using the legacy
      // /session/:id/message endpoint, which carries conversation parts.
      for (const sessionInfo of body.data) {
        const node = store.sessions.get(sessionInfo.id)
        if (node?.inferredState !== 'unknown') continue
        try {
          const msgResponse = await fetch(`${url}/session/${sessionInfo.id}/message`)
          if (!msgResponse.ok) continue
          const messages: Array<{ info: { role: string }; parts: Array<{ type: string; reason?: string }> }> = await msgResponse.json()

          let lastFinishReason: string | null = null
          for (const msg of messages) {
            for (const part of msg.parts) {
              if (part.type === 'step-finish' && part.reason) {
                lastFinishReason = part.reason
              }
            }
          }

          if (lastFinishReason && lastFinishReason !== 'tool-calls') {
            store.backfillState(sessionInfo.id, 'completed', lastFinishReason as FinishReason)
          } else if (!lastFinishReason) {
            const created = sessionInfo.time.created
            const updated = sessionInfo.time.updated
            if (updated && created && updated > created) {
              store.backfillState(sessionInfo.id, 'completed', null)
            }
          }
        } catch {
          // Next reconcile cycle retries
        }
      }

      // Re-verify 'running' sessions on this instance whose lastEventTime is
      // older than 30s (i.e. not actively streaming). Catches completions
      // during a disconnect window where no SSE event arrived.
      const thirtySecAgo = Date.now() - 30000
      for (const sessionInfo of body.data) {
        const node = store.sessions.get(sessionInfo.id)
        if (!node || node.inferredState !== 'running' || node.lastEventTime > thirtySecAgo) continue
        try {
          const msgResponse = await fetch(`${url}/session/${sessionInfo.id}/message`)
          if (!msgResponse.ok) continue
          const messages: Array<{
            info: { time?: { created?: string | number; updated?: string | number } }
            parts: Array<{ type: string; reason?: string; state?: { status?: string } }>
          }> = await msgResponse.json()

          let lastFinishReason: string | null = null
          let hasRunningTool = false
          for (const msg of messages) {
            for (const part of msg.parts) {
              if (part.type === 'step-finish' && part.reason) {
                lastFinishReason = part.reason
              }
              if (part.type === 'tool' && part.state?.status === 'running') {
                hasRunningTool = true
              }
            }
          }

          let newState: 'running' | 'completed' | null = null
          if (hasRunningTool) {
            newState = 'running'
          } else if (lastFinishReason && lastFinishReason !== 'tool-calls') {
            newState = 'completed'
          } else if (!lastFinishReason) {
            const created = sessionInfo.time.created
            const updated = sessionInfo.time.updated
            if (updated && created && updated > created) {
              newState = 'completed'
            }
          }

          if (newState && newState !== node.inferredState) {
            store.backfillState(sessionInfo.id, newState, lastFinishReason as FinishReason)
          }
        } catch {
          // One failure shouldn't abort the loop
        }
      }
    } catch {
      // Silently fail — next reconnect cycle retries
    }
  }

  function handleEvent(event: MessageEvent<string>, url: string): void {
    try {
      const parsed: SSEEvent = JSON.parse(event.data)
      const data = parsed.data as Record<string, unknown>

      switch (parsed.type) {
        case 'session.created': {
          const d = data as unknown as SessionCreatedEvent
          if (d.info && typeof d.info === 'object') {
            store.addSession(d.info, url)
          } else {
            const session = (data as Record<string, unknown>).session ?? (data as Record<string, unknown>).data
            if (session && typeof session === 'object') {
              store.addSession(session as SessionV2Info, url)
            }
          }
          break
        }
        case 'session.updated': {
          const d = data as unknown as SessionUpdatedEvent
          if (d.sessionID && d.info) {
            store.updateSession({ sessionID: d.sessionID, ...d.info })
          }
          break
        }
        case 'session.idle': {
          // Session became idle — LLM finished responding, no more tool calls
          // pending. This fires when a session transitions from active to
          // idle, including after an abort or natural completion.
          const d = data as { sessionID?: string }
          if (d.sessionID) {
            store.backfillState(d.sessionID, 'completed', null)
          }
          break
        }
        case 'session.status': {
          // Session status event carries status as an OBJECT with .type, not a string.
          // Fix: use object-shape parsing instead of string comparison.
          const d = data as { sessionID?: string; status?: { type?: string } }
          if (d.sessionID && d.status?.type) {
            const t = d.status.type
            if (t === 'idle') {
              store.backfillState(d.sessionID, 'completed', null)
            } else if (t === 'busy' || t === 'retry') {
              // busy/retry means the session is actively working — ensure running
              const node = store.sessions.get(d.sessionID)
              if (node && (node.inferredState === 'unknown' || node.inferredState === 'completed')) {
                store.backfillState(d.sessionID, 'running', null)
              }
            }
          }
          break
        }
        case 'session.error':
        case 'session.deleted': {
          // Session error or deleted — mark as error to stop stuck detection
          const d = data as { sessionID?: string }
          if (d.sessionID) store.backfillState(d.sessionID, 'error', null)
          break
        }
        case 'message.part.updated': {
          const d = data as unknown as MessagePartUpdatedEvent
          if (d.sessionID && d.part) {
            store.addMessagePart(d)
            // Signal A (§5.7): step-finish carries the finish reason.
            if (d.part.type === 'step-finish') {
              const part = d.part as { type: string; reason?: string }
              const reason = part.reason
              if (reason && reason !== 'tool-calls') {
                store.backfillState(d.sessionID, 'completed', reason as FinishReason)
              }
            }
          }
          break
        }
        case 'message.part.delta': {
          const d = data as unknown as MessagePartDeltaEvent
          if (d.sessionID && d.partID && d.delta) {
            store.appendMessageDelta(d)
          }
          break
        }
        default:
          break
      }
    } catch {
      // Ignore malformed events
    }
  }

  function connectInstance(url: string): void {
    // Tear down any previous attempt for this URL before re-opening.
    const prev = connections.get(url)
    if (prev?.es) prev.es.close()
    if (prev?.timer) clearTimeout(prev.timer)

    const state: ConnState = { url, es: null, timer: null, attempts: prev?.attempts ?? 0, markedConnected: false }
    connections.set(url, state)
    store.setInstanceConnected(url, false)

    try {
      const es = new EventSource(`${url}/api/event`)
      state.es = es

      es.onopen = () => {
        state.attempts = 0
        state.markedConnected = true
        store.setInstanceConnected(url, true)
        updateAggregateStatus()
        reconcileInstance(url)
      }

      es.onmessage = (event) => {
        // Fix: if onopen didn't fire reliably, mark connected on first message
        if (!state.markedConnected) {
          state.markedConnected = true
          store.setInstanceConnected(url, true)
          updateAggregateStatus()
        }
        handleEvent(event, url)
      }

      es.onerror = () => {
        store.setInstanceConnected(url, false)
        es.close()
        state.es = null
        updateAggregateStatus()
        scheduleReconnect(state)
      }
    } catch {
      // EventSource construction can throw synchronously on malformed URLs.
      scheduleReconnect(state)
      updateAggregateStatus()
    }
  }

  function connectAll(urls: string[]): void {
    // Close anything we no longer want.
    for (const [url, state] of connections.entries()) {
      if (!urls.includes(url)) {
        state.es?.close()
        if (state.timer) clearTimeout(state.timer)
        connections.delete(url)
      }
    }
    // (Re)open every requested URL.
    for (const url of urls) connectInstance(url)
    updateAggregateStatus()
  }

  function disconnectAll(): void {
    for (const state of connections.values()) {
      state.es?.close()
      if (state.timer) clearTimeout(state.timer)
    }
    connections.clear()
    connected.value = false
    store.setConnectionStatus('disconnected')
    // Mark all store-instances as disconnected so the UI reflects reality.
    for (const inst of store.instances) {
      store.setInstanceConnected(inst.url, false)
    }
  }

  function reconnect(): void {
    const urls = Array.from(connections.keys())
    connectAll(urls)
  }

  return { connected, connectAll, disconnectAll, reconnect }
}
