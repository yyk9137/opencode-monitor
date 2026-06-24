<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { ChevronDown, Loader2, XCircle, RefreshCw } from 'lucide-vue-next'
import { useSessionStore } from '@/stores/session'
import { useConfigStore } from '@/stores/config'
import { useInstanceScanner } from '@/composables/useInstanceScanner'

const sessionStore = useSessionStore()
const configStore = useConfigStore()
const { scanning, scan } = useInstanceScanner()

const dropdownOpen = ref(false)
const healthChecking = ref(false)
const instanceReachable = ref(true) // optimistic default

// Resolve initial instance: active tab → instance URL → first instance → null
const resolvedInstance = computed(() => {
  const sessNode = sessionStore.activeTabId
    ? sessionStore.sessions.get(sessionStore.activeTabId)
    : undefined
  const fromActiveTab = sessNode
    ? sessionStore.instances.find(i => i.url === sessNode.instanceUrl)
    : undefined
  return fromActiveTab ?? sessionStore.instances[0] ?? null
})

const displayLabel = computed(() => {
  const inst = resolvedInstance.value
  if (!inst) return '无实例'
  const port = inst.port
  const dirName = inst.projectDir
    ? inst.projectDir.split(/[\\/]/).pop()
    : ''
  return dirName ? `${dirName} :${port}` : `:${port}`
})

async function selectInstance(url: string) {
  dropdownOpen.value = false
  if (configStore.isDirty) {
    configStore.requestDismiss({ kind: 'switch-instance', newUrl: url })
    return
  }
  await switchToInstance(url)
}

async function switchToInstance(url: string) {
  if (configStore.phase !== 'idle') return
  configStore.setTargetUrl(url)
  configStore.original = null
  configStore.draft = null
  await configStore.fetchConfig()
}

async function rescan() {
  const found = await scan()
  // If instances were empty and scan found something, auto-select the first one
  if (!resolvedInstance.value && found.length > 0) {
    await switchToInstance(found[0].url)
  }
}

// When drawer opens, ensure we have an instance and load config
watch(
  () => configStore.panelOpen,
  async (open) => {
    if (!open) return

    // If no instances, try scanning first
    if (sessionStore.instances.length === 0 && !scanning.value) {
      await scan()
    }

    // Still no instances? Try localhost:4096 fallback
    if (sessionStore.instances.length === 0) {
      const fallbackUrl = 'http://localhost:4096'
      configStore.setTargetUrl(fallbackUrl)
      // Probe health to set instanceReachable
      healthChecking.value = true
      try {
        const resp = await fetch(`${fallbackUrl}/global/health`)
        instanceReachable.value = resp.ok
        if (resp.ok) {
          await configStore.fetchConfig()
        }
      } catch {
        instanceReachable.value = false
      } finally {
        healthChecking.value = false
      }
      return
    }

    // Normal: set target URL from resolved instance
    const inst = resolvedInstance.value
    if (inst) {
      configStore.setTargetUrl(inst.url)
      // Probe health
      healthChecking.value = true
      try {
        const resp = await fetch(`${inst.url}/global/health`)
        instanceReachable.value = resp.ok
      } catch {
        instanceReachable.value = false
      } finally {
        healthChecking.value = false
      }
      await configStore.fetchConfig()
    }
  },
  { immediate: false }
)
</script>

<template>
  <div class="instance-selector">
    <button
      class="selector-trigger"
      :class="{ disabled: configStore.phase !== 'idle' }"
      :disabled="configStore.phase !== 'idle'"
      @click="dropdownOpen = !dropdownOpen"
    >
      <!-- Status dot -->
      <span
        class="status-dot"
        :class="{
          ok: instanceReachable && !healthChecking,
          bad: !instanceReachable && !healthChecking,
          checking: healthChecking
        }"
      />

      <Loader2 v-if="configStore.phase === 'loading'" :size="12" class="animate-spin" />
      <span class="selector-label">{{ displayLabel }}</span>

      <ChevronDown :size="12" class="selector-chevron" :class="{ open: dropdownOpen }" />

      <button
        class="rescan-btn"
        title="重新扫描实例"
        @click.stop="rescan"
      >
        <RefreshCw :size="10" :class="{ spinning: scanning }" />
      </button>
    </button>

    <!-- Dropdown menu -->
    <Transition name="dropdown">
      <div v-if="dropdownOpen" class="selector-menu">
        <div v-if="scanning" class="menu-loading">
          <Loader2 :size="14" class="animate-spin" />
          <span>扫描中...</span>
        </div>

        <div v-else-if="sessionStore.instances.length === 0" class="menu-empty">
          <XCircle :size="14" />
          <span>未发现 OpenCode 实例</span>
          <button class="menu-rescan" @click="rescan">重新扫描</button>
        </div>

        <button
          v-for="inst in sessionStore.instances"
          v-else
          :key="inst.url"
          class="menu-row"
          :class="{ active: resolvedInstance?.url === inst.url }"
          @click="selectInstance(inst.url)"
        >
          <span class="menu-row-dot" :class="{ connected: inst.connected }" />
          <span class="menu-row-label">
            <span class="menu-row-port">:{{ inst.port }}</span>
            <span v-if="inst.projectDir" class="menu-row-dir">
              {{ inst.projectDir.split(/[\\/]/).pop() }}
            </span>
          </span>
          <span v-if="inst.version" class="menu-row-version">{{ inst.version }}</span>
        </button>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.instance-selector {
  position: relative;
  display: flex;
  align-items: center;
  padding: var(--space-6) var(--space-12);
  background: var(--bg-app);
  border-bottom: 1px solid var(--border-variant);
}

.selector-trigger {
  display: flex;
  align-items: center;
  gap: var(--space-6);
  padding: 4px var(--space-8);
  background: var(--bg-element);
  border: 1px solid var(--border-variant);
  border-radius: var(--radius-xs);
  color: var(--text-primary);
  font-family: var(--font-ui);
  font-size: var(--font-size-ui);
  cursor: pointer;
  transition: background var(--duration-fast) ease;
  min-width: 0;
}

.selector-trigger:hover:not(.disabled) {
  background: var(--bg-hover);
}

.selector-trigger.disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--text-placeholder);
  flex-shrink: 0;
}

.status-dot.ok {
  background: var(--success);
}

.status-dot.bad {
  background: var(--error);
}

.status-dot.checking {
  background: var(--warning);
  animation: pulse-dot 1s ease-in-out infinite;
}

.selector-label {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.selector-chevron {
  color: var(--text-muted);
  transition: transform var(--duration-fast) ease;
}

.selector-chevron.open {
  transform: rotate(180deg);
}

.rescan-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  border-radius: var(--radius-xs);
}

.rescan-btn:hover {
  color: var(--text-primary);
  background: var(--bg-hover);
}

/* ── Dropdown menu ────────────────────────────────────────────────────── */
.selector-menu {
  position: absolute;
  top: 100%;
  left: var(--space-12);
  right: var(--space-12);
  background: var(--bg-elevated);
  border: 1px solid var(--border-variant);
  border-radius: var(--radius-xs);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  z-index: 60;
  overflow: hidden;
  max-height: 300px;
  overflow-y: auto;
}

.menu-loading,
.menu-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-6);
  padding: var(--space-12);
  color: var(--text-muted);
  font-size: var(--font-size-ui);
}

.menu-rescan {
  background: transparent;
  border: 1px solid var(--border-variant);
  color: var(--text-accent);
  padding: 4px var(--space-8);
  border-radius: var(--radius-xs);
  cursor: pointer;
  font-size: var(--font-size-ui);
}

.menu-rescan:hover {
  background: var(--bg-hover);
}

.menu-row {
  display: flex;
  align-items: center;
  gap: var(--space-6);
  width: 100%;
  padding: var(--space-6) var(--space-8);
  background: transparent;
  border: none;
  color: var(--text-primary);
  font-family: var(--font-ui);
  font-size: var(--font-size-ui);
  cursor: pointer;
  text-align: left;
  transition: background var(--duration-fast) ease;
}

.menu-row:hover {
  background: var(--bg-hover);
}

.menu-row.active {
  background: var(--bg-selected);
}

.menu-row-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--text-placeholder);
  flex-shrink: 0;
}

.menu-row-dot.connected {
  background: var(--success);
}

.menu-row-label {
  flex: 1;
  display: flex;
  align-items: center;
  gap: var(--space-6);
  min-width: 0;
}

.menu-row-port {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--text-muted);
}

.menu-row-dir {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.menu-row-version {
  font-family: var(--font-mono);
  font-size: 9px;
  color: var(--text-placeholder);
}

/* ── Dropdown transition ──────────────────────────────────────────────── */
.dropdown-enter-active,
.dropdown-leave-active {
  transition: opacity var(--duration-fast) ease, transform var(--duration-fast) ease;
}

.dropdown-enter-from,
.dropdown-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

/* ── Animations ───────────────────────────────────────────────────────── */
@keyframes pulse-dot {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

.animate-spin {
  animation: spin 1s linear infinite;
}

.spinning {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
