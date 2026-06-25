<script setup lang="ts">
import { computed, ref } from 'vue'
import { ChevronDown, ChevronRight, Plus, Trash2, RefreshCw, Loader2 } from 'lucide-vue-next'
import { useConfigStore } from '@/stores/config'

const configStore = useConfigStore()
const expanded = ref<string | null>(null)
const showAddForm = ref(false)

// ── Known providers list (from OpenCode schema / OpenChamber pattern) ─────
const KNOWN_PROVIDERS = [
  { id: 'anthropic', name: 'Anthropic', api: 'anthropic' },
  { id: 'openai', name: 'OpenAI', api: 'openai-compatible' },
  { id: 'google', name: 'Google (Gemini)', api: 'google' },
  { id: 'azure', name: 'Azure OpenAI', api: 'openai-compatible' },
  { id: 'openrouter', name: 'OpenRouter', api: 'openai-compatible' },
  { id: 'groq', name: 'Groq', api: 'openai-compatible' },
  { id: 'together', name: 'Together AI', api: 'openai-compatible' },
  { id: 'fireworks', name: 'Fireworks AI', api: 'openai-compatible' },
  { id: 'deepseek', name: 'DeepSeek', api: 'openai-compatible' },
  { id: 'mistral', name: 'Mistral', api: 'openai-compatible' },
  { id: 'cohere', name: 'Cohere', api: 'openai-compatible' },
  { id: 'xai', name: 'xAI (Grok)', api: 'openai-compatible' },
  { id: 'github-copilot', name: 'GitHub Copilot', api: 'openai-compatible' },
  { id: 'custom', name: 'Custom (OpenAI Compatible)', api: 'openai-compatible' },
]

const selectedKnownProvider = ref('')
const customId = ref('')

// ── Model import types (unused now, kept for reference) ──────────────────
// interface RemoteModel { id: string; name?: string }
// interface RemoteProvider { id: string; name?: string; models?: RemoteModel[] }

// ── Config providers ────────────────────────────────────────────────────────
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

// apiKey: write-only, never repopulate from saved config
// Key behavior: empty input = keep existing (don't delete), non-empty = update
const apiKeyInputs = ref<Record<string, string>>({})
function onApiKeyInput(id: string, value: string) {
  apiKeyInputs.value[id] = value
  if (value) {
    // User entered a new key → write it to draft
    updateOptions(id, 'apiKey', value)
  }
  // If empty → don't touch draft's apiKey (preserve existing value from original)
  // This prevents accidental deletion of saved keys when editing other fields
}

/** Check if the existing apiKey for a provider uses {env:VAR_NAME} format */
function isEnvRef(id: string): boolean {
  const existing = configStore.draft?.provider?.[id]?.options?.apiKey
  return typeof existing === 'string' && existing.startsWith('{env:')
}

/** Get a display-friendly placeholder for the apiKey field */
function getApiKeyPlaceholder(id: string): string {
  const existing = configStore.draft?.provider?.[id]?.options?.apiKey
  if (typeof existing === 'string' && existing.startsWith('{env:')) {
    return existing.slice(5, -1) // e.g. {env:MIMO_API_KEY} → MIMO_API_KEY
  }
  return 'Enter key to update (saved value hidden)'
}

// ── Add provider flow ────────────────────────────────────────────────────
function startAddProvider() {
  showAddForm.value = true
  selectedKnownProvider.value = ''
  customId.value = ''
}

function confirmAddProvider() {
  let id = ''
  let name = ''
  let api = ''

  if (selectedKnownProvider.value === 'custom') {
    id = customId.value.trim()
    if (!id) return
    name = id
    api = '@ai-sdk/openai-compatible'
  } else if (selectedKnownProvider.value) {
    const known = KNOWN_PROVIDERS.find(p => p.id === selectedKnownProvider.value)
    if (!known) return
    id = known.id
    name = known.name
    // Map simple names to full SDK package names
    if (known.api === 'anthropic') api = '@ai-sdk/anthropic'
    else if (known.api === 'google') api = '@ai-sdk/google'
    else api = '@ai-sdk/openai-compatible'
  } else {
    return
  }

  if (!configStore.draft) return
  if (!configStore.draft.provider) configStore.draft.provider = {}
  if (configStore.draft.provider[id]) { expanded.value = id; showAddForm.value = false; return }

  const defaultApiKey = `{env:${id.toUpperCase().replace(/-/g, '_')}_API_KEY}`
  configStore.draft.provider[id] = { name, api, options: { apiKey: defaultApiKey } }
  configStore.dirtyPaths.add('provider.' + id)
  showAddForm.value = false
  expanded.value = id
}

function softDeleteProvider(id: string) {
  if (!configStore.draft?.provider) return
  // Delete from draft (UI removes the card immediately)
  delete configStore.draft.provider[id]
  configStore.dirtyPaths.add('provider.' + id)
  if (expanded.value === id) expanded.value = null
  // Note: server-side mergeDeep may restore the key from existing config.
  // True deletion may require manual edit of config.json.
}

// ── Model management (inside provider edit form) ─────────────────────────
const expandedModel = ref<string | null>(null)

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
    limit: { context: 128000, output: 8192 },
  }
  configStore.dirtyPaths.add(`provider.${providerId}.models.${modelId}`)
  expandedModel.value = `${providerId}/${modelId}`
}

function removeModel(providerId: string, modelId: string) {
  if (!configStore.draft?.provider?.[providerId]?.models) return
  configStore.draft.provider[providerId].models![modelId] = {}
  configStore.dirtyPaths.add(`provider.${providerId}.models.${modelId}`)
}

// ── Import models from upstream provider (direct API call) ──────────────
const importLoading = ref<Set<string>>(new Set())
const importMessages = ref<Record<string, string>>({})
const importErrors = ref<Record<string, string>>({})

async function importModelsFromServer(providerId: string) {
  if (!configStore.draft?.provider?.[providerId]) return

  const config = configStore.draft.provider[providerId]
  const baseURL = config.options?.baseURL as string | undefined
  const apiKey = apiKeyInputs.value[providerId] || (config.options?.apiKey as string | undefined)

  if (!baseURL) {
    importErrors.value[providerId] = 'Base URL is required to fetch models.'
    return
  }
  if (!apiKey) {
    importErrors.value[providerId] = 'API Key is required to fetch models.'
    return
  }

  importLoading.value.add(providerId)
  importErrors.value[providerId] = ''
  importMessages.value[providerId] = ''

  try {
    // OpenAI-compatible /v1/models endpoint
    // Use window.fetch (not Tauri's fetch) to avoid scope/permission issues with external URLs
    const url = baseURL.replace(/\/$/, '') + '/models'
    const resp = await window.fetch(url, {
      headers: { 'Authorization': 'Bearer ' + apiKey },
    })

    if (!resp.ok) {
      importErrors.value[providerId] = 'GET ' + url + ' failed: ' + resp.status
      return
    }

    const data = await resp.json() as { data?: Array<{ id: string; object?: string }> }
    const models = data.data || []

    if (models.length === 0) {
      importErrors.value[providerId] = 'No models returned from provider.'
      return
    }

    if (!configStore.draft.provider[providerId].models) {
      configStore.draft.provider[providerId].models = {}
    }
    let added = 0
    for (const m of models) {
      if (!configStore.draft.provider[providerId].models![m.id]) {
        configStore.draft.provider[providerId].models![m.id] = {
          id: m.id,
          name: m.id,
          limit: { context: 128000, output: 8192 },  // required by schema — default limits
        }
        added++
      }
    }
    configStore.dirtyPaths.add('provider.' + providerId + '.models')
    importMessages.value[providerId] = 'Fetched ' + added + ' model' + (added !== 1 ? 's' : '') + ' from upstream.'
  } catch (e) {
    importErrors.value[providerId] = String(e)
  } finally {
    importLoading.value.delete(providerId)
  }
}

const showAddModel = ref<Record<string, boolean>>({})
const newModelId = ref<Record<string, string>>({})
</script>

<template>
  <div class="section-content">
    <h2 class="section-title">Providers</h2>

    <!-- Existing providers -->
    <div v-for="{ id, config } in providers" :key="id" class="provider-card">
      <button class="provider-header" @click="toggleExpand(id)">
        <component :is="expanded === id ? ChevronDown : ChevronRight" :size="12" />
        <span class="provider-name">{{ config.name || id }}</span>
        <span class="provider-id">{{ id }}</span>
      </button>

      <div v-if="expanded === id" class="provider-body">
        <!-- API Key — write-only -->
        <div class="form-row">
          <label class="form-label">API Key</label>
          <div class="api-key-input-row">
            <input
              type="password"
              :value="apiKeyInputs[id] ?? ''"
              class="form-input"
              :placeholder="getApiKeyPlaceholder(id)"
              @input="onApiKeyInput(id, ($event.target as HTMLInputElement).value)"
            />
            <span v-if="isEnvRef(id)" class="env-badge">env</span>
          </div>
          <span class="form-helper">可输入明文密钥或 {env:VAR_NAME} 格式的环境变量引用</span>
        </div>

        <!-- Base URL -->
        <div class="form-row">
          <label class="form-label">Base URL</label>
          <input :value="config.options?.baseURL ?? ''" type="text" class="form-input" placeholder="https://api.example.com" @input="updateOptions(id, 'baseURL', ($event.target as HTMLInputElement).value || undefined)" />
        </div>

        <!-- Display Name -->
        <div class="form-row">
          <label class="form-label">Display Name</label>
          <input :value="config.name ?? ''" type="text" class="form-input" @input="updateProvider(id, 'name', ($event.target as HTMLInputElement).value || undefined)" />
        </div>

        <!-- API SDK package -->
        <div class="form-row">
          <label class="form-label">API SDK</label>
          <select :value="config.api ?? ''" class="form-input" @change="updateProvider(id, 'api', ($event.target as HTMLSelectElement).value || undefined)">
            <option value="">(not set)</option>
            <option value="@ai-sdk/openai-compatible">@ai-sdk/openai-compatible (OpenAI compatible)</option>
            <option value="@ai-sdk/anthropic">@ai-sdk/anthropic</option>
            <option value="@ai-sdk/google">@ai-sdk/google</option>
          </select>
        </div>

        <!-- Models section (inside provider edit) -->
        <div class="models-section">
          <div class="models-header">
            <label class="form-label">Models</label>
            <button class="btn-import" @click="importModelsFromServer(id)" :disabled="importLoading.has(id)">
              <Loader2 v-if="importLoading.has(id)" :size="10" class="animate-spin" />
              <RefreshCw v-else :size="10" />
              Fetch models
            </button>
          </div>

          <!-- Import feedback -->
          <div v-if="importMessages[id]" class="import-success">{{ importMessages[id] }}</div>
          <div v-if="importErrors[id]" class="import-error">{{ importErrors[id] }}</div>

          <div v-for="{ modelId, model } in providerModels(id)" :key="modelId" class="model-card">
            <button class="model-header" @click="toggleModelExpand(id + '/' + modelId)">
              <component :is="expandedModel === id + '/' + modelId ? ChevronDown : ChevronRight" :size="10" />
              <span class="model-name">{{ model.name || modelId }}</span>
              <span class="model-id">{{ modelId }}</span>
              <span v-if="model.attachment" class="model-badge">multimodal</span>
              <span v-if="model.reasoning" class="model-badge reasoning">reasoning</span>
            </button>

            <div v-if="expandedModel === id + '/' + modelId" class="model-body">
              <div class="form-row">
                <label class="form-label">Model ID</label>
                <input :value="model.id ?? ''" type="text" class="form-input" @input="updateModelField(id, modelId, 'id', ($event.target as HTMLInputElement).value || undefined)" />
              </div>
              <div class="form-row">
                <label class="form-label">Display Name</label>
                <input :value="model.name ?? ''" type="text" class="form-input" @input="updateModelField(id, modelId, 'name', ($event.target as HTMLInputElement).value || undefined)" />
              </div>
              <div class="form-row-inline">
                <label class="checkbox-label"><input type="checkbox" :checked="model.attachment ?? false" @change="updateModelField(id, modelId, 'attachment', ($event.target as HTMLInputElement).checked)" /><span>Multimodal</span></label>
                <label class="checkbox-label"><input type="checkbox" :checked="model.reasoning ?? false" @change="updateModelField(id, modelId, 'reasoning', ($event.target as HTMLInputElement).checked)" /><span>Reasoning</span></label>
                <label class="checkbox-label"><input type="checkbox" :checked="model.tool_call ?? false" @change="updateModelField(id, modelId, 'tool_call', ($event.target as HTMLInputElement).checked)" /><span>Tool calling</span></label>
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
              <div class="model-actions">
                <button class="btn-delete" @click="removeModel(id, modelId)"><Trash2 :size="10" /> Remove</button>
              </div>
            </div>
          </div>

          <div v-if="showAddModel[id]" class="add-model-form">
            <input v-model="newModelId[id]" class="form-input" placeholder="model id (e.g. claude-sonnet-4-5)" @keydown.enter="addModel(id, newModelId[id] || ''); newModelId[id] = ''; showAddModel[id] = false" />
            <button class="btn-add-sm" @click="addModel(id, newModelId[id] || ''); newModelId[id] = ''; showAddModel[id] = false">Add</button>
            <button class="btn-cancel-sm" @click="showAddModel[id] = false">Cancel</button>
          </div>
          <button v-else class="btn-add-model" @click="showAddModel[id] = true; newModelId[id] = ''"><Plus :size="10" /> Add Model</button>
        </div>

        <!-- Actions -->
        <div class="card-actions">
          <button class="btn-delete" @click="softDeleteProvider(id)"><Trash2 :size="11" /> Delete</button>
        </div>
      </div>
    </div>

    <!-- Add provider form (dropdown of known providers + custom) -->
    <div v-if="showAddForm" class="add-form">
      <div class="add-form-inner">
        <label class="form-label">Select Provider</label>
        <select v-model="selectedKnownProvider" class="form-input">
          <option value="">— Choose a provider —</option>
          <option v-for="kp in KNOWN_PROVIDERS" :key="kp.id" :value="kp.id">{{ kp.name }}</option>
        </select>
        <input v-if="selectedKnownProvider === 'custom'" v-model="customId" class="form-input" placeholder="Provider ID (e.g. my-custom-api)" />
        <div class="add-form-actions">
          <button class="btn-add" @click="confirmAddProvider" :disabled="!selectedKnownProvider || (selectedKnownProvider === 'custom' && !customId.trim())">Add</button>
          <button class="btn-cancel" @click="showAddForm = false">Cancel</button>
        </div>
      </div>
    </div>
    <button v-else class="btn-add-card" @click="startAddProvider"><Plus :size="12" /> Add Provider</button>
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
.api-key-input-row { display: flex; align-items: center; gap: var(--space-6); }
.api-key-input-row .form-input { flex: 1; }
.env-badge { font-family: var(--font-mono); font-size: 9px; padding: 1px 5px; border-radius: var(--radius-xs); background: var(--bg-element); color: var(--text-accent); border: 1px solid var(--border-variant); white-space: nowrap; }
.form-helper { font-size: var(--font-size-small); color: var(--text-muted); line-height: 1.4; }
.number-false-row { display: flex; align-items: center; gap: var(--space-8); }
.number-false-row .form-input { flex: 1; }
.checkbox-label { display: flex; align-items: center; gap: 4px; font-size: var(--font-size-small); color: var(--text-muted); cursor: pointer; white-space: nowrap; }
.models-section { display: flex; flex-direction: column; gap: var(--space-6); padding-top: var(--space-8); border-top: 1px solid var(--border-variant); }
.models-header { display: flex; align-items: center; justify-content: space-between; }
.btn-import { display: inline-flex; align-items: center; gap: 4px; padding: 2px var(--space-6); background: transparent; border: 1px solid var(--border-variant); border-radius: var(--radius-xs); color: var(--text-accent); cursor: pointer; font-size: var(--font-size-small); }
.btn-import:hover { background: var(--bg-hover); }
.import-success { font-size: var(--font-size-small); color: var(--success); padding: 2px 0; }
.import-error { font-size: var(--font-size-small); color: var(--error); padding: 2px 0; }
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
.add-form { border: 1px solid var(--border-variant); border-radius: var(--radius-xs); padding: var(--space-8); background: var(--bg-editor); }
.add-form-inner { display: flex; flex-direction: column; gap: var(--space-8); }
.add-form-actions { display: flex; gap: var(--space-6); }
.btn-add, .btn-cancel { padding: 4px var(--space-8); border-radius: var(--radius-xs); cursor: pointer; font-size: var(--font-size-ui); border: none; }
.btn-add { background: var(--text-accent); color: var(--bg-editor); }
.btn-add:disabled { opacity: 0.4; cursor: not-allowed; }
.btn-cancel { background: transparent; color: var(--text-muted); }
.btn-add-card { display: inline-flex; align-items: center; gap: 4px; padding: var(--space-6) var(--space-8); background: transparent; border: 1px dashed var(--border-variant); border-radius: var(--radius-xs); color: var(--text-muted); cursor: pointer; font-size: var(--font-size-ui); }
.btn-add-card:hover { color: var(--text-primary); border-color: var(--text-accent); }
.animate-spin { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
</style>
