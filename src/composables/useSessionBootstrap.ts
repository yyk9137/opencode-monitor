import { fetch } from '@tauri-apps/plugin-http'
import { invoke } from '@tauri-apps/api/core'
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
    const log = (msg: string) => { console.log(msg); invoke('write_debug_log', { lines: msg }).catch(() => {}) }
    try {
      // Step 0: Get the current project directory from the server.
      let projectDir: string | undefined
      try {
        const projResp = await fetch(`${url}/project/current`, { signal: AbortSignal.timeout(3000) })
        log(`[bootstrap] /project/current status: ${projResp.status}`)
        if (projResp.ok) {
          const projBody = await projResp.json()
          log(`[bootstrap] /project/current body: ${JSON.stringify(projBody).slice(0, 300)}`)
          const projData = projBody as { worktree?: string; data?: { directory?: string }; directory?: string }
          projectDir = projData.worktree ?? projData.data?.directory ?? projData.directory ?? undefined
          log(`[bootstrap] projectDir: ${projectDir}`)
        }
      } catch (e) {
        log(`[bootstrap] /project/current failed: ${e}`)
      }

      // Update the instance's projectDir so the tree filter can use it
      if (projectDir) {
        const inst = store.instances.find(i => i.url === url)
        if (inst && !inst.projectDir) {
          store.setInstances(store.instances.map(i =>
            i.url === url ? { ...i, projectDir } : i
          ))
        }
      }

      // Step 1: Fetch sessions — use directory filter if we know the project
      const allSessions: { sessionInfo: SessionV2Info; instanceUrl: string }[] = []

      const sessionUrl = projectDir
        ? `${url}/api/session?directory=${encodeURIComponent(projectDir)}&limit=500`
        : `${url}/api/session?limit=500`

      log(`[bootstrap] sessionUrl: ${sessionUrl}`)

      try {
        const response = await fetch(sessionUrl)
        if (response.ok) {
          const body: SessionListResponse = await response.json()
          log(`[bootstrap] fetched ${body.data.length} sessions`)
          for (const s of body.data.slice(0, 3)) {
            log(`[bootstrap]   session "${s.title}" dir="${s.location?.directory}" archived=${s.time?.archived}`)
          }
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
