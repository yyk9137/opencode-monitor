<script setup lang="ts">
import { computed, ref, onMounted, watch } from 'vue'
import { readTextFile, exists } from '@tauri-apps/plugin-fs'
import { homeDir, join } from '@tauri-apps/api/path'
import { Plus, Trash2, Package, ChevronDown, ChevronRight } from 'lucide-vue-next'
import { useConfigStore } from '@/stores/config'
import JsonEditor from '../JsonEditor.vue'

const configStore = useConfigStore()
const showAddForm = ref(false)
const addTab = ref<'npm' | 'path' | 'file'>('npm')
const expanded = ref<number | null>(null)

// Add form state
const npmSpec = ref('')
const npmOptions = ref('{}')
const pathSpec = ref('')
const pathOptions = ref('{}')
const fileName = ref('')
const fileContent = ref('')

const plugins = computed(() => configStore.draft?.plugin ?? [])

// ── Plugin config files ──────────────────────────────────────────────────
interface PluginConfigFile {
  pluginName: string
  fileName: string
  path: string
  content: unknown
  raw: string
  exists: boolean
}

const pluginConfigFiles = ref<PluginConfigFile[]>([])
const configLoading = ref(false)

// Map plugin names to their config file locations
// Each entry: [configDir, fileName]
// configDir is relative to home: '.config/opencode' or '.config/cortexkit'
interface PluginConfigEntry {
  dir: string  // relative to home dir
  file: string
}

const PLUGIN_CONFIG_MAP: Record<string, PluginConfigEntry[]> = {
  'oh-my-opencode-slim': [{ dir: '.config/opencode', file: 'oh-my-opencode-slim.json' }],
  '@cortexkit/aft-opencode': [{ dir: '.config/opencode', file: 'aft.jsonc' }],
  '@cortexkit/aft-opencode@latest': [{ dir: '.config/opencode', file: 'aft.jsonc' }],
  '@cortexkit/opencode-magic-context': [{ dir: '.config/cortexkit', file: 'magic-context.jsonc' }],
  '@cortexkit/opencode-magic-context@latest': [{ dir: '.config/cortexkit', file: 'magic-context.jsonc' }],
}

// Also load tui.json (TUI plugin list)
const TUI_CONFIG: PluginConfigEntry = { dir: '.config/opencode', file: 'tui.json' }

function stripJsonComments(text: string): string {
  return text.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '').trim()
}

async function tryReadConfigFile(home: string, entry: PluginConfigEntry): Promise<PluginConfigFile | null> {
  const filePath = await join(home, entry.dir, entry.file)
  const fileExists = await exists(filePath)
  let content: unknown = null
  let raw = ''

  if (fileExists) {
    try {
      raw = await readTextFile(filePath)
      content = JSON.parse(stripJsonComments(raw))
    } catch { /* parse error */ }
  }

  return {
    pluginName: '',
    fileName: entry.file,
    path: filePath,
    content,
    raw,
    exists: fileExists,
  }
}

async function loadPluginConfigs() {
  configLoading.value = true
  try {
    const home = await homeDir()
    const results: PluginConfigFile[] = []

    // Load tui.json first
    const tuiFile = await tryReadConfigFile(home, TUI_CONFIG)
    if (tuiFile) {
      tuiFile.pluginName = '(TUI config)'
      results.push(tuiFile)
    }

    // Load per-plugin config files
    for (const plugin of plugins.value) {
      const name = typeof plugin === 'string' ? plugin : plugin[0]
      // Find matching config entries
      let configEntries: PluginConfigEntry[] | undefined
      for (const [key, val] of Object.entries(PLUGIN_CONFIG_MAP)) {
        if (name === key || name.startsWith(key.replace('@latest', ''))) {
          configEntries = val
          break
        }
      }
      if (!configEntries) continue

      for (const entry of configEntries) {
        const file = await tryReadConfigFile(home, entry)
        if (file) {
          file.pluginName = name
          results.push(file)
        }
      }
    }

    pluginConfigFiles.value = results
  } catch { /* silent */ } finally {
    configLoading.value = false
  }
}

onMounted(loadPluginConfigs)
watch(() => configStore.draft?.plugin, () => loadPluginConfigs(), { deep: true })

function updateConfigContent(_key: string, _value: unknown) {
  // TODO: save plugin config files to disk (separate from opencode.jsonc)
  // For now, edits are in-memory only and lost on panel close
}

// ── Plugin list CRUD ──────────────────────────────────────────────────────
function updatePlugins(newPlugins: (string | [string, Record<string, unknown>])[]) {
  if (!configStore.draft) return
  configStore.draft.plugin = newPlugins
  configStore.dirtyPaths.add('plugin')
}

function isTuple(p: string | [string, Record<string, unknown>]): p is [string, Record<string, unknown>] {
  return Array.isArray(p)
}

function addNpmPlugin() {
  const spec = npmSpec.value.trim()
  if (!spec) return
  let options: Record<string, unknown> | undefined
  try {
    const parsed = JSON.parse(npmOptions.value.trim() || '{}')
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) options = parsed
  } catch { return }
  updatePlugins([...plugins.value, options ? [spec, options] : spec])
  npmSpec.value = ''
  npmOptions.value = '{}'
  showAddForm.value = false
}

function addPathPlugin() {
  const spec = pathSpec.value.trim()
  if (!spec) return
  let options: Record<string, unknown> | undefined
  try {
    const parsed = JSON.parse(pathOptions.value.trim() || '{}')
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) options = parsed
  } catch { return }
  updatePlugins([...plugins.value, options ? [spec, options] : spec])
  pathSpec.value = ''
  pathOptions.value = '{}'
  showAddForm.value = false
}

function addFilePlugin() {
  const name = fileName.value.trim()
  if (!name || !fileContent.value.trim()) return
  updatePlugins([...plugins.value, [name, { content: fileContent.value }]])
  fileName.value = ''
  fileContent.value = ''
  showAddForm.value = false
}

function removePlugin(index: number) {
  const arr = [...plugins.value]
  arr.splice(index, 1)
  updatePlugins(arr)
}

function updatePluginName(index: number, name: string) {
  const arr = [...plugins.value]
  const p = arr[index]
  if (typeof p === 'string') arr[index] = name
  else arr[index] = [name, p[1]]
  updatePlugins(arr)
}

function enableConfig(index: number) {
  const arr = [...plugins.value]
  const p = arr[index]
  if (typeof p === 'string') { arr[index] = [p, {}]; updatePlugins(arr) }
}

function disableConfig(index: number) {
  const arr = [...plugins.value]
  const p = arr[index]
  if (Array.isArray(p)) { arr[index] = p[0]; updatePlugins(arr) }
}

function getPluginType(p: string | [string, Record<string, unknown>]): string {
  if (typeof p === 'string') return 'name'
  if (p[1]?.content) return 'file'
  if (p[0].startsWith('.') || p[0].startsWith('/')) return 'path'
  return 'npm'
}

function toggleExpand(index: number) {
  expanded.value = expanded.value === index ? null : index
}
</script>

<template>
  <div class="section-content">
    <h2 class="section-title">Plugins</h2>

    <p class="field-hint">
      插件列表来自 opencode.jsonc。下方显示每个插件的配置文件内容，可直接编辑。
    </p>

    <!-- Plugin list with config files -->
    <div v-for="(plugin, i) in plugins" :key="i" class="plugin-card">
      <button class="plugin-header" @click="toggleExpand(i)">
        <component :is="expanded === i ? ChevronDown : ChevronRight" :size="12" />
        <Package :size="12" class="plugin-type-icon" />
        <span class="plugin-name">{{ isTuple(plugin) ? plugin[0] : plugin }}</span>
        <span class="plugin-type-badge" :class="getPluginType(plugin)">{{ getPluginType(plugin) }}</span>
        <span v-if="isTuple(plugin)" class="plugin-config-badge">config</span>
      </button>

      <div v-if="expanded === i" class="plugin-body">
        <!-- Plugin name/spec editor -->
        <div class="form-row">
          <label class="form-label">Name / Spec</label>
          <input :value="isTuple(plugin) ? plugin[0] : plugin" type="text" class="form-input" placeholder="npm package or path" @input="updatePluginName(i, ($event.target as HTMLInputElement).value)" />
        </div>

        <!-- Plugin inline config (tuple) -->
        <div v-if="isTuple(plugin)">
          <div class="config-toolbar">
            <label class="form-label">Inline Config</label>
            <button class="btn-toggle-config" @click="disableConfig(i)">Remove inline config</button>
          </div>
          <JsonEditor :model-value="plugin[1]" @update:model-value="updatePlugins(plugins.map((p, idx) => idx === i ? [isTuple(plugin) ? plugin[0] : plugin, $event as Record<string, unknown>] : p) as (string | [string, Record<string, unknown>])[])" @dirty="configStore.dirtyPaths.add('plugin')" />
        </div>
        <div v-else class="no-config">
          <span class="no-config-hint">No inline config.</span>
          <button class="btn-enable-config" @click="enableConfig(i)">+ Add inline config</button>
        </div>

        <!-- Plugin config files (from disk) -->
        <div v-for="cf in pluginConfigFiles.filter(f => f.pluginName === (isTuple(plugin) ? plugin[0] : plugin))" :key="cf.path" class="config-file-section">
          <div class="config-toolbar">
            <label class="form-label">{{ cf.fileName }}</label>
            <span class="file-path-hint" :class="{ 'file-found': cf.exists, 'file-missing': !cf.exists }">{{ cf.exists ? '✓ loaded' : '✗ not found' }}</span>
          </div>
          <div class="file-path-detail">{{ cf.path }}</div>
          <JsonEditor
            :model-value="cf.content"
            @update:model-value="updateConfigContent(cf.pluginName + ':' + cf.path, $event)"
            @dirty="configStore.dirtyPaths.add('plugin')"
          />
        </div>

        <div class="card-actions">
          <button class="btn-delete" @click="removePlugin(i)"><Trash2 :size="11" /> Remove</button>
        </div>
      </div>
    </div>

    <div v-if="plugins.length === 0" class="empty-state">
      <Package :size="24" />
      <p>No plugins installed.</p>
    </div>

    <!-- TUI config file (tui.json) -->
    <div v-if="pluginConfigFiles.find(f => f.pluginName === '(TUI config)')" class="plugin-card">
      <div class="plugin-header" style="cursor: default">
        <Package :size="12" class="plugin-type-icon" />
        <span class="plugin-name">TUI Config (tui.json)</span>
        <span class="file-path-hint" :class="{ 'file-found': pluginConfigFiles.find(f => f.pluginName === '(TUI config)')?.exists, 'file-missing': !pluginConfigFiles.find(f => f.pluginName === '(TUI config)')?.exists }">{{ pluginConfigFiles.find(f => f.pluginName === '(TUI config)')?.exists ? '✓ loaded' : '✗ not found' }}</span>
      </div>
      <div class="plugin-body">
        <div class="form-row">
          <label class="form-label">tui.json</label>
          <div class="file-path-detail">{{ pluginConfigFiles.find(f => f.pluginName === '(TUI config)')?.path }}</div>
          <JsonEditor
            :model-value="pluginConfigFiles.find(f => f.pluginName === '(TUI config)')?.content"
            @update:model-value="updateConfigContent('tui-config', $event)"
            @dirty="configStore.dirtyPaths.add('plugin')"
          />
        </div>
      </div>
    </div>

    <!-- Add plugin form -->
    <div v-if="showAddForm" class="add-form">
      <div class="add-tabs">
        <button class="add-tab" :class="{ active: addTab === 'npm' }" @click="addTab = 'npm'">npm</button>
        <button class="add-tab" :class="{ active: addTab === 'path' }" @click="addTab = 'path'">path</button>
        <button class="add-tab" :class="{ active: addTab === 'file' }" @click="addTab = 'file'">file</button>
      </div>

      <div v-if="addTab === 'npm'" class="add-tab-content">
        <div class="form-row"><label class="form-label">Package Spec</label><input v-model="npmSpec" class="form-input" placeholder="@cortexkit/magic-context@latest" /></div>
        <div class="form-row"><label class="form-label">Options (JSON)</label><JsonEditor v-model="npmOptions" @dirty="() => {}" /></div>
      </div>
      <div v-if="addTab === 'path'" class="add-tab-content">
        <div class="form-row"><label class="form-label">Local Path</label><input v-model="pathSpec" class="form-input" placeholder="./plugins/my-plugin" /></div>
        <div class="form-row"><label class="form-label">Options (JSON)</label><JsonEditor v-model="pathOptions" @dirty="() => {}" /></div>
      </div>
      <div v-if="addTab === 'file'" class="add-tab-content">
        <div class="form-row"><label class="form-label">File Name</label><input v-model="fileName" class="form-input" placeholder="my-plugin.mjs" /></div>
        <div class="form-row"><label class="form-label">Content</label><textarea v-model="fileContent" class="form-textarea" rows="12" placeholder="// Plugin code..."></textarea></div>
      </div>

      <div class="add-form-actions">
        <button class="btn-add" @click="addTab === 'npm' ? addNpmPlugin() : addTab === 'path' ? addPathPlugin() : addFilePlugin()">Install</button>
        <button class="btn-cancel" @click="showAddForm = false">Cancel</button>
      </div>
    </div>
    <button v-else class="btn-add-card" @click="showAddForm = true"><Plus :size="12" /> Add Plugin</button>
  </div>
</template>

<style scoped>
.section-content { padding: var(--space-12) var(--space-16); display: flex; flex-direction: column; gap: var(--space-12); }
.section-title { font-size: var(--font-size-ui); font-weight: 600; color: var(--text-primary); text-transform: uppercase; letter-spacing: 0.06em; margin: 0; }
.field-hint { font-size: var(--font-size-small); color: var(--text-placeholder); }
.empty-state { display: flex; flex-direction: column; align-items: center; gap: var(--space-6); padding: var(--space-16); color: var(--text-placeholder); }
.empty-state p { font-size: var(--font-size-ui); }
.plugin-card { border: 1px solid var(--border-variant); border-radius: var(--radius-xs); overflow: hidden; }
.plugin-header { display: flex; align-items: center; gap: var(--space-6); width: 100%; padding: var(--space-6) var(--space-8); background: var(--bg-app); border: none; color: var(--text-primary); cursor: pointer; font-family: var(--font-ui); font-size: var(--font-size-ui); text-align: left; }
.plugin-header:hover { background: var(--bg-hover); }
.plugin-type-icon { color: var(--text-muted); }
.plugin-name { flex: 1; }
.plugin-type-badge { font-family: var(--font-mono); font-size: 9px; padding: 1px 4px; border-radius: var(--radius-xs); background: var(--bg-element); color: var(--text-muted); }
.plugin-type-badge.npm { color: var(--text-accent); }
.plugin-config-badge { font-family: var(--font-mono); font-size: 8px; padding: 1px 3px; border-radius: var(--radius-xs); background: var(--bg-element); color: var(--text-accent); }
.plugin-body { padding: var(--space-8); background: var(--bg-editor); display: flex; flex-direction: column; gap: var(--space-8); }
.form-row { display: flex; flex-direction: column; gap: var(--space-6); }
.form-label { font-size: 11px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-muted); }
.form-input { width: 100%; padding: 4px var(--space-8); height: 28px; background: var(--bg-element); border: 1px solid var(--border-variant); border-radius: var(--radius-xs); color: var(--text-primary); font-family: var(--font-ui); font-size: var(--font-size-ui); outline: none; }
.form-input:focus { background: var(--bg-editor); box-shadow: 0 0 0 1px var(--border-focused); }
.form-textarea { width: 100%; padding: var(--space-6) var(--space-8); min-height: 200px; background: var(--code-block-bg); border: 1px solid var(--border-variant); border-radius: var(--radius-xs); color: var(--text-primary); font-family: var(--font-mono); font-size: var(--font-size-code); outline: none; resize: vertical; line-height: 1.5; }
.config-toolbar { display: flex; align-items: center; justify-content: space-between; margin-bottom: var(--space-6); }
.btn-toggle-config { background: transparent; border: none; color: var(--text-muted); cursor: pointer; font-size: var(--font-size-small); text-decoration: underline; }
.btn-toggle-config:hover { color: var(--text-primary); }
.no-config { display: flex; align-items: center; gap: var(--space-6); padding: var(--space-6) 0; }
.no-config-hint { font-size: var(--font-size-small); color: var(--text-placeholder); }
.btn-enable-config { background: transparent; border: none; color: var(--text-accent); cursor: pointer; font-size: var(--font-size-small); text-decoration: underline; }
.config-file-section { padding-top: var(--space-8); border-top: 1px solid var(--border-variant); display: flex; flex-direction: column; gap: var(--space-6); }
.file-path-detail { font-family: var(--font-mono); font-size: 9px; color: var(--text-placeholder); word-break: break-all; }
.file-found { color: var(--success); }
.file-missing { color: var(--error); }
.file-path-hint { font-size: var(--font-size-small); color: var(--text-placeholder); }
.card-actions { display: flex; justify-content: flex-end; }
.btn-delete { display: inline-flex; align-items: center; gap: 4px; padding: 4px var(--space-8); background: transparent; border: 1px solid var(--error); border-radius: var(--radius-xs); color: var(--error); cursor: pointer; font-size: var(--font-size-small); }
.btn-delete:hover { background: rgba(217,87,87,0.1); }
.add-form { border: 1px solid var(--border-variant); border-radius: var(--radius-xs); padding: var(--space-8); background: var(--bg-editor); }
.add-tabs { display: flex; gap: 2px; margin-bottom: var(--space-8); }
.add-tab { flex: 1; padding: 4px var(--space-8); background: var(--bg-element); border: 1px solid var(--border-variant); border-radius: var(--radius-xs); color: var(--text-muted); cursor: pointer; font-size: var(--font-size-small); }
.add-tab.active { background: var(--bg-selected); color: var(--text-accent); border-color: var(--text-accent); }
.add-tab-content { display: flex; flex-direction: column; gap: var(--space-8); margin-bottom: var(--space-8); }
.add-form-actions { display: flex; gap: var(--space-6); }
.btn-add, .btn-cancel { padding: 4px var(--space-8); border-radius: var(--radius-xs); cursor: pointer; font-size: var(--font-size-ui); border: none; }
.btn-add { background: var(--text-accent); color: var(--bg-editor); }
.btn-cancel { background: transparent; color: var(--text-muted); }
.btn-add-card { display: inline-flex; align-items: center; gap: 4px; padding: var(--space-6) var(--space-8); background: transparent; border: 1px dashed var(--border-variant); border-radius: var(--radius-xs); color: var(--text-muted); cursor: pointer; font-size: var(--font-size-ui); }
.btn-add-card:hover { color: var(--text-primary); border-color: var(--text-accent); }
</style>
