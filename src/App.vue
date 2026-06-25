<script setup lang="ts">
import { onMounted, ref, onBeforeUnmount, watch } from "vue";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { Minus, Square, X, Settings } from "lucide-vue-next";
import { useSessionStore } from "@/stores/session";
import { useConfigStore } from "@/stores/config";
import { useEventStream } from "@/composables/useEventStream";
import { useSessionBootstrap } from "@/composables/useSessionBootstrap";
import { useInstanceScanner } from "@/composables/useInstanceScanner";
import { useStuckDetection } from "@/composables/useStuckDetection";
import ConnectionConfig from "@/components/ConnectionConfig.vue";
import SessionTree from "@/components/SessionTree.vue";
import SubagentDetail from "@/components/SubagentDetail.vue";
import ToastHost from "@/components/ToastHost.vue";
import SettingsDrawer from "@/components/settings/SettingsDrawer.vue";

const store = useSessionStore();
const configStore = useConfigStore();
const { connectAll, disconnectAll } = useEventStream();
const { bootstrap } = useSessionBootstrap();
const { scan } = useInstanceScanner();
const { startWatching, stopWatching } = useStuckDetection();

// ── Titlebar window controls ──────────────────────────────────────────

const appWindow = getCurrentWindow();
const isMaximized = ref(false);

// Gear button ref — focus restore on drawer close
const gearBtn = ref<HTMLButtonElement | null>(null);

// Watch drawer close → restore focus to gear button
watch(() => configStore.panelOpen, (open, wasOpen) => {
  if (!open && wasOpen) {
    gearBtn.value?.focus();
  }
});

// ── Diagnostic logger — writes to %TEMP%\monitor-debug.log (for release builds without devtools) ──
const debugLog: string[] = []
function dbg(msg: string) {
  const line = `[${new Date().toISOString()}] ${msg}`
  console.log(line)
  debugLog.push(line)
  // Write to file every 10 lines
  if (debugLog.length % 10 === 0) {
    invoke('write_debug_log', { lines: debugLog.join('\n') }).catch(() => {})
  }
}

async function toggleMaximize() {
  await appWindow.toggleMaximize();
  isMaximized.value = await appWindow.isMaximized();
}

// ── Connector orchestration — used on mount and on rescan ─────────────
//
// Flow: scan ports → discover instances → bootstrap session history from
// each → open SSE streams per instance. Re-runnable: invoked again when
// the user clicks the rescan button in ConnectionConfig.

const bootstrapError = ref<string>("");
const scanNotice = ref<string>("");

async function orchestrate(): Promise<void> {
  scanNotice.value = "";
  dbg('orchestrate: starting scan')
  let discovered: Awaited<ReturnType<typeof scan>>;
  try {
    discovered = await scan();
    dbg(`orchestrate: scan found ${discovered.length} instances: ${discovered.map(i => i.url).join(', ')}`)
  } catch (err) {
    dbg(`orchestrate: scan failed: ${err}`)
    console.error("[App] scan failed", err);
    scanNotice.value = err instanceof Error ? err.message : "Scan failed";
    disconnectAll();
    return;
  }

  const urls = discovered.map((i) => i.url);
  dbg(`orchestrate: urls = ${JSON.stringify(urls)}`)

  if (urls.length === 0) {
    dbg('orchestrate: no instances found, disconnecting')
    disconnectAll();
    return;
  }

  try {
    await bootstrap(urls);
    dbg('orchestrate: bootstrap done')
  } catch (err) {
    dbg(`orchestrate: bootstrap failed: ${err}`)
    console.error("[App] bootstrap failed", err);
    bootstrapError.value =
      err instanceof Error ? err.message : "Bootstrap failed";
  }

  dbg('orchestrate: connecting SSE')
  connectAll(urls);
  dbg('orchestrate: connectAll returned')
}

onMounted(async () => {
  isMaximized.value = await appWindow.isMaximized();
  dbg('App mounted')

  // Read --cwd CLI arg (passed by Zed task: --cwd $ZED_WORKTREE_ROOT).
  try {
    const args = await invoke<string[]>("get_cli_args");
    dbg(`CLI args = ${JSON.stringify(args)}`)
    const cwdIdx = args.indexOf("--cwd");
    if (cwdIdx !== -1 && args[cwdIdx + 1]) {
      let cwd = args[cwdIdx + 1];
      // If --cwd points to a file (not a directory), use its parent directory
      // This happens when Zed's $ZED_WORKTREE_ROOT resolves to a file path
      // e.g. when Zed opened a single file rather than a project folder
      if (cwd.includes('.') && !cwd.endsWith('\\') && !cwd.endsWith('/')) {
        const lastSep = Math.max(cwd.lastIndexOf('\\'), cwd.lastIndexOf('/'));
        if (lastSep > 0) {
          cwd = cwd.substring(0, lastSep);
        }
      }
      store.cwdFilter = cwd;
      dbg(`cwdFilter set to = ${store.cwdFilter}`)
    } else {
      dbg('no --cwd arg')
    }
  } catch {
    dbg('get_cli_args failed')
  }

  dbg('starting orchestrate')
  await orchestrate();
  dbg('orchestrate done, starting stuck detection')
  startWatching();
  dbg('onMounted complete')
  // Flush debug log
  invoke('write_debug_log', { lines: debugLog.join('\n') }).catch(() => {})
});

onBeforeUnmount(() => {
  stopWatching();
  disconnectAll();
});
</script>

<template>
  <div class="app-container">
    <!-- Custom Titlebar -->
    <div class="titlebar">
      <div class="titlebar-left">
        <span class="titlebar-title">OpenCode Monitor</span>
        <span v-if="store.activeTabId" class="titlebar-context">
          · {{ store.sessions.get(store.activeTabId)?.title || "session" }}
        </span>
      </div>
      <div class="titlebar-buttons">
        <div class="titlebar-actions">
          <button
            ref="gearBtn"
            class="titlebar-button gear-btn"
            title="设置 (Ctrl+,)"
            @click="configStore.panelOpen = true"
          >
            <Settings :size="14" />
          </button>
        </div>
        <div class="titlebar-button" @click="appWindow.minimize()">
          <Minus :size="14" />
        </div>
        <div class="titlebar-button" @click="toggleMaximize">
          <Square :size="12" />
        </div>
        <div class="titlebar-button close" @click="appWindow.close()">
          <X :size="14" />
        </div>
      </div>
    </div>

    <!-- Main split layout -->
    <div class="app-body">
      <!-- Sidebar -->
      <aside class="sidebar">
        <ConnectionConfig :rescan="orchestrate" />
        <SessionTree />
      </aside>

      <!-- Detail pane -->
      <main class="main-pane" :inert="configStore.panelOpen">
        <SubagentDetail />
      </main>
    </div>

    <!-- Optional error toast at the bottom -->
    <div v-if="bootstrapError" class="bootstrap-error">
      <span>Initial sync failed: {{ bootstrapError }}</span>
      <button type="button" @click="bootstrapError = ''">dismiss</button>
    </div>
    <div v-else-if="scanNotice" class="bootstrap-error">
      <span>Scan failed: {{ scanNotice }}</span>
      <button type="button" @click="scanNotice = ''">dismiss</button>
    </div>
    <ToastHost />
    <SettingsDrawer />
  </div>
</template>

<style scoped>
.app-container {
  display: flex;
  flex-direction: column;
  height: 100%;
  position: relative;
}

.app-body {
  flex: 1;
  display: flex;
  min-height: 0;
  overflow: hidden;
}

.sidebar {
  width: var(--sidebar-width);
  display: flex;
  flex-direction: column;
  background: var(--bg-panel);
  border-right: 1px solid var(--border-variant);
  flex-shrink: 0;
  min-height: 0;
}

.main-pane {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}

.titlebar-left {
  display: flex;
  align-items: center;
  gap: var(--space-6);
  min-width: 0;
}

.titlebar-context {
  font-size: var(--font-size-small);
  color: var(--text-placeholder);
  font-weight: 400;
  letter-spacing: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 280px;
}

.titlebar-actions {
  display: flex;
  align-items: center;
  -webkit-app-region: no-drag;  /* Override .titlebar drag — gear button must be clickable */
  margin-right: var(--space-4);
}

.bootstrap-error {
  position: absolute;
  bottom: var(--space-12);
  left: 50%;
  transform: translateX(-50%);
  display: inline-flex;
  align-items: center;
  gap: var(--space-8);
  padding: var(--space-6) var(--space-12);
  background: var(--bg-elevated);
  border: 1px solid var(--error);
  border-radius: var(--radius-sm);
  color: var(--error);
  font-size: var(--font-size-small);
  z-index: 20;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.30);
}

.bootstrap-error button {
  background: transparent;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  font-family: var(--font-ui);
  font-size: var(--font-size-small);
  padding: 2px var(--space-6);
  border-radius: var(--radius-xs);
}

.bootstrap-error button:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}
</style>
