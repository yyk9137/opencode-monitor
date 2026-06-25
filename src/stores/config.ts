import { defineStore } from 'pinia'
import { ref, shallowRef, computed } from 'vue'
import { fetch } from '@tauri-apps/plugin-http'
import { readTextFile, writeTextFile, exists } from '@tauri-apps/plugin-fs'
import { invoke } from '@tauri-apps/api/core'
import { homeDir, join } from '@tauri-apps/api/path'
import { modify as modifyJsonc, applyEdits as applyJsoncEdits } from 'jsonc-parser'
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

// stripJsonComments removed — jsonc-parser handles JSONC parsing natively now

// ── Deep diff: find leaf-level changes between original and draft ──────────
// Only paths where original !== draft are returned. This captures user edits
// while ignoring API-resolved values (e.g., {env:VAR} resolved to plaintext).
interface DiffEntry {
  path: (string | number)[]
  value: unknown
  type: 'add' | 'update' | 'delete'
}

function deepDiff(original: unknown, draft: unknown, basePath: (string | number)[] = []): DiffEntry[] {
  const diffs: DiffEntry[] = []

  // Deleted: original has value, draft is undefined
  if (draft === undefined) {
    if (original !== undefined) {
      diffs.push({ path: basePath, value: undefined, type: 'delete' })
    }
    return diffs
  }

  // Added: original is undefined, draft has value
  if (original === undefined) {
    diffs.push({ path: basePath, value: draft, type: 'add' })
    return diffs
  }

  // Both are non-null objects (but not arrays) → recurse
  if (
    typeof original === 'object' && original !== null && !Array.isArray(original) &&
    typeof draft === 'object' && draft !== null && !Array.isArray(draft)
  ) {
    const allKeys = new Set([...Object.keys(original), ...Object.keys(draft)])
    for (const key of allKeys) {
      diffs.push(...deepDiff((original as Record<string, unknown>)[key], (draft as Record<string, unknown>)[key], [...basePath, key]))
    }
    return diffs
  }

  // Arrays or scalars → compare by value
  if (JSON.stringify(original) !== JSON.stringify(draft)) {
    diffs.push({ path: basePath, value: draft, type: 'update' })
  }

  return diffs
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

  // ── Save config: field-level merge to opencode.jsonc, preserving comments ─
  // 1. Read raw opencode.jsonc text from disk (preserves {env:VAR} and comments)
  // 2. Compute diff between original (API baseline) and draft (user edits)
  //    → only leaf-level user changes are captured
  // 3. Apply each diff to raw text via jsonc-parser.modify()
  //    → preserves comments, formatting, and unedited fields
  // 4. Write back (UTF-8 without BOM)
  // 5. Restart Zed
  async function saveConfig(): Promise<boolean> {
    if (phase.value !== 'idle') return false
    if (!original.value || !draft.value) return false

    phase.value = 'saving'
    lastError.value = null

    try {
      const configPath = await getConfigPath()

      // 1. Read raw text from disk (preserves comments + {env:VAR} format)
      let rawText = ''
      if (await exists(configPath)) {
        rawText = await readTextFile(configPath)
      } else {
        rawText = '{}'
      }

      // 2. Compute actual user changes (original from API vs draft with user edits)
      const o = cloneDeep(original.value) as Record<string, unknown>
      const d = cloneDeep(draft.value) as Record<string, unknown>
      const diffs = deepDiff(o, d)

      console.log(`[saveConfig] ${diffs.length} field-level changes detected`)

      // 3. Apply each diff to raw text via jsonc-parser.modify()
      //    This preserves comments, formatting, and unedited {env:VAR} values
      const formattingOptions = { tabSize: 2, insertSpaces: true, eol: '\n' } as const
      let modifiedText = rawText
      let applied = 0
      for (const diff of diffs) {
        try {
          const edits = modifyJsonc(modifiedText, diff.path, diff.value, { formattingOptions })
          modifiedText = applyJsoncEdits(modifiedText, edits)
          applied++
        } catch {
          // jsonc-parser.modify may fail for complex paths — skip and continue
        }
      }
      console.log(`[saveConfig] applied ${applied}/${diffs.length} changes`)

      // 4. Write back (Tauri's writeTextFile uses Rust std::fs::write → UTF-8 without BOM)
      await writeTextFile(configPath, modifiedText)

      // Verify no BOM was written (safety check)
      const verifyRaw = await readTextFile(configPath)
      if (verifyRaw.charCodeAt(0) === 0xFEFF) {
        await writeTextFile(configPath, verifyRaw.slice(1))
      }

      // Update original to match what we just wrote
      original.value = cloneDeep(draft.value)
      dirtyPaths.value = new Set()
      phase.value = 'idle'

      // Auto-restart OpenCode by updating Zed's agent_servers env timestamp.
      // Zed detects the settings change and auto-reconnects the ACP server,
      // spawning a fresh OpenCode process with the updated config.
      // Monitor is a separate process and survives the restart.
      try {
        await invoke('restart_opencode_via_zed')
      } catch (e) {
        // Zed settings update failed — config is still saved, user can restart manually
        lastError.value = { at: Date.now(), phase: 'saving', message: '配置已保存，但 OpenCode 重启失败: ' + String(e) + '。请手动重启 OpenCode。' }
      }

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
