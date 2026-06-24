import { defineStore } from 'pinia'
import { ref, shallowRef, computed } from 'vue'
import { fetch } from '@tauri-apps/plugin-http'
import type { OpenCodeConfig } from '@/types/opencode-config'

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

  // Stub — full implementation in step-05
  async function saveConfig(): Promise<boolean> {
    if (phase.value !== 'idle') return false
    // Step 5 implements the full re-GET + computeDiff + applyDiff + AJV validate + PATCH flow
    return false
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
  }
})
