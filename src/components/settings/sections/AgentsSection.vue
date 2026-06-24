<script setup lang="ts">
import { computed, ref } from 'vue'
import { ChevronDown, ChevronRight, Plus, Trash2 } from 'lucide-vue-next'
import { useConfigStore } from '@/stores/config'
import JsonEditor from '../JsonEditor.vue'

const configStore = useConfigStore()
const expandedAgent = ref<string | null>(null)
const newAgentName = ref('')
const showAddForm = ref(false)

const agents = computed(() => Object.entries(configStore.draft?.agent ?? {}).map(([name, config]) => ({ name, config })))

const builtInAgents = new Set(['build', 'plan', 'general', 'explore', 'title', 'summary', 'compaction'])

function toggleExpand(name: string) {
  expandedAgent.value = expandedAgent.value === name ? null : name
}

function updateAgent(name: string, field: string, value: unknown) {
  if (!configStore.draft?.agent?.[name]) return
  ;(configStore.draft.agent[name] as Record<string, unknown>)[field] = value
  configStore.dirtyPaths.add(`agent.${name}.${field}`)
}

function addAgent() {
  const name = newAgentName.value.trim()
  if (!name || !configStore.draft) return
  if (!configStore.draft.agent) configStore.draft.agent = {}
  configStore.draft.agent[name] = { mode: 'subagent', prompt: '' }
  configStore.dirtyPaths.add(`agent.${name}`)
  newAgentName.value = ''
  showAddForm.value = false
}

function softDeleteAgent(name: string) {
  if (!configStore.draft?.agent?.[name]) return
  configStore.draft.agent[name].disable = true
  configStore.draft.agent[name].hidden = true
  configStore.dirtyPaths.add(`agent.${name}.disable`)
  configStore.dirtyPaths.add(`agent.${name}.hidden`)
}
</script>

<template>
  <div class="section-content">
    <h2 class="section-title">Agents</h2>

    <div v-for="{ name, config: agent } in agents" :key="name" class="agent-card">
      <button class="agent-header" @click="toggleExpand(name)">
        <component :is="expandedAgent === name ? ChevronDown : ChevronRight" :size="12" />
        <span>{{ name }}</span>
        <span v-if="builtInAgents.has(name)" class="agent-builtin">built-in</span>
        <span v-if="agent.disable" class="agent-disabled">disabled</span>
        <span v-if="agent.mode" class="agent-mode">{{ agent.mode }}</span>
      </button>

      <div v-if="expandedAgent === name" class="agent-body">
        <div class="form-row">
          <label class="form-label">Model</label>
          <input :value="agent.model ?? ''" type="text" class="form-input" placeholder="(inherit top-level)" @input="updateAgent(name, 'model', ($event.target as HTMLInputElement).value || undefined)" />
        </div>
        <div class="form-row">
          <label class="form-label">Mode</label>
          <select :value="agent.mode ?? ''" class="form-input" @change="updateAgent(name, 'mode', ($event.target as HTMLSelectElement).value || undefined)">
            <option value="">(not set)</option>
            <option value="subagent">subagent</option>
            <option value="primary">primary</option>
            <option value="all">all</option>
          </select>
        </div>
        <div class="form-row">
          <label class="form-label">Prompt</label>
          <textarea :value="agent.prompt ?? ''" class="form-textarea" rows="4" @input="updateAgent(name, 'prompt', ($event.target as HTMLTextAreaElement).value || undefined)" />
        </div>
        <div class="form-row">
          <label class="form-label">Description</label>
          <input :value="agent.description ?? ''" type="text" class="form-input" @input="updateAgent(name, 'description', ($event.target as HTMLInputElement).value || undefined)" />
        </div>
        <div class="form-row">
          <label class="form-label">Steps</label>
          <input :value="agent.steps ?? ''" type="number" min="1" class="form-input" @input="updateAgent(name, 'steps', Number(($event.target as HTMLInputElement).value) || undefined)" />
        </div>
        <div class="form-row">
          <label class="form-label">Color</label>
          <input :value="agent.color ?? ''" type="text" class="form-input" placeholder="#RRGGBB or theme name" @input="updateAgent(name, 'color', ($event.target as HTMLInputElement).value || undefined)" />
        </div>
        <div class="form-row">
          <label class="form-label">Hidden</label>
          <button class="toggle-switch" :class="{ on: agent.hidden }" :disabled="agent.mode !== 'subagent'" @click="updateAgent(name, 'hidden', !agent.hidden)">
            <span class="toggle-knob" />
          </button>
          <span v-if="agent.mode !== 'subagent'" class="field-hint">(仅 subagent 模式生效)</span>
        </div>
        <div class="form-row">
          <label class="form-label">Permission</label>
          <JsonEditor :model-value="agent.permission" @update:model-value="updateAgent(name, 'permission', $event)" @dirty="configStore.dirtyPaths.add(`agent.${name}.permission`)" />
        </div>
        <div class="form-row">
          <label class="form-label">Options</label>
          <JsonEditor :model-value="agent.options" @update:model-value="updateAgent(name, 'options', $event)" @dirty="configStore.dirtyPaths.add(`agent.${name}.options`)" />
        </div>
        <div class="agent-actions">
          <button class="btn-delete" @click="softDeleteAgent(name)">
            <Trash2 :size="11" /> Soft-delete (disable + hidden)
          </button>
        </div>
      </div>
    </div>

    <div v-if="showAddForm" class="add-form">
      <input v-model="newAgentName" class="form-input" placeholder="agent name" @keydown.enter="addAgent" />
      <button class="btn-add" @click="addAgent">Add</button>
      <button class="btn-cancel" @click="showAddForm = false">Cancel</button>
    </div>
    <button v-else class="btn-add-agent" @click="showAddForm = true">
      <Plus :size="12" /> Add Agent
    </button>
  </div>
</template>

<style scoped>
.section-content { padding: var(--space-12) var(--space-16); display: flex; flex-direction: column; gap: var(--space-12); }
.section-title { font-size: var(--font-size-ui); font-weight: 600; color: var(--text-primary); text-transform: uppercase; letter-spacing: 0.06em; margin: 0; }
.agent-card { border: 1px solid var(--border-variant); border-radius: var(--radius-xs); overflow: hidden; }
.agent-header { display: flex; align-items: center; gap: var(--space-6); width: 100%; padding: var(--space-6) var(--space-8); background: var(--bg-app); border: none; color: var(--text-primary); cursor: pointer; font-family: var(--font-ui); font-size: var(--font-size-ui); text-align: left; }
.agent-header:hover { background: var(--bg-hover); }
.agent-builtin, .agent-disabled, .agent-mode { font-family: var(--font-mono); font-size: 9px; padding: 1px 4px; border-radius: var(--radius-xs); margin-left: auto; }
.agent-builtin { background: var(--bg-element); color: var(--text-muted); }
.agent-disabled { background: rgba(217,87,87,0.15); color: var(--error); }
.agent-mode { background: var(--bg-element); color: var(--text-accent); }
.agent-body { padding: var(--space-8); background: var(--bg-editor); display: flex; flex-direction: column; gap: var(--space-8); }
.form-row { display: flex; flex-direction: column; gap: var(--space-6); }
.form-label { font-size: 11px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-muted); }
.form-input { width: 100%; padding: 4px var(--space-8); height: 28px; background: var(--bg-element); border: 1px solid var(--border-variant); border-radius: var(--radius-xs); color: var(--text-primary); font-family: var(--font-ui); font-size: var(--font-size-ui); outline: none; }
.form-input:focus { background: var(--bg-editor); box-shadow: 0 0 0 1px var(--border-focused); }
.form-textarea { width: 100%; padding: var(--space-6) var(--space-8); min-height: 80px; background: var(--bg-element); border: 1px solid var(--border-variant); border-radius: var(--radius-xs); color: var(--text-primary); font-family: var(--font-mono); font-size: var(--font-size-ui); outline: none; resize: vertical; }
.form-textarea:focus { background: var(--bg-editor); box-shadow: 0 0 0 1px var(--border-focused); }
.field-hint { font-size: var(--font-size-small); color: var(--text-placeholder); }
.toggle-switch { width: 32px; height: 16px; border-radius: 8px; border: none; background: var(--bg-element); cursor: pointer; position: relative; padding: 0; }
.toggle-switch.on { background: var(--text-accent); }
.toggle-switch:disabled { opacity: 0.4; cursor: not-allowed; }
.toggle-knob { position: absolute; top: 2px; left: 2px; width: 12px; height: 12px; border-radius: 50%; background: var(--text-primary); transition: transform var(--duration-fast) ease; }
.toggle-switch.on .toggle-knob { transform: translateX(16px); }
.agent-actions { display: flex; justify-content: flex-end; }
.btn-delete { display: inline-flex; align-items: center; gap: 4px; padding: 4px var(--space-8); background: transparent; border: 1px solid var(--error); border-radius: var(--radius-xs); color: var(--error); cursor: pointer; font-size: var(--font-size-small); }
.btn-delete:hover { background: rgba(217,87,87,0.1); }
.add-form { display: flex; gap: var(--space-6); align-items: center; }
.btn-add, .btn-cancel { padding: 4px var(--space-8); border-radius: var(--radius-xs); cursor: pointer; font-size: var(--font-size-ui); border: none; }
.btn-add { background: var(--text-accent); color: var(--bg-editor); }
.btn-cancel { background: transparent; color: var(--text-muted); }
.btn-add-agent { display: inline-flex; align-items: center; gap: 4px; padding: var(--space-6) var(--space-8); background: transparent; border: 1px dashed var(--border-variant); border-radius: var(--radius-xs); color: var(--text-muted); cursor: pointer; font-size: var(--font-size-ui); }
.btn-add-agent:hover { color: var(--text-primary); border-color: var(--text-accent); }
</style>
