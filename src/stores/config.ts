import { defineStore } from 'pinia'
import { ref, shallowRef, computed } from 'vue'
import { fetch } from '@tauri-apps/plugin-http'
import { readTextFile, writeTextFile, exists } from '@tauri-apps/plugin-fs'
import { invoke } from '@tauri-apps/api/core'
import { homeDir, join } from '@tauri-apps/api/path'
import { parse as parseJsonc, modify as modifyJsonc, applyEdits as applyJsoncEdits } from 'jsonc-parser'
import type { OpenCodeConfig } from '@/types/opencode-config'
import { useSessionStore } from '@/stores/session'

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

  // Lazily-initialized cache for projectCwd
  let _projectCwd: string | null = null

  async function ensureProjectCwd(): Promise<string | null> {
    if (_projectCwd !== null) return _projectCwd

    // 1. Try session store — instances have projectDir from health probe
    const sessionStore = useSessionStore()
    const inst = sessionStore.instances.find(i => i.projectDir)
    if (inst?.projectDir) {
      _projectCwd = inst.projectDir
      projectCwd.value = _projectCwd
      return _projectCwd
    }

    // 2. Try active session's directory
    const activeSession = Array.from(sessionStore.sessions.values()).find(s => s.directory)
    if (activeSession?.directory) {
      _projectCwd = activeSession.directory
      projectCwd.value = _projectCwd
      return _projectCwd
    }

    // 3. Fallback: Rust current_dir (wherever Monitor was launched from)
    try {
      const cwd = await invoke<string>('get_cwd')
      if (cwd) {
        _projectCwd = cwd
        projectCwd.value = cwd
        return cwd
      }
    } catch {
      // get_cwd not available
    }
    _projectCwd = null
    projectCwd.value = null
    return null
  }

  // ── Config data ──────────────────────────────────────────────────────────
  const original = shallowRef<OpenCodeConfig | null>(null)
  const draft = ref<OpenCodeConfig | null>(null)

  // ── Slim config tracking (oh-my-opencode-slim.json) ─────────────────────
  // Agents defined in slim presets are tracked separately so saveConfig
  // can route their changes to the correct file.
  const slimConfigPath = ref<string | null>(null)
  const slimActivePreset = ref<string>('')
  // Set of agent IDs that come from slim presets (not from opencode.jsonc)
  const slimAgentIds = ref<Set<string>>(new Set())
  // Original slim config text (for comment-preserving modify)
  const slimOriginalText = ref<string>('')

  // ── Magic-context config tracking ──────────────────────────────────────
  // Agents defined in magic-context.jsonc (historian, dreamer, sidekick)
  const magicConfigPath = ref<string | null>(null)
  const magicAgentIds = ref<Set<string>>(new Set())
  const magicOriginalText = ref<string>('')

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

    // ── Read config: hybrid approach (file for env vars, API for plugin agents) ──
  // Global scope: read opencode.jsonc from disk (preserves {env:VAR} format)
  //               + GET /config API (for plugin-registered agents/MCP)
  //               → merge: use API's agent/mcp, but keep file's apiKey/headers
  // Project scope: <cwd>/.opencode/config.json (plain JSON)
  async function fetchConfig(): Promise<boolean> {
    if (phase.value !== 'idle') return false
    if (pendingSave.value) return false

    phase.value = 'loading'
    lastError.value = null

    try {
      let config: OpenCodeConfig

      if (configScope.value === 'global') {
        // 1. Read from disk (preserves {env:VAR} format and comments)
        const configPath = await getConfigPath()
        let rawText = '{}'
        if (await exists(configPath)) {
          rawText = await readTextFile(configPath)
        }
        const fileConfig = (parseJsonc(rawText) ?? {}) as OpenCodeConfig

        // 2. Try GET /config API for plugin-registered agents/MCP
        //    Use session store's discovered instance URL if available (already verified)
        //    Fallback to discover_opencode_ports if session store is empty
        if (!targetUrl.value) {
          // Try session store first — instances already discovered by scanner
          const sessionStore = useSessionStore()
          if (sessionStore.instances.length > 0 && sessionStore.instances[0].url) {
            targetUrl.value = sessionStore.instances[0].url
          } else {
            // Fallback: discover ports via Rust command
            try {
              const ports = await invoke<number[]>('discover_opencode_ports')
              if (ports.length > 0) {
                targetUrl.value = 'http://127.0.0.1:' + ports[0]
              }
            } catch {
              // Discovery failed — try default port
              targetUrl.value = 'http://127.0.0.1:4096'
            }
          }
        }
        let apiConfig: OpenCodeConfig | null = null
        if (targetUrl.value) {
          try {
            const resp = await fetch(targetUrl.value + '/config')
            if (resp.ok) {
              apiConfig = (await resp.json()) as OpenCodeConfig
            }
          } catch {
            // API not available — fall back to file-only
          }
        }

        // 3. Merge: start with file config, then add agents/MCP from API
        config = fileConfig

        // 3a. Read oh-my-opencode-slim.json to identify slim-managed agents
        const home = await homeDir()
        const slimPath = await join(home, '.config', 'opencode', 'oh-my-opencode-slim.json')
        slimConfigPath.value = slimPath
        slimAgentIds.value = new Set()
        slimOriginalText.value = ''
        if (await exists(slimPath)) {
          try {
            const slimRaw = await readTextFile(slimPath)
            slimOriginalText.value = slimRaw
            const slim = JSON.parse(slimRaw) as { preset?: string; presets?: Record<string, Record<string, { model?: string; variant?: string; skills?: string[]; mcps?: string[]; options?: Record<string, unknown> }>> }
            slimActivePreset.value = slim.preset ?? ''
            const presetAgents = slim.presets?.[slimActivePreset.value] ?? {}
            for (const agentId of Object.keys(presetAgents)) {
              slimAgentIds.value.add(agentId)
            }
          } catch {
            // slim config parse failure — skip
          }
        }

        // 3b. Read magic-context.jsonc to identify magic-context-managed agents
        const magicPath = await join(home, '.config', 'cortexkit', 'magic-context.jsonc')
        magicConfigPath.value = magicPath
        magicAgentIds.value = new Set()
        magicOriginalText.value = ''
        if (await exists(magicPath)) {
          try {
            const magicRaw = await readTextFile(magicPath)
            magicOriginalText.value = magicRaw
            const magic = parseJsonc(magicRaw) as Record<string, unknown>
            // Magic-context agents are top-level objects: historian, dreamer, sidekick
            for (const key of Object.keys(magic)) {
              if (typeof magic[key] === 'object' && magic[key] !== null && !Array.isArray(magic[key])) {
                const obj = magic[key] as Record<string, unknown>
                // Heuristic: if it has model or fallback_models, it's an agent config
                if ('model' in obj || 'fallback_models' in obj || 'variant' in obj) {
                  magicAgentIds.value.add(key)
                }
              }
            }
          } catch {
            // magic-context parse failure — skip
          }
        }

        if (apiConfig) {
          // Merge agents from API — API has complete definitions (prompt, description, etc.)
          // For slim/magic agents: API data replaces slim file data (API is more complete)
          // For opencode.jsonc agents: user overrides take priority (disable, etc.)
          if (!config.agent) config.agent = {}
          if (apiConfig.agent) {
            for (const [agentId, apiDef] of Object.entries(apiConfig.agent)) {
              const existing = config.agent[agentId]
              if (existing && slimAgentIds.value.has(agentId)) {
                // Slim agent: API has full definition (prompt/description), merge over file data
                // But keep fields from opencode.jsonc overrides (like disable)
                config.agent[agentId] = { ...apiDef, ...existing }
              } else if (existing && magicAgentIds.value.has(agentId)) {
                // Magic agent: same — API is more complete
                config.agent[agentId] = { ...apiDef, ...existing }
              } else if (!existing) {
                // Not in any file config — add from API
                config.agent[agentId] = apiDef
              }
              // If existing and not slim/magic — it's an opencode.jsonc native agent, keep as-is
            }
          }
          // Merge MCP servers from API
          if (!config.mcp) config.mcp = {}
          if (apiConfig.mcp) {
            for (const [mcpId, mcpDef] of Object.entries(apiConfig.mcp)) {
              if (!config.mcp[mcpId]) {
                config.mcp[mcpId] = mcpDef
              }
            }
          }
          // Note: apiKey and headers are NOT merged from API
          // → file config's {env:VAR} values are preserved
        }
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

        // Separate diffs: slim-managed, magic-context-managed, vs opencode.jsonc changes
        const slimDiffs: typeof diffs = []
        const magicDiffs: typeof diffs = []
        const opencodeDiffs: typeof diffs = []
        for (const diff of diffs) {
          // Check if this is an agent change that belongs to a plugin config
          if (diff.path[0] === 'agent' && diff.path.length >= 2) {
            const agentId = diff.path[1] as string
            if (slimAgentIds.value.has(agentId)) {
              // Route to slim config: agent.xxx → presets.{activePreset}.xxx
              const slimPath = ['presets', slimActivePreset.value, ...diff.path.slice(1)]
              slimDiffs.push({ ...diff, path: slimPath })
              continue
            }
            if (magicAgentIds.value.has(agentId)) {
              // Route to magic-context config: agent.xxx → xxx (strip agent. prefix)
              const magicPath = [...diff.path.slice(1)]
              magicDiffs.push({ ...diff, path: magicPath })
              continue
            }
          }
          opencodeDiffs.push(diff)
        }

        // Apply opencode.jsonc changes
        const formattingOptions = { tabSize: 2, insertSpaces: true, eol: '\n' } as const
        let modifiedText = rawText
        let applied = 0
        for (const diff of opencodeDiffs) {
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

        // Apply slim config changes (oh-my-opencode-slim.json)
        if (slimDiffs.length > 0 && slimConfigPath.value) {
          let slimText = slimOriginalText.value || '{}'
          let slimApplied = 0
          for (const diff of slimDiffs) {
            try {
              const edits = modifyJsonc(slimText, diff.path, diff.value, { formattingOptions })
              slimText = applyJsoncEdits(slimText, edits)
              slimApplied++
            } catch {
              // modify may fail for complex paths — skip
            }
          }
          console.log(`[saveConfig:slim] applied ${slimApplied}/${slimDiffs.length} changes to oh-my-opencode-slim.json`)
          if (slimApplied > 0) {
            await writeTextFile(slimConfigPath.value, slimText)
            // Update slim original text for next save
            slimOriginalText.value = slimText
            // Verify no BOM
            const slimVerify = await readTextFile(slimConfigPath.value)
            if (slimVerify.charCodeAt(0) === 0xFEFF) {
              await writeTextFile(slimConfigPath.value, slimVerify.slice(1))
            }
          }
        }

        // Apply magic-context changes (magic-context.jsonc)
        if (magicDiffs.length > 0 && magicConfigPath.value) {
          let magicText = magicOriginalText.value || '{}'
          let magicApplied = 0
          for (const diff of magicDiffs) {
            try {
              const edits = modifyJsonc(magicText, diff.path, diff.value, { formattingOptions })
              magicText = applyJsoncEdits(magicText, edits)
              magicApplied++
            } catch {
              // modify may fail for complex paths — skip
            }
          }
          console.log(`[saveConfig:magic] applied ${magicApplied}/${magicDiffs.length} changes to magic-context.jsonc`)
          if (magicApplied > 0) {
            await writeTextFile(magicConfigPath.value, magicText)
            magicOriginalText.value = magicText
            const magicVerify = await readTextFile(magicConfigPath.value)
            if (magicVerify.charCodeAt(0) === 0xFEFF) {
              await writeTextFile(magicConfigPath.value, magicVerify.slice(1))
            }
          }
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

      // Config saved successfully — prompt user to restart Zed manually
      lastError.value = {
        at: Date.now(),
        phase: 'idle',
        message: '配置已保存，请手动重启 Zed 使配置生效。',
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
