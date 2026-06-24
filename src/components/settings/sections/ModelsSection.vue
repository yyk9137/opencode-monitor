<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { fetch } from '@tauri-apps/plugin-http'
import { useConfigStore } from '@/stores/config'
import { AlertCircle, ChevronDown } from 'lucide-vue-next'

const configStore = useConfigStore()

// ── Provider data (for model dropdowns) ──────────────────────────────────
interface ProviderModel { id: string; name?: string }
interface ProviderInfo { id: string; name?: string; models?: ProviderModel[] }

const providers = ref<ProviderInfo[]>([])
const loadingProviders = ref(false)
const providerError = ref('')

// ── Agent data (for default_agent dropdown) ───────────────────────────────
interface AgentInfo { name: string; mode?: string }
const agents = ref<AgentInfo[]>([])

// Model list formatted as "provider_id/model_id"
const modelOptions = computed(() => {
  const options: { value: string; label: string }[] = []
  for (const p of providers.value) {
    if (!p.models) continue
    for (const m of p.models) {
      const value = `${p.id}/${m.id}`
      const label = m.name || m.id
      options.push({ value, label: `${p.id} / ${label}` })
    }
  }
  return options
})

// Filter agents to primary-capable (mode === 'primary' || 'all')
const primaryAgents = computed(() =>
  agents.value.filter(a => a.mode === 'primary' || a.mode === 'all' || !a.mode)
)

async function loadProviders() {
  if (!configStore.targetUrl) return
  loadingProviders.value = true
  providerError.value = ''
  try {
    const resp = await fetch(`${configStore.targetUrl}/provider`)
    if (!resp.ok) { providerError.value = `GET /provider failed: ${resp.status}`; return }
    const data = await resp.json() as { all: ProviderInfo[] }
    providers.value = data.all || []
  } catch (e) {
    providerError.value = String(e)
  } finally {
    loadingProviders.value = false
  }
}

async function loadAgents() {
  if (!configStore.targetUrl) return
  try {
    const resp = await fetch(`${configStore.targetUrl}/agent`)
    if (!resp.ok) return
    const data = await resp.json()
    // Agent endpoint returns array or map — normalize
    if (Array.isArray(data)) {
      agents.value = data.map((a: { id?: string; name?: string; mode?: string }) => ({
        name: a.name || a.id || '',
        mode: a.mode
      }))
    } else if (typeof data === 'object') {
      agents.value = Object.entries(data).map(([name, val]) => ({
        name,
        mode: (val as { mode?: string }).mode
      }))
    }
  } catch { /* silent */ }
}

onMounted(() => {
  loadProviders()
  loadAgents()
})

// ── Field update helper ───────────────────────────────────────────────────
function updateField(field: string, value: unknown) {
  if (!configStore.draft) return
  ;(configStore.draft as Record<string, unknown>)[field] = value
  configStore.dirtyPaths.add(field)
}

// Current values from draft
const modelValue = computed({
  get: () => configStore.draft?.model ?? '',
  set: (v: string) => updateField('model', v)
})
const smallModelValue = computed({
  get: () => configStore.draft?.small_model ?? '',
  set: (v: string) => updateField('small_model', v)
})
const defaultAgentValue = computed({
  get: () => configStore.draft?.default_agent ?? '',
  set: (v: string) => updateField('default_agent', v)
})
</script>

<template>
  <div class="section-content">
    <h2 class="section-title">Models</h2>

    <!-- Model -->
    <div class="form-row">
      <label class="form-label">Model</label>
      <div class="select-wrapper">
        <select v-model="modelValue" class="form-select">
          <option value="">(not set)</option>
          <option v-for="opt in modelOptions" :key="opt.value" :value="opt.value">
            {{ opt.label }}
          </option>
        </select>
        <ChevronDown :size="12" class="select-chevron" />
      </div>
    </div>

    <!-- Small model -->
    <div class="form-row">
      <label class="form-label">Small Model</label>
      <div class="select-wrapper">
        <select v-model="smallModelValue" class="form-select">
          <option value="">(not set)</option>
          <option v-for="opt in modelOptions" :key="opt.value" :value="opt.value">
            {{ opt.label }}
          </option>
        </select>
        <ChevronDown :size="12" class="select-chevron" />
      </div>
    </div>

    <!-- Default agent -->
    <div class="form-row">
      <label class="form-label">Default Agent</label>
      <div class="select-wrapper">
        <select v-model="defaultAgentValue" class="form-select">
          <option value="">(not set, defaults to build)</option>
          <option v-for="a in primaryAgents" :key="a.name" :value="a.name">
            {{ a.name }}{{ a.mode ? ` (${a.mode})` : '' }}
          </option>
        </select>
        <ChevronDown :size="12" class="select-chevron" />
      </div>
    </div>

    <!-- Loading / error states -->
    <div v-if="loadingProviders" class="loading-hint">Loading providers...</div>
    <div v-if="providerError" class="error-hint">
      <AlertCircle :size="12" /> {{ providerError }}
    </div>
    <div v-if="modelOptions.length === 0 && !loadingProviders" class="warning-hint">
      No models found. Start an OpenCode instance and try again.
    </div>
  </div>
</template>

<style scoped>
.section-content {
  padding: var(--space-12) var(--space-16);
  display: flex;
  flex-direction: column;
  gap: var(--space-12);
}

.section-title {
  font-size: var(--font-size-ui);
  font-weight: 600;
  color: var(--text-primary);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin: 0;
}

.form-row {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
}

.form-label {
  font-size: 11px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-muted);
}

.select-wrapper {
  position: relative;
}

.form-select {
  width: 100%;
  padding: 4px var(--space-8);
  height: 28px;
  background: var(--bg-element);
  border: 1px solid var(--border-variant);
  border-radius: var(--radius-xs);
  color: var(--text-primary);
  font-family: var(--font-ui);
  font-size: var(--font-size-ui);
  outline: none;
  cursor: pointer;
  appearance: none;
  -webkit-appearance: none;
}

.form-select:focus {
  background: var(--bg-editor);
  box-shadow: 0 0 0 1px var(--border-focused);
}

.select-chevron {
  position: absolute;
  right: var(--space-6);
  top: 50%;
  transform: translateY(-50%);
  color: var(--text-muted);
  pointer-events: none;
}

.loading-hint,
.error-hint,
.warning-hint {
  display: flex;
  align-items: center;
  gap: var(--space-6);
  font-size: var(--font-size-small);
  color: var(--text-muted);
  padding: var(--space-6) 0;
}

.error-hint {
  color: var(--error);
}

.warning-hint {
  color: var(--warning);
}
</style>
