<script setup lang="ts">
import { ref } from 'vue'
import { X } from 'lucide-vue-next'

const props = withDefaults(defineProps<{
  modelValue: string[]
  placeholder?: string
}>(), {
  placeholder: 'Add...',
})

const emit = defineEmits<{
  'update:modelValue': [value: string[]]
  'dirty': [path: string]
}>()

const input = ref('')

function addTag() {
  const value = input.value.trim()
  if (!value) return
  if (props.modelValue.includes(value)) return // dedup
  emit('update:modelValue', [...props.modelValue, value])
  emit('dirty', '')
  input.value = ''
}

function removeTag(index: number) {
  const updated = [...props.modelValue]
  updated.splice(index, 1)
  emit('update:modelValue', updated)
  emit('dirty', '')
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter') {
    e.preventDefault()
    addTag()
  } else if (e.key === 'Backspace' && input.value === '' && props.modelValue.length > 0) {
    removeTag(props.modelValue.length - 1)
  }
}
</script>

<template>
  <div class="tag-input">
    <div class="tags-list">
      <span v-for="(tag, i) in modelValue" :key="i" class="tag">
        {{ tag }}
        <button class="tag-remove" @click="removeTag(i)">
          <X :size="10" />
        </button>
      </span>
    </div>
    <input
      v-model="input"
      class="tag-field"
      type="text"
      :placeholder="placeholder"
      @keydown="handleKeydown"
    >
  </div>
</template>

<style scoped>
.tag-input {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  padding: 4px var(--space-6);
  background: var(--bg-element);
  border: 1px solid var(--border-variant);
  border-radius: var(--radius-xs);
  min-height: 28px;
}

.tags-list {
  display: contents;
}

.tag {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 2px 4px 2px 6px;
  background: var(--bg-hover);
  border-radius: var(--radius-xs);
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--text-primary);
}

.tag-remove {
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  padding: 0;
  border-radius: var(--radius-xs);
}

.tag-remove:hover {
  color: var(--error);
}

.tag-field {
  flex: 1;
  min-width: 80px;
  border: none;
  background: transparent;
  color: var(--text-primary);
  font-family: var(--font-ui);
  font-size: var(--font-size-ui);
  outline: none;
}
</style>
