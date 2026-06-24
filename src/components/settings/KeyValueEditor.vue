<script setup lang="ts">
import { ref } from 'vue'
import { X, Plus } from 'lucide-vue-next'

const props = withDefaults(defineProps<{
  modelValue: Record<string, string>
  secretKeys?: string[]
}>(), {
  secretKeys: () => [],
})

const emit = defineEmits<{
  'update:modelValue': [value: Record<string, string>]
  'dirty': []
}>()

const newKey = ref('')
const newValue = ref('')
const showSecrets = ref<Set<string>>(new Set())

function toggleSecret(key: string) {
  if (showSecrets.value.has(key)) {
    showSecrets.value.delete(key)
  } else {
    showSecrets.value.add(key)
  }
}

function isSecretKey(key: string): boolean {
  if (props.secretKeys.includes(key)) return true
  return /(_TOKEN|_KEY|_SECRET|_PASSWORD|AUTHORIZATION)/i.test(key)
}

function addEntry() {
  const key = newKey.value.trim()
  const value = newValue.value.trim()
  if (!key) return
  emit('update:modelValue', { ...props.modelValue, [key]: value })
  emit('dirty')
  newKey.value = ''
  newValue.value = ''
}

function removeEntry(key: string) {
  const updated = { ...props.modelValue }
  delete updated[key]
  emit('update:modelValue', updated)
  emit('dirty')
}
</script>

<template>
  <div class="kv-editor">
    <div v-for="(value, key) in modelValue" :key="key" class="kv-row">
      <span class="kv-key">{{ key }}</span>
      <span class="kv-value" :class="{ secret: isSecretKey(String(key)) }">
        {{ isSecretKey(String(key)) && !showSecrets.has(String(key)) ? '••••••••' : value }}
      </span>
      <button v-if="isSecretKey(String(key))" class="kv-toggle" @click="toggleSecret(String(key))">
        {{ showSecrets.has(String(key)) ? 'hide' : 'show' }}
      </button>
      <button class="kv-remove" @click="removeEntry(String(key))">
        <X :size="10" />
      </button>
    </div>
    <div class="kv-add">
      <input v-model="newKey" class="kv-input" placeholder="key" />
      <input v-model="newValue" class="kv-input" placeholder="value" />
      <button class="kv-add-btn" @click="addEntry">
        <Plus :size="10" /> Add
      </button>
    </div>
  </div>
</template>

<style scoped>
.kv-editor {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.kv-row {
  display: flex;
  align-items: center;
  gap: var(--space-6);
  padding: 2px var(--space-6);
  background: var(--bg-element);
  border-radius: var(--radius-xs);
}

.kv-key {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--text-muted);
  min-width: 80px;
}

.kv-value {
  flex: 1;
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--text-primary);
}

.kv-value.secret { color: var(--warning); }

.kv-toggle, .kv-remove {
  border: none;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 10px;
  padding: 2px 4px;
  border-radius: var(--radius-xs);
}

.kv-toggle:hover, .kv-remove:hover { color: var(--text-primary); background: var(--bg-hover); }
.kv-remove:hover { color: var(--error); }

.kv-add {
  display: flex;
  gap: var(--space-6);
  margin-top: var(--space-6);
}

.kv-input {
  flex: 1;
  padding: 2px var(--space-6);
  background: var(--bg-element);
  border: 1px solid var(--border-variant);
  border-radius: var(--radius-xs);
  color: var(--text-primary);
  font-family: var(--font-mono);
  font-size: 10px;
  outline: none;
}

.kv-input:focus { border-color: var(--border-focused); }

.kv-add-btn {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 2px var(--space-6);
  background: transparent;
  border: 1px solid var(--border-variant);
  border-radius: var(--radius-xs);
  color: var(--text-accent);
  cursor: pointer;
  font-size: var(--font-size-small);
}

.kv-add-btn:hover { background: var(--bg-hover); }
</style>
