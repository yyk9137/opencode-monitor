<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { fetch } from '@tauri-apps/plugin-http'
import { useConfigStore } from '@/stores/config'
import { AlertCircle, Loader2 } from 'lucide-vue-next'

const configStore = useConfigStore()

interface ProviderModel { id: string; name?: string }
interface ProviderInfo { id: string; name?: string; models?: ProviderModel[] }
interface ProviderResponse { all: ProviderInfo[]; connected: string[] }

const providers = ref<ProviderInfo[]>([])
const connected = ref<string[]>([])
const loading = ref(false)
const error = ref('')

// Merge /provider all with disabled_providers from config
const providerRows = computed(() => {
  const disabled = new Set(configStore.draft?.disabled_providers ?? [])
  const enabled = configStore.draft?.enabled_providers

  const rows: { id: string; name: string; modelCount: number; isOn: boolean; authed: boolean }[] = []

  // From /provider response
  for (const p of providers.value) {
    const isDisabled = disabled.has(p.id)
    const isEnabled = enabled ? enabled.includes(p.id) : true
    rows.push({
      id: p.id,
      name: p.name || p.id,
      modelCount: p.models?.length ?? 0,
      isOn: isEnabled && !isDisabled,
      authed: connected.value.includes(p.id),
    })
  }

  // Add disabled providers not in /provider response (they vanished after disable)
  for (const id of disabled) {
    if (!rows.find(r => r.id === id)) {
      rows.push({ id, name: id, modelCount: 0, isOn: false, authed: false })
    }
  }

  return rows
})

async function loadProviders() {
  if (!configStore.targetUrl) return
  loading.value = true
  error.value = ''
  try {
    const resp = await fetch(`${configStore.targetUrl}/provider`)
    if (!resp.ok) { error.value = `GET /provider failed: ${resp.status}`; return }
    const data = (await resp.json()) as ProviderResponse
    providers.value = data.all || []
    connected.value = data.connected || []
  } catch (e) {
    error.value = String(e)
  } finally {
    loading.value = false
  }
}

onMounted(loadProviders)

function toggleProvider(id: string, on: boolean) {
  if (!configStore.draft) return
  const draft = configStore.draft
  const disabled = new Set(draft.disabled_providers ?? [])
  const enabled = new Set(draft.enabled_providers ?? [])

  if (on) {
    disabled.delete(id)
    enabled.add(id)
  } else {
    disabled.add(id)
    enabled.delete(id)
  }

  draft.disabled_providers = Array.from(disabled)
  draft.enabled_providers = Array.from(enabled)
  configStore.dirtyPaths.add('disabled_providers')
  configStore.dirtyPaths.add('enabled_providers')
}
</script>

<template>
  <div class="section-content">
    <h2 class="section-title">Providers</h2>

    <div v-if="loading" class="loading-hint">
      <Loader2 :size="14" class="animate-spin" /> Loading providers...
    </div>

    <div v-else-if="error" class="error-hint">
      <AlertCircle :size="14" /> {{ error }}
    </div>

    <div v-else class="provider-list">
      <div v-for="row in providerRows" :key="row.id" class="provider-row">
        <div class="provider-info">
          <span class="provider-dot" :class="{ authed: row.authed }" />
          <span class="provider-name">{{ row.name }}</span>
          <span v-if="row.modelCount > 0" class="provider-models">{{ row.modelCount }} models</span>
        </div>
        <button
          class="toggle-switch"
          :class="{ on: row.isOn }"
          @click="toggleProvider(row.id, !row.isOn)"
        >
          <span class="toggle-knob" />
        </button>
      </div>
    </div>

    <p class="section-hint">
      Toggle to enable/disable providers. API keys are set via
      <code>PUT /auth/:id</code> or environment variables. OAuth providers are not supported in this UI.
    </p>
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

.provider-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.provider-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-6) var(--space-8);
  border-radius: var(--radius-xs);
  transition: background var(--duration-fast) ease;
}

.provider-row:hover {
  background: var(--bg-hover);
}

.provider-info {
  display: flex;
  align-items: center;
  gap: var(--space-6);
}

.provider-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--text-placeholder);
  flex-shrink: 0;
}

.provider-dot.authed {
  background: var(--success);
}

.provider-name {
  font-size: var(--font-size-ui);
  color: var(--text-primary);
}

.provider-models {
  font-size: var(--font-size-small);
  color: var(--text-muted);
}

.toggle-switch {
  width: 32px;
  height: 16px;
  border-radius: 8px;
  border: none;
  background: var(--bg-element);
  cursor: pointer;
  position: relative;
  transition: background var(--duration-fast) ease;
  padding: 0;
}

.toggle-switch.on {
  background: var(--text-accent);
}

.toggle-knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--text-primary);
  transition: transform var(--duration-fast) ease;
}

.toggle-switch.on .toggle-knob {
  transform: translateX(16px);
}

.section-hint {
  font-size: var(--font-size-small);
  color: var(--text-placeholder);
}

.section-hint code {
  font-family: var(--font-mono);
  font-size: 10px;
  background: var(--bg-element);
  padding: 1px 4px;
  border-radius: var(--radius-xs);
}

.loading-hint, .error-hint {
  display: flex;
  align-items: center;
  gap: var(--space-6);
  color: var(--text-muted);
}

.error-hint { color: var(--error); }

.animate-spin { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
</style>
