<script setup lang="ts">
import { computed } from 'vue'
import { Loader2 } from 'lucide-vue-next'
import { useConfigStore } from '@/stores/config'

const configStore = useConfigStore()

const props = defineProps<{
  title: string
  bodyLines: string[]
  onCancel: () => void
  onDiscard: () => void
  onSaveAndContinue: () => Promise<boolean>
  cancelLabel?: string
  discardLabel?: string
  saveLabel?: string
}>()

const isVisible = computed(() => configStore.pendingDismiss !== null)
const isSaving = ref(false)
const saveError = ref('')

import { ref } from 'vue'

// (reason field available in configStore.pendingDismiss for future copy customization)

async function handleSave() {
  isSaving.value = true
  saveError.value = ''
  try {
    const success = await props.onSaveAndContinue()
    if (success) {
      configStore.cancelDismiss()
    } else {
      saveError.value = '保存失败，请重试'
    }
  } catch (e) {
    saveError.value = String(e)
  } finally {
    isSaving.value = false
  }
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    props.onCancel()
  }
}
</script>

<template>
  <Transition name="dialog">
    <div
      v-if="isVisible"
      class="confirm-dialog-overlay"
      @keydown="handleKeydown"
    >
      <div
        class="confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        :aria-labelledby="'dialog-title'"
        :aria-describedby="'dialog-body'"
      >
        <h3 id="dialog-title" class="dialog-title">{{ title }}</h3>
        <div id="dialog-body" class="dialog-body">
          <p v-for="(line, i) in bodyLines" :key="i">{{ line }}</p>
        </div>

        <div v-if="saveError" class="dialog-error">
          {{ saveError }}
        </div>

        <div class="dialog-actions">
          <button
            class="btn-save"
            :disabled="isSaving || configStore.phase !== 'idle'"
            @click="handleSave"
          >
            <Loader2 v-if="isSaving" :size="12" class="animate-spin" />
            {{ saveLabel || '保存并重启' }}
          </button>
          <button
            class="btn-cancel"
            :disabled="isSaving"
            @click="onCancel"
          >
            {{ cancelLabel || '取消' }}
          </button>
          <button
            class="btn-discard"
            :disabled="isSaving"
            @click="onDiscard"
          >
            {{ discardLabel || '放弃更改' }}
          </button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.confirm-dialog-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.4);
  z-index: 70;
}

.confirm-dialog {
  min-width: 280px;
  max-width: 480px;
  background: var(--bg-app);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  box-shadow: 0 1px 0 rgba(0, 0, 0, 0.4), 0 8px 24px rgba(0, 0, 0, 0.4);
  padding: var(--space-16);
  display: flex;
  flex-direction: column;
  gap: var(--space-12);
}

.dialog-title {
  font-size: var(--font-size-ui);
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}

.dialog-body {
  font-size: var(--font-size-ui);
  color: var(--text-muted);
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
}

.dialog-body p {
  margin: 0;
}

.dialog-error {
  padding: var(--space-6) var(--space-8);
  background: rgba(217, 87, 87, 0.1);
  border-left: 2px solid var(--error);
  color: var(--error);
  font-size: var(--font-size-small);
  border-radius: var(--radius-xs);
}

.dialog-actions {
  display: flex;
  align-items: center;
  gap: var(--space-8);
  justify-content: flex-end;
}

.btn-save,
.btn-cancel,
.btn-discard {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px var(--space-12);
  border: none;
  border-radius: var(--radius-xs);
  font-family: var(--font-ui);
  font-size: var(--font-size-ui);
  cursor: pointer;
  transition: opacity var(--duration-fast) ease, background var(--duration-fast) ease;
}

.btn-save {
  background: var(--text-accent);
  color: var(--bg-editor);
  font-weight: 500;
}

.btn-save:hover:not(:disabled) {
  opacity: 0.9;
}

.btn-cancel {
  background: transparent;
  color: var(--text-muted);
}

.btn-cancel:hover:not(:disabled) {
  color: var(--text-primary);
  background: var(--bg-hover);
}

.btn-discard {
  background: transparent;
  border: 1px solid var(--error);
  color: var(--error);
}

.btn-discard:hover:not(:disabled) {
  background: rgba(217, 87, 87, 0.1);
}

.btn-save:disabled,
.btn-cancel:disabled,
.btn-discard:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.animate-spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* ── Dialog transition ────────────────────────────────────────────────── */
.dialog-enter-active,
.dialog-leave-active {
  transition: opacity var(--duration-fast) ease;
}

.dialog-enter-from,
.dialog-leave-to {
  opacity: 0;
}

@media (max-width: 900px) {
  .confirm-dialog {
    max-width: calc(100vw - 32px);
  }
}
</style>
