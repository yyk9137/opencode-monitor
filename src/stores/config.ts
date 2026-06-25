import { defineStore } from 'pinia'
import { ref, shallowRef, computed } from 'vue'
import { fetch } from '@tauri-apps/plugin-http'
import { readTextFile, writeTextFile, exists } from '@tauri-apps/plugin-fs'
import { invoke } from '@tauri-apps/api/core'
import { homeDir, join } from '@tauri-apps/api/path'
import { parse as parseJsonc, modify as modifyJsonc, applyEdits as applyJsoncEdits } from 'jsonc-parser'
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

// ── Config scope type ─────────────────────────────────────────────────────
export type ConfigScope = 'global' | 'project'

// ── Config file path resolution (for writing) ───────────────────────────

export const useConfigStore = defineStore('config', () => {
  // ── Config scope ─────────────────────────────────────────────────────────

  const configScope = ref<ConfigScope>('global')
  const projectCwd = ref<string | null>(null)

  // Lazily-initialized cache for projectCwd (avoids repeated invoke calls)
  let _projectCwd: string | null = null

  async function ensureProjectCwd(): Promise<string | null> {
    if (_projectCwd !== null) return _projectCwd
    try {
      const args = await invoke<string[]>('get_cli_args')
      const cwdIdx = args.indexOf('--cwd')
      if (cwdIdx !== -1 && args[cwdIdx + 1]) {
        _projectCwd = args[cwdIdx + 1]
        projectCwd.value = _projectCwd
        return _projectCwd
      }
    } catch {
      // CLI args not available — fall through
    }
    _projectCwd = null
    projectCwd.value = null
    return null
  }

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

    // ── Read config directly from disk ───────────────────────────────────────
  // Global scope:  ~/.config/opencode/opencode.jsonc  (JSONC, parsed via jsonc-parser)
  // Project scope: <cwd>/.opencode/config.json        (plain JSON)
  async function fetchConfig(): Promise<boolean> {
    if (phase.value !== 'idle') return false
    if (pendingSave.value) return false

    phase.value = 'loading'
    lastError.value = null

    try {
      let config: OpenCodeConfig

      if (configScope.value === 'global') {
        const configPath = await getConfigPath()
        let rawText = '{}'
        if (await exists(configPath)) {
          rawText = await readTextFile(configPath)
        }
        // JSONC — use jsonc-parser.parse() to handle comments
        const parsed = parseJsonc(rawText)
        config = (parsed ?? {}) as OpenCodeConfig
      } else {
        const cwd = await ensureProjectCwd()
        if (!cwd) {
          phase.value = 'idle'
          lastError.value = { at: Date.now(), phase: 'loading', message: 'No project directory found. Use --cwd CLI arg.' }
          return false
        }
        const configPath = await join(cwd, '.opencode', 'config.json')
        if (await exists(configPath)) {
          const rawText = await readTextFile(configPath)
          config = JSON.parse(rawText) as OpenCodeConfig
        } else {
          config = {} as OpenCodeConfig
        }
      }

      original.value = config
      draft.value = cloneDeep(config)
      dirtyPaths.value = new Set()
      phase.value = 'idle'
      return true
    } catch (e) {
      phase.value = 'idle'
      lastError.value = { at: Date.now(), phase: 'loading', message: 'Failed to read config: ' + String(e) }
      return false
    }
  }

  // ── Save config: field-level merge, scope-aware ─────────────────────────
  // Global scope:  comment-preserving merge using jsonc-parser.modify()
  // Project scope: plain JSON merge using JSON.stringify()
  async function saveConfig(): Promise<boolean> {
    if (phase.value !== 'idle') return false
    if (!original.value || !draft.value) return false

    phase.value = 'saving'
    lastError.value = null

    try {
      const o = cloneDeep(original.value) as Record<string, unknown>
      const d = cloneDeep(draft.value) as Record<string, unknown>
      const diffs = deepDiff(o, d)

      if (configScope.value === 'global') {
        // ── Global scope: comment-preserving merge ─────────────────────────
        const configPath = await getConfigPath()

        let rawText = ''
        if (await exists(configPath)) {
          rawText = await readTextFile(configPath)
        } else {
          rawText = '{}'
        }

        console.log(`[saveConfig:global] ${diffs.length} field-level changes detected`)

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
        console.log(`[saveConfig:global] applied ${applied}/${diffs.length} changes`)

        await writeTextFile(configPath, modifiedText)

        // Verify no BOM was written (safety check)
        const verifyRaw = await readTextFile(configPath)
        if (verifyRaw.charCodeAt(0) === 0xFEFF) {
          await writeTextFile(configPath, verifyRaw.slice(1))
        }
      } else {
        // ── Project scope: plain JSON ──────────────────────────────────────
        const cwd = await ensureProjectCwd()
        if (!cwd) {
          phase.value = 'idle'
          lastError.value = { at: Date.now(), phase: 'saving', message: '未找到项目目录，无法保存项目配置。' }
          return false
        }
        const configPath = await join(cwd, '.opencode', 'config.json')

        // Read existing config or start fresh
        let existing: Record<string, unknown> = {}
        if (await exists(configPath)) {
          const rawText = await readTextFile(configPath)
          existing = JSON.parse(rawText) as Record<string, unknown>
        }

        console.log(`[saveConfig:project] ${diffs.length} field-level changes detected`)

        // Apply diffs to existing object
        for (const diff of diffs) {
          const path = [...diff.path]
          let current = existing
          // Navigate to parent
          for (let i = 0; i < path.length - 1; i++) {
            const key = path[i] as string
            if (!(key in current) || current[key] === null || typeof current[key] !== 'object') {
              current[key] = {}
            }
            current = current[key] as Record<string, unknown>
          }
          const lastKey = path[path.length - 1] as string
          if (diff.type === 'delete') {
            delete current[lastKey]
          } else {
            current[lastKey] = diff.value
          }
        }

        await writeTextFile(configPath, JSON.stringify(existing, null, 2))
      }

      // Update original to match what we just wrote
      original.value = cloneDeep(draft.value)
      dirtyPaths.value = new Set()
      phase.value = 'idle'

      // Restart Zed + Monitor via detached batch script
      try {
        await invoke('restart_zed_and_monitor')
      } catch (e) {
        lastError.value = {
          at: Date.now(),
          phase: 'saving',
          message: '配置已保存，但重启失败: ' + String(e) + '。请手动重启 Zed。',
        }
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

  const configFilePath = computed(() => {
    if (configScope.value === 'global') {
      return '~/.config/opencode/opencode.jsonc'
    }
    if (projectCwd.value) {
      return projectCwd.value + '/.opencode/config.json'
    }
    return ''
  })

  return {
    original, draft, phase, activeSection, panelOpen, targetUrl, configScope, projectCwd, configFilePath,
    restartStartTime, restartElapsed, restartDetected, restartConfirmed,
    pendingDismiss, pendingSave, pendingConnectNewUrl, lastError, dirtyPaths,
    isDirty, dirtyCount,
    setTargetUrl, fetchConfig, saveConfig, resetToSaved,
    requestDismiss, cancelDismiss, forceDismiss, hidePanel,
    retryDetection, resetToSavedAfterTimeout, stopDetection,
  }
})
