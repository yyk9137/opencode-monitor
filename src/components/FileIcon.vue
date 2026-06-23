<template>
  <img
    v-if="iconName"
    :src="iconSrc"
    :alt="fileName"
    class="file-icon"
    :width="size"
    :height="size"
  />
  <LucideFileIcon v-else :size="size" class="file-icon file-icon--fallback" />
</template>

<script setup lang="ts">
import { computed } from 'vue'
// ⚠️ Must alias: component name is FileIcon, direct import would self-reference → recursive render
import { FileIcon as LucideFileIcon } from 'lucide-vue-next'
import { fileIconMap } from '@/assets/icons/file-icon-map'

const props = defineProps<{ fileName: string; size?: number }>()
const size = computed(() => props.size ?? 16)

const iconName = computed(() => {
  const ext = props.fileName.split('.').pop()?.toLowerCase()
  return ext ? fileIconMap[ext] : null
})

const iconSrc = computed(() =>
  iconName.value
    ? new URL(`../assets/icons/file-icons/${iconName.value}.svg`, import.meta.url).href
    : undefined
)
</script>

<style scoped>
.file-icon {
  flex-shrink: 0;
  filter: saturate(0.92) brightness(0.96);
  /* Catppuccin mocha icons tuned for #1E1E2E; ayu night surfaces are darker (#0D1017~#141821).
     This filter reduces saturation+brightness to blend better with ayu's cooler palette. */
}

.file-icon--fallback {
  color: var(--text-muted);
}
</style>
