import { fetch } from '@tauri-apps/plugin-http'
import { useSessionStore } from '@/stores/session'
import type {
  SessionListResponse,
  SessionV2Info,
  FinishReason,
} from '@/types'

// Legacy API response shape (GET /session/:id/message)
interface LegacyMessage {
  info: {
    id: string
    sessionID: string
    role: string
    time?: { created: string | number }
    [key: string]: unknown
  }
  parts: Array<{
    id: string
    type: string
    reason?: string
    text?: string
    [key: string]: unknown
  }>
}

interface UseSessionBootstrapReturn {
  bootstrap: (urls: string[]) => Promise<void>
}

export function useSessionBootstrap(): UseSessionBootstrapReturn {
  const store = useSessionStore()

  async function bootstrapInstance(url: string): Promise<void> {
    try {
      // Step 1: Fetch sessions for the current workspace only.
      // Don't enumerate /project and fetch per-directory — that pulls sessions
      // from ALL projects on the server, causing the sidebar to show 27 sessions
      // when Zed shows 9. Match Zed's behavior: only the current workspace.
      const allSessions: { sessionInfo: SessionV2Info; instanceUrl: string }[] = []

      try {
        const response = await fetch(`${url}/api/session?limit=500`)
        if (response.ok) {
          const body: SessionListResponse = await response.json()
          for (const sessionInfo of body.data) {
            allSessions.push({ sessionInfo, instanceUrl: url })
          }
        }
      } catch {
        // Skip — other instances may still be reachable
      }

      // Step 2: Add all sessions to store
      for (const { sessionInfo, instanceUrl } of allSessions) {
        store.addSession(sessionInfo, instanceUrl)
      }

      // Step 5: Backfill unknown sessions
      const unknownSessions = allSessions
        .map(s => s.sessionInfo)
        .filter((s: SessionV2Info) => {
          const node = store.sessions.get(s.id)
          return node?.inferredState === 'unknown'
        })

      for (const sessionInfo of unknownSessions) {
        try {
          const msgResponse = await fetch(`${url}/session/${sessionInfo.id}/message`)
          if (!msgResponse.ok) continue
          const messages: LegacyMessage[] = await msgResponse.json()

          // Scan all parts in order. Track the last step-finish reason AND
          // whether any tool part has state.status === 'running'. A session
          // whose last tool call is still running is actively running,
          // regardless of what step-finish reasons say.
          let lastFinishReason: string | null = null
          let hasRunningTool = false
          for (const msg of messages) {
            for (const part of msg.parts) {
              if (part.type === 'step-finish' && part.reason) {
                lastFinishReason = part.reason
              }
              if (part.type === 'tool' && (part as { state?: { status?: string } }).state?.status === 'running') {
                hasRunningTool = true
              }
            }
          }

          if (hasRunningTool) {
            // A tool is still executing — session is running.
            store.backfillState(sessionInfo.id, 'running', null)
          } else if (lastFinishReason && lastFinishReason !== 'tool-calls') {
            store.backfillState(sessionInfo.id, 'completed', lastFinishReason as FinishReason)
          } else if (!lastFinishReason) {
            const created = sessionInfo.time.created
            const updated = sessionInfo.time.updated
            if (updated && created && updated > created) {
              store.backfillState(sessionInfo.id, 'completed', null)
            }
          }
        } catch {
          // Skip — best-effort enrichment
        }
      }

      // Step 6: Second pass — scan top-level parent sessions' user messages for
      // <task> state tags so child sessions get inferred states.
      const topLevelSessions = allSessions
        .map(s => s.sessionInfo)
        .filter((s: SessionV2Info) => !s.parentID)

      for (const parent of topLevelSessions) {
        try {
          const msgResponse = await fetch(`${url}/session/${parent.id}/message`)
          if (!msgResponse.ok) continue
          const messages: LegacyMessage[] = await msgResponse.json()

          const taskPattern = /<task\s+id=["']([^"']+)["']\s+state=["'](\w+)["']/g
          for (const msg of messages) {
            if (msg.info.role !== 'user') continue
            for (const part of msg.parts) {
              if (part.type !== 'text' || !part.text) continue
              for (const m of part.text.matchAll(taskPattern)) {
                const childId = m[1]
                const taskState = m[2]
                const childNode = store.sessions.get(childId)
                if (childNode && childNode.inferredState === 'unknown' && (taskState === 'completed' || taskState === 'error')) {
                  store.backfillState(childId, taskState === 'completed' ? 'completed' : 'error', null)
                }
              }
            }
          }
        } catch {
          // Skip — best-effort enrichment
        }
      }
    } catch {
      // Skip instance — others may still be reachable
    }
  }

  async function bootstrap(urls: string[]): Promise<void> {
    if (urls.length === 0) return
    // Parallel: each instance's bootstrap is independent.
    await Promise.all(urls.map((url) => bootstrapInstance(url)))
  }

  return { bootstrap }
}
