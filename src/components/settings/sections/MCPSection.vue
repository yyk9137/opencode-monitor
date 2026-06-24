<script setup lang="ts">
import { computed, ref } from 'vue'
import { Plus, Trash2 } from 'lucide-vue-next'
import { useConfigStore } from '@/stores/config'
import JsonEditor from '../JsonEditor.vue'

const configStore = useConfigStore()
const showAddForm = ref(false)
const newName = ref('')

const mcpServers = computed(() => {
  return Object.entries(configStore.draft?.mcp ?? {}).map(([name, server]) => ({ name, server }))
})

function updateMcp(name: string, value: unknown) {
  if (!configStore.draft?.mcp) return
  configStore.draft.mcp[name] = value as never
  configStore.dirtyPaths.add(`mcp.${name}`)
}

function addServer() {
  const name = newName.value.trim()
  if (!name || !configStore.draft) return
  if (!configStore.draft.mcp) configStore.draft.mcp = {}
  // Default local server template
  configStore.draft.mcp[name] = { type: 'local', command: [] } as never
  configStore.dirtyPaths.add(`mcp.${name}`)
  newName.value = ''
  showAddForm.value = false
}

function clearServer(name: string) {
  if (!configStore.draft?.mcp) return
  // Can't delete via deep-merge, set to { enabled: false } (built-in disabled)
  configStore.draft.mcp[name] = { enabled: false } as never
  configStore.dirtyPaths.add(`mcp.${name}`)
}
</script>

<template>
  <div class="section-content">
    <h2 class="section-title">MCP Servers</h2>

    <p class="field-hint">
      MCP server configs are shown as JSON. Standard formats:
    </p>
    <pre class="format-example">{
  "type": "local",
  "command": ["npx", "-y", "@modelcontextprotocol/server-filesystem", "/path"],
  "environment": { "KEY": "value" },
  "cwd": ".",
  "enabled": true,
  "timeout": 5000
}
{
  "type": "remote",
  "url": "https://mcp.example.com/sse",
  "headers": { "Authorization": "Bearer ..." },
  "enabled": true,
  "timeout": 5000
}
{
  "enabled": false  // built-in server disable
}</pre>

    <div v-for="{ name, server } in mcpServers" :key="name" class="mcp-card">
      <div class="mcp-header">
        <span class="mcp-name">{{ name }}</span>
        <span class="mcp-type">{{ 'type' in server ? server.type : 'built-in' }}</span>
        <button class="btn-clear" @click="clearServer(name)">
          <Trash2 :size="10" /> Disable
        </button>
      </div>
      <JsonEditor
        :model-value="server"
        @update:model-value="updateMcp(name, $event)"
        @dirty="configStore.dirtyPaths.add(`mcp.${name}`)"
      />
    </div>

    <div v-if="showAddForm" class="add-form">
      <input v-model="newName" class="form-input" placeholder="server name" @keydown.enter="addServer" />
      <button class="btn-add" @click="addServer">Add</button>
      <button class="btn-cancel" @click="showAddForm = false">Cancel</button>
    </div>
    <button v-else class="btn-add-card" @click="showAddForm = true">
      <Plus :size="12" /> Add MCP Server
    </button>

    <p class="field-hint">
      Note: Servers cannot be deleted via config PATCH (deep-merge preserves existing keys).
      Use "Disable" to set <code>{ "enabled": false }</code>.
    </p>
  </div>
</template>

<style scoped>
.section-content { padding: var(--space-12) var(--space-16); display: flex; flex-direction: column; gap: var(--space-12); }
.section-title { font-size: var(--font-size-ui); font-weight: 600; color: var(--text-primary); text-transform: uppercase; letter-spacing: 0.06em; margin: 0; }
.field-hint { font-size: var(--font-size-small); color: var(--text-placeholder); }
.field-hint code { font-family: var(--font-mono); font-size: 10px; background: var(--bg-element); padding: 1px 4px; border-radius: var(--radius-xs); }
.format-example { font-family: var(--font-mono); font-size: 10px; color: var(--text-muted); background: var(--code-block-bg); border: 1px solid var(--border-variant); border-radius: var(--radius-xs); padding: var(--space-8); margin: 0; overflow-x: auto; line-height: 1.5; white-space: pre; }
.mcp-card { border: 1px solid var(--border-variant); border-radius: var(--radius-xs); overflow: hidden; }
.mcp-header { display: flex; align-items: center; gap: var(--space-6); padding: var(--space-6) var(--space-8); background: var(--bg-app); }
.mcp-name { flex: 1; font-size: var(--font-size-ui); color: var(--text-primary); }
.mcp-type { font-family: var(--font-mono); font-size: 9px; padding: 1px 4px; border-radius: var(--radius-xs); background: var(--bg-element); color: var(--text-accent); }
.btn-clear { display: inline-flex; align-items: center; gap: 4px; padding: 2px var(--space-6); background: transparent; border: 1px solid var(--error); border-radius: var(--radius-xs); color: var(--error); cursor: pointer; font-size: var(--font-size-small); }
.btn-clear:hover { background: rgba(217,87,87,0.1); }
.add-form { display: flex; gap: var(--space-6); align-items: center; }
.add-form .form-input { flex: 1; }
.form-input { padding: 4px var(--space-8); height: 28px; background: var(--bg-element); border: 1px solid var(--border-variant); border-radius: var(--radius-xs); color: var(--text-primary); font-family: var(--font-ui); font-size: var(--font-size-ui); outline: none; }
.form-input:focus { background: var(--bg-editor); box-shadow: 0 0 0 1px var(--border-focused); }
.btn-add, .btn-cancel { padding: 4px var(--space-8); border-radius: var(--radius-xs); cursor: pointer; font-size: var(--font-size-ui); border: none; }
.btn-add { background: var(--text-accent); color: var(--bg-editor); }
.btn-cancel { background: transparent; color: var(--text-muted); }
.btn-add-card { display: inline-flex; align-items: center; gap: 4px; padding: var(--space-6) var(--space-8); background: transparent; border: 1px dashed var(--border-variant); border-radius: var(--radius-xs); color: var(--text-muted); cursor: pointer; font-size: var(--font-size-ui); }
.btn-add-card:hover { color: var(--text-primary); border-color: var(--text-accent); }
</style>
