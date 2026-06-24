<script setup lang="ts">
import { computed, ref } from 'vue'
import { Plus, Trash2, Server, Globe, ChevronDown, ChevronRight } from 'lucide-vue-next'
import { useConfigStore } from '@/stores/config'
import type { McpLocalConfig, McpRemoteConfig } from '@/types/opencode-config'

const configStore = useConfigStore()
const expanded = ref<string | null>(null)
const showAddForm = ref(false)
const newName = ref('')
const newType = ref<'local' | 'remote'>('local')

// Env/header row editor state
interface KVRow { key: string; value: string }

const mcpServers = computed(() => {
  return Object.entries(configStore.draft?.mcp ?? {}).map(([name, server]) => ({ name, server }))
})

function toggleExpand(name: string) {
  expanded.value = expanded.value === name ? null : name
}

function isLocal(server: unknown): server is McpLocalConfig {
  return typeof server === 'object' && server !== null && (server as McpLocalConfig).type === 'local'
}
function isRemote(server: unknown): server is McpRemoteConfig {
  return typeof server === 'object' && server !== null && (server as McpRemoteConfig).type === 'remote'
}
function isBuiltIn(server: unknown): boolean {
  return typeof server === 'object' && server !== null && !('type' in server)
}

// ── Type switching (clears transport-specific fields) ───────────────────
function switchType(name: string, type: 'local' | 'remote') {
  if (!configStore.draft?.mcp?.[name]) return
  if (type === 'local') {
    configStore.draft.mcp[name] = {
      type: 'local',
      command: [],
      environment: (configStore.draft.mcp[name] as McpLocalConfig).environment ?? {},
      enabled: true,
    } as never
  } else {
    configStore.draft.mcp[name] = {
      type: 'remote',
      url: '',
      enabled: true,
    } as never
  }
  configStore.dirtyPaths.add(`mcp.${name}`)
}

// ── Field updates ────────────────────────────────────────────────────────
function updateField(name: string, field: string, value: unknown) {
  if (!configStore.draft?.mcp?.[name]) return
  ;(configStore.draft.mcp[name] as unknown as Record<string, unknown>)[field] = value
  configStore.dirtyPaths.add(`mcp.${name}.${field}`)
}

// ── Command array editor ─────────────────────────────────────────────────
function updateCommandArg(name: string, index: number, value: string) {
  if (!configStore.draft?.mcp?.[name]) return
  const server = configStore.draft.mcp[name] as McpLocalConfig
  if (!Array.isArray(server.command)) return
  const arr = [...server.command]
  arr[index] = value
  updateField(name, 'command', arr)
}
function removeCommandArg(name: string, index: number) {
  if (!configStore.draft?.mcp?.[name]) return
  const server = configStore.draft.mcp[name] as McpLocalConfig
  if (!Array.isArray(server.command)) return
  const arr = [...server.command]
  arr.splice(index, 1)
  updateField(name, 'command', arr)
}
function addCommandArg(name: string) {
  if (!configStore.draft?.mcp?.[name]) return
  const server = configStore.draft.mcp[name] as McpLocalConfig
  if (!Array.isArray(server.command)) return
  updateField(name, 'command', [...server.command, ''])
}

// ── Environment / Headers (Record<string,string> ↔ KVRow[]) ──────────────
function recordToKV(record: Record<string, string> | undefined): KVRow[] {
  if (!record) return []
  return Object.entries(record).map(([key, value]) => ({ key, value }))
}
function kvToRecord(rows: KVRow[]): Record<string, string> {
  const result: Record<string, string> = {}
  for (const row of rows) {
    if (row.key.trim()) result[row.key.trim()] = row.value
  }
  return result
}

function updateEnvRow(name: string, index: number, field: 'key' | 'value', value: string) {
  if (!configStore.draft?.mcp?.[name]) return
  const server = configStore.draft.mcp[name] as McpLocalConfig
  const rows = recordToKV(server.environment)
  rows[index][field] = value
  updateField(name, 'environment', kvToRecord(rows))
}
function addEnvRow(name: string) {
  if (!configStore.draft?.mcp?.[name]) return
  const server = configStore.draft.mcp[name] as McpLocalConfig
  const rows = recordToKV(server.environment)
  rows.push({ key: '', value: '' })
  updateField(name, 'environment', kvToRecord(rows))
}
function removeEnvRow(name: string, index: number) {
  if (!configStore.draft?.mcp?.[name]) return
  const server = configStore.draft.mcp[name] as McpLocalConfig
  const rows = recordToKV(server.environment)
  rows.splice(index, 1)
  updateField(name, 'environment', kvToRecord(rows))
}

function updateHeaderRow(name: string, index: number, field: 'key' | 'value', value: string) {
  if (!configStore.draft?.mcp?.[name]) return
  const server = configStore.draft.mcp[name] as McpRemoteConfig
  const rows = recordToKV(server.headers)
  rows[index][field] = value
  updateField(name, 'headers', kvToRecord(rows))
}
function addHeaderRow(name: string) {
  if (!configStore.draft?.mcp?.[name]) return
  const server = configStore.draft.mcp[name] as McpRemoteConfig
  const rows = recordToKV(server.headers)
  rows.push({ key: '', value: '' })
  updateField(name, 'headers', kvToRecord(rows))
}
function removeHeaderRow(name: string, index: number) {
  if (!configStore.draft?.mcp?.[name]) return
  const server = configStore.draft.mcp[name] as McpRemoteConfig
  const rows = recordToKV(server.headers)
  rows.splice(index, 1)
  updateField(name, 'headers', kvToRecord(rows))
}

// ── OAuth toggle ─────────────────────────────────────────────────────────
function toggleOauth(name: string, enabled: boolean) {
  if (enabled) {
    updateField(name, 'oauth', {})
  } else {
    updateField(name, 'oauth', false)
  }
}

// ── Add / Disable server ─────────────────────────────────────────────────
function addServer() {
  const name = newName.value.trim()
  if (!name || !configStore.draft) return
  if (!configStore.draft.mcp) configStore.draft.mcp = {}
  if (configStore.draft.mcp[name]) { expanded.value = name; showAddForm.value = false; return }
  if (newType.value === 'local') {
    configStore.draft.mcp[name] = { type: 'local', command: [], enabled: true } as never
  } else {
    configStore.draft.mcp[name] = { type: 'remote', url: '', enabled: true } as never
  }
  configStore.dirtyPaths.add(`mcp.${name}`)
  newName.value = ''
  showAddForm.value = false
  expanded.value = name
}

function disableServer(name: string) {
  if (!configStore.draft?.mcp) return
  configStore.draft.mcp[name] = { enabled: false } as never
  configStore.dirtyPaths.add(`mcp.${name}`)
}
</script>

<template>
  <div class="section-content">
    <h2 class="section-title">MCP Servers</h2>

    <div v-for="{ name, server } in mcpServers" :key="name" class="mcp-card">
      <button class="mcp-header" @click="toggleExpand(name)">
        <component :is="expanded === name ? ChevronDown : ChevronRight" :size="12" />
        <component :is="isLocal(server) ? Server : isRemote(server) ? Globe : Server" :size="12" class="mcp-type-icon" />
        <span class="mcp-name">{{ name }}</span>
        <span class="mcp-type-badge">{{ isBuiltIn(server) ? 'built-in' : (isLocal(server) ? 'local' : 'remote') }}</span>
      </button>

      <div v-if="expanded === name" class="mcp-body">
        <!-- Built-in: only enable/disable -->
        <template v-if="isBuiltIn(server)">
          <div class="form-row">
            <label class="form-label">Enabled</label>
            <button class="toggle-switch" :class="{ on: server.enabled }" @click="updateField(name, 'enabled', !server.enabled)">
              <span class="toggle-knob" />
            </button>
          </div>
          <p class="field-hint">Built-in MCP server.</p>
        </template>

        <template v-else>
          <!-- Type selector -->
          <div class="form-row">
            <label class="form-label">Type</label>
            <div class="type-selector">
              <button class="type-btn" :class="{ active: isLocal(server) }" @click="switchType(name, 'local')">Local (stdio)</button>
              <button class="type-btn" :class="{ active: isRemote(server) }" @click="switchType(name, 'remote')">Remote (SSE)</button>
            </div>
          </div>

          <!-- Enabled toggle -->
          <div class="form-row">
            <label class="form-label">Enabled</label>
            <button class="toggle-switch" :class="{ on: server.enabled }" @click="updateField(name, 'enabled', !server.enabled)">
              <span class="toggle-knob" />
            </button>
          </div>

          <!-- Timeout -->
          <div class="form-row">
            <label class="form-label">Timeout (ms)</label>
            <input :value="(server as unknown as Record<string, unknown>).timeout ?? ''" type="number" min="1" class="form-input" placeholder="5000" @input="updateField(name, 'timeout', Number(($event.target as HTMLInputElement).value) || undefined)" />
          </div>

          <!-- Local fields -->
          <template v-if="isLocal(server)">
            <div class="form-row">
              <label class="form-label">Command (argv)</label>
              <div class="command-list">
                <div v-for="(cmd, i) in (server.command || [])" :key="i" class="command-row">
                  <input :value="cmd" class="form-input mono" @input="updateCommandArg(name, i, ($event.target as HTMLInputElement).value)" />
                  <button class="kv-remove" @click="removeCommandArg(name, i)">×</button>
                </div>
                <button class="btn-add-cmd" @click="addCommandArg(name)">+ Add argument</button>
              </div>
            </div>

            <div class="form-row">
              <label class="form-label">Working Directory</label>
              <input :value="server.cwd ?? ''" type="text" class="form-input mono" @input="updateField(name, 'cwd', ($event.target as HTMLInputElement).value || undefined)" />
            </div>

            <!-- Environment variables -->
            <div class="form-row">
              <label class="form-label">Environment Variables</label>
              <div class="kv-list">
                <div v-for="(row, i) in recordToKV(server.environment)" :key="i" class="kv-row">
                  <input :value="row.key" class="form-input mono kv-key" placeholder="KEY" @input="updateEnvRow(name, i, 'key', ($event.target as HTMLInputElement).value)" />
                  <input :value="row.value" class="form-input mono kv-value" placeholder="value" @input="updateEnvRow(name, i, 'value', ($event.target as HTMLInputElement).value)" />
                  <button class="kv-remove" @click="removeEnvRow(name, i)">×</button>
                </div>
                <button class="btn-add-cmd" @click="addEnvRow(name)">+ Add variable</button>
              </div>
            </div>
          </template>

          <!-- Remote fields -->
          <template v-if="isRemote(server)">
            <div class="form-row">
              <label class="form-label">URL</label>
              <input :value="server.url ?? ''" type="text" class="form-input mono" placeholder="https://mcp.example.com/sse" @input="updateField(name, 'url', ($event.target as HTMLInputElement).value || undefined)" />
            </div>

            <!-- Headers -->
            <div class="form-row">
              <label class="form-label">Headers</label>
              <div class="kv-list">
                <div v-for="(row, i) in recordToKV(server.headers)" :key="i" class="kv-row">
                  <input :value="row.key" class="form-input mono kv-key" placeholder="Header" @input="updateHeaderRow(name, i, 'key', ($event.target as HTMLInputElement).value)" />
                  <input :value="row.value" class="form-input mono kv-value" placeholder="value" @input="updateHeaderRow(name, i, 'value', ($event.target as HTMLInputElement).value)" />
                  <button class="kv-remove" @click="removeHeaderRow(name, i)">×</button>
                </div>
                <button class="btn-add-cmd" @click="addHeaderRow(name)">+ Add header</button>
              </div>
            </div>

            <!-- OAuth -->
            <div class="form-row">
              <label class="form-label">OAuth Authentication</label>
              <button class="toggle-switch" :class="{ on: typeof server.oauth === 'object' && server.oauth !== null }" @click="toggleOauth(name, !(typeof server.oauth === 'object' && server.oauth !== null))">
                <span class="toggle-knob" />
              </button>
            </div>

            <template v-if="typeof server.oauth === 'object' && server.oauth !== null">
              <div class="form-row">
                <label class="form-label">Client ID</label>
                <input :value="server.oauth?.clientId ?? ''" type="text" class="form-input" @input="updateField(name, 'oauth', { ...server.oauth, clientId: ($event.target as HTMLInputElement).value || undefined })" />
              </div>
              <div class="form-row">
                <label class="form-label">Client Secret</label>
                <input :value="server.oauth?.clientSecret ?? ''" type="password" class="form-input" @input="updateField(name, 'oauth', { ...server.oauth, clientSecret: ($event.target as HTMLInputElement).value || undefined })" />
              </div>
              <div class="form-row">
                <label class="form-label">Scope</label>
                <input :value="server.oauth?.scope ?? ''" type="text" class="form-input" @input="updateField(name, 'oauth', { ...server.oauth, scope: ($event.target as HTMLInputElement).value || undefined })" />
              </div>
              <div class="form-row">
                <label class="form-label">Redirect URI</label>
                <input :value="server.oauth?.redirectUri ?? ''" type="text" class="form-input" @input="updateField(name, 'oauth', { ...server.oauth, redirectUri: ($event.target as HTMLInputElement).value || undefined })" />
              </div>
            </template>
          </template>

          <!-- Actions -->
          <div class="card-actions">
            <button class="btn-delete" @click="disableServer(name)"><Trash2 :size="11" /> Disable</button>
          </div>
        </template>
      </div>
    </div>

    <!-- Add server form -->
    <div v-if="showAddForm" class="add-form">
      <div class="add-form-inner">
        <input v-model="newName" class="form-input" placeholder="server name" @keydown.enter="addServer" />
        <div class="type-selector">
          <button class="type-btn" :class="{ active: newType === 'local' }" @click="newType = 'local'">Local (stdio)</button>
          <button class="type-btn" :class="{ active: newType === 'remote' }" @click="newType = 'remote'">Remote (SSE)</button>
        </div>
        <div class="add-form-actions">
          <button class="btn-add" @click="addServer" :disabled="!newName.trim()">Add</button>
          <button class="btn-cancel" @click="showAddForm = false">Cancel</button>
        </div>
      </div>
    </div>
    <button v-else class="btn-add-card" @click="showAddForm = true"><Plus :size="12" /> Add MCP Server</button>

    <p class="field-hint">Servers cannot be deleted via config (deep-merge preserves keys). Use "Disable" to set <code>{ enabled: false }</code>.</p>
  </div>
</template>

<style scoped>
.section-content { padding: var(--space-12) var(--space-16); display: flex; flex-direction: column; gap: var(--space-12); }
.section-title { font-size: var(--font-size-ui); font-weight: 600; color: var(--text-primary); text-transform: uppercase; letter-spacing: 0.06em; margin: 0; }
.mcp-card { border: 1px solid var(--border-variant); border-radius: var(--radius-xs); overflow: hidden; }
.mcp-header { display: flex; align-items: center; gap: var(--space-6); width: 100%; padding: var(--space-6) var(--space-8); background: var(--bg-app); border: none; color: var(--text-primary); cursor: pointer; font-family: var(--font-ui); font-size: var(--font-size-ui); text-align: left; }
.mcp-header:hover { background: var(--bg-hover); }
.mcp-type-icon { color: var(--text-muted); }
.mcp-name { flex: 1; }
.mcp-type-badge { font-family: var(--font-mono); font-size: 9px; padding: 1px 4px; border-radius: var(--radius-xs); background: var(--bg-element); color: var(--text-accent); }
.mcp-body { padding: var(--space-8); background: var(--bg-editor); display: flex; flex-direction: column; gap: var(--space-8); }
.form-row { display: flex; flex-direction: column; gap: var(--space-6); }
.form-label { font-size: 11px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-muted); }
.form-input { width: 100%; padding: 4px var(--space-8); height: 28px; background: var(--bg-element); border: 1px solid var(--border-variant); border-radius: var(--radius-xs); color: var(--text-primary); font-family: var(--font-ui); font-size: var(--font-size-ui); outline: none; }
.form-input.mono { font-family: var(--font-mono); font-size: 10px; }
.form-input:focus { background: var(--bg-editor); box-shadow: 0 0 0 1px var(--border-focused); }
.type-selector { display: flex; gap: 2px; }
.type-btn { flex: 1; padding: 4px var(--space-8); background: var(--bg-element); border: 1px solid var(--border-variant); border-radius: var(--radius-xs); color: var(--text-muted); cursor: pointer; font-size: var(--font-size-small); }
.type-btn.active { background: var(--bg-selected); color: var(--text-accent); border-color: var(--text-accent); }
.command-list, .kv-list { display: flex; flex-direction: column; gap: 2px; }
.command-row, .kv-row { display: flex; gap: var(--space-4); align-items: center; }
.command-row .form-input { flex: 1; }
.kv-key { max-width: 120px; }
.kv-value { flex: 1; }
.kv-remove { border: none; background: transparent; color: var(--text-muted); cursor: pointer; font-size: 14px; padding: 2px 4px; border-radius: var(--radius-xs); }
.kv-remove:hover { color: var(--error); }
.btn-add-cmd { align-self: flex-start; padding: 2px var(--space-6); background: transparent; border: 1px dashed var(--border-variant); border-radius: var(--radius-xs); color: var(--text-muted); cursor: pointer; font-size: var(--font-size-small); }
.btn-add-cmd:hover { color: var(--text-accent); }
.toggle-switch { width: 32px; height: 16px; border-radius: 8px; border: none; background: var(--bg-element); cursor: pointer; position: relative; padding: 0; }
.toggle-switch.on { background: var(--text-accent); }
.toggle-knob { position: absolute; top: 2px; left: 2px; width: 12px; height: 12px; border-radius: 50%; background: var(--text-primary); transition: transform var(--duration-fast) ease; }
.toggle-switch.on .toggle-knob { transform: translateX(16px); }
.card-actions { display: flex; justify-content: flex-end; }
.btn-delete { display: inline-flex; align-items: center; gap: 4px; padding: 4px var(--space-8); background: transparent; border: 1px solid var(--error); border-radius: var(--radius-xs); color: var(--error); cursor: pointer; font-size: var(--font-size-small); }
.btn-delete:hover { background: rgba(217,87,87,0.1); }
.field-hint { font-size: var(--font-size-small); color: var(--text-placeholder); }
.field-hint code { font-family: var(--font-mono); font-size: 10px; background: var(--bg-element); padding: 1px 4px; border-radius: var(--radius-xs); }
.add-form { border: 1px solid var(--border-variant); border-radius: var(--radius-xs); padding: var(--space-8); background: var(--bg-editor); }
.add-form-inner { display: flex; flex-direction: column; gap: var(--space-8); }
.add-form-actions { display: flex; gap: var(--space-6); }
.btn-add, .btn-cancel { padding: 4px var(--space-8); border-radius: var(--radius-xs); cursor: pointer; font-size: var(--font-size-ui); border: none; }
.btn-add { background: var(--text-accent); color: var(--bg-editor); }
.btn-add:disabled { opacity: 0.4; cursor: not-allowed; }
.btn-cancel { background: transparent; color: var(--text-muted); }
.btn-add-card { display: inline-flex; align-items: center; gap: 4px; padding: var(--space-6) var(--space-8); background: transparent; border: 1px dashed var(--border-variant); border-radius: var(--radius-xs); color: var(--text-muted); cursor: pointer; font-size: var(--font-size-ui); }
.btn-add-card:hover { color: var(--text-primary); border-color: var(--text-accent); }
</style>
