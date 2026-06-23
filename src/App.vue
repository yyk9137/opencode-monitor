<script setup lang="ts">
import { onMounted, ref, onBeforeUnmount } from "vue";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { Minus, Square, X } from "lucide-vue-next";
import { useSessionStore } from "@/stores/session";
import { useEventStream } from "@/composables/useEventStream";
import { useSessionBootstrap } from "@/composables/useSessionBootstrap";
import { useInstanceScanner } from "@/composables/useInstanceScanner";
import { useStuckDetection } from "@/composables/useStuckDetection";
import ConnectionConfig from "@/components/ConnectionConfig.vue";
import SessionTree from "@/components/SessionTree.vue";
import SubagentDetail from "@/components/SubagentDetail.vue";
import ToastHost from "@/components/ToastHost.vue";

const store = useSessionStore();
const { connectAll, disconnectAll } = useEventStream();
const { bootstrap } = useSessionBootstrap();
const { scan } = useInstanceScanner();
const { startWatching, stopWatching } = useStuckDetection();

// ── Titlebar window controls ──────────────────────────────────────────

const appWindow = getCurrentWindow();
const isMaximized = ref(false);

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
  let discovered: Awaited<ReturnType<typeof scan>>;
  try {
    discovered = await scan();
  } catch (err) {
    console.error("[App] scan failed", err);
    scanNotice.value = err instanceof Error ? err.message : "Scan failed";
    disconnectAll();
    return;
  }

  const urls = discovered.map((i) => i.url);

  if (urls.length === 0) {
    // No servers up — close everything down so the UI reflects truth.
    disconnectAll();
    return;
  }

  try {
    await bootstrap(urls);
  } catch (err) {
    console.error("[App] bootstrap failed", err);
    bootstrapError.value =
      err instanceof Error ? err.message : "Bootstrap failed";
  }

  connectAll(urls);
}

onMounted(async () => {
  isMaximized.value = await appWindow.isMaximized();

  // Read --cwd CLI arg (passed by Zed task: --cwd $ZED_WORKTREE_ROOT).
  try {
    const args = await invoke<string[]>("get_cli_args");
    console.log("[App] CLI args =", args);
    const cwdIdx = args.indexOf("--cwd");
    if (cwdIdx !== -1 && args[cwdIdx + 1]) {
      store.cwdFilter = args[cwdIdx + 1];
      console.log("[App] cwdFilter set to =", store.cwdFilter);
    } else {
      console.log("[App] no --cwd arg, cwdFilter =", store.cwdFilter);
    }
  } catch {
    // CLI args not available — show all sessions
    console.log("[App] get_cli_args failed, cwdFilter =", store.cwdFilter);
  }

  // Initial scan → bootstrap → connect.
  await orchestrate();
  startWatching();
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
      <main class="main-pane">
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
