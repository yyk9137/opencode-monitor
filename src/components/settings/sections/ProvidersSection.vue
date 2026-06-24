<script setup lang="ts">
import { computed, ref } from 'vue'
import { ChevronDown, ChevronRight, Plus, Trash2, Eye, EyeOff } from 'lucide-vue-next'
import { useConfigStore } from '@/stores/config'
import TagInput from '../TagInput.vue'
import JsonEditor from '../JsonEditor.vue'

const configStore = useConfigStore()
const expanded = ref<string | null>(null)
const showAddForm = ref(false)
const newId = ref('')
const showApiKey = ref<Set<string>>(new Set())

const providers = computed(() => {
  return Object.entries(configStore.draft?.provider ?? {}).map(([id, config]) => ({ id, config }))
})

function toggleExpand(id: string) {
  expanded.value = expanded.value === id ? null : id
}

function updateProvider(id: string, field: string, value: unknown) {
  if (!configStore.draft?.provider?.[id]) return
  ;(configStore.draft.provider[id] as Record<string, unknown>)[field] = value
  configStore.dirtyPaths.add(`provider.${id}.${field}`)
}

function updateOptions(id: string, key: string, value: unknown) {
  const opts = { ...(configStore.draft?.provider?.[id].options ?? {}) }
  if (value === '' || value === undefined || value === null) {
    delete (opts as Record<string, unknown>)[key]
  } else {
    ;(opts as Record<string, unknown>)[key] = value
  }
  updateProvider(id, 'options', opts)
}

function toggleApiKeyVisibility(id: string) {
  if (showApiKey.value.has(id)) showApiKey.value.delete(id)
  else showApiKey.value.add(id)
}

function addProvider() {
  const id = newId.value.trim()
  if (!id || !configStore.draft) return
  if (!configStore.draft.provider) configStore.draft.provider = {}
  if (configStore.draft.provider[id]) return // already exists
  configStore.draft.provider[id] = { options: {} }
  configStore.dirtyPaths.add(`provider.${id}`)
  newId.value = ''
  showAddForm.value = false
  expanded.value = id
}

function softDeleteProvider(id: string) {
  // Deep-merge can't delete map keys — remove from draft locally but note limitation
  if (!configStore.draft?.provider) return
  // Can't truly delete via PATCH; best we can do is set to empty
  configStore.draft.provider[id] = {}
  configStore.dirtyPaths.add(`provider.${id}`)
}
</script>

<template>
  <div class="section-content">
    <h2 class="section-title">Providers</h2>

    <div v-for="{ id, config } in providers" :key="id" class="provider-card">
      <button class="provider-header" @click="toggleExpand(id)">
        <component :is="expanded === id ? ChevronDown : ChevronRight" :size="12" />
        <span class="provider-name">{{ config.name || id }}</span>
        <span class="provider-id">{{ id }}</span>
      </button>

      <div v-if="expanded === id" class="provider-body">
        <!-- API Key (password field, no plaintext by default) -->
        <div class="form-row">
          <label class="form-label">API Key (env var name)</label>
          <div class="secret-field">
            <input
              :type="showApiKey.has(id) ? 'text' : 'password'"
              :value="config.options?.apiKey ?? ''"
              class="form-input"
              placeholder="Env var name (e.g. ANTHROPIC_API_KEY)"
              @input="updateOptions(id, 'apiKey', ($event.target as HTMLInputElement).value || undefined)"
            />
            <button class="secret-toggle" @click="toggleApiKeyVisibility(id)">
              <EyeOff v-if="showApiKey.has(id)" :size="12" />
              <Eye v-else :size="12" />
            </button>
          </div>
        </div>

        <!-- Base URL -->
        <div class="form-row">
          <label class="form-label">Base URL</label>
          <input
            :value="config.options?.baseURL ?? ''"
            type="text"
            class="form-input"
            placeholder="https://api.example.com"
            @input="updateOptions(id, 'baseURL', ($event.target as HTMLInputElement).value || undefined)"
          />
        </div>

        <!-- Timeout -->
        <div class="form-row">
          <label class="form-label">Timeout (ms)</label>
          <div class="number-false-row">
            <input
              :value="typeof config.options?.timeout === 'number' ? config.options.timeout : ''"
              type="number"
              min="1"
              class="form-input"
              :disabled="config.options?.timeout === false"
              placeholder="5000"
              @input="updateOptions(id, 'timeout', Number(($event.target as HTMLInputElement).value) || undefined)"
            />
            <label class="checkbox-label">
              <input
                type="checkbox"
                :checked="config.options?.timeout === false"
                @change="updateOptions(id, 'timeout', ($event.target as HTMLInputElement).checked ? false : undefined)"
              />
              <span>Disable timeout</span>
            </label>
          </div>
        </div>

        <!-- API -->
        <div class="form-row">
          <label class="form-label">API (custom endpoint)</label>
          <input
            :value="config.api ?? ''"
            type="text"
            class="form-input"
            placeholder="@anthropic-ai/sdk"
            @input="updateProvider(id, 'api', ($event.target as HTMLInputElement).value || undefined)"
          />
        </div>

        <!-- Env vars -->
        <div class="form-row">
          <label class="form-label">Env Vars</label>
          <TagInput
            :model-value="config.env ?? []"
            @update:model-value="updateProvider(id, 'env', $event)"
            @dirty="configStore.dirtyPaths.add(`provider.${id}.env`)"
          />
        </div>

        <!-- NPM package -->
        <div class="form-row">
          <label class="form-label">NPM Package</label>
          <input
            :value="config.npm ?? ''"
            type="text"
            class="form-input"
            placeholder="@anthropic-ai/sdk"
            @input="updateProvider(id, 'npm', ($event.target as HTMLInputElement).value || undefined)"
          />
        </div>

        <!-- Name -->
        <div class="form-row">
          <label class="form-label">Display Name</label>
          <input
            :value="config.name ?? ''"
            type="text"
            class="form-input"
            @input="updateProvider(id, 'name', ($event.target as HTMLInputElement).value || undefined)"
          />
        </div>

        <!-- Whitelist / Blacklist -->
        <div class="form-row">
          <label class="form-label">Model Whitelist</label>
          <TagInput
            :model-value="config.whitelist ?? []"
            @update:model-value="updateProvider(id, 'whitelist', $event)"
            @dirty="configStore.dirtyPaths.add(`provider.${id}.whitelist`)"
          />
        </div>
        <div class="form-row">
          <label class="form-label">Model Blacklist</label>
          <TagInput
            :model-value="config.blacklist ?? []"
            @update:model-value="updateProvider(id, 'blacklist', $event)"
            @dirty="configStore.dirtyPaths.add(`provider.${id}.blacklist`)"
          />
        </div>

        <!-- Models (raw JSON) -->
        <div class="form-row">
          <label class="form-label">Models (raw JSON)</label>
          <JsonEditor
            :model-value="config.models"
            @update:model-value="updateProvider(id, 'models', $event)"
            @dirty="configStore.dirtyPaths.add(`provider.${id}.models`)"
          />
        </div>

        <!-- Actions -->
        <div class="card-actions">
          <button class="btn-delete" @click="softDeleteProvider(id)">
            <Trash2 :size="11" /> Clear config
          </button>
        </div>
      </div>
    </div>

    <div v-if="showAddForm" class="add-form">
      <input v-model="newId" class="form-input" placeholder="provider id (e.g. anthropic)" @keydown.enter="addProvider" />
      <button class="btn-add" @click="addProvider">Add</button>
      <button class="btn-cancel" @click="showAddForm = false">Cancel</button>
    </div>
    <button v-else class="btn-add-card" @click="showAddForm = true">
      <Plus :size="12" /> Add Provider
    </button>

    <p class="field-hint">
      Only providers configured in your opencode config.json are shown here.
      API keys are stored as environment variable names in config — actual key values go in
      <code>~/.config/opencode/auth.json</code> (via <code>PUT /auth/:id</code> or TUI <code>/connect</code>).
    </p>
  </div>
</template>

<style scoped>
.section-content { padding: var(--space-12) var(--space-16); display: flex; flex-direction: column; gap: var(--space-12); }
.section-title { font-size: var(--font-size-ui); font-weight: 600; color: var(--text-primary); text-transform: uppercase; letter-spacing: 0.06em; margin: 0; }
.provider-card { border: 1px solid var(--border-variant); border-radius: var(--radius-xs); overflow: hidden; }
.provider-header { display: flex; align-items: center; gap: var(--space-6); width: 100%; padding: var(--space-6) var(--space-8); background: var(--bg-app); border: none; color: var(--text-primary); cursor: pointer; font-family: var(--font-ui); font-size: var(--font-size-ui); text-align: left; }
.provider-header:hover { background: var(--bg-hover); }
.provider-name { flex: 1; }
.provider-id { font-family: var(--font-mono); font-size: 10px; color: var(--text-muted); }
.provider-body { padding: var(--space-8); background: var(--bg-editor); display: flex; flex-direction: column; gap: var(--space-8); }
.form-row { display: flex; flex-direction: column; gap: var(--space-6); }
.form-label { font-size: 11px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-muted); }
.form-input { width: 100%; padding: 4px var(--space-8); height: 28px; background: var(--bg-element); border: 1px solid var(--border-variant); border-radius: var(--radius-xs); color: var(--text-primary); font-family: var(--font-ui); font-size: var(--font-size-ui); outline: none; }
.form-input:focus { background: var(--bg-editor); box-shadow: 0 0 0 1px var(--border-focused); }
.form-input:disabled { opacity: 0.4; }
.secret-field { display: flex; gap: var(--space-4); }
.secret-field .form-input { flex: 1; }
.secret-toggle { display: flex; align-items: center; justify-content: center; width: 28px; height: 28px; border: 1px solid var(--border-variant); border-radius: var(--radius-xs); background: var(--bg-element); color: var(--text-muted); cursor: pointer; }
.secret-toggle:hover { color: var(--text-primary); }
.number-false-row { display: flex; align-items: center; gap: var(--space-8); }
.number-false-row .form-input { flex: 1; }
.checkbox-label { display: flex; align-items: center; gap: 4px; font-size: var(--font-size-small); color: var(--text-muted); cursor: pointer; white-space: nowrap; }
.card-actions { display: flex; justify-content: flex-end; }
.btn-delete { display: inline-flex; align-items: center; gap: 4px; padding: 4px var(--space-8); background: transparent; border: 1px solid var(--error); border-radius: var(--radius-xs); color: var(--error); cursor: pointer; font-size: var(--font-size-small); }
.btn-delete:hover { background: rgba(217,87,87,0.1); }
.add-form { display: flex; gap: var(--space-6); align-items: center; }
.btn-add, .btn-cancel { padding: 4px var(--space-8); border-radius: var(--radius-xs); cursor: pointer; font-size: var(--font-size-ui); border: none; }
.btn-add { background: var(--text-accent); color: var(--bg-editor); }
.btn-cancel { background: transparent; color: var(--text-muted); }
.btn-add-card { display: inline-flex; align-items: center; gap: 4px; padding: var(--space-6) var(--space-8); background: transparent; border: 1px dashed var(--border-variant); border-radius: var(--radius-xs); color: var(--text-muted); cursor: pointer; font-size: var(--font-size-ui); }
.btn-add-card:hover { color: var(--text-primary); border-color: var(--text-accent); }
.field-hint { font-size: var(--font-size-small); color: var(--text-placeholder); }
.field-hint code { font-family: var(--font-mono); font-size: 10px; background: var(--bg-element); padding: 1px 4px; border-radius: var(--radius-xs); }
</style>
