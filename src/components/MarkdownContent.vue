<template>
  <div
    v-if="html"
    class="markdown-content"
    v-html="html"
  />
  <pre v-else>{{ text }}</pre>
</template>

<script setup lang="ts">
import { ref, watch, onBeforeUnmount } from 'vue'
import { useMarkdown } from '@/composables/useMarkdown'

const props = defineProps<{
  text: string
}>()

const { renderMarkdown, getCachedRender } = useMarkdown()
const html = ref<string>('')

// ── Debounce + stale-render cancellation ──────────────────────────
let debounceTimer: ReturnType<typeof setTimeout> | null = null
let renderGeneration = 0

function tryRender(text: string) {
  if (!text) {
    html.value = ''
    return
  }

  // Synchronous cache hit — instant, no debounce needed
  const cached = getCachedRender(text)
  if (cached !== undefined) {
    html.value = cached
    return
  }

  // Debounce: batch rapid streaming updates (150ms)
  const generation = ++renderGeneration
  if (debounceTimer !== null) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    debounceTimer = null
    if (generation !== renderGeneration) return
    try {
      html.value = renderMarkdown(text)
    } catch {
      html.value = ''
    }
  }, 150)
}

watch(() => props.text, (newText) => {
  tryRender(newText)
}, { immediate: true })

onBeforeUnmount(() => {
  if (debounceTimer !== null) clearTimeout(debounceTimer)
  renderGeneration++
})
</script>
