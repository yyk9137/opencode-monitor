<script setup lang="ts">
import { computed, ref } from 'vue'
import { ChevronDown, ChevronRight } from 'lucide-vue-next'
import { useConfigStore } from '@/stores/config'
import TagInput from '../TagInput.vue'
import JsonEditor from '../JsonEditor.vue'

const configStore = useConfigStore()
const expandedProvider = ref<string | null>(null)
const activeTab = ref<Record<string, 'basic' | 'advanced' | 'raw'>>({})

const providers = computed(() => {
  const entries = Object.entries(configStore.draft?.provider ?? {})
  return entries.map(([id, config]) => ({ id, config }))
})

function toggleExpand(id: string) {
  expandedProvider.value = expandedProvider.value === id ? null : id
  if (!(id in activeTab.value)) activeTab.value[id] = 'basic'
}

function updateProvider(id: string, field: string, value: unknown) {
  if (!configStore.draft?.provider?.[id]) return
  ;(configStore.draft.provider[id] as Record<string, unknown>)[field] = value
  configStore.dirtyPaths.add(`provider.${id}.${field}`)
}
</script>

<template>
  <div class="section-content">
    <h2 class="section-title">Provider Config</h2>

    <div v-for="{ id, config } in providers" :key="id" class="provider-card">
      <button class="provider-header" @click="toggleExpand(id)">
        <component :is="expandedProvider === id ? ChevronDown : ChevronRight" :size="12" />
        <span>{{ config.name || id }}</span>
        <span class="provider-id">{{ id }}</span>
      </button>

      <div v-if="expandedProvider === id" class="provider-body">
        <div class="config-tabs">
          <button class="tab-header" :class="{ active: (activeTab[id] || 'basic') === 'basic' }" @click="activeTab[id] = 'basic'">Basic</button>
          <button class="tab-header" :class="{ active: activeTab[id] === 'advanced' }" @click="activeTab[id] = 'advanced'">Advanced</button>
          <button class="tab-header" :class="{ active: activeTab[id] === 'raw' }" @click="activeTab[id] = 'raw'">Raw JSON</button>
        </div>

        <!-- Basic tab -->
        <div v-show="(activeTab[id] || 'basic') === 'basic'" class="tab-content">
          <div class="form-row">
            <label class="form-label">API Key (env var name)</label>
            <input :value="config.options?.apiKey ?? ''" type="text" class="form-input"
              :placeholder="config.options?.apiKey ? '' : 'Env var name (e.g. ANTHROPIC_API_KEY)'"
              @input="updateProvider(id, 'options', { ...config.options, apiKey: ($event.target as HTMLInputElement).value || undefined })" />
          </div>
          <div class="form-row">
            <label class="form-label">Base URL</label>
            <input :value="config.options?.baseURL ?? ''" type="text" class="form-input" placeholder="https://api.example.com"
              @input="updateProvider(id, 'options', { ...config.options, baseURL: ($event.target as HTMLInputElement).value || undefined })" />
          </div>
        </div>

        <!-- Advanced tab -->
        <div v-show="activeTab[id] === 'advanced'" class="tab-content">
          <div class="form-row">
            <label class="form-label">API</label>
            <input :value="config.api ?? ''" type="text" class="form-input" @input="updateProvider(id, 'api', ($event.target as HTMLInputElement).value || undefined)" />
          </div>
          <div class="form-row">
            <label class="form-label">Env Vars</label>
            <TagInput :model-value="config.env ?? []" @update:model-value="updateProvider(id, 'env', $event)" @dirty="configStore.dirtyPaths.add(`provider.${id}.env`)" />
          </div>
          <div class="form-row">
            <label class="form-label">NPM</label>
            <input :value="config.npm ?? ''" type="text" class="form-input" @input="updateProvider(id, 'npm', ($event.target as HTMLInputElement).value || undefined)" />
          </div>
          <div class="form-row">
            <label class="form-label">Whitelist</label>
            <TagInput :model-value="config.whitelist ?? []" @update:model-value="updateProvider(id, 'whitelist', $event)" @dirty="configStore.dirtyPaths.add(`provider.${id}.whitelist`)" />
          </div>
          <div class="form-row">
            <label class="form-label">Blacklist</label>
            <TagInput :model-value="config.blacklist ?? []" @update:model-value="updateProvider(id, 'blacklist', $event)" @dirty="configStore.dirtyPaths.add(`provider.${id}.blacklist`)" />
          </div>
          <div class="form-row">
            <label class="form-label">Set Cache Key</label>
            <button class="toggle-switch" :class="{ on: config.options?.setCacheKey }" @click="updateProvider(id, 'options', { ...config.options, setCacheKey: !config.options?.setCacheKey })">
              <span class="toggle-knob" />
            </button>
          </div>
        </div>

        <!-- Raw JSON tab -->
        <div v-show="activeTab[id] === 'raw'" class="tab-content">
          <JsonEditor :model-value="config" @update:model-value="updateProvider(id, '', $event)" @dirty="configStore.dirtyPaths.add(`provider.${id}`)" />
        </div>
      </div>
    </div>

    <p v-if="providers.length === 0" class="empty-hint">No provider configs. Add one in opencode config.</p>
  </div>
</template>

<style scoped>
.section-content { padding: var(--space-12) var(--space-16); display: flex; flex-direction: column; gap: var(--space-12); }
.section-title { font-size: var(--font-size-ui); font-weight: 600; color: var(--text-primary); text-transform: uppercase; letter-spacing: 0.06em; margin: 0; }
.provider-card { border: 1px solid var(--border-variant); border-radius: var(--radius-xs); overflow: hidden; }
.provider-header { display: flex; align-items: center; gap: var(--space-6); width: 100%; padding: var(--space-6) var(--space-8); background: var(--bg-app); border: none; color: var(--text-primary); cursor: pointer; font-family: var(--font-ui); font-size: var(--font-size-ui); text-align: left; }
.provider-header:hover { background: var(--bg-hover); }
.provider-id { font-family: var(--font-mono); font-size: 10px; color: var(--text-muted); margin-left: auto; }
.provider-body { padding: var(--space-8); background: var(--bg-editor); }
.config-tabs { display: flex; gap: 2px; margin-bottom: var(--space-8); }
.tab-header { padding: 4px var(--space-8); background: var(--bg-element); border: none; border-radius: var(--radius-xs) var(--radius-xs) 0 0; color: var(--text-muted); cursor: pointer; font-size: var(--font-size-small); }
.tab-header.active { background: var(--bg-editor); color: var(--text-primary); border-bottom: 1px solid var(--text-accent); }
.tab-content { display: flex; flex-direction: column; gap: var(--space-8); padding-top: var(--space-6); }
.form-row { display: flex; flex-direction: column; gap: var(--space-6); }
.form-label { font-size: 11px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-muted); }
.form-input { width: 100%; padding: 4px var(--space-8); height: 28px; background: var(--bg-element); border: 1px solid var(--border-variant); border-radius: var(--radius-xs); color: var(--text-primary); font-family: var(--font-ui); font-size: var(--font-size-ui); outline: none; }
.form-input:focus { background: var(--bg-editor); box-shadow: 0 0 0 1px var(--border-focused); }
.toggle-switch { width: 32px; height: 16px; border-radius: 8px; border: none; background: var(--bg-element); cursor: pointer; position: relative; padding: 0; transition: background var(--duration-fast) ease; }
.toggle-switch.on { background: var(--text-accent); }
.toggle-knob { position: absolute; top: 2px; left: 2px; width: 12px; height: 12px; border-radius: 50%; background: var(--text-primary); transition: transform var(--duration-fast) ease; }
.toggle-switch.on .toggle-knob { transform: translateX(16px); }
.empty-hint { color: var(--text-placeholder); font-size: var(--font-size-ui); }
</style>
