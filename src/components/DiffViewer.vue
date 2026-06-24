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
.diff-viewer {
  font-family: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Consolas', monospace;
  font-size: 12px;
  line-height: 1.5;
}

.diff-hunk {
  margin-bottom: 8px;
  border: 1px solid var(--border);
  border-radius: 4px;
  overflow: hidden;
}

.diff-hunk-header {
  padding: 4px 8px;
  background: var(--surface);
  color: var(--text-muted);
  font-size: 11px;
  border-bottom: 1px solid var(--border);
  white-space: nowrap;
  overflow-x: auto;
}

.diff-lines {
  overflow-x: auto;
}

.diff-line {
  display: flex;
  white-space: pre;
}

.diff-line-sign {
  flex-shrink: 0;
  width: 16px;
  text-align: center;
  user-select: none;
  color: var(--text-muted);
}

.diff-line-text {
  flex: 1;
  white-space: pre-wrap;
  word-break: break-all;
}

.diff-line--added {
  background: rgba(112, 191, 86, 0.12);
}

.diff-line--added .diff-line-sign {
  color: #70bf56;
}

.diff-line--removed {
  background: rgba(217, 87, 87, 0.12);
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
  font-size: 12px;
  text-align: center;
}
</style>
