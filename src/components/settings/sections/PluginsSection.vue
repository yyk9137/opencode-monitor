<script setup lang="ts">
import { computed } from 'vue'
import { Plus, Trash2, Settings as SettingsIcon } from 'lucide-vue-next'
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

function isTuple(p: string | [string, Record<string, unknown>]): p is [string, Record<string, unknown>] {
  return Array.isArray(p)
}
</script>

<template>
  <div class="section-content">
    <h2 class="section-title">Plugins</h2>

    <div v-if="plugins.length === 0" class="empty-state">
      <SettingsIcon :size="24" />
      <p>No plugins configured.</p>
    </div>

    <div v-for="(plugin, i) in plugins" :key="i" class="plugin-card">
      <div class="plugin-header">
        <input
          :value="isTuple(plugin) ? plugin[0] : plugin"
          type="text"
          class="form-input plugin-name-input"
          placeholder="plugin name or npm package"
          @input="updatePluginName(i, ($event.target as HTMLInputElement).value)"
        />
        <button class="btn-remove" @click="removePlugin(i)">
          <Trash2 :size="11" />
        </button>
      </div>

      <div v-if="isTuple(plugin)" class="plugin-config">
        <label class="form-label">Config (JSON)</label>
        <JsonEditor
          :model-value="plugin[1]"
          @update:model-value="updatePluginConfig(i, $event)"
          @dirty="configStore.dirtyPaths.add('plugin')"
        />
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

    <p class="field-hint">
      Plugins are npm packages or local paths that extend OpenCode.
      Each entry is either a bare string (name) or a [name, config] tuple.
    </p>
  </div>
</template>

<style scoped>
.section-content { padding: var(--space-12) var(--space-16); display: flex; flex-direction: column; gap: var(--space-12); }
.section-title { font-size: var(--font-size-ui); font-weight: 600; color: var(--text-primary); text-transform: uppercase; letter-spacing: 0.06em; margin: 0; }
.empty-state { display: flex; flex-direction: column; align-items: center; gap: var(--space-6); padding: var(--space-16); color: var(--text-placeholder); }
.empty-state p { font-size: var(--font-size-ui); }
.plugin-card { border: 1px solid var(--border-variant); border-radius: var(--radius-xs); overflow: hidden; }
.plugin-header { display: flex; align-items: center; gap: var(--space-6); padding: var(--space-6) var(--space-8); background: var(--bg-app); }
.plugin-name-input { flex: 1; }
.plugin-config { padding: var(--space-8); background: var(--bg-editor); display: flex; flex-direction: column; gap: var(--space-6); }
.form-label { font-size: 11px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-muted); }
.form-input { padding: 4px var(--space-8); height: 28px; background: var(--bg-element); border: 1px solid var(--border-variant); border-radius: var(--radius-xs); color: var(--text-primary); font-family: var(--font-ui); font-size: var(--font-size-ui); outline: none; }
.form-input:focus { background: var(--bg-editor); box-shadow: 0 0 0 1px var(--border-focused); }
.btn-remove { display: flex; align-items: center; justify-content: center; width: 24px; height: 24px; border: none; background: transparent; color: var(--text-muted); cursor: pointer; border-radius: var(--radius-xs); }
.btn-remove:hover { color: var(--error); background: var(--bg-hover); }
.add-buttons { display: flex; gap: var(--space-8); }
.btn-add-card { display: inline-flex; align-items: center; gap: 4px; padding: var(--space-6) var(--space-8); background: transparent; border: 1px dashed var(--border-variant); border-radius: var(--radius-xs); color: var(--text-muted); cursor: pointer; font-size: var(--font-size-ui); }
.btn-add-card:hover { color: var(--text-primary); border-color: var(--text-accent); }
.field-hint { font-size: var(--font-size-small); color: var(--text-placeholder); }
</style>
