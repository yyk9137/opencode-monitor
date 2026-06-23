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

  function checkAndUpdateAlerts(): void {
    const now = Date.now()
    const alerts: StuckAlert[] = []

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
        alerts.push({
          sessionID: session.id,
          stuckDuration: elapsed,
          lastEventType: session.lastEventType,
        })
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
  }

  return { startWatching, stopWatching }
}
