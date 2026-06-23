<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch, nextTick } from 'vue'
import { ChevronDown, Send, Loader2, CheckCircle2 } from 'lucide-vue-next'
import { useSessionStore } from '@/stores/session'
import { usePromptSender } from '@/composables/usePromptSender'
import type { SessionNode } from '@/types'

const store = useSessionStore()
const { sendPrompt } = usePromptSender()

// ── Target selection ──────────────────────────────────────────────────

const targetId = ref<string | null>(null)

watch(
  () => store.activeTabId,
  (id) => {
    if (id && !targetId.value) targetId.value = id
  },
  { immediate: true },
)

const targetNode = computed<SessionNode | null>(() => {
  if (!targetId.value) return null
  return store.sessions.get(targetId.value) ?? null
})

const targetIsRunning = computed<boolean>(() => {
  return targetNode.value?.inferredState === 'running'
})

const targetLabel = computed<string>(() => {
  const node = targetNode.value
  if (!node) return 'Select session…'
  return node.title || node.agent || node.id.slice(0, 8)
})

const disableReason = computed<string>(() => {
  if (!targetId.value) return 'Pick a session to send to'
  if (targetIsRunning.value) return 'Session is currently running'
  return ''
})

// Options for the selector — same grouping as the tree, but flat rows.
const options = computed<SessionNode[]>(() => {
  return store.tree.flatMap((parent) => [parent, ...parent.children])
})

const dropdownOpen = ref(false)
const dropdownEl = ref<HTMLElement | null>(null)

function toggleDropdown(): void {
  if (dropdownOpen.value) {
    dropdownOpen.value = false
  } else {
    dropdownOpen.value = true
    nextTick(() => focusFirstOption())
  }
}

function closeDropdown(): void {
  dropdownOpen.value = false
}

function onClickOutside(event: MouseEvent): void {
  if (!dropdownOpen.value) return
  const target = event.target as Node | null
  if (dropdownEl.value && target && !dropdownEl.value.contains(target)) {
    closeDropdown()
  }
}

onMounted(() => document.addEventListener('mousedown', onClickOutside))
onBeforeUnmount(() => document.removeEventListener('mousedown', onClickOutside))

function selectOption(id: string): void {
  // Group header rows are not selectable.
  targetId.value = id
  closeDropdown()
  focusInput()
}

function focusInput(): void {
  inputEl.value?.focus()
}

function focusFirstOption(): void {
  const first = dropdownEl.value?.querySelector<HTMLElement>('.option-row:not(.disabled)')
  first?.focus()
}

// Keyboard support for the dropdown.
function onDropdownKeydown(event: KeyboardEvent): void {
  if (!dropdownOpen.value) return
  if (event.key === 'Escape') {
    event.preventDefault()
    closeDropdown()
    focusInput()
  }
}

// ── Send flow ──────────────────────────────────────────────────────────

const promptText = ref('')
const inputEl = ref<HTMLTextAreaElement | null>(null)
const sending = ref(false)
const lastSentText = ref('')
const lastError = ref('')

const canSend = computed<boolean>(() => {
  return (
    !sending.value &&
    !targetIsRunning.value &&
    !!targetId.value &&
    promptText.value.trim().length > 0
  )
})

async function send(): Promise<void> {
  if (!canSend.value || !targetId.value) return
  const text = promptText.value
  sending.value = true
  lastError.value = ''
  try {
    await sendPrompt(targetId.value, text)
    lastSentText.value = text
    promptText.value = ''
  } catch (err) {
    lastError.value = err instanceof Error ? err.message : String(err)
  } finally {
    sending.value = false
    focusInput()
  }
}

function onInputKeydown(event: KeyboardEvent): void {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    void send()
  }
}

function autoResize(event: Event): void {
  const el = event.target as HTMLTextAreaElement
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight, 140)}px`
}
</script>

<template>
  <section class="prompt-bar">
    <!-- ─── Target selector row ──────────────────────────────── -->
    <div class="target-row">
      <label class="target-label">Send to</label>
      <div ref="dropdownEl" class="selector" :class="{ open: dropdownOpen }">
        <button
          type="button"
          class="selector-trigger"
          :aria-expanded="dropdownOpen"
          @click="toggleDropdown"
        >
          <span class="selector-name">{{ targetLabel }}</span>
          <span v-if="targetNode" class="selector-agent">
            {{ targetNode.agent }}
          </span>
          <span v-if="targetIsRunning" class="selector-badge">
            <Loader2 :size="10" class="spin" /> running
          </span>
          <ChevronDown :size="12" class="selector-chevron" />
        </button>

        <div
          v-show="dropdownOpen"
          class="selector-menu"
          @keydown="onDropdownKeydown"
        >
          <ul class="option-list">
            <li
              v-for="option in options"
              :key="option.id"
              class="option-li"
            >
              <button
                type="button"
                class="option-row"
                :class="{
                  selected: targetId === option.id,
                  child: option.parentID !== null,
                  disabled: option.inferredState === 'running',
                }"
                @click="selectOption(option.id)"
              >
                <span class="option-status" :data-state="option.inferredState" />
                <span class="option-name">{{ option.title || option.agent || option.id.slice(0, 8) }}</span>
                <span class="option-agent">{{ option.agent }}</span>
                <span v-if="option.inferredState === 'running'" class="option-badge">
                  <Loader2 :size="10" class="spin" /> running
                </span>
                <span v-else-if="option.inferredState === 'completed'" class="option-badge done">
                  <CheckCircle2 :size="10" /> idle
                </span>
              </button>
            </li>
          </ul>
          <p class="option-empty" v-if="options.length === 0">
            No sessions available yet.
          </p>
        </div>
      </div>
    </div>

    <!-- ─── Prompt input + send ──────────────────────────────── -->
    <form class="prompt-row" @submit.prevent="send">
      <textarea
        ref="inputEl"
        v-model="promptText"
        class="prompt-input"
        rows="1"
        spellcheck="false"
        :placeholder="disableReason || 'Type a prompt. Press Enter to send, Shift+Enter for newline.'"
        :disabled="sending"
        @keydown="onInputKeydown"
        @input="autoResize"
      />
      <button
        type="submit"
        class="send-btn"
        :disabled="!canSend"
        :title="disableReason || 'Send'"
      >
        <Loader2 v-if="sending" :size="14" class="spin" />
        <Send v-else :size="14" />
      </button>
    </form>

    <!-- ─── Footer status line ──────────────────────────────── -->
    <footer class="prompt-footer">
      <span v-if="lastError" class="prompt-error">{{ lastError }}</span>
      <span v-else-if="lastSentText" class="prompt-success">
        Sent · {{ lastSentText.length }} chars
      </span>
      <span v-else class="prompt-hint muted small">
        {{ store.connectionStatus === 'connected' ? 'streaming events' : 'not connected' }}
        <span class="dot-sep">·</span>
        {{ disableReason || 'ready' }}
      </span>
    </footer>
  </section>
</template>

<style scoped>
.prompt-bar {
  display: flex;
  flex-direction: column;
  background: var(--bg-app);
  border-top: 1px solid var(--border);
  flex-shrink: 0;
  padding: var(--space-12) var(--space-16) var(--space-16);
  gap: var(--space-8);
}

/* ── Target row ──────────────────────────────────────────────────────── */

.target-row {
  display: flex;
  align-items: center;
  gap: var(--space-12);
}

.target-label {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-muted);
  flex-shrink: 0;
}

.selector {
  position: relative;
  flex: 1;
  min-width: 0;
}

.selector-trigger {
  display: flex;
  align-items: center;
  gap: var(--space-8);
  width: 100%;
  padding: var(--space-6) var(--space-12);
  background: var(--bg-element);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  font-family: var(--font-ui);
  font-size: var(--font-size-ui);
  cursor: pointer;
  text-align: left;
  transition:
    background var(--duration-fast) var(--ease-out-quint),
    border-color var(--duration-fast) var(--ease-out-quint);
}

.selector-trigger:hover {
  background: var(--bg-hover);
  border-color: var(--border-focused);
}

.selector.open .selector-trigger {
  border-color: var(--border-focused);
}

.selector-name {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-weight: 500;
}

.selector-agent {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--text-placeholder);
  padding: 1px var(--space-4);
  background: var(--bg-app);
  border-radius: var(--radius-xs);
  text-transform: lowercase;
}

.selector-badge {
  display: inline-flex;
  align-items: center;
  gap: var(--space-4);
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--success);
  padding: 1px var(--space-6);
  background: rgba(170, 217, 76, 0.10);
  border-radius: var(--radius-xs);
  text-transform: lowercase;
}

.selector-chevron {
  color: var(--text-placeholder);
  transition: transform var(--duration-fast) var(--ease-out-quint);
}

.selector.open .selector-chevron {
  transform: rotate(180deg);
}

/* ── Dropdown menu ───────────────────────────────────────────────────── */

.selector-menu {
  position: absolute;
  bottom: calc(100% + var(--space-4));
  left: 0;
  right: 0;
  max-height: 280px;
  overflow-y: auto;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  box-shadow: 0 4px 18px rgba(0, 0, 0, 0.30);
  z-index: 50;
  padding: var(--space-4);
  animation: menu-pop var(--duration-fast) var(--ease-out-quint);
}

.option-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.option-li { display: block; }

.option-row {
  display: grid;
  grid-template-columns: 10px 1fr auto auto;
  align-items: center;
  gap: var(--space-8);
  width: 100%;
  padding: var(--space-6) var(--space-8);
  background: transparent;
  border: none;
  border-radius: var(--radius-xs);
  color: var(--text-primary);
  font-family: var(--font-ui);
  font-size: var(--font-size-ui);
  text-align: left;
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-out-quint);
}

.option-row:hover:not(.disabled),
.option-row:focus-visible:not(.disabled) {
  background: var(--bg-hover);
  outline: none;
}

.option-row.selected {
  background: var(--bg-selected);
}

.option-row.child {
  padding-left: var(--space-24);
}

.option-row.disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.option-status {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--text-placeholder);
}

.option-status[data-state='running']  { background: var(--success); }
.option-status[data-state='completed'] { background: var(--success); }
.option-status[data-state='error']    { background: var(--error); }
.option-status[data-state='unknown']  { background: var(--text-placeholder); }

.option-name {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.option-agent {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--text-placeholder);
  text-transform: lowercase;
}

.option-badge {
  display: inline-flex;
  align-items: center;
  gap: var(--space-4);
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--warning);
  text-transform: lowercase;
}

.option-badge.done {
  color: var(--text-muted);
}

.option-empty {
  padding: var(--space-8);
  font-size: var(--font-size-small);
  color: var(--text-placeholder);
  text-align: center;
}

.spin {
  animation: spin 1s linear infinite;
}

/* ── Prompt row ──────────────────────────────────────────────────────── */

.prompt-row {
  display: flex;
  align-items: stretch;
  gap: var(--space-8);
}

.prompt-input {
  flex: 1;
  resize: none;
  padding: var(--space-8) var(--space-12);
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  background: var(--bg-element);
  color: var(--text-primary);
  font-family: var(--font-mono);
  font-size: var(--font-size-code);
  line-height: 1.5;
  outline: none;
  min-height: 32px;
  max-height: 140px;
  transition:
    border-color var(--duration-fast) var(--ease-out-quint),
    background var(--duration-fast) var(--ease-out-quint);
}

.prompt-input::placeholder {
  color: var(--text-placeholder);
  font-family: var(--font-ui);
  font-size: var(--font-size-ui);
}

.prompt-input:hover {
  border-color: var(--border-focused);
}

.prompt-input:focus {
  border-color: var(--border-focused);
  background: var(--bg-editor);
  box-shadow: 0 0 0 1px var(--border-focused);
}

.prompt-input:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.send-btn {
  width: 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--text-accent);
  color: var(--bg-editor);
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition:
    background var(--duration-fast) var(--ease-out-quint),
    transform var(--duration-fast) var(--ease-out-quint);
  flex-shrink: 0;
}

.send-btn:hover:not(:disabled) {
  background: color-mix(in srgb, var(--text-accent) 88%, white);
}

.send-btn:active:not(:disabled) {
  transform: scale(0.95);
}

.send-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
  background: var(--bg-element);
  color: var(--text-placeholder);
  border-color: var(--border);
}

/* ── Footer status ───────────────────────────────────────────────────── */

.prompt-footer {
  font-family: var(--font-mono);
  font-size: 10px;
  min-height: 14px;
  letter-spacing: 0.03em;
}

.prompt-error {
  color: var(--error);
}

.prompt-success {
  color: var(--success);
}

.prompt-hint {
  color: var(--text-placeholder);
}

.dot-sep {
  margin: 0 var(--space-6);
  color: var(--text-placeholder);
}

/* ── Animations ──────────────────────────────────────────────────────── */

@keyframes menu-pop {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to   { transform: rotate(360deg); }
}
</style>
