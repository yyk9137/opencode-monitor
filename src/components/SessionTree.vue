<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  ChevronRight,
  ChevronDown,
  Terminal,
} from 'lucide-vue-next'
import { useSessionStore } from '@/stores/session'
import type { SessionNode } from '@/types'

const store = useSessionStore()

// ── Group top-level sessions by directory ──────────────────────────────
// Only show top-level sessions (parentID === null). Child sessions are
// accessible through subagent cards in the parent session's message stream.

const groupedTree = computed<{ directory: string; sessions: SessionNode[] }[]>(() => {
  const groups = new Map<string, SessionNode[]>()
  for (const session of store.tree) {
    const list = groups.get(session.directory) ?? []
    list.push(session)
    groups.set(session.directory, list)
  }

  return Array.from(groups.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([directory, sessions]) => ({
      directory,
      sessions: sessions.sort((a, b) => a.title.localeCompare(b.title)),
    }))
})

// ── Expand state ───────────────────────────────────────────────────────

const expandedDirs = ref<Set<string>>(new Set())

function toggleDir(directory: string): void {
  // Reassign to trigger reactivity on Set mutations.
  const next = new Set(expandedDirs.value)
  if (next.has(directory)) next.delete(directory)
  else next.add(directory)
  expandedDirs.value = next
}

function isDirExpanded(directory: string): boolean {
  return expandedDirs.value.has(directory)
}

// Default-open everything on first render so the monitor immediately conveys state.
onMounted(() => {
  // Auto-expand all directories on first render
  const dirs = new Set<string>()
  for (const group of groupedTree.value) {
    if (group.sessions.length > 0) dirs.add(group.directory)
  }
  expandedDirs.value = dirs
})

// ── Selection ──────────────────────────────────────────────────────────

function openSessionTab(sessionId: string): void {
  // Browser-tab model: clicking a tree node always opens a tab. The
  // tree's "selected" highlight is `activeTabId` — the currently-
  // visible tab. No separate `selectedSessionId` exists.
  void store.openTab(sessionId)
}

// ── Display helpers ────────────────────────────────────────────────────

function directoryBasename(directory: string): string {
  // Trim trailing separator and grab last segment; tolerate mixed slashes.
  const trimmed = directory.replace(/[\\/]+$/, '')
  const parts = trimmed.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? directory
}

const stuckIds = computed(() => new Set(store.stuckAlerts.map(a => a.sessionID)))

function statusGlyph(session: SessionNode): 'running' | 'completed' | 'error' | 'stuck' | 'unknown' {
  if (stuckIds.value.has(session.id)) return 'stuck'
  return session.inferredState
}

</script>

<template>
  <nav class="session-tree" aria-label="Sessions">
    <header class="tree-header">
      <span class="tree-title">Sessions</span>
      <span class="tree-count">{{ store.tree.length }}</span>
      <span v-if="store.stuckAlerts.length > 0" class="stuck-badge">
        {{ store.stuckAlerts.length }}
      </span>
    </header>

    <div v-if="groupedTree.length === 0" class="empty-state">
      <p class="empty-title">No sessions yet</p>
      <p class="empty-hint">
        Connect to an OpenCode endpoint above<br>or wait for events to arrive.
      </p>
    </div>

    <ul v-else class="group-stack" role="tree">
      <li v-for="group in groupedTree" :key="group.directory" class="group">
        <button
          type="button"
          class="group-header"
          :aria-expanded="isDirExpanded(group.directory)"
          @click="toggleDir(group.directory)"
        >
          <component
            :is="isDirExpanded(group.directory) ? ChevronDown : ChevronRight"
            :size="12"
            class="group-chevron"
          />
          <span class="group-name" :title="group.directory">
            {{ directoryBasename(group.directory) }}
          </span>
          <span class="group-meta">{{ group.sessions.length }}</span>
        </button>

        <ul
          v-show="isDirExpanded(group.directory)"
          class="session-list"
          role="group"
        >
          <li
            v-for="session in group.sessions"
            :key="session.id"
            class="session-row"
          >
            <div class="session-entry">
              <button
                type="button"
                class="session-button"
                :class="{ selected: store.activeTabId === session.id }"
                @click="openSessionTab(session.id)"
              >
                <span
                  class="status-dot"
                  :data-state="statusGlyph(session)"
                  :aria-label="session.inferredState"
                />
                <Terminal :size="12" class="agent-icon" />
                <span class="session-title" :title="session.title">
                  {{ session.title }}
                </span>
                <span
                  v-if="session.children.length > 0"
                  class="child-count clickable"
                  role="button"
                  tabindex="0"
                  :title="`${session.children.length} subagents — click to view list`"
                  @click.stop="store.openChildList(session.id)"
                  @keydown.enter.stop="store.openChildList(session.id)"
                >
                  {{ session.children.length }}
                </span>
              </button>
            </div>
          </li>
        </ul>
      </li>
    </ul>
  </nav>
</template>

<style scoped>
.session-tree {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  background: var(--bg-panel);
}

/* ── Header strip ───────────────────────────────────────────────────── */

.tree-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-8) var(--space-12);
  border-bottom: 1px solid var(--border-variant);
  flex-shrink: 0;
}

.tree-title {
  font-size: var(--font-size-small);
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.tree-count {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--text-placeholder);
  background: var(--bg-element);
  padding: 1px var(--space-6);
  border-radius: var(--radius-xs);
  min-width: 18px;
  text-align: center;
}

.stuck-badge {
  display: inline-flex;
  align-items: center;
  padding: 0 var(--space-5);
  background: var(--warning);
  color: var(--bg-panel);
  border-radius: var(--radius-xs);
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 700;
  line-height: 1.3;
  height: 16px;
}

/* ── Empty state ────────────────────────────────────────────────────── */

.empty-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: var(--space-24) var(--space-12);
  text-align: center;
}

.empty-title {
  font-size: var(--font-size-ui);
  color: var(--text-muted);
  margin-bottom: var(--space-6);
}

.empty-hint {
  font-size: var(--font-size-small);
  color: var(--text-placeholder);
  line-height: 1.5;
}

/* ── Group / directory ──────────────────────────────────────────────── */

.group-stack,
.session-list,
.child-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.group {
  padding: var(--space-4) 0;
}

.group-header {
  display: flex;
  align-items: center;
  gap: var(--space-6);
  width: 100%;
  padding: var(--space-4) var(--space-12);
  background: transparent;
  border: none;
  color: var(--text-muted);
  font-family: var(--font-ui);
  font-size: var(--font-size-small);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-out-quint);
  text-align: left;
}

.group-header:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.group-chevron {
  flex-shrink: 0;
  color: var(--text-placeholder);
  transition: transform var(--duration-fast) var(--ease-out-quint);
}

.group-name {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.group-meta {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--text-placeholder);
  background: var(--bg-element);
  padding: 1px var(--space-4);
  border-radius: var(--radius-xs);
}

/* ── Session row ────────────────────────────────────────────────────── */

.session-row {
  padding: 1px 0;
}

.session-entry {
  position: relative;
}

.session-button {
  display: flex;
  align-items: center;
  gap: var(--space-8);
  width: 100%;
  padding: var(--space-6) var(--space-12);
  padding-left: var(--space-24);
  background: transparent;
  border: none;
  color: var(--text-primary);
  font-family: var(--font-ui);
  font-size: var(--font-size-ui);
  text-align: left;
  cursor: pointer;
  position: relative;
  transition:
    background var(--duration-fast) var(--ease-out-quint),
    color var(--duration-fast) var(--ease-out-quint);
}

.session-button::before {
  content: '';
  position: absolute;
  left: var(--space-12);
  top: 50%;
  transform: translateY(-50%);
  width: 2px;
  height: 0;
  background: transparent;
  border-radius: 1px;
  transition: height var(--duration-fast) var(--ease-out-quint);
}

.session-button:hover {
  background: var(--bg-hover);
}

.session-button.selected {
  background: var(--bg-selected);
  color: var(--text-primary);
}

.session-button.selected::before {
  height: 14px;
  background: var(--text-accent);
}

.agent-icon {
  flex-shrink: 0;
  color: var(--text-muted);
}

.session-button:hover .agent-icon,
.session-button.selected .agent-icon {
  color: var(--text-primary);
}

.session-title {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: var(--font-size-ui);
}

.child-count {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--text-placeholder);
  background: var(--bg-element);
  padding: 1px var(--space-4);
  border-radius: var(--radius-xs);
  flex-shrink: 0;
  transition: background var(--duration-fast) var(--ease-out-quint), color var(--duration-fast) var(--ease-out-quint);
}

.child-count.clickable {
  cursor: pointer;
}

.child-count.clickable:hover {
  background: var(--accent);
  color: var(--bg-panel);
}

/* ── Status dot ─────────────────────────────────────────────────────── */

.status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
  background: var(--text-placeholder);
  transition: background var(--duration-fast) var(--ease-out-quint);
}

.status-dot[data-state='running'] {
  background: var(--success);
  box-shadow: 0 0 0 1.5px rgba(161, 193, 129, 0.20);
  animation: pulse-dot 2.2s var(--ease-out-quint) infinite;
}

.status-dot[data-state='completed'] {
  display: none;
}

.status-dot[data-state='error'] {
  background: var(--error);
  box-shadow: 0 0 0 1.5px rgba(208, 114, 119, 0.18);
}

.status-dot[data-state='stuck'] {
  background: var(--warning);
  box-shadow: 0 0 0 1.5px rgba(222, 193, 132, 0.25);
  animation: pulse-dot-warning 1.4s var(--ease-out-quint) infinite;
}

.status-dot[data-state='unknown'] {
  background: var(--text-placeholder);
  opacity: 0.4;
}

@keyframes pulse-dot {
  0%, 100% {
    box-shadow: 0 0 0 1.5px rgba(161, 193, 129, 0.22);
    transform: scale(1);
  }
  50% {
    box-shadow: 0 0 0 4px rgba(161, 193, 129, 0.04);
    transform: scale(1.05);
  }
}

@keyframes pulse-dot-warning {
  0%, 100% {
    box-shadow: 0 0 0 1.5px rgba(222, 193, 132, 0.30);
    transform: scale(1);
  }
  50% {
    box-shadow: 0 0 0 6px rgba(222, 193, 132, 0.05);
    transform: scale(1.08);
  }
}
</style>
