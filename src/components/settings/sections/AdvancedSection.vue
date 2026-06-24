<script setup lang="ts">
import { } from 'vue'
import { useConfigStore } from '@/stores/config'
import TagInput from '../TagInput.vue'
import JsonEditor from '../JsonEditor.vue'

const configStore = useConfigStore()

function updateField(field: string, value: unknown) {
  if (!configStore.draft) return
  ;(configStore.draft as Record<string, unknown>)[field] = value
  configStore.dirtyPaths.add(field)
}
</script>

<template>
  <div class="section-content">
    <h2 class="section-title">Advanced</h2>

    <!-- Server -->
    <div class="form-group">
      <h3 class="group-title">Server</h3>
      <div class="form-row">
        <label class="form-label">Port</label>
        <input :value="configStore.draft?.server?.port ?? ''" type="number" min="1" class="form-input" @input="updateField('server', { ...configStore.draft?.server, port: Number(($event.target as HTMLInputElement).value) || undefined })" />
      </div>
      <div class="form-row">
        <label class="form-label">Hostname</label>
        <input :value="configStore.draft?.server?.hostname ?? ''" type="text" class="form-input" @input="updateField('server', { ...configStore.draft?.server, hostname: ($event.target as HTMLInputElement).value || undefined })" />
      </div>
      <div class="form-row">
        <label class="form-label">mDNS</label>
        <button class="toggle-switch" :class="{ on: configStore.draft?.server?.mdns }" @click="updateField('server', { ...configStore.draft?.server, mdns: !configStore.draft?.server?.mdns })">
          <span class="toggle-knob" />
        </button>
      </div>
      <div class="form-row">
        <label class="form-label">CORS Domains</label>
        <TagInput :model-value="configStore.draft?.server?.cors ?? []" @update:model-value="updateField('server', { ...configStore.draft?.server, cors: $event })" @dirty="configStore.dirtyPaths.add('server.cors')" />
      </div>
    </div>

    <!-- Attachment -->
    <div class="form-group">
      <h3 class="group-title">Attachment</h3>
      <div class="form-row">
        <label class="form-label">Auto Resize</label>
        <button class="toggle-switch" :class="{ on: configStore.draft?.attachment?.image?.auto_resize }" @click="updateField('attachment', { ...configStore.draft?.attachment, image: { ...configStore.draft?.attachment?.image, auto_resize: !configStore.draft?.attachment?.image?.auto_resize } })">
          <span class="toggle-knob" />
        </button>
      </div>
      <div class="form-row">
        <label class="form-label">Max Width</label>
        <input :value="configStore.draft?.attachment?.image?.max_width ?? ''" type="number" min="1" class="form-input" @input="updateField('attachment', { ...configStore.draft?.attachment, image: { ...configStore.draft?.attachment?.image, max_width: Number(($event.target as HTMLInputElement).value) || undefined } })" />
      </div>
      <div class="form-row">
        <label class="form-label">Max Height</label>
        <input :value="configStore.draft?.attachment?.image?.max_height ?? ''" type="number" min="1" class="form-input" @input="updateField('attachment', { ...configStore.draft?.attachment, image: { ...configStore.draft?.attachment?.image, max_height: Number(($event.target as HTMLInputElement).value) || undefined } })" />
      </div>
    </div>

    <!-- Experimental -->
    <div class="form-group">
      <h3 class="group-title">Experimental</h3>
      <div class="form-row">
        <label class="form-label">Disable Paste Summary</label>
        <button class="toggle-switch" :class="{ on: configStore.draft?.experimental?.disable_paste_summary }" @click="updateField('experimental', { ...configStore.draft?.experimental, disable_paste_summary: !configStore.draft?.experimental?.disable_paste_summary })">
          <span class="toggle-knob" />
        </button>
      </div>
      <div class="form-row">
        <label class="form-label">Batch Tool</label>
        <button class="toggle-switch" :class="{ on: configStore.draft?.experimental?.batch_tool }" @click="updateField('experimental', { ...configStore.draft?.experimental, batch_tool: !configStore.draft?.experimental?.batch_tool })">
          <span class="toggle-knob" />
        </button>
      </div>
      <div class="form-row">
        <label class="form-label">OpenTelemetry</label>
        <button class="toggle-switch" :class="{ on: configStore.draft?.experimental?.openTelemetry }" @click="updateField('experimental', { ...configStore.draft?.experimental, openTelemetry: !configStore.draft?.experimental?.openTelemetry })">
          <span class="toggle-knob" />
        </button>
      </div>
      <div class="form-row">
        <label class="form-label">Continue Loop on Deny</label>
        <button class="toggle-switch" :class="{ on: configStore.draft?.experimental?.continue_loop_on_deny }" @click="updateField('experimental', { ...configStore.draft?.experimental, continue_loop_on_deny: !configStore.draft?.experimental?.continue_loop_on_deny })">
          <span class="toggle-knob" />
        </button>
      </div>
      <div class="form-row">
        <label class="form-label">Primary Tools</label>
        <TagInput :model-value="configStore.draft?.experimental?.primary_tools ?? []" @update:model-value="updateField('experimental', { ...configStore.draft?.experimental, primary_tools: $event })" @dirty="configStore.dirtyPaths.add('experimental.primary_tools')" />
      </div>
    </div>

    <!-- Snapshot -->
    <div class="form-group">
      <h3 class="group-title">Snapshot</h3>
      <div class="form-row">
        <label class="form-label">Enable Snapshot</label>
        <button class="toggle-switch" :class="{ on: configStore.draft?.snapshot }" @click="updateField('snapshot', !configStore.draft?.snapshot)">
          <span class="toggle-knob" />
        </button>
      </div>
    </div>

    <!-- Permission -->
    <div class="form-group">
      <h3 class="group-title">Permission</h3>
      <JsonEditor :model-value="configStore.draft?.permission" @update:model-value="updateField('permission', $event)" @dirty="configStore.dirtyPaths.add('permission')" />
    </div>

    <!-- Command -->
    <div class="form-group">
      <h3 class="group-title">Command (Map)</h3>
      <JsonEditor :model-value="configStore.draft?.command" @update:model-value="updateField('command', $event)" @dirty="configStore.dirtyPaths.add('command')" />
    </div>

    <!-- Tools -->
    <div class="form-group">
      <h3 class="group-title">Tools</h3>
      <JsonEditor :model-value="configStore.draft?.tools" @update:model-value="updateField('tools', $event)" @dirty="configStore.dirtyPaths.add('tools')" />
    </div>

    <!-- Deprecated fields (read-only) -->
    <div class="form-group deprecated">
      <h3 class="group-title">Deprecated Fields</h3>
      <div class="form-row">
        <label class="form-label">Layout (deprecated)</label>
        <input :value="configStore.draft?.layout ?? ''" type="text" class="form-input" readonly />
      </div>
      <div class="form-row">
        <label class="form-label">Autoshare (deprecated)</label>
        <input :value="configStore.draft?.autoshare ?? ''" type="text" class="form-input" readonly />
      </div>
    </div>
  </div>
</template>

<style scoped>
.section-content { padding: var(--space-12) var(--space-16); display: flex; flex-direction: column; gap: var(--space-16); }
.section-title { font-size: var(--font-size-ui); font-weight: 600; color: var(--text-primary); text-transform: uppercase; letter-spacing: 0.06em; margin: 0; }
.form-group { display: flex; flex-direction: column; gap: var(--space-8); padding: var(--space-8) 0; border-top: 1px solid var(--border-variant); }
.group-title { font-size: var(--font-size-ui); font-weight: 500; color: var(--text-muted); margin: 0; text-transform: uppercase; letter-spacing: 0.03em; }
.form-row { display: flex; flex-direction: column; gap: var(--space-6); }
.form-label { font-size: 11px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-muted); }
.form-input { width: 100%; padding: 4px var(--space-8); height: 28px; background: var(--bg-element); border: 1px solid var(--border-variant); border-radius: var(--radius-xs); color: var(--text-primary); font-family: var(--font-ui); font-size: var(--font-size-ui); outline: none; }
.form-input:focus { background: var(--bg-editor); box-shadow: 0 0 0 1px var(--border-focused); }
.form-input[readonly] { opacity: 0.5; }
.toggle-switch { width: 32px; height: 16px; border-radius: 8px; border: none; background: var(--bg-element); cursor: pointer; position: relative; padding: 0; }
.toggle-switch.on { background: var(--text-accent); }
.toggle-knob { position: absolute; top: 2px; left: 2px; width: 12px; height: 12px; border-radius: 50%; background: var(--text-primary); transition: transform var(--duration-fast) ease; }
.toggle-switch.on .toggle-knob { transform: translateX(16px); }
.deprecated .group-title { color: var(--text-placeholder); text-decoration: line-through; }
</style>
