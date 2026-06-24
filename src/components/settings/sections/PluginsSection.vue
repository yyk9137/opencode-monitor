<script setup lang="ts">
import { computed, ref } from 'vue'
import { Plus, Trash2, Package, Folder, FileText, ChevronDown, ChevronRight } from 'lucide-vue-next'
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
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      options = parsed
    }
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
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      options = parsed
    }
  } catch { return }
  updatePlugins([...plugins.value, options ? [spec, options] : spec])
  pathSpec.value = ''
  pathOptions.value = '{}'
  showAddForm.value = false
}

function addFilePlugin() {
  const name = fileName.value.trim()
  if (!name || !fileContent.value.trim()) return
  // File plugins are stored as [name, { content: "..." }] tuple
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
  if (typeof p === 'string') {
    arr[index] = name
  } else {
    arr[index] = [name, p[1]]
  }
  updatePlugins(arr)
}

function updatePluginConfig(index: number, config: unknown) {
  const arr = [...plugins.value]
  const p = arr[index]
  if (Array.isArray(p)) {
    arr[index] = [p[0], config as Record<string, unknown>]
    updatePlugins(arr)
  }
}

function enableConfig(index: number) {
  const arr = [...plugins.value]
  const p = arr[index]
  if (typeof p === 'string') {
    arr[index] = [p, {}]
    updatePlugins(arr)
  }
}

function disableConfig(index: number) {
  const arr = [...plugins.value]
  const p = arr[index]
  if (Array.isArray(p)) {
    arr[index] = p[0]
    updatePlugins(arr)
  }
}

function toggleExpand(index: number) {
  expanded.value = expanded.value === index ? null : index
}

function getPluginType(p: string | [string, Record<string, unknown>]): string {
  if (typeof p === 'string') return 'name'
  if (p[1]?.content) return 'file'
  if (p[0].startsWith('.') || p[0].startsWith('/')) return 'path'
  return 'npm'
}

function getPluginIcon(p: string | [string, Record<string, unknown>]) {
  const type = getPluginType(p)
  if (type === 'file') return FileText
  if (type === 'path') return Folder
  return Package
}
</script>

<template>
  <div class="section-content">
    <h2 class="section-title">Plugins</h2>

    <p class="field-hint">
      Plugins extend OpenCode with custom tools, providers, or behavior.
      Install from npm, a local path, or create a file-based plugin.
    </p>

    <!-- Plugin list -->
    <div v-for="(plugin, i) in plugins" :key="i" class="plugin-card">
      <button class="plugin-header" @click="toggleExpand(i)">
        <component :is="expanded === i ? ChevronDown : ChevronRight" :size="12" />
        <component :is="getPluginIcon(plugin)" :size="12" class="plugin-type-icon" />
        <span class="plugin-name">{{ isTuple(plugin) ? plugin[0] : plugin }}</span>
        <span class="plugin-type-badge" :class="getPluginType(plugin)">{{ getPluginType(plugin) }}</span>
        <span v-if="isTuple(plugin)" class="plugin-config-badge">config</span>
      </button>

      <div v-if="expanded === i" class="plugin-body">
        <div class="form-row">
          <label class="form-label">Name / Spec</label>
          <input :value="isTuple(plugin) ? plugin[0] : plugin" type="text" class="form-input" placeholder="npm package or path" @input="updatePluginName(i, ($event.target as HTMLInputElement).value)" />
        </div>

        <div v-if="isTuple(plugin)">
          <div class="config-toolbar">
            <label class="form-label">Configuration</label>
            <button class="btn-toggle-config" @click="disableConfig(i)">Remove config</button>
          </div>
          <JsonEditor :model-value="plugin[1]" @update:model-value="updatePluginConfig(i, $event)" @dirty="configStore.dirtyPaths.add('plugin')" />
        </div>
        <div v-else class="no-config">
          <span class="no-config-hint">No configuration.</span>
          <button class="btn-enable-config" @click="enableConfig(i)">+ Add config</button>
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

    <!-- Add plugin form (tabbed) -->
    <div v-if="showAddForm" class="add-form">
      <div class="add-tabs">
        <button class="add-tab" :class="{ active: addTab === 'npm' }" @click="addTab = 'npm'">npm install</button>
        <button class="add-tab" :class="{ active: addTab === 'path' }" @click="addTab = 'path'">path install</button>
        <button class="add-tab" :class="{ active: addTab === 'file' }" @click="addTab = 'file'">create file</button>
      </div>

      <!-- npm tab -->
      <div v-if="addTab === 'npm'" class="add-tab-content">
        <div class="form-row">
          <label class="form-label">Package Spec</label>
          <input v-model="npmSpec" class="form-input" placeholder="@cortexkit/magic-context or package@1.0.0" />
        </div>
        <div class="form-row">
          <label class="form-label">Options (JSON)</label>
          <JsonEditor v-model="npmOptions" @dirty="() => {}" />
        </div>
      </div>

      <!-- path tab -->
      <div v-if="addTab === 'path'" class="add-tab-content">
        <div class="form-row">
          <label class="form-label">Local Path</label>
          <input v-model="pathSpec" class="form-input" placeholder="./plugins/my-plugin or /abs/path" />
        </div>
        <div class="form-row">
          <label class="form-label">Options (JSON)</label>
          <JsonEditor v-model="pathOptions" @dirty="() => {}" />
        </div>
      </div>

      <!-- file tab -->
      <div v-if="addTab === 'file'" class="add-tab-content">
        <div class="form-row">
          <label class="form-label">File Name</label>
          <input v-model="fileName" class="form-input" placeholder="my-plugin.mjs" />
        </div>
        <div class="form-row">
          <label class="form-label">Content</label>
          <textarea v-model="fileContent" class="form-textarea" rows="12" placeholder="// Plugin code..."></textarea>
        </div>
      </div>

      <div class="add-form-actions">
        <button class="btn-add" @click="addTab === 'npm' ? addNpmPlugin() : addTab === 'path' ? addPathPlugin() : addFilePlugin()">
          Install
        </button>
        <button class="btn-cancel" @click="showAddForm = false">Cancel</button>
      </div>
    </div>
    <button v-else class="btn-add-card" @click="showAddForm = true">
      <Plus :size="12" /> Add Plugin
    </button>
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
.plugin-type-badge.path { color: var(--warning); }
.plugin-config-badge { font-family: var(--font-mono); font-size: 8px; padding: 1px 3px; border-radius: var(--radius-xs); background: var(--bg-element); color: var(--text-accent); }
.plugin-body { padding: var(--space-8); background: var(--bg-editor); display: flex; flex-direction: column; gap: var(--space-8); }
.form-row { display: flex; flex-direction: column; gap: var(--space-6); }
.form-label { font-size: 11px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-muted); }
.form-input { width: 100%; padding: 4px var(--space-8); height: 28px; background: var(--bg-element); border: 1px solid var(--border-variant); border-radius: var(--radius-xs); color: var(--text-primary); font-family: var(--font-ui); font-size: var(--font-size-ui); outline: none; }
.form-input:focus { background: var(--bg-editor); box-shadow: 0 0 0 1px var(--border-focused); }
.form-textarea { width: 100%; padding: var(--space-6) var(--space-8); min-height: 200px; background: var(--code-block-bg); border: 1px solid var(--border-variant); border-radius: var(--radius-xs); color: var(--text-primary); font-family: var(--font-mono); font-size: var(--font-size-code); outline: none; resize: vertical; line-height: 1.5; }
.form-textarea:focus { border-color: var(--border-focused); }
.config-toolbar { display: flex; align-items: center; justify-content: space-between; margin-bottom: var(--space-6); }
.btn-toggle-config { background: transparent; border: none; color: var(--text-muted); cursor: pointer; font-size: var(--font-size-small); text-decoration: underline; }
.btn-toggle-config:hover { color: var(--text-primary); }
.no-config { display: flex; align-items: center; gap: var(--space-6); padding: var(--space-6) 0; }
.no-config-hint { font-size: var(--font-size-small); color: var(--text-placeholder); }
.btn-enable-config { background: transparent; border: none; color: var(--text-accent); cursor: pointer; font-size: var(--font-size-small); text-decoration: underline; }
.btn-enable-config:hover { color: var(--text-primary); }
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
