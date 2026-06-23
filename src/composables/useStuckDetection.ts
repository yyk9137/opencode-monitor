import { fetch } from '@tauri-apps/plugin-http'
import { useSessionStore } from '@/stores/session'
import type { StuckAlert } from '@/types'

const DEFAULT_CHECK_INTERVAL_MS = 10_000

interface UseStuckDetectionOptions {
  checkIntervalMs?: number
}

interface UseStuckDetectionReturn {
  startWatching: () => void
  stopWatching: () => void
}

export function useStuckDetection(
  options: UseStuckDetectionOptions = {},
): UseStuckDetectionReturn {
  const store = useSessionStore()
  const checkIntervalMs = options.checkIntervalMs ?? DEFAULT_CHECK_INTERVAL_MS
  let intervalId: ReturnType<typeof setInterval> | null = null

  // Sessions we've already verified via API in this cycle — avoid
  // re-checking the same session repeatedly.
  const verifiedThisCycle = new Set<string>()

  // When a session exceeds the stuck threshold, verify via API whether it's
  // actually still running before raising a stuck alert. This handles the
  // case where a session was aborted externally (e.g. through Zed) and no
  // step-finish event was emitted, leaving inferredState stuck at 'running'.
  async function verifySessionRunning(
    sessionId: string,
    instanceUrl: string,
  ): Promise<boolean> {
    // If we don't know which instance owns this session, we can't verify.
    // Fall back to "still running" (preserve old behavior) rather than
    // false-positive an alert.
    if (!instanceUrl) return true

    try {
      const response = await fetch(
        `${instanceUrl}/session/${sessionId}/message`,
        { method: 'GET' },
      )

      // 404 or other non-OK: session doesn't exist on this instance anymore.
      // It was likely aborted or the instance restarted. NOT running.
      if (!response.ok) return false

      const messages: Array<{
        info?: { time?: { created?: number; updated?: number } }
        parts: Array<{
          type: string
          state?: { status?: string }
          reason?: string
        }>
      }> = await response.json()

      if (messages.length === 0) return false

      // Check the session's last activity timestamp from the API metadata.
      // If the last update was more than 2x the stuck threshold ago, the
      // session is definitely not running — it was likely aborted without
      // a proper step-finish event.
      const lastMsg = messages[messages.length - 1]
      const lastUpdated = lastMsg?.info?.time?.updated
      if (lastUpdated) {
        const idleMs = Date.now() - lastUpdated
        if (idleMs > store.stuckThresholdMs * 2) {
          return false
        }
      }

      // Check if any tool part is still actively running.
      let hasRunningTool = false
      let hasStepFinish = false
      for (const msg of messages) {
        for (const part of msg.parts) {
          if (
            part.type === 'tool' &&
            part.state?.status === 'running'
          ) {
            hasRunningTool = true
          }
          if (part.type === 'step-finish') {
            hasStepFinish = true
          }
        }
      }

      // If there's a running tool but the session has step-finish parts
      // (meaning at least one step completed), AND the last update was
      // more than the stuck threshold ago, the tool state is stale —
      // the session was likely aborted between steps.
      if (hasRunningTool && hasStepFinish) {
        // We already checked lastUpdated above and it's within 2x threshold.
        // But if it's beyond 1x threshold (which is why we're here), the
        // running tool is stale.
        if (lastUpdated) {
          const idleMs = Date.now() - lastUpdated
          if (idleMs > store.stuckThresholdMs) {
            return false
          }
        }
      }

      // If there's a running tool and no step-finish (first step still going),
      // check the idle time more carefully.
      if (hasRunningTool && !hasStepFinish) {
        if (lastUpdated) {
          const idleMs = Date.now() - lastUpdated
          if (idleMs > store.stuckThresholdMs) {
            return false
          }
        }
      }

      return hasRunningTool
    } catch {
      // Network error: if we can't verify, assume still running
      // (don't false-positive a stuck alert)
      return true
    }
  }

  async function checkAndUpdateAlerts(): Promise<void> {
    const now = Date.now()
    const alerts: StuckAlert[] = []
    const candidates: Array<{ sessionId: string; instanceUrl: string }> = []

    // First pass: collect candidates without async
    for (const session of store.sessions.values()) {
      // Only check sessions that are actively running. 'unknown' and 'completed'
      // sessions should NOT trigger stuck alerts — 'unknown' often means the
      // session finished before the monitor started and we couldn't infer its
      // final state, not that it's stuck.
      if (session.inferredState !== 'running') {
        continue
      }
      const elapsed = now - session.lastEventTime
      if (elapsed > store.stuckThresholdMs) {
        candidates.push({
          sessionId: session.id,
          instanceUrl: session.instanceUrl,
        })
      }
    }

    // If no candidates, clear alerts and return
    if (candidates.length === 0) {
      store.stuckAlerts = [] as typeof store.stuckAlerts
      verifiedThisCycle.clear()
      return
    }

    // Second pass: verify each candidate via API
    for (const { sessionId, instanceUrl } of candidates) {
      if (verifiedThisCycle.has(sessionId)) {
        // Already verified as stuck — keep the alert
        const session = store.sessions.get(sessionId)
        if (session) {
          alerts.push({
            sessionID: sessionId,
            stuckDuration: now - session.lastEventTime,
            lastEventType: session.lastEventType,
          })
        }
        continue
      }

      const stillRunning = await verifySessionRunning(sessionId, instanceUrl)
      if (stillRunning) {
        // Session is genuinely stuck (still running, but no events for a while)
        verifiedThisCycle.add(sessionId)
        const session = store.sessions.get(sessionId)
        if (session) {
          alerts.push({
            sessionID: sessionId,
            stuckDuration: now - session.lastEventTime,
            lastEventType: session.lastEventType,
          })
        }
      } else {
        // Session is NOT actually running — it was likely aborted externally.
        // Update inferredState to 'error' so it stops being flagged as stuck.
        store.backfillState(sessionId, 'error', null)
      }
    }

    store.stuckAlerts = alerts as typeof store.stuckAlerts
  }

  function startWatching(): void {
    if (intervalId !== null) return
    checkAndUpdateAlerts()
    intervalId = setInterval(checkAndUpdateAlerts, checkIntervalMs)
  }

  function stopWatching(): void {
    if (intervalId !== null) {
      clearInterval(intervalId)
      intervalId = null
    }
    verifiedThisCycle.clear()
  }

  return { startWatching, stopWatching }
}
