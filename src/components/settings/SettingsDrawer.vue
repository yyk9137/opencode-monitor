<script setup lang="ts">
import { ref } from 'vue'
import { Settings, ChevronRight, RotateCcw, Loader2 } from 'lucide-vue-next'
import { useConfigStore } from '@/stores/config'

const configStore = useConfigStore()

// Gear button ref for focus restore on close
const gearBtn = ref<HTMLButtonElement | null>(null)

// Navigation sections
const navSections = [
  { id: 'models', label: 'Models' },
  { id: 'general', label: 'General' },
  { id: 'providers', label: 'Providers' },
  { id: 'provider-config', label: 'Provider Config' },
  { id: 'agents', label: 'Agents' },
  { id: 'mcp', label: 'MCP' },
  { id: 'advanced', label: 'Advanced' },
]

function selectSection(id: string) {
  configStore.activeSection = id
}

function handleClose() {
  if (configStore.isDirty) {
    configStore.requestDismiss({ kind: 'close' })
  } else {
    configStore.forceDismiss()
    gearBtn.value?.focus()
  }
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && !e.defaultPrevented) {
    e.preventDefault()
    e.stopPropagation()
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
      <div class="drawer-header">
        <span class="drawer-title">Settings</span>
        <button
          class="drawer-close-btn"
          title="关闭设置 (Esc)"
          @click="handleClose"
        >
          <ChevronRight :size="16" />
        </button>
      </div>

      <!-- Instance bar (step-3 will fill this in) -->
      <div class="drawer-instance-bar">
        <!-- InstanceSelector goes here in step-3 -->
      </div>

      <!-- Restart banner (step-5 will fill this in) -->
      <div class="drawer-restart-banner">
        <!-- RestartOverlay goes here in step-5 -->
      </div>

      <!-- Body: nav + content -->
      <div class="drawer-body">
        <nav class="drawer-nav">
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

        <div class="drawer-content">
          <!-- Section content will be rendered here in steps 4-11 -->
          <div class="section-placeholder">
            <Settings :size="32" />
            <p>Settings panel — step {{ configStore.activeSection }}</p>
            <p class="placeholder-hint">Section content will be implemented in steps 4-11.</p>
          </div>
        </div>
      </div>

      <!-- Footer: save bar -->
      <div class="drawer-footer">
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
          >
            <Loader2 v-if="configStore.phase !== 'idle'" :size="12" class="animate-spin" />
            保存并重启
          </button>
        </div>
      </div>
    </div>
  </Transition>
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

/* ── Instance bar ─────────────────────────────────────────────────────── */
.drawer-instance-bar {
  flex-shrink: 0;
  min-height: 0;
}

/* ── Restart banner ───────────────────────────────────────────────────── */
.drawer-restart-banner {
  flex-shrink: 0;
  min-height: 0;
}

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
