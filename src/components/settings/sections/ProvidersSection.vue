<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'
import { fetch } from '@tauri-apps/plugin-http'
import { ChevronDown, ChevronRight, Plus, Trash2, RefreshCw, Loader2 } from 'lucide-vue-next'
import { useConfigStore } from '@/stores/config'
import TagInput from '../TagInput.vue'

const configStore = useConfigStore()
const expanded = ref<string | null>(null)
const showAddForm = ref(false)
const newId = ref('')

// apiKey is write-only: we track locally entered values, don't repopulate from saved config
const apiKeyInputs = ref<Record<string, string>>({})

// Model expansion per provider
const expandedModel = ref<string | null>(null) // key: `${providerId}/${modelId}`

// ── Fetch models from /provider ────────────────────────────────────────────
interface RemoteModel { id: string; name?: string }
interface RemoteProvider { id: string; name?: string; models?: RemoteModel[] }

const remoteProviders = ref<RemoteProvider[]>([])
const loadingModels = ref(false)
const modelFetchError = ref('')

async function fetchRemoteModels() {
  if (!configStore.targetUrl) return
  loadingModels.value = true
  modelFetchError.value = ''
  try {
    const resp = await fetch(`${configStore.targetUrl}/provider`)
    if (!resp.ok) { modelFetchError.value = `GET /provider failed: ${resp.status}`; return }
    const data = await resp.json() as { all: RemoteProvider[] }
    remoteProviders.value = data.all || []
  } catch (e) {
    modelFetchError.value = String(e)
  } finally {
    loadingModels.value = false
  }
}

onMounted(fetchRemoteModels)

// ── Config providers ────────────────────────────────────────────────────────
const providers = computed(() => {
  return Object.entries(configStore.draft?.provider ?? {}).map(([id, config]) => ({ id, config }))
})

function toggleExpand(id: string) {
  expanded.value = expanded.value === id ? null : id
  if (expanded.value === id && !apiKeyInputs.value[id]) {
    apiKeyInputs.value[id] = '' // init empty for write-only field
  }
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

// apiKey: only write, never read back
function onApiKeyInput(id: string, value: string) {
  apiKeyInputs.value[id] = value
  if (value) {
    updateOptions(id, 'apiKey', value)
  } else {
    // empty = don't change (keep existing), remove from draft
    updateOptions(id, 'apiKey', undefined)
  }
}

function addProvider() {
  const id = newId.value.trim()
  if (!id || !configStore.draft) return
  if (!configStore.draft.provider) configStore.draft.provider = {}
  if (configStore.draft.provider[id]) return
  configStore.draft.provider[id] = { options: {} }
  configStore.dirtyPaths.add(`provider.${id}`)
  newId.value = ''
  showAddForm.value = false
  expanded.value = id
}

function softDeleteProvider(id: string) {
  if (!configStore.draft?.provider) return
  configStore.draft.provider[id] = {}
  configStore.dirtyPaths.add(`provider.${id}`)
}

// ── Model management ───────────────────────────────────────────────────────
const providerModels = computed(() => {
  return (id: string) => Object.entries(configStore.draft?.provider?.[id]?.models ?? {}).map(([modelId, model]) => ({ modelId, model }))
})

function toggleModelExpand(key: string) {
  expandedModel.value = expandedModel.value === key ? null : key
}

function updateModelField(providerId: string, modelId: string, field: string, value: unknown) {
  if (!configStore.draft?.provider?.[providerId]?.models) return
  const models = configStore.draft.provider[providerId].models!
  if (!models[modelId]) return
  ;(models[modelId] as Record<string, unknown>)[field] = value
  configStore.dirtyPaths.add(`provider.${providerId}.models.${modelId}.${field}`)
}

function addModel(providerId: string, modelId: string) {
  if (!configStore.draft?.provider?.[providerId]) return
  if (!configStore.draft.provider[providerId].models) {
    configStore.draft.provider[providerId].models = {}
  }
  if (configStore.draft.provider[providerId].models![modelId]) return
  configStore.draft.provider[providerId].models![modelId] = {
    id: modelId,
    name: modelId,
    attachment: false,
    reasoning: false,
    tool_call: true,
  }
  configStore.dirtyPaths.add(`provider.${providerId}.models.${modelId}`)
  expandedModel.value = `${providerId}/${modelId}`
}

function removeModel(providerId: string, modelId: string) {
  if (!configStore.draft?.provider?.[providerId]?.models) return
  // Can't delete via deep-merge, set to empty
  configStore.draft.provider[providerId].models![modelId] = {}
  configStore.dirtyPaths.add(`provider.${providerId}.models.${modelId}`)
}

// Import models from /provider for a specific provider
function importModels(providerId: string) {
  const remote = remoteProviders.value.find(p => p.id === providerId)
  if (!remote?.models) return
  if (!configStore.draft?.provider?.[providerId]) return
  if (!configStore.draft.provider[providerId].models) {
    configStore.draft.provider[providerId].models = {}
  }
  for (const m of remote.models) {
    if (!configStore.draft.provider[providerId].models![m.id]) {
      configStore.draft.provider[providerId].models![m.id] = {
        id: m.id,
        name: m.name || m.id,
      }
    }
  }
  configStore.dirtyPaths.add(`provider.${providerId}.models`)
}

const showAddModel = ref<Record<string, boolean>>({})
const newModelId = ref<Record<string, string>>({})
</script>

<template>
  <div class="section-content">
    <h2 class="section-title">Providers</h2>

    <!-- Refresh remote models button -->
    <div class="toolbar">
      <button class="btn-refresh" @click="fetchRemoteModels" :disabled="loadingModels">
        <Loader2 v-if="loadingModels" :size="11" class="animate-spin" />
        <RefreshCw v-else :size="11" />
        Fetch models from server
      </button>
      <span v-if="modelFetchError" class="error-text">{{ modelFetchError }}</span>
    </div>

    <div v-for="{ id, config } in providers" :key="id" class="provider-card">
      <button class="provider-header" @click="toggleExpand(id)">
        <component :is="expanded === id ? ChevronDown : ChevronRight" :size="12" />
        <span class="provider-name">{{ config.name || id }}</span>
        <span class="provider-id">{{ id }}</span>
      </button>

      <div v-if="expanded === id" class="provider-body">
        <!-- API Key — write-only, never repopulated -->
        <div class="form-row">
          <label class="form-label">API Key</label>
          <input
            type="password"
            :value="apiKeyInputs[id] ?? ''"
            class="form-input"
            placeholder="Enter key to update (saved value hidden for security)"
            @input="onApiKeyInput(id, ($event.target as HTMLInputElement).value)"
          />
          <span class="field-hint">Key is passed via environment variable. Saved value is not shown.</span>
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

        <!-- API package -->
        <div class="form-row">
          <label class="form-label">API Package</label>
          <input
            :value="config.api ?? ''"
            type="text"
            class="form-input"
            placeholder="@anthropic-ai/sdk"
            @input="updateProvider(id, 'api', ($event.target as HTMLInputElement).value || undefined)"
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

        <!-- Display Name -->
        <div class="form-row">
          <label class="form-label">Display Name</label>
          <input
            :value="config.name ?? ''"
            type="text"
            class="form-input"
            @input="updateProvider(id, 'name', ($event.target as HTMLInputElement).value || undefined)"
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
              <span>Disable</span>
            </label>
          </div>
        </div>

        <!-- Models section -->
        <div class="models-section">
          <div class="models-header">
            <label class="form-label">Models</label>
            <button class="btn-import" @click="importModels(id)" title="Import models from server">
              <RefreshCw :size="10" /> Import from server
            </button>
          </div>

          <div v-for="{ modelId, model } in providerModels(id)" :key="modelId" class="model-card">
            <button class="model-header" @click="toggleModelExpand(`${id}/${modelId}`)">
              <component :is="expandedModel === `${id}/${modelId}` ? ChevronDown : ChevronRight" :size="10" />
              <span class="model-name">{{ model.name || modelId }}</span>
              <span class="model-id">{{ modelId }}</span>
              <span v-if="model.attachment" class="model-badge">multimodal</span>
              <span v-if="model.reasoning" class="model-badge reasoning">reasoning</span>
            </button>

            <div v-if="expandedModel === `${id}/${modelId}`" class="model-body">
              <div class="form-row">
                <label class="form-label">Name</label>
                <input :value="model.name ?? ''" type="text" class="form-input" @input="updateModelField(id, modelId, 'name', ($event.target as HTMLInputElement).value || undefined)" />
              </div>
              <div class="form-row">
                <label class="form-label">ID</label>
                <input :value="model.id ?? ''" type="text" class="form-input" @input="updateModelField(id, modelId, 'id', ($event.target as HTMLInputElement).value || undefined)" />
              </div>
              <div class="form-row-inline">
                <label class="checkbox-label">
                  <input type="checkbox" :checked="model.attachment ?? false" @change="updateModelField(id, modelId, 'attachment', ($event.target as HTMLInputElement).checked)" />
                  <span>Multimodal (image/video/audio)</span>
                </label>
                <label class="checkbox-label">
                  <input type="checkbox" :checked="model.reasoning ?? false" @change="updateModelField(id, modelId, 'reasoning', ($event.target as HTMLInputElement).checked)" />
                  <span>Reasoning model</span>
                </label>
                <label class="checkbox-label">
                  <input type="checkbox" :checked="model.tool_call ?? false" @change="updateModelField(id, modelId, 'tool_call', ($event.target as HTMLInputElement).checked)" />
                  <span>Tool calling</span>
                </label>
              </div>
              <div class="form-row">
                <label class="form-label">Max Context (tokens)</label>
                <input :value="model.limit?.context ?? ''" type="number" min="1" class="form-input" placeholder="e.g. 200000" @input="updateModelField(id, modelId, 'limit', { ...model.limit, context: Number(($event.target as HTMLInputElement).value) || undefined })" />
              </div>
              <div class="form-row">
                <label class="form-label">Max Output (tokens)</label>
                <input :value="model.limit?.output ?? ''" type="number" min="1" class="form-input" placeholder="e.g. 8192" @input="updateModelField(id, modelId, 'limit', { ...model.limit, output: Number(($event.target as HTMLInputElement).value) || undefined })" />
              </div>
              <div class="form-row">
                <label class="form-label">Family</label>
                <input :value="model.family ?? ''" type="text" class="form-input" placeholder="e.g. claude" @input="updateModelField(id, modelId, 'family', ($event.target as HTMLInputElement).value || undefined)" />
              </div>
              <div class="form-row">
                <label class="form-label">Status</label>
                <select :value="model.status ?? ''" class="form-input" @change="updateModelField(id, modelId, 'status', ($event.target as HTMLSelectElement).value || undefined)">
                  <option value="">(not set)</option>
                  <option value="active">active</option>
                  <option value="beta">beta</option>
                  <option value="alpha">alpha</option>
                  <option value="deprecated">deprecated</option>
                </select>
              </div>
              <div class="model-actions">
                <button class="btn-delete" @click="removeModel(id, modelId)">
                  <Trash2 :size="10" /> Remove model
                </button>
              </div>
            </div>
          </div>

          <!-- Add model -->
          <div v-if="showAddModel[id]" class="add-model-form">
            <input v-model="newModelId[id]" class="form-input" placeholder="model id (e.g. claude-sonnet-4-5)" @keydown.enter="addModel(id, newModelId[id] || ''); newModelId[id] = ''; showAddModel[id] = false" />
            <button class="btn-add-sm" @click="addModel(id, newModelId[id] || ''); newModelId[id] = ''; showAddModel[id] = false">Add</button>
            <button class="btn-cancel-sm" @click="showAddModel[id] = false">Cancel</button>
          </div>
          <button v-else class="btn-add-model" @click="showAddModel[id] = true; newModelId[id] = ''">
            <Plus :size="10" /> Add Model
          </button>
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
  </div>
</template>

<style scoped>
.section-content { padding: var(--space-12) var(--space-16); display: flex; flex-direction: column; gap: var(--space-12); }
.section-title { font-size: var(--font-size-ui); font-weight: 600; color: var(--text-primary); text-transform: uppercase; letter-spacing: 0.06em; margin: 0; }
.toolbar { display: flex; align-items: center; gap: var(--space-8); }
.btn-refresh { display: inline-flex; align-items: center; gap: 4px; padding: 4px var(--space-8); background: transparent; border: 1px solid var(--border-variant); border-radius: var(--radius-xs); color: var(--text-muted); cursor: pointer; font-size: var(--font-size-small); }
.btn-refresh:hover { color: var(--text-primary); background: var(--bg-hover); }
.error-text { font-size: var(--font-size-small); color: var(--error); }
.provider-card { border: 1px solid var(--border-variant); border-radius: var(--radius-xs); overflow: hidden; }
.provider-header { display: flex; align-items: center; gap: var(--space-6); width: 100%; padding: var(--space-6) var(--space-8); background: var(--bg-app); border: none; color: var(--text-primary); cursor: pointer; font-family: var(--font-ui); font-size: var(--font-size-ui); text-align: left; }
.provider-header:hover { background: var(--bg-hover); }
.provider-name { flex: 1; }
.provider-id { font-family: var(--font-mono); font-size: 10px; color: var(--text-muted); }
.provider-body { padding: var(--space-8); background: var(--bg-editor); display: flex; flex-direction: column; gap: var(--space-8); }
.form-row { display: flex; flex-direction: column; gap: var(--space-6); }
.form-row-inline { display: flex; gap: var(--space-12); flex-wrap: wrap; }
.form-label { font-size: 11px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-muted); }
.form-input { width: 100%; padding: 4px var(--space-8); height: 28px; background: var(--bg-element); border: 1px solid var(--border-variant); border-radius: var(--radius-xs); color: var(--text-primary); font-family: var(--font-ui); font-size: var(--font-size-ui); outline: none; }
.form-input:focus { background: var(--bg-editor); box-shadow: 0 0 0 1px var(--border-focused); }
.form-input:disabled { opacity: 0.4; }
.field-hint { font-size: var(--font-size-small); color: var(--text-placeholder); }
.number-false-row { display: flex; align-items: center; gap: var(--space-8); }
.number-false-row .form-input { flex: 1; }
.checkbox-label { display: flex; align-items: center; gap: 4px; font-size: var(--font-size-small); color: var(--text-muted); cursor: pointer; white-space: nowrap; }
.models-section { display: flex; flex-direction: column; gap: var(--space-6); padding-top: var(--space-8); border-top: 1px solid var(--border-variant); }
.models-header { display: flex; align-items: center; justify-content: space-between; }
.btn-import { display: inline-flex; align-items: center; gap: 4px; padding: 2px var(--space-6); background: transparent; border: 1px solid var(--border-variant); border-radius: var(--radius-xs); color: var(--text-accent); cursor: pointer; font-size: var(--font-size-small); }
.btn-import:hover { background: var(--bg-hover); }
.model-card { border: 1px solid var(--border-variant); border-radius: var(--radius-xs); overflow: hidden; }
.model-header { display: flex; align-items: center; gap: var(--space-6); width: 100%; padding: var(--space-4) var(--space-6); background: var(--bg-app); border: none; color: var(--text-primary); cursor: pointer; font-family: var(--font-ui); font-size: var(--font-size-small); text-align: left; }
.model-header:hover { background: var(--bg-hover); }
.model-name { flex: 1; }
.model-id { font-family: var(--font-mono); font-size: 9px; color: var(--text-muted); }
.model-badge { font-family: var(--font-mono); font-size: 8px; padding: 1px 4px; border-radius: var(--radius-xs); background: var(--bg-element); color: var(--text-accent); }
.model-badge.reasoning { color: var(--warning); }
.model-body { padding: var(--space-8); background: var(--bg-editor); display: flex; flex-direction: column; gap: var(--space-8); }
.model-actions { display: flex; justify-content: flex-end; }
.add-model-form { display: flex; gap: var(--space-6); align-items: center; }
.add-model-form .form-input { flex: 1; }
.btn-add-sm { padding: 2px var(--space-6); background: var(--text-accent); color: var(--bg-editor); border: none; border-radius: var(--radius-xs); cursor: pointer; font-size: var(--font-size-small); }
.btn-cancel-sm { padding: 2px var(--space-6); background: transparent; color: var(--text-muted); border: none; border-radius: var(--radius-xs); cursor: pointer; font-size: var(--font-size-small); }
.btn-add-model { display: inline-flex; align-items: center; gap: 4px; padding: 2px var(--space-6); background: transparent; border: 1px dashed var(--border-variant); border-radius: var(--radius-xs); color: var(--text-muted); cursor: pointer; font-size: var(--font-size-small); align-self: flex-start; }
.btn-add-model:hover { color: var(--text-accent); border-color: var(--text-accent); }
.card-actions { display: flex; justify-content: flex-end; }
.btn-delete { display: inline-flex; align-items: center; gap: 4px; padding: 4px var(--space-8); background: transparent; border: 1px solid var(--error); border-radius: var(--radius-xs); color: var(--error); cursor: pointer; font-size: var(--font-size-small); }
.btn-delete:hover { background: rgba(217,87,87,0.1); }
.add-form { display: flex; gap: var(--space-6); align-items: center; }
.btn-add, .btn-cancel { padding: 4px var(--space-8); border-radius: var(--radius-xs); cursor: pointer; font-size: var(--font-size-ui); border: none; }
.btn-add { background: var(--text-accent); color: var(--bg-editor); }
.btn-cancel { background: transparent; color: var(--text-muted); }
.btn-add-card { display: inline-flex; align-items: center; gap: 4px; padding: var(--space-6) var(--space-8); background: transparent; border: 1px dashed var(--border-variant); border-radius: var(--radius-xs); color: var(--text-muted); cursor: pointer; font-size: var(--font-size-ui); }
.btn-add-card:hover { color: var(--text-primary); border-color: var(--text-accent); }
.animate-spin { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
</style>
