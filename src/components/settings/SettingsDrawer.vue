<script setup lang="ts">
import { computed, watch } from 'vue'
import { ChevronRight, RotateCcw, Loader2, AlertCircle } from 'lucide-vue-next'
import { useConfigStore } from '@/stores/config'
import type { ConfigScope } from '@/stores/config'
import RestartOverlay from './RestartOverlay.vue'
import ConfirmDialog from './ConfirmDialog.vue'
import ProvidersSection from './sections/ProvidersSection.vue'
import PluginsSection from './sections/PluginsSection.vue'
import AgentsSection from './sections/AgentsSection.vue'
import MCPSection from './sections/MCPSection.vue'

const configStore = useConfigStore()

// Navigation sections
const navSections = [
  { id: 'providers', label: 'Providers' },
  { id: 'plugins', label: 'Plugins' },
  { id: 'agents', label: 'Agents' },
  { id: 'mcp', label: 'MCP' },
]

function selectSection(id: string) {
  configStore.activeSection = id
}

function handleClose() {
  if (configStore.isDirty) {
    configStore.requestDismiss({ kind: 'close' })
  } else {
    configStore.forceDismiss()
    // Focus restore handled by App.vue watch on panelOpen
  }
}

async function switchScope(scope: ConfigScope) {
  if (configStore.configScope === scope) return
  configStore.configScope = scope
  // Reset state and re-fetch from new scope
  configStore.original = null
  configStore.draft = null
  await configStore.fetchConfig()
}

// Fetch config when drawer opens
watch(() => configStore.panelOpen, async (open) => {
  if (open && !configStore.draft) {
    await configStore.fetchConfig()
  }
})

async function handleSave() {
  const success = await configStore.saveConfig()
  if (!success) {
    // Error is stored in configStore.lastError — displayed in the drawer
    console.error('[handleSave] saveConfig failed:', configStore.lastError)
  }
}

// ── Confirm dialog props ────────────────────────────────────────────────
const dialogTitle = computed(() => {
  const r = configStore.pendingDismiss
  if (r?.kind === 'switch-instance') return '切换实例前保存更改？'
  return '未保存的更改'
})

const dialogBody = computed(() => {
  const r = configStore.pendingDismiss
  const count = configStore.dirtyCount
  if (r?.kind === 'switch-instance') {
    return [`您有 ${count} 个未保存的更改。`, '保存并切换到新实例，或放弃更改。']
  }
  return [`您有 ${count} 个未保存的更改。保存后 Zed 将自动重启。`]
})

const dialogSaveLabel = computed(() => {
  const r = configStore.pendingDismiss
  if (r?.kind === 'switch-instance') return '保存并切换'
  return '保存并重启 Zed'
})

function handleDialogCancel() {
  configStore.cancelDismiss()
}

function handleDialogDiscard() {
  configStore.forceDismiss()
}

async function handleDialogSave(): Promise<boolean> {
  return await configStore.saveConfig()
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && !e.defaultPrevented) {
    e.preventDefault()
    e.stopPropagation()
    if (configStore.pendingDismiss !== null) {
      // Dialog handles its own Escape
      return
    }
    handleClose()
  }
}
</script>

<template>
  <Transition name="drawer">
    <div
      v-show="configStore.panelOpen"
      class="settings-drawer"
      :inert="!configStore.panelOpen"
      :aria-hidden="!configStore.panelOpen"
      tabindex="-1"
      @keydown="handleKeydown"
    >
      <!-- Header -->
      <div class="drawer-header" :inert="configStore.pendingDismiss !== null">
        <span class="drawer-title">Settings</span>
        <button
          class="drawer-close-btn"
          title="关闭设置 (Esc)"
          @click="handleClose"
        >
          <ChevronRight :size="16" />
        </button>
      </div>

      <!-- Config scope toggle -->
      <div class="drawer-scope-bar" :inert="configStore.pendingDismiss !== null">
        <button
          class="scope-btn"
          :class="{ active: configStore.configScope === 'global' }"
          :disabled="configStore.phase !== 'idle'"
          @click="switchScope('global')"
        >
          全局配置
        </button>
        <button
          class="scope-btn"
          :class="{ active: configStore.configScope === 'project' }"
          :disabled="configStore.phase !== 'idle'"
          @click="switchScope('project')"
        >
          项目配置
        </button>
        <span class="scope-file-hint" :title="configStore.configFilePath">
          {{ configStore.configFilePath }}
        </span>
      </div>

      <!-- Restart banner -->
      <div class="drawer-restart-banner" :inert="configStore.pendingDismiss !== null">
        <RestartOverlay />
      </div>

      <!-- Error banner -->
      <div v-if="configStore.lastError && configStore.phase === 'idle'" class="drawer-error-banner">
        <AlertCircle :size="12" />
        <span>{{ configStore.lastError.message }}</span>
        <button class="error-dismiss" @click="configStore.lastError = null">×</button>
      </div>

      <!-- Body: nav + content -->
      <div class="drawer-body">
        <nav class="drawer-nav" :inert="configStore.pendingDismiss !== null">
          <button
            v-for="section in navSections"
            :key="section.id"
            class="nav-row"
            :class="{ active: configStore.activeSection === section.id }"
            role="tab"
            tabindex="0"
            @click="selectSection(section.id)"
          >
            <span class="nav-label">{{ section.label }}</span>
            <span
              class="nav-dirty-dot"
              :class="{ dirty: false }"
            />
          </button>
        </nav>

        <div class="drawer-content" :inert="configStore.pendingDismiss !== null">
          <ProvidersSection v-if="configStore.activeSection === 'providers'" />
          <PluginsSection v-else-if="configStore.activeSection === 'plugins'" />
          <AgentsSection v-else-if="configStore.activeSection === 'agents'" />
          <MCPSection v-else-if="configStore.activeSection === 'mcp'" />
        </div>
      </div>

      <!-- Footer: save bar -->
      <div class="drawer-footer" :inert="configStore.pendingDismiss !== null">
        <div class="save-status">
          <span v-if="configStore.isDirty" class="status-dirty">
            {{ configStore.dirtyCount }} 个未保存字段
          </span>
          <span v-else class="status-clean">已是最新</span>
        </div>
        <div class="save-actions">
          <button
            class="btn-reset"
            :disabled="!configStore.isDirty || configStore.phase !== 'idle'"
            @click="configStore.resetToSaved()"
          >
            <RotateCcw :size="12" />
            恢复到最近保存
          </button>
          <button
            class="btn-save"
            :disabled="!configStore.isDirty || configStore.phase !== 'idle'"
            @click="handleSave"
          >
            <Loader2 v-if="configStore.phase !== 'idle'" :size="12" class="animate-spin" />
            保存并重启 Zed
          </button>
        </div>
      </div>
    </div>
  </Transition>

  <!-- Confirm dialog (sibling of drawer, not child, to avoid :inert propagation) -->
  <ConfirmDialog
    v-if="configStore.pendingDismiss !== null"
    :title="dialogTitle"
    :body-lines="dialogBody"
    :save-label="dialogSaveLabel"
    :on-cancel="handleDialogCancel"
    :on-discard="handleDialogDiscard"
    :on-save-and-continue="handleDialogSave"
  />
</template>

<style scoped>
.settings-drawer {
  position: absolute;
  top: var(--titlebar-height);
  right: 0;
  bottom: 0;
  width: min(520px, 100%);
  display: flex;
  flex-direction: column;
  background: var(--bg-panel);
  border-left: 1px solid var(--border-variant);
  z-index: 50;
  overflow: hidden;
}

/* ── Drawer transition ────────────────────────────────────────────────── */
.drawer-enter-active,
.drawer-leave-active {
  transition: transform var(--duration-slow) var(--ease-out-quint);
}
.drawer-enter-from,
.drawer-leave-to {
  transform: translateX(100%);
}

/* ── Header ───────────────────────────────────────────────────────────── */
.drawer-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 var(--space-12);
  height: 40px;
  background: var(--bg-app);
  border-bottom: 1px solid var(--border-variant);
  flex-shrink: 0;
}

.drawer-title {
  font-size: var(--font-size-ui);
  font-weight: 500;
  color: var(--text-primary);
  letter-spacing: 0.02em;
}

.drawer-close-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  border-radius: var(--radius-xs);
  transition: background var(--duration-fast) ease, color var(--duration-fast) ease;
}

.drawer-close-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

/* ── Scope toggle bar ─────────────────────────────────────────────────── */
.drawer-scope-bar {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-6) var(--space-12);
  background: var(--bg-app);
  border-bottom: 1px solid var(--border-variant);
  flex-shrink: 0;
}

.scope-btn {
  padding: 3px var(--space-8);
  border: 1px solid var(--border-variant);
  border-radius: var(--radius-xs);
  background: transparent;
  color: var(--text-muted);
  font-family: var(--font-ui);
  font-size: var(--font-size-small);
  cursor: pointer;
  transition: background var(--duration-fast) ease, color var(--duration-fast) ease, border-color var(--duration-fast) ease;
}

.scope-btn:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.scope-btn.active {
  background: var(--bg-selected);
  color: var(--text-primary);
  border-color: var(--text-accent);
}

.scope-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.scope-file-hint {
  margin-left: auto;
  font-family: var(--font-mono);
  font-size: 9px;
  color: var(--text-placeholder);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 200px;
}

/* ── Restart banner ───────────────────────────────────────────────────── */
.drawer-restart-banner {
  flex-shrink: 0;
  min-height: 0;
}

/* ── Error banner ──────────────────────────────────────────────────────── */
.drawer-error-banner {
  display: flex;
  align-items: center;
  gap: var(--space-6);
  padding: var(--space-6) var(--space-12);
  background: rgba(217, 87, 87, 0.1);
  border-bottom: 1px solid var(--error);
  color: var(--error);
  font-size: var(--font-size-ui);
  flex-shrink: 0;
}

.error-dismiss {
  margin-left: auto;
  border: none;
  background: transparent;
  color: var(--error);
  cursor: pointer;
  font-size: 16px;
  padding: 0 4px;
}
.error-dismiss:hover { opacity: 0.7; }

/* ── Body ─────────────────────────────────────────────────────────────── */
.drawer-body {
  flex: 1;
  display: flex;
  min-height: 0;
  overflow: hidden;
}

/* ── Navigation sidebar ──────────────────────────────────────────────── */
.drawer-nav {
  width: 160px;
  display: flex;
  flex-direction: column;
  padding: var(--space-6) 0;
  background: var(--bg-app);
  border-right: 1px solid var(--border-variant);
  overflow-y: auto;
  flex-shrink: 0;
}

.nav-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 var(--space-12);
  height: 28px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  font-family: var(--font-ui);
  font-size: var(--font-size-ui);
  text-align: left;
  position: relative;
  transition: background var(--duration-fast) ease, color var(--duration-fast) ease;
}

.nav-row:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.nav-row.active {
  background: var(--bg-selected);
  color: var(--text-primary);
}

.nav-row.active::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 2px;
  background: var(--text-accent);
}

.nav-dirty-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--text-placeholder);
  flex-shrink: 0;
}

.nav-dirty-dot.dirty {
  background: var(--warning);
  animation: pulse-dot 2s ease-in-out infinite;
}

@keyframes pulse-dot {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

/* ── Content area ─────────────────────────────────────────────────────── */
.drawer-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow-y: auto;
  background: var(--bg-editor);
}

.section-placeholder {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-8);
  color: var(--text-placeholder);
  padding: var(--space-16);
}

.section-placeholder p {
  font-size: var(--font-size-ui);
  color: var(--text-muted);
}

.placeholder-hint {
  font-size: var(--font-size-small) !important;
  color: var(--text-placeholder) !important;
}

/* ── Footer / save bar ────────────────────────────────────────────────── */
.drawer-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 var(--space-12);
  height: 36px;
  background: var(--bg-app);
  border-top: 1px solid var(--border-variant);
  flex-shrink: 0;
}

.save-status {
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.03em;
  color: var(--text-muted);
}

.status-dirty {
  color: var(--warning);
}

.status-clean {
  color: var(--text-placeholder);
}

.save-actions {
  display: flex;
  align-items: center;
  gap: var(--space-6);
}

.btn-reset,
.btn-save {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px var(--space-8);
  border: none;
  border-radius: var(--radius-xs);
  font-family: var(--font-ui);
  font-size: var(--font-size-ui);
  cursor: pointer;
  transition: opacity var(--duration-fast) ease;
}

.btn-reset {
  background: transparent;
  color: var(--text-muted);
}

.btn-reset:hover:not(:disabled) {
  color: var(--text-primary);
  background: var(--bg-hover);
}

.btn-save {
  background: var(--text-accent);
  color: var(--bg-editor);
  font-weight: 500;
}

.btn-save:hover:not(:disabled) {
  opacity: 0.9;
}

.btn-reset:disabled,
.btn-save:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.animate-spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* ── Responsive ──────────────────────────────────────────────────────── */
@media (max-width: 900px) {
  .settings-drawer {
    width: 100%;
  }

  .drawer-nav {
    width: 48px;
  }

  .nav-label {
    display: none;
  }

  .nav-row {
    justify-content: center;
  }
}

@media (max-width: 700px) {
  .drawer-nav {
    display: none;
  }
}
</style>
