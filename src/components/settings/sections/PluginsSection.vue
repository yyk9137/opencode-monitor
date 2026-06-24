<script setup lang="ts">
import { computed } from 'vue'
import { Plus, Trash2, Package } from 'lucide-vue-next'
import { useConfigStore } from '@/stores/config'
import JsonEditor from '../JsonEditor.vue'

const configStore = useConfigStore()

const plugins = computed(() => configStore.draft?.plugin ?? [])

function updatePlugins(newPlugins: (string | [string, Record<string, unknown>])[]) {
  if (!configStore.draft) return
  configStore.draft.plugin = newPlugins
  configStore.dirtyPaths.add('plugin')
}

function addStringPlugin() {
  updatePlugins([...plugins.value, ''])
}

function addTuplePlugin() {
  updatePlugins([...plugins.value, ['', {}]])
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
  }
  updatePlugins(arr)
}

// Convert a string plugin to a tuple (enable config)
function enableConfig(index: number) {
  const arr = [...plugins.value]
  const p = arr[index]
  if (typeof p === 'string') {
    arr[index] = [p, {}]
    updatePlugins(arr)
  }
}

// Convert a tuple plugin back to string (disable config)
function disableConfig(index: number) {
  const arr = [...plugins.value]
  const p = arr[index]
  if (Array.isArray(p)) {
    arr[index] = p[0]
    updatePlugins(arr)
  }
}

function isTuple(p: string | [string, Record<string, unknown>]): p is [string, Record<string, unknown>] {
  return Array.isArray(p)
}
</script>

<template>
  <div class="section-content">
    <h2 class="section-title">Plugins</h2>

    <p class="field-hint">
      Plugins extend OpenCode with custom tools, providers, or behavior.
      Each plugin is either a bare package name (string) or a [name, config] tuple with configuration options.
    </p>

    <div v-if="plugins.length === 0" class="empty-state">
      <Package :size="24" />
      <p>No plugins configured.</p>
    </div>

    <div v-for="(plugin, i) in plugins" :key="i" class="plugin-card">
      <div class="plugin-header">
        <input
          :value="isTuple(plugin) ? plugin[0] : plugin"
          type="text"
          class="form-input plugin-name-input"
          placeholder="plugin name or npm package (e.g. @cortexkit/magic-context)"
          @input="updatePluginName(i, ($event.target as HTMLInputElement).value)"
        />
        <span class="plugin-type-badge" :class="isTuple(plugin) ? 'tuple' : 'string'">
          {{ isTuple(plugin) ? 'config' : 'name only' }}
        </span>
        <button class="btn-remove" @click="removePlugin(i)">
          <Trash2 :size="11" />
        </button>
      </div>

      <div v-if="isTuple(plugin)" class="plugin-config-body">
        <div class="config-toolbar">
          <label class="form-label">Plugin Configuration</label>
          <button class="btn-toggle-config" @click="disableConfig(i)">
            Remove config
          </button>
        </div>
        <JsonEditor
          :model-value="plugin[1]"
          @update:model-value="updatePluginConfig(i, $event)"
          @dirty="configStore.dirtyPaths.add('plugin')"
        />
      </div>
      <div v-else class="plugin-no-config">
        <span class="no-config-hint">No configuration. </span>
        <button class="btn-enable-config" @click="enableConfig(i)">
          + Add config
        </button>
      </div>
    </div>

    <div class="add-buttons">
      <button class="btn-add-card" @click="addStringPlugin">
        <Plus :size="12" /> Add Plugin (name only)
      </button>
      <button class="btn-add-card" @click="addTuplePlugin">
        <Plus :size="12" /> Add Plugin (name + config)
      </button>
    </div>
  </div>
</template>

<style scoped>
.section-content { padding: var(--space-12) var(--space-16); display: flex; flex-direction: column; gap: var(--space-12); }
.section-title { font-size: var(--font-size-ui); font-weight: 600; color: var(--text-primary); text-transform: uppercase; letter-spacing: 0.06em; margin: 0; }
.field-hint { font-size: var(--font-size-small); color: var(--text-placeholder); }
.empty-state { display: flex; flex-direction: column; align-items: center; gap: var(--space-6); padding: var(--space-16); color: var(--text-placeholder); }
.empty-state p { font-size: var(--font-size-ui); }
.plugin-card { border: 1px solid var(--border-variant); border-radius: var(--radius-xs); overflow: hidden; }
.plugin-header { display: flex; align-items: center; gap: var(--space-6); padding: var(--space-6) var(--space-8); background: var(--bg-app); }
.plugin-name-input { flex: 1; }
.plugin-type-badge { font-family: var(--font-mono); font-size: 9px; padding: 1px 4px; border-radius: var(--radius-xs); background: var(--bg-element); }
.plugin-type-badge.tuple { color: var(--text-accent); }
.plugin-type-badge.string { color: var(--text-muted); }
.btn-remove { display: flex; align-items: center; justify-content: center; width: 24px; height: 24px; border: none; background: transparent; color: var(--text-muted); cursor: pointer; border-radius: var(--radius-xs); }
.btn-remove:hover { color: var(--error); background: var(--bg-hover); }
.plugin-config-body { padding: var(--space-8); background: var(--bg-editor); display: flex; flex-direction: column; gap: var(--space-6); }
.config-toolbar { display: flex; align-items: center; justify-content: space-between; }
.form-label { font-size: 11px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-muted); }
.btn-toggle-config { background: transparent; border: none; color: var(--text-muted); cursor: pointer; font-size: var(--font-size-small); text-decoration: underline; }
.btn-toggle-config:hover { color: var(--text-primary); }
.plugin-no-config { padding: var(--space-6) var(--space-8); background: var(--bg-editor); display: flex; align-items: center; gap: var(--space-6); }
.no-config-hint { font-size: var(--font-size-small); color: var(--text-placeholder); }
.btn-enable-config { background: transparent; border: none; color: var(--text-accent); cursor: pointer; font-size: var(--font-size-small); text-decoration: underline; }
.btn-enable-config:hover { color: var(--text-primary); }
.add-buttons { display: flex; gap: var(--space-8); }
.btn-add-card { display: inline-flex; align-items: center; gap: 4px; padding: var(--space-6) var(--space-8); background: transparent; border: 1px dashed var(--border-variant); border-radius: var(--radius-xs); color: var(--text-muted); cursor: pointer; font-size: var(--font-size-ui); }
.btn-add-card:hover { color: var(--text-primary); border-color: var(--text-accent); }
.form-input { padding: 4px var(--space-8); height: 28px; background: var(--bg-element); border: 1px solid var(--border-variant); border-radius: var(--radius-xs); color: var(--text-primary); font-family: var(--font-ui); font-size: var(--font-size-ui); outline: none; }
.form-input:focus { background: var(--bg-editor); box-shadow: 0 0 0 1px var(--border-focused); }
</style>
