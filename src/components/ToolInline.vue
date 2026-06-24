<template>
  <!--
    Inline tool row — visual fidelity target: Zed render_tool_call_label.
    A single slim row: icon → label → status → (hover-only) chevron.
    On click the body expands inline below (no border, editor-bg).
    Body content can be provided via the default slot OR via #body when
    a fallback is needed (for inline tools we always have a body).
  -->
  <div class="tool-inline" :class="{ 'tool-inline--expanded': expanded }">
    <button
      type="button"
      class="tool-inline__row"
      :aria-expanded="expanded ? 'true' : 'false'"
      @click="$emit('toggle')"
    >
      <FileIcon
        v-if="filePath"
        :file-name="filePath"
        :size="13"
        class="tool-inline__icon"
      />
      <component
        v-else
        :is="icon"
        :size="13"
        class="tool-inline__icon"
      />
      <span class="tool-inline__label">
        {{ label }}
      </span>
      <span class="tool-inline__status" :data-status="statusKey">
        <Loader2 v-if="status === 'running'" :size="10" class="spin" />
        <CheckCircle2 v-else-if="status === 'completed'" :size="10" />
        <XCircle v-else-if="status === 'error'" :size="10" />
        <Circle v-else :size="9" />
      </span>
      <span
        v-if="hasBody"
        class="tool-inline__disclosure"
        aria-hidden="true"
      >
        <component
          :is="expanded ? ChevronUp : ChevronDown"
          :size="11"
        />
      </span>
    </button>
    <div
      v-show="expanded && hasBody"
      class="tool-inline__body"
    >
      <slot name="body">
        <MarkdownContent :text="outputText" />
      </slot>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, type Component } from 'vue'
import {
  ArrowLeftRight,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Circle,
  FileX,
  Globe,
  Loader2,
  Pencil,
  Search,
  Wrench,
  XCircle,
} from 'lucide-vue-next'
import FileIcon from '@/components/FileIcon.vue'
import MarkdownContent from '@/components/MarkdownContent.vue'
import type { ToolPart } from '@/types'

const props = defineProps<{
  tool: ToolPart
  expanded: boolean
}>()

defineEmits<{
  (e: 'toggle'): void
}>()

const filePath = computed<string | null>(() => extractFilePath(props.tool))

const icon = computed<Component>(() => iconFor(props.tool.tool))

const label = computed<string>(() => {
  const path = filePath.value
  if (path) return filepathTail(path)
  switch (props.tool.tool) {
    case 'grep':
    case 'ast_grep_search':
      return descOf(props.tool) || props.tool.tool
    case 'webfetch':
      return descOf(props.tool) || 'fetching…'
    default:
      return props.tool.tool || 'tool'
  }
})

const statusKey = computed<string>(() => props.tool.state?.status ?? 'pending')
const status = computed<string>(() => statusKey.value)

const outputRaw = computed<unknown>(() => props.tool.state?.output)
const errorRaw = computed<string | undefined>(() => props.tool.state?.error)

const outputText = computed<string>(() => {
  const err = errorRaw.value
  if (err) return err
  const out = outputRaw.value
  if (typeof out === 'string') return out
  if (out === undefined || out === null) return ''
  try {
    return JSON.stringify(out, null, 2)
  } catch {
    return String(out)
  }
})

const hasBody = computed<boolean>(() => {
  return Boolean(errorRaw.value) || (outputText.value?.length ?? 0) > 0
})

// ─── Helpers ──────────────────────────────────────────────────────────

function extractFilePath(tool: ToolPart): string | null {
  const input = tool.state?.input
  if (typeof input !== 'object' || !input) return null
  const obj = input as Record<string, unknown>
  const str = (k: string) =>
    k in obj && typeof obj[k] === 'string' ? (obj[k] as string) : null
  return (
    str('filePath') ??
    str('path') ??
    str('pattern') ??
    (Array.isArray(obj.paths) && obj.paths.length
      ? String(obj.paths[0])
      : null)
  )
}

function descOf(tool: ToolPart): string {
  const input = tool.state?.input
  if (typeof input !== 'object' || !input) return ''
  const obj = input as Record<string, unknown>
  const str = (k: string) =>
    k in obj && typeof obj[k] === 'string' ? (obj[k] as string) : null
  const candidate =
    str('pattern') ??
    str('query') ??
    str('url') ??
    str('path')
  if (candidate) return filepathTail(candidate)
  return ''
}

function filepathTail(p: string): string {
  // Strip CWD-ish prefixes; show last 2 segments to keep labels compact.
  const trimmed = p.replace(/^[./\\]+/, '')
  const segs = trimmed.split(/[\\/]/)
  if (segs.length <= 2) return trimmed
  return segs.slice(-2).join('/')
}

function iconFor(name: string): Component {
  if (
    ['read','glob','grep','ast_grep_search','aft_outline','aft_zoom','aft_search','aft_inspect'].includes(name)
  ) return Search
  if (['edit','write','apply_patch','aft_refactor','ast_grep_replace','aft_import'].includes(name))
    return Pencil
  if (['aft_delete'].includes(name)) return FileX
  if (['aft_move'].includes(name)) return ArrowLeftRight
  if (['bash','bash_write','bash_status','bash_watch','bash_kill'].includes(name))
    return Wrench
  if (['webfetch'].includes(name)) return Globe
  return Wrench
}
</script>

<style scoped>
/* ─── Inline tool row — Zed render_tool_call_label ──────────────────
   Icon → label → status → (hover) disclosure. Single horizontal line,
   6px gaps, 22px min-height, sits in message-stream rhythm (no
   background, no border by default). */

.tool-inline {
  display: flex;
  flex-direction: column;
  min-width: 0;
  margin: 1px 0;
}

.tool-inline__row {
  display: inline-flex;
  align-items: center;
  gap: var(--tool-gap);                 /* Zed gap_1p5 = 6px */
  min-height: var(--tool-row-height);   /* 22px */
  padding: 2px 6px 2px 0;               /* subtle right-side breathing */
  background: transparent;
  border: none;
  border-radius: var(--radius-xs);
  color: var(--text-primary);
  font-family: var(--font-mono);
  font-size: var(--font-size-code);
  text-align: left;
  cursor: pointer;
  user-select: none;
  max-width: 100%;
  transition:
    background var(--duration-fast) var(--ease-out-quint);
}

.tool-inline__row:hover {
  background: var(--bg-hover);
}

.tool-inline__row:focus-visible {
  outline: none;
  box-shadow: 0 0 0 1px var(--border-focused);
}

.tool-inline__icon {
  color: var(--text-muted);
  flex-shrink: 0;
  opacity: 0.78;
  /* Align with label baseline — Lucide strokes are slightly off-center */
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.tool-inline__label {
  font-family: var(--font-mono);
  font-size: var(--font-size-code);
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
  flex-shrink: 1;
  padding-right: 2px;
}

.tool-inline__status {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  flex-shrink: 0;
  opacity: 0.85;
}

.tool-inline__status[data-status='pending']   { color: var(--warning); }
.tool-inline__status[data-status='running']   { color: var(--info); }
.tool-inline__status[data-status='completed'] { color: var(--success); }
.tool-inline__status[data-status='error']     { color: var(--error); }

.tool-inline__disclosure {
  display: inline-flex;
  align-items: center;
  margin-left: 2px;
  color: var(--text-muted);
  opacity: var(--tool-disclosure-opacity);
  transition: opacity var(--duration-fast) var(--ease-out-quint);
  flex-shrink: 0;
}

.tool-inline__row:hover .tool-inline__disclosure,
.tool-inline--expanded .tool-inline__disclosure {
  opacity: 0.85;
}

/* ─── Inline body (when expanded) ─── */
.tool-inline__body {
  padding: 4px 0 4px calc(var(--tool-gap) + 13px + var(--tool-gap));
  /* 6px (gap) + 13px (icon) + 6px (gap) = label-column indent */
  color: var(--text-muted);
  font-size: var(--font-size-code);
  line-height: 1.55;
  max-height: 320px;
  overflow-y: auto;
  background: rgba(13, 16, 22, 0.40);
  border-radius: var(--radius-xs);
  padding-top: 4px;
  padding-bottom: 4px;
}

.tool-inline__body :deep(.markdown-content) {
  font-size: var(--font-size-code);
  color: var(--text-muted);
  line-height: 1.55;
}

.tool-inline__body :deep(.markdown-content > *) {
  margin-bottom: 4px;
}
</style>
