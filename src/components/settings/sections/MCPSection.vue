<script setup lang="ts">
import { computed, ref } from 'vue'
import { ChevronDown, ChevronRight, Plus } from 'lucide-vue-next'
import { useConfigStore } from '@/stores/config'
import KeyValueEditor from '../KeyValueEditor.vue'

const configStore = useConfigStore()
const expanded = ref<string | null>(null)
const showAddForm = ref(false)
const newName = ref('')

const mcpServers = computed(() => Object.entries(configStore.draft?.mcp ?? {}).map(([name, server]) => ({ name, server })))

function toggleExpand(name: string) { expanded.value = expanded.value === name ? null : name }

function updateMcp(name: string, field: string, value: unknown) {
  if (!configStore.draft?.mcp?.[name]) return
  ;(configStore.draft.mcp[name] as unknown as Record<string, unknown>)[field] = value
  configStore.dirtyPaths.add(`mcp.${name}.${field}`)
}

function updateCommandArg(name: string, index: number, value: string) {
  if (!configStore.draft?.mcp?.[name]) return
  const mcp = configStore.draft.mcp[name]
  if (mcp && 'command' in mcp && Array.isArray(mcp.command)) {
    const arr = [...mcp.command]
    arr[index] = value
    updateMcp(name, 'command', arr)
  }
}

function removeCommandArg(name: string, index: number) {
  if (!configStore.draft?.mcp?.[name]) return
  const mcp = configStore.draft.mcp[name]
  if (mcp && 'command' in mcp && Array.isArray(mcp.command)) {
    const arr = [...mcp.command]
    arr.splice(index, 1)
    updateMcp(name, 'command', arr)
  }
}

function addCommandArg(name: string) {
  if (!configStore.draft?.mcp?.[name]) return
  const mcp = configStore.draft.mcp[name]
  if (mcp && 'command' in mcp && Array.isArray(mcp.command)) {
    updateMcp(name, 'command', [...mcp.command, ''])
  }
}

function addServer() {
  const name = newName.value.trim()
  if (!name || !configStore.draft) return
  if (!configStore.draft.mcp) configStore.draft.mcp = {}
  configStore.draft.mcp[name] = { type: 'local', command: [] }
  configStore.dirtyPaths.add(`mcp.${name}`)
  newName.value = ''
  showAddForm.value = false
  expanded.value = name
}
</script>

<template>
  <div class="section-content">
    <h2 class="section-title">MCP Servers</h2>

    <div v-for="{ name, server } in mcpServers" :key="name" class="mcp-card">
      <button class="mcp-header" @click="toggleExpand(name)">
        <component :is="expanded === name ? ChevronDown : ChevronRight" :size="12" />
        <span>{{ name }}</span>
        <span class="mcp-type">{{ 'type' in server ? server.type : 'built-in' }}</span>
      </button>

      <div v-if="expanded === name" class="mcp-body">
        <!-- Built-in (no type field) -->
        <template v-if="!('type' in server)">
          <div class="form-row">
            <label class="form-label">Enabled</label>
            <button class="toggle-switch" :class="{ on: server.enabled }" @click="updateMcp(name, 'enabled', !server.enabled)">
              <span class="toggle-knob" />
            </button>
          </div>
          <p class="field-hint">Built-in MCP server — only enable/disable is available.</p>
        </template>

        <!-- Local -->
        <template v-else-if="server.type === 'local'">
          <div class="form-row">
            <label class="form-label">Command (argv array)</label>
            <div class="command-list">
              <div v-for="(cmd, i) in server.command" :key="i" class="command-row">
                <input :value="cmd" class="form-input mono" @input="updateCommandArg(name, i, ($event.target as HTMLInputElement).value)" />
                <button class="kv-remove" @click="removeCommandArg(name, i)">×</button>
              </div>
              <button class="btn-add-cmd" @click="addCommandArg(name)">+ Add arg</button>
            </div>
          </div>
          <div class="form-row">
            <label class="form-label">Environment</label>
            <KeyValueEditor :model-value="server.environment ?? {}" @update:model-value="updateMcp(name, 'environment', $event)" @dirty="configStore.dirtyPaths.add(`mcp.${name}.environment`)" />
          </div>
          <div class="form-row">
            <label class="form-label">Working Directory</label>
            <input :value="server.cwd ?? ''" type="text" class="form-input mono" @input="updateMcp(name, 'cwd', ($event.target as HTMLInputElement).value || undefined)" />
          </div>
          <div class="form-row">
            <label class="form-label">Enabled</label>
            <button class="toggle-switch" :class="{ on: server.enabled }" @click="updateMcp(name, 'enabled', !server.enabled)">
              <span class="toggle-knob" />
            </button>
          </div>
          <div class="form-row">
            <label class="form-label">Timeout (ms)</label>
            <input :value="server.timeout ?? ''" type="number" min="1" class="form-input" @input="updateMcp(name, 'timeout', Number(($event.target as HTMLInputElement).value) || undefined)" />
          </div>
        </template>

        <!-- Remote -->
        <template v-else-if="server.type === 'remote'">
          <div class="form-row">
            <label class="form-label">URL</label>
            <input :value="server.url ?? ''" type="text" class="form-input mono" placeholder="https://..." @input="updateMcp(name, 'url', ($event.target as HTMLInputElement).value || undefined)" />
          </div>
          <div class="form-row">
            <label class="form-label">Headers</label>
            <KeyValueEditor :model-value="server.headers ?? {}" @update:model-value="updateMcp(name, 'headers', $event)" @dirty="configStore.dirtyPaths.add(`mcp.${name}.headers`)" />
          </div>
          <div class="form-row">
            <label class="form-label">Enabled</label>
            <button class="toggle-switch" :class="{ on: server.enabled }" @click="updateMcp(name, 'enabled', !server.enabled)">
              <span class="toggle-knob" />
            </button>
          </div>
          <div class="form-row">
            <label class="form-label">Timeout (ms)</label>
            <input :value="server.timeout ?? ''" type="number" min="1" class="form-input" @input="updateMcp(name, 'timeout', Number(($event.target as HTMLInputElement).value) || undefined)" />
          </div>
        </template>
      </div>
    </div>

    <div v-if="showAddForm" class="add-form">
      <input v-model="newName" class="form-input" placeholder="server name" @keydown.enter="addServer" />
      <button class="btn-add" @click="addServer">Add</button>
      <button class="btn-cancel" @click="showAddForm = false">Cancel</button>
    </div>
    <button v-else class="btn-add-server" @click="showAddForm = true">
      <Plus :size="12" /> Add MCP Server
    </button>

    <p class="field-hint">Note: Deletion is not supported via deep-merge PATCH. Use disable instead.</p>
  </div>
</template>

<style scoped>
.section-content { padding: var(--space-12) var(--space-16); display: flex; flex-direction: column; gap: var(--space-12); }
.section-title { font-size: var(--font-size-ui); font-weight: 600; color: var(--text-primary); text-transform: uppercase; letter-spacing: 0.06em; margin: 0; }
.mcp-card { border: 1px solid var(--border-variant); border-radius: var(--radius-xs); overflow: hidden; }
.mcp-header { display: flex; align-items: center; gap: var(--space-6); width: 100%; padding: var(--space-6) var(--space-8); background: var(--bg-app); border: none; color: var(--text-primary); cursor: pointer; font-family: var(--font-ui); font-size: var(--font-size-ui); text-align: left; }
.mcp-header:hover { background: var(--bg-hover); }
.mcp-type { font-family: var(--font-mono); font-size: 9px; padding: 1px 4px; border-radius: var(--radius-xs); background: var(--bg-element); color: var(--text-accent); margin-left: auto; }
.mcp-body { padding: var(--space-8); background: var(--bg-editor); display: flex; flex-direction: column; gap: var(--space-8); }
.form-row { display: flex; flex-direction: column; gap: var(--space-6); }
.form-label { font-size: 11px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-muted); }
.form-input { width: 100%; padding: 4px var(--space-8); height: 28px; background: var(--bg-element); border: 1px solid var(--border-variant); border-radius: var(--radius-xs); color: var(--text-primary); font-family: var(--font-ui); font-size: var(--font-size-ui); outline: none; }
.form-input.mono { font-family: var(--font-mono); font-size: 10px; }
.form-input:focus { background: var(--bg-editor); box-shadow: 0 0 0 1px var(--border-focused); }
.command-list { display: flex; flex-direction: column; gap: 2px; }
.command-row { display: flex; gap: var(--space-6); align-items: center; }
.command-row .form-input { flex: 1; }
.kv-remove { border: none; background: transparent; color: var(--text-muted); cursor: pointer; font-size: 14px; padding: 2px 4px; }
.kv-remove:hover { color: var(--error); }
.btn-add-cmd { align-self: flex-start; padding: 2px var(--space-6); background: transparent; border: 1px dashed var(--border-variant); border-radius: var(--radius-xs); color: var(--text-muted); cursor: pointer; font-size: var(--font-size-small); }
.btn-add-cmd:hover { color: var(--text-accent); }
.toggle-switch { width: 32px; height: 16px; border-radius: 8px; border: none; background: var(--bg-element); cursor: pointer; position: relative; padding: 0; }
.toggle-switch.on { background: var(--text-accent); }
.toggle-knob { position: absolute; top: 2px; left: 2px; width: 12px; height: 12px; border-radius: 50%; background: var(--text-primary); transition: transform var(--duration-fast) ease; }
.toggle-switch.on .toggle-knob { transform: translateX(16px); }
.field-hint { font-size: var(--font-size-small); color: var(--text-placeholder); }
.add-form { display: flex; gap: var(--space-6); align-items: center; }
.btn-add, .btn-cancel { padding: 4px var(--space-8); border-radius: var(--radius-xs); cursor: pointer; font-size: var(--font-size-ui); border: none; }
.btn-add { background: var(--text-accent); color: var(--bg-editor); }
.btn-cancel { background: transparent; color: var(--text-muted); }
.btn-add-server { display: inline-flex; align-items: center; gap: 4px; padding: var(--space-6) var(--space-8); background: transparent; border: 1px dashed var(--border-variant); border-radius: var(--radius-xs); color: var(--text-muted); cursor: pointer; font-size: var(--font-size-ui); }
.btn-add-server:hover { color: var(--text-primary); border-color: var(--text-accent); }
</style>
