<script setup lang="ts">
import { ref, watch } from 'vue'

const props = withDefaults(defineProps<{
  modelValue: unknown
  readonly?: boolean
}>(), {
  readonly: false,
})

const emit = defineEmits<{
  'update:modelValue': [value: unknown]
  'dirty': []
}>()

const text = ref('')
const error = ref('')
const isFocused = ref(false)

// Sync incoming value to text
watch(() => props.modelValue, (val) => {
  if (!isFocused.value) {
    try {
      text.value = JSON.stringify(val, null, 2)
    } catch {
      text.value = String(val)
    }
  }
}, { immediate: true })

function handleBlur() {
  isFocused.value = false
  if (props.readonly) return
  try {
    const parsed = text.value.trim() ? JSON.parse(text.value) : undefined
    error.value = ''
    emit('update:modelValue', parsed)
    emit('dirty')
  } catch (e) {
    error.value = `Invalid JSON: ${e instanceof Error ? e.message : String(e)}`
  }
}

function handleFocus() {
  isFocused.value = true
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Tab') {
    e.preventDefault()
    const textarea = e.target as HTMLTextAreaElement
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    text.value = text.value.substring(0, start) + '  ' + text.value.substring(end)
    // Restore cursor position after Vue updates
    requestAnimationFrame(() => {
      textarea.selectionStart = textarea.selectionEnd = start + 2
    })
  }
}
</script>

<template>
  <div class="json-editor">
    <textarea
      v-model="text"
      class="json-textarea"
      :readonly="readonly"
      spellcheck="false"
      @blur="handleBlur"
      @focus="handleFocus"
      @keydown="handleKeydown"
    />
    <div v-if="error" class="json-error">{{ error }}</div>
  </div>
</template>

<style scoped>
.json-editor {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
}

.json-textarea {
  width: 100%;
  min-height: 120px;
  padding: var(--space-6) var(--space-8);
  background: var(--code-block-bg);
  border: 1px solid var(--border-variant);
  border-radius: var(--radius-xs);
  color: var(--text-primary);
  font-family: var(--font-mono);
  font-size: var(--font-size-code);
  line-height: 1.5;
  outline: none;
  resize: vertical;
}

.json-textarea:focus {
  border-color: var(--border-focused);
}

.json-textarea[readonly] {
  opacity: 0.7;
}

.json-error {
  font-size: var(--font-size-small);
  color: var(--error);
  padding: var(--space-6) var(--space-8);
  background: rgba(217, 87, 87, 0.1);
  border-radius: var(--radius-xs);
}
</style>
