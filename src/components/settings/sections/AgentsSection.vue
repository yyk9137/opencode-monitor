<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'
import { fetch } from '@tauri-apps/plugin-http'
import { ChevronDown, ChevronRight, Plus, Trash2, Copy, RotateCcw } from 'lucide-vue-next'
import { useConfigStore } from '@/stores/config'
import JsonEditor from '../JsonEditor.vue'

const configStore = useConfigStore()
const expanded = ref<string | null>(null)
const showAddForm = ref(false)
const newAgentName = ref('')

const builtInAgents = new Set(['build', 'plan', 'general', 'explore', 'title', 'summary', 'compaction'])

// ── Model data ────────────────────────────────────────────────────────────
interface ProviderModel { id: string; name?: string }
interface ProviderInfo { id: string; name?: string; models?: ProviderModel[] }
const providers = ref<ProviderInfo[]>([])
const modelLoading = ref(false)

async function loadProviders() {
  if (!configStore.targetUrl) return
  modelLoading.value = true
  try {
    const resp = await fetch(`${configStore.targetUrl}/provider`)
    if (!resp.ok) return
    const data = await resp.json() as { all: ProviderInfo[] }
    providers.value = data.all || []
  } catch { /* silent */ } finally { modelLoading.value = false }
}
onMounted(loadProviders)

const modelOptions = computed(() => {
  const opts: { value: string; label: string }[] = []
  for (const p of providers.value) {
    if (!p.models) continue
    for (const m of p.models) {
      opts.push({ value: `${p.id}/${m.id}`, label: `${p.id} / ${m.name || m.id}` })
    }
  }
  return opts
})

// ── Agents ─────────────────────────────────────────────────────────────────
const agents = computed(() => Object.entries(configStore.draft?.agent ?? {}).map(([name, config]) => ({ name, config })))
const builtInList = computed(() => agents.value.filter(a => builtInAgents.has(a.name)))
const customList = computed(() => agents.value.filter(a => !builtInAgents.has(a.name)))

function toggleExpand(name: string) { expanded.value = expanded.value === name ? null : name }

function updateAgent(name: string, field: string, value: unknown) {
  if (!configStore.draft?.agent?.[name]) return
  ;(configStore.draft.agent[name] as Record<string, unknown>)[field] = value
  configStore.dirtyPaths.add(`agent.${name}.${field}`)
}

function addAgent() {
  const name = newAgentName.value.trim()
  if (!name || !configStore.draft) return
  if (!configStore.draft.agent) configStore.draft.agent = {}
  if (configStore.draft.agent[name]) { expanded.value = name; showAddForm.value = false; return }
  configStore.draft.agent[name] = { mode: 'subagent', prompt: '', disable: false }
  configStore.dirtyPaths.add(`agent.${name}`)
  newAgentName.value = ''
  showAddForm.value = false
  expanded.value = name
}

function duplicateAgent(name: string) {
  if (!configStore.draft?.agent?.[name]) return
  let newName = `${name}-copy`
  let i = 2
  while (configStore.draft.agent[newName]) { newName = `${name}-copy-${i++}` }
  configStore.draft.agent[newName] = structuredClone(configStore.draft.agent[name])
  configStore.dirtyPaths.add(`agent.${newName}`)
  expanded.value = newName
}

function softDeleteAgent(name: string) {
  if (!configStore.draft?.agent?.[name]) return
  configStore.draft.agent[name].disable = true
  configStore.draft.agent[name].hidden = true
  configStore.dirtyPaths.add(`agent.${name}.disable`)
  configStore.dirtyPaths.add(`agent.${name}.hidden`)
}

function resetAgent(name: string) {
  if (!configStore.draft?.agent) return
  configStore.draft.agent[name] = { disable: false }
  configStore.dirtyPaths.add(`agent.${name}`)
}

// ── Permission ruleset ──────────────────────────────────────────────────────
interface PRule { permission: string; pattern: string; action: string }
const rulesets = ref<Record<string, PRule[]>>({})

function permToRules(perm: unknown): PRule[] {
  if (typeof perm === 'string') return [{ permission: '*', pattern: '*', action: perm }]
  if (typeof perm === 'object' && perm !== null) {
    const rules: PRule[] = []
    for (const [p, v] of Object.entries(perm as Record<string, unknown>)) {
      if (typeof v === 'string') rules.push({ permission: p, pattern: '*', action: v })
      else if (typeof v === 'object' && v !== null) {
        for (const [pat, act] of Object.entries(v as Record<string, unknown>)) {
          if (typeof act === 'string') rules.push({ permission: p, pattern: pat, action: act })
        }
      }
    }
    return rules
  }
  return []
}

function ensureRules(name: string) {
  if (!rulesets.value[name]) {
    rulesets.value[name] = permToRules(configStore.draft?.agent?.[name]?.permission)
  }
}

function addRule(name: string) {
  if (!rulesets.value[name]) rulesets.value[name] = []
  rulesets.value[name].push({ permission: 'bash', pattern: '*', action: 'ask' })
}

function removeRule(name: string, i: number) {
  rulesets.value[name]?.splice(i, 1)
  commitPerm(name)
}

function commitPerm(name: string) {
  const rules = rulesets.value[name] || []
  if (rules.length === 0) { updateAgent(name, 'permission', undefined); return }
  const perm: Record<string, unknown> = {}
  for (const r of rules) {
    if (r.pattern === '*') perm[r.permission] = r.action
    else { if (typeof perm[r.permission] !== 'object') perm[r.permission] = {}; (perm[r.permission] as Record<string, unknown>)[r.pattern] = r.action }
  }
  updateAgent(name, 'permission', perm)
}
</script>

<template>
  <div class="section-content">
    <h2 class="section-title">Agents</h2>

    <!-- Built-in agents -->
    <div v-if="builtInList.length > 0" class="agent-group">
      <div class="group-header">Built-in Agents</div>
      <div v-for="{ name, config } in builtInList" :key="name" class="agent-card">
        <button class="agent-header" @click="toggleExpand(name)">
          <component :is="expanded === name ? ChevronDown : ChevronRight" :size="12" />
          <span class="agent-name">{{ name }}</span>
          <span v-if="config.disable" class="badge disabled">disabled</span>
          <span v-if="config.mode" class="badge mode">{{ config.mode }}</span>
        </button>
        <div v-if="expanded === name" class="agent-body">
          <div class="form-row">
            <label class="form-label">Model</label>
            <select :value="config.model ?? ''" class="form-input" @change="updateAgent(name, 'model', ($event.target as HTMLSelectElement).value || undefined)">
              <option value="">(inherit top-level)</option>
              <option v-for="opt in modelOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
            </select>
          </div>
          <div class="form-row">
            <label class="form-label">Mode</label>
            <select :value="config.mode ?? ''" class="form-input" @change="updateAgent(name, 'mode', ($event.target as HTMLSelectElement).value || undefined)">
              <option value="">(not set)</option><option value="subagent">subagent</option><option value="primary">primary</option><option value="all">all</option>
            </select>
          </div>
          <div class="form-row"><label class="form-label">Description</label><input :value="config.description ?? ''" type="text" class="form-input" @input="updateAgent(name, 'description', ($event.target as HTMLInputElement).value || undefined)" /></div>
          <div class="form-row"><label class="form-label">System Prompt</label><textarea :value="config.prompt ?? ''" class="form-textarea" rows="6" @input="updateAgent(name, 'prompt', ($event.target as HTMLTextAreaElement).value || undefined)"></textarea></div>
          <div class="form-row-inline">
            <div class="form-row"><label class="form-label">Temperature</label><input :value="config.temperature ?? ''" type="number" step="0.1" min="0" max="2" class="form-input" @input="updateAgent(name, 'temperature', Number(($event.target as HTMLInputElement).value) || undefined)" /></div>
            <div class="form-row"><label class="form-label">Top P</label><input :value="config.top_p ?? ''" type="number" step="0.01" min="0" max="1" class="form-input" @input="updateAgent(name, 'top_p', Number(($event.target as HTMLInputElement).value) || undefined)" /></div>
            <div class="form-row"><label class="form-label">Steps</label><input :value="config.steps ?? ''" type="number" min="1" class="form-input" @input="updateAgent(name, 'steps', Number(($event.target as HTMLInputElement).value) || undefined)" /></div>
          </div>
          <div class="form-row"><label class="form-label">Color</label><input :value="config.color ?? ''" type="text" class="form-input" placeholder="#RRGGBB or theme name" @input="updateAgent(name, 'color', ($event.target as HTMLInputElement).value || undefined)" /></div>
          <div class="form-row"><label class="form-label">Disabled</label><button class="toggle-switch" :class="{ on: config.disable }" @click="updateAgent(name, 'disable', !config.disable)"><span class="toggle-knob" /></button></div>
          <div class="form-row"><label class="form-label">Hidden (subagent only)</label><button class="toggle-switch" :class="{ on: config.hidden }" :disabled="config.mode !== 'subagent'" @click="updateAgent(name, 'hidden', !config.hidden)"><span class="toggle-knob" /></button></div>
          <!-- Permission rules -->
          <div class="perm-section" @click="ensureRules(name)">
            <label class="form-label">Permissions</label>
            <div class="perm-rules">
              <div v-for="(rule, i) in (rulesets[name] || [])" :key="i" class="rule-row">
                <input :value="rule.permission" class="form-input mono" placeholder="tool" @change="rulesets[name][i].permission = ($event.target as HTMLInputElement).value; commitPerm(name)" />
                <input :value="rule.pattern" class="form-input mono" placeholder="pattern" @change="rulesets[name][i].pattern = ($event.target as HTMLInputElement).value; commitPerm(name)" />
                <select :value="rule.action" class="form-input" @change="rulesets[name][i].action = ($event.target as HTMLSelectElement).value; commitPerm(name)"><option value="allow">allow</option><option value="ask">ask</option><option value="deny">deny</option></select>
                <button class="kv-remove" @click="removeRule(name, i)">×</button>
              </div>
              <button class="btn-add-rule" @click="addRule(name)">+ Add rule</button>
            </div>
          </div>
          <!-- Options JSON -->
          <div class="form-row"><label class="form-label">Options (JSON)</label><JsonEditor :model-value="config.options" @update:model-value="updateAgent(name, 'options', $event)" @dirty="configStore.dirtyPaths.add(`agent.${name}.options`)" /></div>
          <div class="card-actions"><button class="btn-action" @click="resetAgent(name)"><RotateCcw :size="11" /> Reset</button></div>
        </div>
      </div>
    </div>

    <!-- Custom agents -->
    <div class="agent-group">
      <div class="group-header">Custom Agents</div>
      <div v-for="{ name, config } in customList" :key="name" class="agent-card">
        <button class="agent-header" @click="toggleExpand(name)">
          <component :is="expanded === name ? ChevronDown : ChevronRight" :size="12" />
          <span class="agent-name">{{ name }}</span>
          <span v-if="config.disable" class="badge disabled">disabled</span>
          <span v-if="config.mode" class="badge mode">{{ config.mode }}</span>
        </button>
        <div v-if="expanded === name" class="agent-body">
          <div class="form-row">
            <label class="form-label">Model</label>
            <select :value="config.model ?? ''" class="form-input" @change="updateAgent(name, 'model', ($event.target as HTMLSelectElement).value || undefined)">
              <option value="">(inherit top-level)</option>
              <option v-for="opt in modelOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
            </select>
          </div>
          <div class="form-row">
            <label class="form-label">Mode</label>
            <select :value="config.mode ?? ''" class="form-input" @change="updateAgent(name, 'mode', ($event.target as HTMLSelectElement).value || undefined)">
              <option value="">(not set)</option><option value="subagent">subagent</option><option value="primary">primary</option><option value="all">all</option>
            </select>
          </div>
          <div class="form-row"><label class="form-label">Description</label><input :value="config.description ?? ''" type="text" class="form-input" @input="updateAgent(name, 'description', ($event.target as HTMLInputElement).value || undefined)" /></div>
          <div class="form-row"><label class="form-label">System Prompt</label><textarea :value="config.prompt ?? ''" class="form-textarea" rows="6" @input="updateAgent(name, 'prompt', ($event.target as HTMLTextAreaElement).value || undefined)"></textarea></div>
          <div class="form-row-inline">
            <div class="form-row"><label class="form-label">Temperature</label><input :value="config.temperature ?? ''" type="number" step="0.1" min="0" max="2" class="form-input" @input="updateAgent(name, 'temperature', Number(($event.target as HTMLInputElement).value) || undefined)" /></div>
            <div class="form-row"><label class="form-label">Top P</label><input :value="config.top_p ?? ''" type="number" step="0.01" min="0" max="1" class="form-input" @input="updateAgent(name, 'top_p', Number(($event.target as HTMLInputElement).value) || undefined)" /></div>
            <div class="form-row"><label class="form-label">Steps</label><input :value="config.steps ?? ''" type="number" min="1" class="form-input" @input="updateAgent(name, 'steps', Number(($event.target as HTMLInputElement).value) || undefined)" /></div>
          </div>
          <div class="form-row"><label class="form-label">Color</label><input :value="config.color ?? ''" type="text" class="form-input" placeholder="#RRGGBB or theme name" @input="updateAgent(name, 'color', ($event.target as HTMLInputElement).value || undefined)" /></div>
          <div class="form-row"><label class="form-label">Disabled</label><button class="toggle-switch" :class="{ on: config.disable }" @click="updateAgent(name, 'disable', !config.disable)"><span class="toggle-knob" /></button></div>
          <div class="form-row"><label class="form-label">Hidden (subagent only)</label><button class="toggle-switch" :class="{ on: config.hidden }" :disabled="config.mode !== 'subagent'" @click="updateAgent(name, 'hidden', !config.hidden)"><span class="toggle-knob" /></button></div>
          <!-- Permission rules -->
          <div class="perm-section" @click="ensureRules(name)">
            <label class="form-label">Permissions</label>
            <div class="perm-rules">
              <div v-for="(rule, i) in (rulesets[name] || [])" :key="i" class="rule-row">
                <input :value="rule.permission" class="form-input mono" placeholder="tool" @change="rulesets[name][i].permission = ($event.target as HTMLInputElement).value; commitPerm(name)" />
                <input :value="rule.pattern" class="form-input mono" placeholder="pattern" @change="rulesets[name][i].pattern = ($event.target as HTMLInputElement).value; commitPerm(name)" />
                <select :value="rule.action" class="form-input" @change="rulesets[name][i].action = ($event.target as HTMLSelectElement).value; commitPerm(name)"><option value="allow">allow</option><option value="ask">ask</option><option value="deny">deny</option></select>
                <button class="kv-remove" @click="removeRule(name, i)">×</button>
              </div>
              <button class="btn-add-rule" @click="addRule(name)">+ Add rule</button>
            </div>
          </div>
          <!-- Options JSON -->
          <div class="form-row"><label class="form-label">Options (JSON)</label><JsonEditor :model-value="config.options" @update:model-value="updateAgent(name, 'options', $event)" @dirty="configStore.dirtyPaths.add(`agent.${name}.options`)" /></div>
          <div class="card-actions">
            <button class="btn-action" @click="duplicateAgent(name)"><Copy :size="11" /> Duplicate</button>
            <button class="btn-delete" @click="softDeleteAgent(name)"><Trash2 :size="11" /> Disable</button>
          </div>
        </div>
      </div>
    </div>

    <!-- Add agent -->
    <div v-if="showAddForm" class="add-form">
      <input v-model="newAgentName" class="form-input" placeholder="agent name (e.g. my-agent)" @keydown.enter="addAgent" />
      <button class="btn-add" @click="addAgent" :disabled="!newAgentName.trim()">Add</button>
      <button class="btn-cancel" @click="showAddForm = false">Cancel</button>
    </div>
    <button v-else class="btn-add-card" @click="showAddForm = true"><Plus :size="12" /> Add Agent</button>
  </div>
</template>

<style scoped>
.section-content { padding: var(--space-12) var(--space-16); display: flex; flex-direction: column; gap: var(--space-12); }
.section-title { font-size: var(--font-size-ui); font-weight: 600; color: var(--text-primary); text-transform: uppercase; letter-spacing: 0.06em; margin: 0; }
.agent-group { display: flex; flex-direction: column; gap: var(--space-6); }
.group-header { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-muted); padding: 0 var(--space-4); }
.agent-card { border: 1px solid var(--border-variant); border-radius: var(--radius-xs); overflow: hidden; }
.agent-header { display: flex; align-items: center; gap: var(--space-6); width: 100%; padding: var(--space-6) var(--space-8); background: var(--bg-app); border: none; color: var(--text-primary); cursor: pointer; font-family: var(--font-ui); font-size: var(--font-size-ui); text-align: left; }
.agent-header:hover { background: var(--bg-hover); }
.agent-name { flex: 1; }
.badge { font-family: var(--font-mono); font-size: 9px; padding: 1px 4px; border-radius: var(--radius-xs); }
.badge.disabled { background: rgba(217,87,87,0.15); color: var(--error); }
.badge.mode { background: var(--bg-element); color: var(--text-accent); }
.agent-body { padding: var(--space-8); background: var(--bg-editor); display: flex; flex-direction: column; gap: var(--space-8); }
.form-row { display: flex; flex-direction: column; gap: var(--space-6); }
.form-row-inline { display: flex; gap: var(--space-8); flex-wrap: wrap; }
.form-row-inline .form-row { flex: 1; min-width: 100px; }
.form-label { font-size: 11px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-muted); }
.form-input { width: 100%; padding: 4px var(--space-8); height: 28px; background: var(--bg-element); border: 1px solid var(--border-variant); border-radius: var(--radius-xs); color: var(--text-primary); font-family: var(--font-ui); font-size: var(--font-size-ui); outline: none; }
.form-input.mono { font-family: var(--font-mono); font-size: 10px; }
.form-input:focus { background: var(--bg-editor); box-shadow: 0 0 0 1px var(--border-focused); }
.form-textarea { width: 100%; padding: var(--space-6) var(--space-8); min-height: 100px; background: var(--bg-element); border: 1px solid var(--border-variant); border-radius: var(--radius-xs); color: var(--text-primary); font-family: var(--font-mono); font-size: var(--font-size-ui); outline: none; resize: vertical; }
.form-textarea:focus { background: var(--bg-editor); box-shadow: 0 0 0 1px var(--border-focused); }
.toggle-switch { width: 32px; height: 16px; border-radius: 8px; border: none; background: var(--bg-element); cursor: pointer; position: relative; padding: 0; }
.toggle-switch.on { background: var(--text-accent); }
.toggle-switch:disabled { opacity: 0.4; cursor: not-allowed; }
.toggle-knob { position: absolute; top: 2px; left: 2px; width: 12px; height: 12px; border-radius: 50%; background: var(--text-primary); transition: transform var(--duration-fast) ease; }
.toggle-switch.on .toggle-knob { transform: translateX(16px); }
.perm-section { display: flex; flex-direction: column; gap: var(--space-6); padding-top: var(--space-8); border-top: 1px solid var(--border-variant); }
.perm-rules { display: flex; flex-direction: column; gap: 2px; }
.rule-row { display: flex; gap: var(--space-4); align-items: center; }
.rule-row .form-input { flex: 1; }
.kv-remove { border: none; background: transparent; color: var(--text-muted); cursor: pointer; font-size: 14px; padding: 2px 4px; border-radius: var(--radius-xs); }
.kv-remove:hover { color: var(--error); }
.btn-add-rule { align-self: flex-start; padding: 2px var(--space-6); background: transparent; border: 1px dashed var(--border-variant); border-radius: var(--radius-xs); color: var(--text-muted); cursor: pointer; font-size: var(--font-size-small); }
.btn-add-rule:hover { color: var(--text-accent); }
.card-actions { display: flex; justify-content: flex-end; gap: var(--space-6); }
.btn-action { display: inline-flex; align-items: center; gap: 4px; padding: 4px var(--space-8); background: transparent; border: 1px solid var(--border-variant); border-radius: var(--radius-xs); color: var(--text-muted); cursor: pointer; font-size: var(--font-size-small); }
.btn-action:hover { color: var(--text-primary); background: var(--bg-hover); }
.btn-delete { display: inline-flex; align-items: center; gap: 4px; padding: 4px var(--space-8); background: transparent; border: 1px solid var(--error); border-radius: var(--radius-xs); color: var(--error); cursor: pointer; font-size: var(--font-size-small); }
.btn-delete:hover { background: rgba(217,87,87,0.1); }
.add-form { display: flex; gap: var(--space-6); align-items: center; }
.add-form .form-input { flex: 1; }
.btn-add, .btn-cancel { padding: 4px var(--space-8); border-radius: var(--radius-xs); cursor: pointer; font-size: var(--font-size-ui); border: none; }
.btn-add { background: var(--text-accent); color: var(--bg-editor); }
.btn-add:disabled { opacity: 0.4; cursor: not-allowed; }
.btn-cancel { background: transparent; color: var(--text-muted); }
.btn-add-card { display: inline-flex; align-items: center; gap: 4px; padding: var(--space-6) var(--space-8); background: transparent; border: 1px dashed var(--border-variant); border-radius: var(--radius-xs); color: var(--text-muted); cursor: pointer; font-size: var(--font-size-ui); }
.btn-add-card:hover { color: var(--text-primary); border-color: var(--text-accent); }
</style>
