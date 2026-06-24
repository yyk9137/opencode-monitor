import { defineStore } from 'pinia'
import { ref, shallowRef, computed } from 'vue'
import { fetch } from '@tauri-apps/plugin-http'
import { readTextFile, writeTextFile, exists } from '@tauri-apps/plugin-fs'
import { homeDir, join } from '@tauri-apps/api/path'
import type { OpenCodeConfig } from '@/types/opencode-config'

// ── Dismiss reason union (shared with ConfirmDialog) ──────────────────────
export type DismissReason =
  | { kind: 'close' }
  | { kind: 'switch-instance'; newUrl: string }
  | { kind: 'window-close' }

// ── Phase enum ─────────────────────────────────────────────────────────────
export type ConfigPhase = 'idle' | 'loading' | 'saving' | 'restarting' | 'timeout'

// ── Error tracking ─────────────────────────────────────────────────────────
export interface ConfigError {
  at: number
  phase: ConfigPhase
  message: string
}

// ── Deep clone that handles Vue reactive proxies ──────────────────────────
function cloneDeep<T>(value: T): T {
  if (value === null || value === undefined) return value
  return JSON.parse(JSON.stringify(value))
}

// ── Config file path resolution ────────────────────────────────────────────
let _configPath: string | null = null

async function getConfigPath(): Promise<string> {
  if (_configPath) return _configPath
  const home = await homeDir()
  // Try opencode.jsonc first, then opencode.json, then config.json
  const candidates = [
    await join(home, '.config', 'opencode', 'opencode.jsonc'),
    await join(home, '.config', 'opencode', 'opencode.json'),
    await join(home, '.config', 'opencode', 'config.json'),
  ]
  for (const p of candidates) {
    if (await exists(p)) {
      _configPath = p
      return p
    }
  }
  // Default to opencode.jsonc (will create if doesn't exist)
  _configPath = await join(home, '.config', 'opencode', 'opencode.jsonc')
  return _configPath
}

// ── Strip JSONC comments (// and /* */) for parsing ──────────────────────
function stripJsonComments(text: string): string {
  let result = ''
  let inString = false
  let escaped = false
  let i = 0
  while (i < text.length) {
    const char = text[i]
    const next = text[i + 1]
    if (inString) {
      result += char
      if (escaped) { escaped = false } else if (char === '\\') { escaped = true } else if (char === '"') { inString = false }
      i++
      continue
    }
    if (char === '"') { inString = true; result += char; i++; continue }
    if (char === '/' && next === '/') { while (i < text.length && text[i] !== '\n') i++; continue }
    if (char === '/' && next === '*') { i += 2; while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++; i += 2; continue }
    result += char
    i++
  }
  return result
}

// ── Config file path resolution (for writing) ───────────────────────────

export const useConfigStore = defineStore('config', () => {
  // ── Config data ──────────────────────────────────────────────────────────
  const original = shallowRef<OpenCodeConfig | null>(null)
  const draft = ref<OpenCodeConfig | null>(null)

  // ── Operation state ──────────────────────────────────────────────────────
  const phase = ref<ConfigPhase>('idle')

  // ── UI state ─────────────────────────────────────────────────────────────
  const activeSection = ref<string>('providers')
  const panelOpen = ref(false)

  // ── Instance target (for restart only) ────────────────────────────────────
  const targetUrl = ref<string | null>(null)

  // ── Restart state ───────────────────────────────────────────────────────
  const restartStartTime = ref(0)
  const restartElapsed = ref(0)
  const restartDetected = ref(false)
  const restartConfirmed = ref(false)
  let progressTimer: ReturnType<typeof setInterval> | null = null
  let healthPollInterval: ReturnType<typeof setInterval> | null = null
  let timeoutId: ReturnType<typeof setTimeout> | null = null
  let absoluteTimeoutId: ReturnType<typeof setTimeout> | null = null

  // ── Dirty-state confirmation ────────────────────────────────────────────
  const pendingDismiss = ref<DismissReason | null>(null)
  const pendingSave = ref(false)
  const pendingConnectNewUrl = ref<string | null>(null)
  const lastError = ref<ConfigError | null>(null)
  const dirtyPaths = ref<Set<string>>(new Set())

  // ── Actions ─────────────────────────────────────────────────────────────

  function setTargetUrl(url: string | null) {
    targetUrl.value = url
  }

  // ── Read config via API (merged from all sources) ───────────────────────
  async function fetchConfig(): Promise<boolean> {
    if (phase.value !== 'idle') return false
    if (pendingSave.value) return false
    if (!targetUrl.value) return false

    phase.value = 'loading'
    lastError.value = null

    try {
      const response = await fetch(targetUrl.value + '/config')
      if (!response.ok) {
        phase.value = 'idle'
        lastError.value = { at: Date.now(), phase: 'loading', message: 'GET /config failed: ' + response.status }
        return false
      }
      const config = (await response.json()) as OpenCodeConfig
      original.value = config
      draft.value = cloneDeep(config)
      dirtyPaths.value = new Set()
      phase.value = 'idle'
      return true
    } catch (e) {
      phase.value = 'idle'
      lastError.value = { at: Date.now(), phase: 'loading', message: 'Failed to fetch config: ' + String(e) }
      return false
    }
  }

  // ── Save config: field-level merge into existing opencode.jsonc ─────────
  async function saveConfig(): Promise<boolean> {
    if (phase.value !== 'idle') return false
    if (!original.value || !draft.value) return false

    phase.value = 'saving'
    lastError.value = null

    try {
      const configPath = await getConfigPath()

      // Read existing config from disk
      let existingConfig: Record<string, unknown> = {}
      if (await exists(configPath)) {
        try {
          const raw = await readTextFile(configPath)
          const stripped = stripJsonComments(raw)
          existingConfig = JSON.parse(stripped)
        } catch {
          existingConfig = {}
        }
      }

      // Determine which top-level sections were changed
      // For each dirty path, extract the top-level key
      const dirtySections = new Set<string>()
      for (const path of dirtyPaths.value) {
        const topKey = path.split('.')[0]
        if (topKey) dirtySections.add(topKey)
      }

      // Merge only changed sections from draft into existing config
      const draftPlain = cloneDeep(draft.value) as Record<string, unknown>

      for (const section of dirtySections) {
        if (section in draftPlain) {
          // Replace this section entirely with draft's version
          existingConfig[section] = draftPlain[section]
        } else {
          // Section was deleted from draft — remove from existing
          delete existingConfig[section]
        }
      }

      // Write back
      const jsonStr = JSON.stringify(existingConfig, null, 2)
      await writeTextFile(configPath, jsonStr)

      // Update original to match what we just wrote (re-read via API after restart)
      // For now, update original with the merged result
      original.value = cloneDeep(draft.value)
      dirtyPaths.value = new Set()

      // Restart the OpenCode instance
      phase.value = 'restarting'
      restartStartTime.value = Date.now()
      restartDetected.value = false
      restartConfirmed.value = false
      restartElapsed.value = 0

      progressTimer = setInterval(() => {
        restartElapsed.value = Date.now() - restartStartTime.value
      }, 100)

      timeoutId = setTimeout(() => {
        if (phase.value === 'restarting') phase.value = 'timeout'
      }, 90_000)

      absoluteTimeoutId = setTimeout(() => {
        stopDetection()
        if (phase.value === 'restarting' || phase.value === 'timeout') {
          phase.value = 'timeout'
        }
      }, 300_000)

      // Dispose the instance via API to trigger restart
      if (targetUrl.value) {
        try {
          await fetch(targetUrl.value + '/instance', { method: 'DELETE' })
        } catch {
          // Instance may not support DELETE — that's ok
        }
      }

      startHealthPolling()
      return true
    } catch (e) {
      phase.value = 'idle'
      lastError.value = { at: Date.now(), phase: 'saving', message: 'Failed to write config: ' + String(e) }
      return false
    }
  }

  // ── Restart detection ───────────────────────────────────────────────────

  function startHealthPolling() {
    if (healthPollInterval) clearInterval(healthPollInterval)
    healthPollInterval = setInterval(async () => {
      if (phase.value !== 'restarting' && phase.value !== 'timeout') return
      if (!targetUrl.value) return

      try {
        const healthPromise = fetch(targetUrl.value + '/global/health')
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
    if (phase.value !== 'restarting' && phase.value !== 'timeout') return
    if (restartDetected.value) return
    restartDetected.value = true

    if (timeoutId) {
      clearTimeout(timeoutId)
      timeoutId = setTimeout(() => {
        if (phase.value === 'restarting') phase.value = 'timeout'
      }, 90_000)
    }

    // Re-read config via API to confirm restart
    try {
      if (!targetUrl.value) return
      const resp = await fetch(targetUrl.value + '/config')
      if (!resp.ok) return
      const confirmed = (await resp.json()) as OpenCodeConfig
      original.value = confirmed
      draft.value = cloneDeep(confirmed)
      dirtyPaths.value = new Set()
      restartConfirmed.value = true
      phase.value = 'idle'
      stopDetection()
    } catch {
      restartDetected.value = false
    }
  }

  function stopDetection() {
    if (healthPollInterval) { clearInterval(healthPollInterval); healthPollInterval = null }
    if (progressTimer) { clearInterval(progressTimer); progressTimer = null }
    if (timeoutId) { clearTimeout(timeoutId); timeoutId = null }
    if (absoluteTimeoutId) { clearTimeout(absoluteTimeoutId); absoluteTimeoutId = null }
  }

  function retryDetection() {
    if (phase.value !== 'timeout') return
    phase.value = 'restarting'
    restartDetected.value = false
    restartStartTime.value = Date.now()
    restartElapsed.value = 0

    progressTimer = setInterval(() => {
      restartElapsed.value = Date.now() - restartStartTime.value
    }, 100)

    timeoutId = setTimeout(() => {
      if (phase.value === 'restarting') phase.value = 'timeout'
    }, 90_000)

    startHealthPolling()
  }

  function resetToSavedAfterTimeout() {
    if (original.value) {
      draft.value = cloneDeep(original.value)
      dirtyPaths.value = new Set()
    }
    stopDetection()
    phase.value = 'idle'
  }

  function resetToSaved() {
    if (!original.value) return
    draft.value = cloneDeep(original.value)
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
  }

  // ── Computed ─────────────────────────────────────────────────────────────

  const isDirty = computed(() => dirtyPaths.value.size > 0)
  const dirtyCount = computed(() => dirtyPaths.value.size)

  return {
    original, draft, phase, activeSection, panelOpen, targetUrl,
    restartStartTime, restartElapsed, restartDetected, restartConfirmed,
    pendingDismiss, pendingSave, pendingConnectNewUrl, lastError, dirtyPaths,
    isDirty, dirtyCount,
    setTargetUrl, fetchConfig, saveConfig, resetToSaved,
    requestDismiss, cancelDismiss, forceDismiss, hidePanel,
    retryDetection, resetToSavedAfterTimeout, stopDetection,
  }
})
