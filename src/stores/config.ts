import { defineStore } from 'pinia'
import { ref, shallowRef, computed } from 'vue'
import { fetch } from '@tauri-apps/plugin-http'
import type { OpenCodeConfig } from '@/types/opencode-config'
import { validateConfig } from '@/composables/useConfigValidator'

// ── Dismiss reason union (shared with step-06 ConfirmDialog) ────────────────
export type DismissReason =
  | { kind: 'close' }
  | { kind: 'switch-instance'; newUrl: string }
  | { kind: 'window-close' }

// ── Phase enum (single mutex for fetchConfig/saveConfig) ────────────────────
export type ConfigPhase = 'idle' | 'loading' | 'saving' | 'restarting' | 'timeout'

// ── Error tracking ─────────────────────────────────────────────────────────
export interface ConfigError {
  at: number
  phase: ConfigPhase
  message: string
}

// ── Diff path (for deep merge strategy from shared context) ─────────────────
export interface DiffPath {
  path: (string | number)[]
  oldValue: unknown
  newValue: unknown
}

/**
 * Compute leaf-path diffs between original and draft.
 * Arrays are treated as replace (not merge) — mergeArrays: false.
 */
export function computeDiff(original: unknown, draft: unknown, path: (string | number)[] = []): DiffPath[] {
  const diffs: DiffPath[] = []

  if (original === draft) return diffs

  // Both objects (not arrays, not null) → recurse
  if (
    typeof original === 'object' && original !== null && !Array.isArray(original) &&
    typeof draft === 'object' && draft !== null && !Array.isArray(draft)
  ) {
    const origObj = original as Record<string, unknown>
    const draftObj = draft as Record<string, unknown>
    const allKeys = new Set([...Object.keys(origObj), ...Object.keys(draftObj)])
    for (const key of allKeys) {
      diffs.push(...computeDiff(origObj[key], draftObj[key], [...path, key]))
    }
    return diffs
  }

  // Everything else (primitives, arrays, null vs object, etc.) → leaf diff
  diffs.push({ path, oldValue: original, newValue: draft })
  return diffs
}

/**
 * Apply diffs onto a fresh tree (from re-GET). Returns a new merged object.
 * mergeArrays: false — arrays are replaced, not concatenated.
 */
export function applyDiff(fresh: unknown, diffs: DiffPath[]): unknown {
  if (diffs.length === 0) return structuredClone(fresh)

  // Deep clone fresh so we don't mutate it
  const result = structuredClone(fresh)

  for (const diff of diffs) {
    if (diff.path.length === 0) {
      // Root replacement
      return structuredClone(diff.newValue)
    }

    // Navigate to parent
    let current: unknown = result
    for (let i = 0; i < diff.path.length - 1; i++) {
      if (current === null || typeof current !== 'object') {
        current = {}
        break
      }
      const key = diff.path[i]
      current = (current as Record<string | number, unknown>)[key]
    }

    if (current !== null && typeof current === 'object') {
      const lastKey = diff.path[diff.path.length - 1]
      const parent = current as Record<string | number, unknown>
      if (diff.newValue === undefined) {
        delete parent[lastKey]
      } else {
        parent[lastKey] = structuredClone(diff.newValue)
      }
    }
  }

  return result
}

export const useConfigStore = defineStore('config', () => {
  // ── Config data ──────────────────────────────────────────────────────────
  const original = shallowRef<OpenCodeConfig | null>(null)
  const draft = ref<OpenCodeConfig | null>(null)

  // ── Operation state — single phase enum for mutex ───────────────────────
  const phase = ref<ConfigPhase>('idle')

  // ── UI state ─────────────────────────────────────────────────────────────
  const activeSection = ref<string>('models')
  const panelOpen = ref(false)

  // ── Instance target ─────────────────────────────────────────────────────
  const targetUrl = ref<string | null>(null)

  // ── Restart state ───────────────────────────────────────────────────────
  const restartStartTime = ref(0)
  // Timeout IDs for step-05 restart detection (non-reactive, kept as refs for store exposure)
  const timeoutId = ref<ReturnType<typeof setTimeout> | null>(null)
  const absoluteTimeoutId = ref<ReturnType<typeof setTimeout> | null>(null)

  // ── Dirty-state confirmation ────────────────────────────────────────────
  const pendingDismiss = ref<DismissReason | null>(null)

  // ── Save confirmation (prevents fetchConfig during confirm dialog) ───────
  const pendingSave = ref(false)

  // ── Signal for App.vue to call connectAll after restart ──────────────────
  const pendingConnectNewUrl = ref<string | null>(null)

  // ── Error tracking ───────────────────────────────────────────────────────
  const lastError = ref<ConfigError | null>(null)

  // ── Dirty-path tracker (Set<string> of touched leaf paths) ───────────────
  const dirtyPaths = ref<Set<string>>(new Set())

  // ── Restart detection state ──────────────────────────────────────────────
  const restartElapsed = ref(0)  // live timer in ms
  const restartDetected = ref(false)
  const restartConfirmed = ref(false)
  let healthPollInterval: ReturnType<typeof setInterval> | null = null
  let progressTimer: ReturnType<typeof setInterval> | null = null

  // ── Actions ─────────────────────────────────────────────────────────────

  function setTargetUrl(url: string | null) {
    targetUrl.value = url
  }

  async function fetchConfig(): Promise<boolean> {
    if (phase.value !== 'idle') return false
    if (pendingSave.value) return false

    phase.value = 'loading'
    lastError.value = null

    try {
      if (!targetUrl.value) {
        phase.value = 'idle'
        lastError.value = { at: Date.now(), phase: 'loading', message: 'No target URL set' }
        return false
      }

      const response = await fetch(`${targetUrl.value}/config`)
      if (!response.ok) {
        phase.value = 'idle'
        lastError.value = { at: Date.now(), phase: 'loading', message: `GET /config failed: ${response.status}` }
        return false
      }

      const config = (await response.json()) as OpenCodeConfig
      original.value = config
      draft.value = structuredClone(config)
      dirtyPaths.value = new Set()
      phase.value = 'idle'
      return true
    } catch (e) {
      phase.value = 'idle'
      lastError.value = { at: Date.now(), phase: 'loading', message: String(e) }
      return false
    }
  }

  async function saveConfig(): Promise<boolean> {
    if (phase.value !== 'idle') return false
    if (!targetUrl.value || !original.value || !draft.value) return false

    phase.value = 'saving'
    lastError.value = null

    try {
      // Step 1: GET fresh tree (prevent TOCTOU)
      const freshResp = await fetch(`${targetUrl.value}/config`)
      if (!freshResp.ok) {
        phase.value = 'idle'
        lastError.value = { at: Date.now(), phase: 'saving', message: `re-GET /config failed: ${freshResp.status}` }
        return false
      }
      const freshTree = (await freshResp.json()) as OpenCodeConfig

      // Step 2: Compute user diffs (only leaf paths the user touched)
      const userDiff = computeDiff(original.value, draft.value)

      // Step 3: Apply diffs onto fresh tree
      const merged = applyDiff(freshTree, userDiff) as OpenCodeConfig

      // Step 4: AJV validate
      const validation = validateConfig(merged)
      if (!validation.valid) {
        phase.value = 'idle'
        lastError.value = { at: Date.now(), phase: 'saving', message: `Validation failed: ${validation.errors.join('; ')}` }
        return false
      }

      // Step 5: PATCH /config (full merged tree)
      const patchResp = await fetch(`${targetUrl.value}/config`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(merged),
      })
      if (!patchResp.ok) {
        phase.value = 'idle'
        lastError.value = { at: Date.now(), phase: 'saving', message: `PATCH /config failed: ${patchResp.status}` }
        return false
      }

      // Step 6: Enter restarting phase
      phase.value = 'restarting'
      restartStartTime.value = Date.now()
      restartDetected.value = false
      restartConfirmed.value = false
      restartElapsed.value = 0

      // Start live timer
      progressTimer = setInterval(() => {
        restartElapsed.value = Date.now() - restartStartTime.value
      }, 100)

      // Start 90s no-progress timeout
      timeoutId.value = setTimeout(() => {
        if (phase.value === 'restarting') {
          phase.value = 'timeout'
        }
      }, 90_000)

      // Start 5min absolute timeout
      absoluteTimeoutId.value = setTimeout(() => {
        stopDetection()
        if (phase.value === 'restarting' || phase.value === 'timeout') {
          phase.value = 'timeout'
        }
      }, 300_000)

      // Step 7: Start health polling
      startHealthPolling()

      return true
    } catch (e) {
      phase.value = 'idle'
      lastError.value = { at: Date.now(), phase: 'saving', message: String(e) }
      return false
    }
  }

  // ── Restart detection ───────────────────────────────────────────────────

  function startHealthPolling() {
    if (healthPollInterval) clearInterval(healthPollInterval)
    healthPollInterval = setInterval(async () => {
      // Guard: only run during restarting/timeout
      if (phase.value !== 'restarting' && phase.value !== 'timeout') return

      if (!targetUrl.value) return

      // Health poll with timeout
      try {
        const healthPromise = fetch(`${targetUrl.value}/global/health`)
        const timeoutPromise = new Promise<Response | null>(r => setTimeout(() => r(null), 1500))
        const response = await Promise.race([healthPromise, timeoutPromise])
        if (response?.ok) {
          await onRestartDetected()
        }
      } catch {
        // Network error — continue polling
      }
    }, 2000)
  }

  async function onRestartDetected() {
    // Guard: only proceed if in restarting/timeout
    if (phase.value !== 'restarting' && phase.value !== 'timeout') return

    // Prevent duplicate triggers
    if (restartDetected.value) return
    restartDetected.value = true

    // Reset no-progress timer (instance responded)
    if (timeoutId.value) {
      clearTimeout(timeoutId.value)
      timeoutId.value = setTimeout(() => {
        if (phase.value === 'restarting') phase.value = 'timeout'
      }, 90_000)
    }

    // Step 8: Confirm GET /config
    if (!targetUrl.value) return
    try {
      const resp = await fetch(`${targetUrl.value}/config`)
      if (!resp.ok) {
        // Confirm failed but save succeeded
        phase.value = 'idle'
        restartConfirmed.value = true
        // Update original to merged (save succeeded, just confirm failed)
        if (draft.value) {
          original.value = structuredClone(draft.value)
          dirtyPaths.value = new Set()
        }
        return
      }

      const confirmed = (await resp.json()) as OpenCodeConfig
      original.value = confirmed
      draft.value = structuredClone(confirmed)
      dirtyPaths.value = new Set()
      restartConfirmed.value = true
      phase.value = 'idle'
      stopDetection()
    } catch {
      // Confirm failed — stay in restarting, will retry on next health poll
      restartDetected.value = false
    }
  }

  function stopDetection() {
    if (healthPollInterval) { clearInterval(healthPollInterval); healthPollInterval = null }
    if (progressTimer) { clearInterval(progressTimer); progressTimer = null }
    if (timeoutId.value) { clearTimeout(timeoutId.value); timeoutId.value = null }
    if (absoluteTimeoutId.value) { clearTimeout(absoluteTimeoutId.value); absoluteTimeoutId.value = null }
  }

  function retryDetection() {
    // Only restart detection, don't re-PATCH
    if (phase.value !== 'timeout') return
    phase.value = 'restarting'
    restartDetected.value = false
    restartStartTime.value = Date.now()
    restartElapsed.value = 0

    progressTimer = setInterval(() => {
      restartElapsed.value = Date.now() - restartStartTime.value
    }, 100)

    timeoutId.value = setTimeout(() => {
      if (phase.value === 'restarting') phase.value = 'timeout'
    }, 90_000)

    startHealthPolling()
  }

  function resetToSavedAfterTimeout() {
    // Restore draft to last saved version (server already saved merged)
    if (original.value) {
      draft.value = structuredClone(original.value)
      dirtyPaths.value = new Set()
    }
    stopDetection()
    phase.value = 'idle'
  }

  function resetToSaved() {
    if (!original.value) return
    draft.value = structuredClone(original.value)
    dirtyPaths.value = new Set()
  }

  function requestDismiss(reason: DismissReason) {
    pendingDismiss.value = reason
  }

  function cancelDismiss() {
    pendingDismiss.value = null
  }

  function forceDismiss(): boolean {
    if (phase.value !== 'idle') return false
    panelOpen.value = false
    draft.value = null
    original.value = null
    pendingDismiss.value = null
    dirtyPaths.value = new Set()
    return true
  }

  function hidePanel() {
    panelOpen.value = false
    // Does NOT clear draft — for restart-period close, preserves draft for read-only display
  }

  // ── Computed ─────────────────────────────────────────────────────────────

  const isDirty = computed(() => dirtyPaths.value.size > 0)

  const dirtyCount = computed(() => dirtyPaths.value.size)

  return {
    // State
    original,
    draft,
    phase,
    activeSection,
    panelOpen,
    targetUrl,
    restartStartTime,
    timeoutId,
    absoluteTimeoutId,
    restartElapsed,
    restartDetected,
    restartConfirmed,
    pendingDismiss,
    pendingSave,
    pendingConnectNewUrl,
    lastError,
    dirtyPaths,
    // Computed
    isDirty,
    dirtyCount,
    // Actions
    setTargetUrl,
    fetchConfig,
    saveConfig,
    resetToSaved,
    requestDismiss,
    cancelDismiss,
    forceDismiss,
    hidePanel,
    retryDetection,
    resetToSavedAfterTimeout,
    stopDetection,
  }
})
