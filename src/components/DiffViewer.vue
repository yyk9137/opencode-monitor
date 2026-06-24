<template>
  <div class="diff-viewer">
    <template v-if="hunks.length > 0">
      <div
        v-for="(hunk, hi) in hunks"
        :key="hi"
        class="diff-hunk"
      >
        <div class="diff-hunk-header">{{ hunk.header }}</div>
        <div class="diff-lines">
          <div
            v-for="(line, li) in hunk.lines"
            :key="li"
            class="diff-line"
            :class="`diff-line--${line.type}`"
          >
            <span class="diff-line-sign">{{ line.sign }}</span>
            <span class="diff-line-text">{{ line.text }}</span>
          </div>
        </div>
      </div>
    </template>
    <p v-else class="diff-empty">No diff content available.</p>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  content?: string
}>()

interface DiffLine {
  type: 'added' | 'removed' | 'context'
  sign: '+' | '-' | ' '
  text: string
}

interface DiffHunk {
  header: string
  lines: DiffLine[]
}

const hunks = computed<DiffHunk[]>(() => {
  if (!props.content) return []
  const lines = props.content.split('\n')
  const result: DiffHunk[] = []
  let currentHunk: DiffHunk | null = null

  for (const raw of lines) {
    // Hunk header: @@ -start,count +start,count @@ context
    if (raw.startsWith('@@')) {
      if (currentHunk) result.push(currentHunk)
      currentHunk = { header: raw, lines: [] }
      continue
    }

    // Skip file headers (--- a/file, +++ b/file)
    if (raw.startsWith('---') || raw.startsWith('+++')) {
      continue
    }

    if (!currentHunk) {
      // Lines before first hunk header — skip
      continue
    }

    if (raw.startsWith('+')) {
      currentHunk.lines.push({ type: 'added', sign: '+', text: raw.slice(1) })
    } else if (raw.startsWith('-')) {
      currentHunk.lines.push({ type: 'removed', sign: '-', text: raw.slice(1) })
    } else if (raw.startsWith(' ')) {
      currentHunk.lines.push({ type: 'context', sign: ' ', text: raw.slice(1) })
    } else if (raw === '') {
      // Empty line — treat as context
      currentHunk.lines.push({ type: 'context', sign: ' ', text: '' })
    }
  }

  if (currentHunk) result.push(currentHunk)
  return result
})
</script>

<style scoped>
/* Zed `cat -n`-style differential — render_tool_call(read) 风格 */
.diff-viewer {
  font-family: var(--font-mono);
  font-size: var(--font-size-code);     /* 13px — Zed agent_buffer_font_size */
  line-height: 1.75;                    /* buffer_font_size * 1.75 */
  letter-spacing: 0;
  color: var(--text-primary);
}

.diff-hunk {
  margin: 8px 0 12px 0;                 /* md_3 mt, md_4 mb — Zed margin */
  border: 1px solid var(--code-block-border);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.diff-hunk-header {
  padding: 4px 8px;
  background: var(--bg-element);
  color: var(--text-muted);
  font-size: var(--font-size-small);     /* 12px */
  font-weight: 500;
  border-bottom: 1px solid var(--border-variant);
  white-space: nowrap;
  overflow-x: auto;
  letter-spacing: 0;
}

.diff-lines {
  overflow-x: auto;
  background: var(--code-block-bg);     /* editor.background — same as code block */
}

.diff-line {
  display: flex;
  white-space: pre;
  letter-spacing: 0;
  border-left: 3px solid transparent;   /* gutter reservation */
}

.diff-line-sign {
  flex-shrink: 0;
  width: 24px;
  text-align: center;
  user-select: none;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
  opacity: 0.7;
}

.diff-line-text {
  flex: 1;
  white-space: pre-wrap;
  word-break: break-all;
  padding-right: 8px;
}

.diff-line--added {
  background: rgba(112, 191, 86, 0.10);   /* vcs.created.background (#294113) blend */
  border-left-color: #70bf56;             /* vcs.created */
}

.diff-line--added .diff-line-sign {
  color: #70bf56;
}

.diff-line--removed {
  background: rgba(217, 87, 87, 0.12);    /* vcs.deleted.background (#48161b) blend */
  border-left-color: #d95757;             /* vcs.deleted */
}

.diff-line--removed .diff-line-sign {
  color: #d95757;
}

.diff-line--context {
  background: transparent;
}

.diff-empty {
  padding: 12px;
  color: var(--text-muted);
  font-size: var(--font-size-small);
  text-align: center;
}
</style>
