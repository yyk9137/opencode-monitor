<script setup lang="ts">
import { X } from 'lucide-vue-next'
import { useToast } from '@/composables/useToast'

const { toasts, dismiss } = useToast()
</script>

<template>
  <div class="toast-host" role="region" aria-label="Notifications">
    <TransitionGroup name="toast">
      <div
        v-for="t in toasts"
        :key="t.id"
        class="toast"
        :data-tone="t.type"
        role="alert"
      >
        <span class="toast-message">{{ t.message }}</span>
        <button
          type="button"
          class="toast-close"
          aria-label="Dismiss"
          @click="dismiss(t.id)"
        >
          <X :size="12" />
        </button>
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.toast-host {
  position: fixed;
  right: var(--space-24, 24px);
  bottom: var(--space-24, 24px);
  z-index: 9999;
  display: flex;
  flex-direction: column-reverse;
  gap: var(--space-8, 8px);
  pointer-events: none;
}

.toast {
  display: flex;
  align-items: center;
  gap: var(--space-12, 12px);
  padding: var(--space-8, 8px) var(--space-12, 12px);
  background: var(--bg-elevated, #11151c);
  border: 1px solid var(--border, #1d2433);
  border-radius: var(--radius-sm, 4px);
  font-family: var(--font-ui);
  font-size: var(--font-size-small);
  color: var(--text-primary, #e6e1cf);
  box-shadow:
    0 1px 0 rgba(0, 0, 0, 0.4),
    0 8px 24px rgba(0, 0, 0, 0.4);
  pointer-events: auto;
  min-width: 200px;
  max-width: 400px;
}

.toast[data-tone='success'] {
  border-left: 2px solid var(--success, #7fd962);
}

.toast[data-tone='error'] {
  border-left: 2px solid var(--error, #e26b73);
}

.toast[data-tone='info'] {
  border-left: 2px solid var(--info, #59c2ff);
}

.toast-message {
  flex: 1;
  user-select: none;
}

.toast-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  background: transparent;
  border: none;
  border-radius: var(--radius-xs, 2px);
  color: var(--text-muted, #8d939e);
  cursor: pointer;
  flex-shrink: 0;
  transition: color var(--duration-fast, 150ms) var(--ease-out-quint, cubic-bezier(0.22, 1, 0.36, 1));
}

.toast-close:hover {
  color: var(--text-primary, #e6e1cf);
}

/* Enter/leave transitions */
.toast-enter-active,
.toast-leave-active {
  transition: all var(--duration-slow, 300ms) var(--ease-out-quint, cubic-bezier(0.22, 1, 0.36, 1));
}

.toast-enter-from {
  opacity: 0;
  transform: translateY(8px);
}

.toast-leave-to {
  opacity: 0;
  transform: translateX(100%);
}

.toast-move {
  transition: transform var(--duration-fast, 150ms) var(--ease-out-quint, cubic-bezier(0.22, 1, 0.36, 1));
}
</style>
