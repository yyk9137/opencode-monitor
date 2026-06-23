<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  ChevronDown,
  ChevronRight,
  Loader2,
  Plus,
  RefreshCw,
  Wifi,
  WifiOff,
} from 'lucide-vue-next'
import { fetch } from '@tauri-apps/plugin-http'
import { useSessionStore } from '@/stores/session'
import { useInstanceScanner } from '@/composables/useInstanceScanner'

interface Props {
  rescan: () => void | Promise<void>
}

const props = defineProps<Props>()
const store = useSessionStore()
const { scanning, scan } = useInstanceScanner()

// ─── Top status pill (aggregates all instance connections) ──────────────

const statusText = computed(() => {
  const total = store.instances.length
  const live = store.instances.filter((i) => i.connected).length
  if (total === 0) {
    if (scanning.value) return 'Scanning…'
    return store.connectionStatus === 'connected' ? 'Connected' : 'Disconnected'
  }
  if (live === total) return 'All connected'
  if (live === 0) return 'Disconnected'
  return `${live}/${total} connected`
})

const statusState = computed<'connected' | 'connecting' | 'disconnected'>(() => {
  if (store.instances.some((i) => i.connected)) return 'connected'
  if (scanning.value) return 'connecting'
  return 'disconnected'
})

// ─── Stuck threshold (kept from the original config) ────────────────────

const stuckMinutes = computed({
  get: () => Math.round(store.stuckThresholdMs / 60000 * 10) / 10,
  set: (minutes: number) => {
    const clamped = Math.min(30, Math.max(0.5, minutes))
    store.setStuckThreshold(Math.round(clamped * 60000))
  },
})

// ─── Display helpers ──────────────────────────────────────────────────

function dirBasename(dir: string | undefined): string {
  if (!dir) return '—'
  const trimmed = dir.replace(/[\\/]+$/, '')
  const parts = trimmed.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? dir
}

// ─── Manual URL entry (collapsed fallback) ─────────────────────────────

const manualOpen = ref(false)
const manualUrl = ref('')
const manualError = ref('')
const manualBusy = ref(false)

async function connectManual(): Promise<void> {
  manualError.value = ''
  const url = manualUrl.value.trim().replace(/\/+$/, '')
  if (!url || !/^https?:\/\//.test(url)) {
    manualError.value = 'Enter a valid http(s)://host:port URL'
    return
  }
  if (store.instances.some((i) => i.url === url)) {
    manualError.value = 'Already in the list'
    return
  }
  manualBusy.value = true
  try {
    const probe = await fetch(`${url}/global/health`, { signal: AbortSignal.timeout(800) })
    if (!probe.ok) {
      manualError.value = `Server returned ${probe.status}`
      return
    }
    let projectDir: string | undefined
    try {
      const proj = await fetch(`${url}/project/current`, { signal: AbortSignal.timeout(800) })
      if (proj.ok) {
        const body = await proj.json() as { data?: { directory?: string }; directory?: string }
        projectDir = body.data?.directory ?? body.directory
      }
    } catch { /* optional */ }
    let port = 0
    try { port = new URL(url).port ? Number(new URL(url).port) : 0 } catch { /* ignore */ }
    store.addInstance({
      url,
      port,
      projectDir,
      connected: false,
    })
    manualUrl.value = ''
    manualOpen.value = false
    // Ask App.vue to (re)sync SSE for the new instance.
    await props.rescan()
  } catch (err) {
    manualError.value = err instanceof Error ? err.message : 'Probe failed'
  } finally {
    manualBusy.value = false
  }
}

async function startRescan(): Promise<void> {
  await props.rescan()
}

async function startScan(): Promise<void> {
  await scan()
  await props.rescan()
}
</script>

<template>
  <section class="connection-config">
    <!-- ── Overall status pill ─────────────────────────────────────── -->
    <div class="status-row">
      <div class="status-pill" :data-state="statusState">
        <span class="dot" aria-hidden="true" />
        <component
          :is="
            statusState === 'connected'
              ? Wifi
              : statusState === 'connecting'
                ? Loader2
                : WifiOff
          "
          :size="12"
          class="status-icon"
        />
        <span class="status-label">{{ statusText }}</span>
      </div>
      <button
        type="button"
        class="rescan-btn"
        :disabled="scanning"
        :title="scanning ? 'Scanning…' : 'Rescan ports 4096-4120'"
        @click="startRescan"
      >
        <RefreshCw :size="12" :class="{ spin: scanning }" />
      </button>
    </div>

    <!-- ── Instances section ───────────────────────────────────────── -->
    <div class="instances-block">
      <header class="section-header">
        <span class="section-label">
          Instances
          <span class="section-count">{{ store.instances.length }}</span>
        </span>
        <span v-if="scanning" class="section-meta">scanning…</span>
      </header>

      <ul v-if="store.instances.length > 0" class="instance-list">
        <li
          v-for="inst in store.instances"
          :key="inst.url"
          class="instance-row"
          :data-state="inst.connected ? 'connected' : 'idle'"
        >
          <span
            class="inst-dot"
            :data-connected="inst.connected ? 'true' : 'false'"
            :aria-label="inst.connected ? 'connected' : 'idle'"
          />
          <span class="inst-port">{{ inst.port }}</span>
          <span class="inst-dir" :title="inst.projectDir || inst.url">
            {{ dirBasename(inst.projectDir) }}
          </span>
          <span v-if="inst.version" class="inst-version" :title="`OpenCode ${inst.version}`">
            ·{{ inst.version }}
          </span>
        </li>
      </ul>

      <div v-else-if="scanning" class="empty scanning-empty">
        <Loader2 :size="14" class="spin empty-spin" />
        <span>Scanning localhost…</span>
      </div>

      <p v-else class="empty-hint">
        No OpenCode servers found. Start one on port 4096,
        or add a custom endpoint below.
      </p>

      <button
        type="button"
        class="scan-btn"
        :class="{ active: scanning }"
        :disabled="scanning"
        @click="startScan"
      >
        <Loader2 v-if="scanning" :size="13" class="spin" />
        <RefreshCw v-else :size="13" />
        <span>{{ scanning ? 'Scanning ports 4096–4120' : 'Scan for instances' }}</span>
      </button>

      <!-- ── Manual URL entry (collapsed) ───────────────────────── -->
      <div class="manual">
        <button
          type="button"
          class="manual-toggle"
          :aria-expanded="manualOpen ? 'true' : 'false'"
          @click="manualOpen = !manualOpen"
        >
          <component
            :is="manualOpen ? ChevronDown : ChevronRight"
            :size="11"
            class="manual-glyph"
          />
          <Plus :size="11" class="manual-plus" />
          <span>Add custom endpoint</span>
        </button>
        <form v-if="manualOpen" class="manual-form" @submit.prevent="connectManual">
          <input
            v-model="manualUrl"
            type="text"
            class="manual-input"
            placeholder="http://host:port"
            spellcheck="false"
            autocomplete="off"
            :disabled="manualBusy"
          />
          <button
            type="submit"
            class="manual-submit"
            :disabled="manualBusy || !manualUrl.trim()"
          >
            <Loader2 v-if="manualBusy" :size="11" class="spin" />
            <span>{{ manualBusy ? 'Probing' : 'Connect' }}</span>
          </button>
          <p v-if="manualError" class="manual-error">{{ manualError }}</p>
        </form>
      </div>
    </div>

    <!-- ── Stuck threshold (kept) ─────────────────────────────────── -->
    <div class="threshold-row">
      <label class="threshold-label" for="stuck-threshold">Stuck threshold (min)</label>
      <div class="threshold-field">
        <input
          id="stuck-threshold"
          v-model.number="stuckMinutes"
          type="number"
          step="0.5"
          min="0.5"
          max="30"
          class="threshold-input"
        />
      </div>
    </div>
  </section>
</template>

<style scoped>
.connection-config {
  display: flex;
  flex-direction: column;
  gap: var(--space-12);
  padding: var(--space-12);
  border-bottom: 1px solid var(--border-variant);
  background: var(--bg-panel);
  flex-shrink: 0;
}

/* ── Status row ──────────────────────────────────────────────────────── */

.status-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-8);
}

.status-pill {
  display: inline-flex;
  align-items: center;
  gap: var(--space-6);
  padding: var(--space-4) var(--space-8);
  border-radius: var(--radius-sm);
  background: var(--bg-element);
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-muted);
  min-width: 0;
}

.status-pill .status-icon {
  flex-shrink: 0;
  color: var(--text-muted);
}

.status-pill .status-label {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--text-muted);
  flex-shrink: 0;
  transition: background var(--duration-fast) var(--ease-out-quint);
}

.status-pill[data-state='connected'] .dot {
  background: var(--success);
  box-shadow: 0 0 0 2px rgba(112, 191, 86, 0.22);
  animation: pulse-running 2.4s var(--ease-out-quint) infinite;
}

.status-pill[data-state='connected'] .status-icon {
  color: var(--success);
}

.status-pill[data-state='connecting'] .dot {
  background: var(--info);
  box-shadow: 0 0 0 2px rgba(89, 194, 255, 0.25);
  animation: pulse-active 1.2s var(--ease-out-quint) infinite;
}

.status-pill[data-state='connecting'] .status-icon {
  color: var(--info);
  animation: spin 1s linear infinite;
}

.status-pill[data-state='disconnected'] .dot {
  background: var(--error);
}

.status-pill[data-state='disconnected'] .status-icon {
  color: var(--error);
}

.rescan-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-variant);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition:
    background var(--duration-fast) var(--ease-out-quint),
    border-color var(--duration-fast) var(--ease-out-quint),
    color var(--duration-fast) var(--ease-out-quint);
}

.rescan-btn:hover:not(:disabled) {
  background: var(--bg-hover);
  border-color: var(--border);
  color: var(--text-primary);
}

.rescan-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

/* ── Instances section ──────────────────────────────────────────────── */

.instances-block {
  display: flex;
  flex-direction: column;
  gap: var(--space-8);
}

.section-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-8);
  padding: 0 var(--space-2);
}

.section-label {
  display: inline-flex;
  align-items: center;
  gap: var(--space-6);
  font-size: var(--font-size-small);
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-weight: 600;
}

.section-count {
  display: inline-block;
  min-width: 18px;
  padding: 0 var(--space-5);
  background: var(--bg-element);
  border-radius: var(--radius-xs);
  text-align: center;
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--text-placeholder);
  line-height: 1.5;
  letter-spacing: 0;
  text-transform: none;
}

.section-meta {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--text-placeholder);
}

/* ── Instance list ─────────────────────────────────────────────────── */

.instance-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
  background: var(--border-variant);
  border: 1px solid var(--border-variant);
  border-radius: var(--radius-sm);
  overflow: hidden;
}

.instance-row {
  display: grid;
  grid-template-columns: 10px auto 1fr auto;
  align-items: center;
  gap: var(--space-8);
  height: 28px;
  padding: 0 var(--space-8);
  background: var(--bg-element);
  font-size: 11px;
}

.inst-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--text-placeholder);
  flex-shrink: 0;
}

.inst-dot[data-connected='true'] {
  background: var(--success);
  box-shadow: 0 0 0 1.5px rgba(112, 191, 86, 0.22);
  animation: pulse-running 2.2s var(--ease-out-quint) infinite;
}

.inst-dot[data-connected='false'] {
  background: var(--text-placeholder);
  opacity: 0.55;
}

.inst-port {
  font-family: var(--font-mono);
  font-weight: 500;
  color: var(--text-primary);
  letter-spacing: 0.02em;
}

.inst-dir {
  font-family: var(--font-ui);
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

.inst-version {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--text-placeholder);
  letter-spacing: 0.02em;
}

/* ── Empty states ──────────────────────────────────────────────────── */

.empty {
  display: flex;
  align-items: center;
  gap: var(--space-8);
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-placeholder);
  padding: var(--space-6) var(--space-8);
  background: var(--bg-element);
  border: 1px dashed var(--border);
  border-radius: var(--radius-sm);
}

.empty-spin {
  color: var(--info);
  flex-shrink: 0;
}

.empty-hint {
  font-family: var(--font-ui);
  font-size: var(--font-size-small);
  color: var(--text-placeholder);
  line-height: 1.5;
  padding: var(--space-6) var(--space-8);
  background: var(--bg-element);
  border: 1px dashed var(--border);
  border-radius: var(--radius-sm);
  margin: 0;
}

/* ── Scan button ───────────────────────────────────────────────────── */

.scan-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-8);
  width: 100%;
  height: 30px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  background: var(--bg-element);
  color: var(--text-primary);
  font-family: var(--font-ui);
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  letter-spacing: 0.02em;
  transition:
    background var(--duration-fast) var(--ease-out-quint),
    border-color var(--duration-fast) var(--ease-out-quint),
    color var(--duration-fast) var(--ease-out-quint);
}

.scan-btn:hover:not(:disabled) {
  background: var(--bg-hover);
  border-color: var(--border-focused);
}

.scan-btn:disabled {
  cursor: progress;
}

.scan-btn.active {
  background: rgba(230, 180, 80, 0.10);
  border-color: rgba(230, 180, 80, 0.45);
  color: var(--text-accent);
}

.scan-btn .spin {
  flex-shrink: 0;
}

/* ── Manual URL disclosure ─────────────────────────────────────────── */

.manual {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
}

.manual-toggle {
  display: inline-flex;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-4) 0;
  background: transparent;
  border: none;
  color: var(--text-placeholder);
  font-family: var(--font-ui);
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-weight: 500;
  cursor: pointer;
  transition: color var(--duration-fast) var(--ease-out-quint);
  align-self: flex-start;
}

.manual-toggle:hover {
  color: var(--text-muted);
}

.manual-glyph {
  color: inherit;
  flex-shrink: 0;
}

.manual-plus {
  color: inherit;
  flex-shrink: 0;
}

.manual-form {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-6);
}

.manual-input {
  flex: 1;
  min-width: 0;
  padding: var(--space-6) var(--space-8);
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  background: var(--bg-element);
  color: var(--text-primary);
  font-family: var(--font-mono);
  font-size: 11px;
  outline: none;
  transition: border-color var(--duration-fast) var(--ease-out-quint);
}

.manual-input::placeholder {
  color: var(--text-placeholder);
}

.manual-input:hover {
  border-color: var(--border-focused);
}

.manual-input:focus {
  border-color: var(--border-focused);
  box-shadow: 0 0 0 1px var(--border-focused);
}

.manual-input:disabled {
  opacity: 0.55;
}

.manual-submit {
  display: inline-flex;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-6) var(--space-12);
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  background: var(--bg-element);
  color: var(--text-primary);
  font-family: var(--font-ui);
  font-size: 11px;
  cursor: pointer;
  transition:
    background var(--duration-fast) var(--ease-out-quint),
    border-color var(--duration-fast) var(--ease-out-quint);
}

.manual-submit:hover:not(:disabled) {
  background: var(--bg-hover);
  border-color: var(--border-focused);
}

.manual-submit:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.manual-error {
  flex-basis: 100%;
  margin: 0;
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--error);
}

/* ── Stuck threshold field ─────────────────────────────────────────── */

.threshold-row {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.threshold-label {
  font-size: var(--font-size-small);
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  font-weight: 500;
}

.threshold-field { position: relative; }

.threshold-input {
  width: 100%;
  padding: var(--space-6) var(--space-8);
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  background: var(--bg-element);
  color: var(--text-primary);
  font-family: var(--font-mono);
  font-size: var(--font-size-code);
  outline: none;
  transition:
    border-color var(--duration-fast) var(--ease-out-quint),
    background var(--duration-fast) var(--ease-out-quint);
}

.threshold-input:hover { border-color: var(--border-focused); }

.threshold-input:focus {
  border-color: var(--border-focused);
  background: var(--bg-editor);
  box-shadow: 0 0 0 1px var(--border-focused);
}

/* ── Animations ────────────────────────────────────────────────────── */

.spin { animation: spin 1s linear infinite; }

@keyframes pulse-running {
  0%, 100% { box-shadow: 0 0 0 2px rgba(112, 191, 86, 0.22); }
  50%      { box-shadow: 0 0 0 4px rgba(112, 191, 86, 0.05); }
}

@keyframes pulse-active {
  0%, 100% { box-shadow: 0 0 0 2px rgba(89, 194, 255, 0.30); }
  50%      { box-shadow: 0 0 0 6px rgba(89, 194, 255, 0.08); }
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to   { transform: rotate(360deg); }
}
</style>
