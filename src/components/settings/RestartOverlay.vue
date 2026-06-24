<script setup lang="ts">
import { computed } from 'vue'
import { Loader2, CheckCircle2, XCircle, RotateCw, CornerUpLeft } from 'lucide-vue-next'
import { useConfigStore } from '@/stores/config'

const configStore = useConfigStore()

const elapsedSeconds = computed(() => (configStore.restartElapsed / 1000).toFixed(1))

const isVisible = computed(() => {
  return configStore.phase === 'saving' || configStore.phase === 'restarting' || configStore.phase === 'timeout'
})

const state = computed(() => {
  if (configStore.phase === 'saving') return 'saving'
  if (configStore.phase === 'restarting') return configStore.restartConfirmed ? 'done' : 'restarting'
  if (configStore.phase === 'timeout') return 'timeout'
  return 'hidden'
})
</script>

<template>
  <Transition name="banner">
    <div v-if="isVisible" class="restart-banner" :class="state">
      <!-- Saving state -->
      <template v-if="state === 'saving'">
        <Loader2 :size="14" class="animate-spin" />
        <span>Saving...</span>
      </template>

      <!-- Restarting state -->
      <template v-else-if="state === 'restarting'">
        <Loader2 :size="14" class="animate-spin" />
        <span>重启中 {{ elapsedSeconds }}s…</span>
      </template>

      <!-- Done state -->
      <template v-else-if="state === 'done'">
        <CheckCircle2 :size="14" />
        <span>已保存 · OpenCode 已重启 · {{ elapsedSeconds }}s</span>
      </template>

      <!-- Timeout state -->
      <template v-else-if="state === 'timeout'">
        <XCircle :size="14" />
        <span>重启超时（90 秒无进展）</span>
        <div class="timeout-actions">
          <button class="btn-action" @click="configStore.retryDetection()">
            <RotateCw :size="11" /> 重试检测
          </button>
          <button class="btn-action" @click="configStore.resetToSavedAfterTimeout()">
            <CornerUpLeft :size="11" /> 恢复
          </button>
        </div>
      </template>
    </div>
  </Transition>
</template>

<style scoped>
.restart-banner {
  display: flex;
  align-items: center;
  gap: var(--space-6);
  padding: var(--space-6) var(--space-12);
  background: var(--bg-elevated);
  border-bottom: 1px solid var(--border-variant);
  font-size: var(--font-size-ui);
  color: var(--text-primary);
}

.restart-banner.restarting {
  border-left: 2px solid var(--text-accent);
}

.restart-banner.done {
  border-left: 2px solid var(--success);
  color: var(--text-primary);
}

.restart-banner.timeout {
  border-left: 2px solid var(--error);
}

.animate-spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.timeout-actions {
  display: flex;
  gap: var(--space-6);
  margin-left: auto;
}

.btn-action {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px var(--space-6);
  background: transparent;
  border: 1px solid var(--border-variant);
  border-radius: var(--radius-xs);
  color: var(--text-muted);
  font-family: var(--font-ui);
  font-size: var(--font-size-small);
  cursor: pointer;
}

.btn-action:hover {
  color: var(--text-primary);
  background: var(--bg-hover);
}

/* ── Banner transition ────────────────────────────────────────────────── */
.banner-enter-active,
.banner-leave-active {
  transition: opacity var(--duration-fast) ease, max-height var(--duration-fast) ease;
  overflow: hidden;
}

.banner-enter-from,
.banner-leave-to {
  opacity: 0;
  max-height: 0;
}
</style>
