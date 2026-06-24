<script setup lang="ts">
import { computed } from 'vue'
import { useConfigStore } from '@/stores/config'
import TagInput from '../TagInput.vue'

const configStore = useConfigStore()

function updateField(field: string, value: unknown) {
  if (!configStore.draft) return
  ;(configStore.draft as Record<string, unknown>)[field] = value
  configStore.dirtyPaths.add(field)
}

const username = computed({
  get: () => configStore.draft?.username ?? '',
  set: (v: string) => updateField('username', v)
})
const logLevel = computed({
  get: () => configStore.draft?.logLevel ?? '',
  set: (v: string) => updateField('logLevel', v || undefined)
})
const shell = computed({
  get: () => configStore.draft?.shell ?? '',
  set: (v: string) => updateField('shell', v)
})
const instructions = computed({
  get: () => configStore.draft?.instructions ?? [],
  set: (v: string[]) => updateField('instructions', v)
})
const share = computed({
  get: () => configStore.draft?.share ?? '',
  set: (v: string) => updateField('share', v || undefined)
})
const autoupdate = computed({
  get: () => {
    const v = configStore.draft?.autoupdate
    if (v === true) return 'true'
    if (v === false) return 'false'
    if (v === 'notify') return 'notify'
    return ''
  },
  set: (v: string) => {
    const mapped = v === 'true' ? true : v === 'false' ? false : v === 'notify' ? 'notify' : undefined
    updateField('autoupdate', mapped)
  }
})
</script>

<template>
  <div class="section-content">
    <h2 class="section-title">General</h2>

    <div class="form-row">
      <label class="form-label">Username</label>
      <input v-model="username" type="text" class="form-input" placeholder="(uses system username)">
    </div>

    <div class="form-row">
      <label class="form-label">Log Level</label>
      <select v-model="logLevel" class="form-input">
        <option value="">(not set, defaults to INFO)</option>
        <option value="DEBUG">DEBUG</option>
        <option value="INFO">INFO</option>
        <option value="WARN">WARN</option>
        <option value="ERROR">ERROR</option>
      </select>
    </div>

    <div class="form-row">
      <label class="form-label">Shell</label>
      <input v-model="shell" type="text" class="form-input" placeholder="(system default)">
    </div>

    <div class="form-row">
      <label class="form-label">Instructions</label>
      <p class="form-hint">文件路径或 glob 模式（如 <code>./AGENTS.md</code> 或 <code>docs/**/*.md</code>）</p>
      <TagInput v-model="instructions" placeholder="Add path..." />
    </div>

    <div class="form-row">
      <label class="form-label">Share</label>
      <select v-model="share" class="form-input">
        <option value="">(not set)</option>
        <option value="manual">manual</option>
        <option value="auto">auto</option>
        <option value="disabled">disabled</option>
      </select>
    </div>

    <div class="form-row">
      <label class="form-label">Auto Update</label>
      <select v-model="autoupdate" class="form-input">
        <option value="">(not set)</option>
        <option value="true">Auto-update</option>
        <option value="notify">Notify only</option>
        <option value="false">Disabled</option>
      </select>
    </div>
  </div>
</template>

<style scoped>
.section-content {
  padding: var(--space-12) var(--space-16);
  display: flex;
  flex-direction: column;
  gap: var(--space-12);
}

.section-title {
  font-size: var(--font-size-ui);
  font-weight: 600;
  color: var(--text-primary);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin: 0;
}

.form-row {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
}

.form-label {
  font-size: 11px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-muted);
}

.form-hint {
  font-size: var(--font-size-small);
  color: var(--text-placeholder);
  margin: 0;
}

.form-hint code {
  font-family: var(--font-mono);
  font-size: 10px;
  background: var(--bg-element);
  padding: 1px 4px;
  border-radius: var(--radius-xs);
}

.form-input {
  width: 100%;
  padding: 4px var(--space-8);
  height: 28px;
  background: var(--bg-element);
  border: 1px solid var(--border-variant);
  border-radius: var(--radius-xs);
  color: var(--text-primary);
  font-family: var(--font-ui);
  font-size: var(--font-size-ui);
  outline: none;
  appearance: none;
  -webkit-appearance: none;
}

.form-input:focus {
  background: var(--bg-editor);
  box-shadow: 0 0 0 1px var(--border-focused);
}

select.form-input {
  cursor: pointer;
}
</style>
