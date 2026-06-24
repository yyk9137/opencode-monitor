import { onMounted } from 'vue'
import { marked } from 'marked'
import DOMPurify from 'dompurify'

// ── Marked configuration (applied once) ────────────────────────────
let markedConfigured = false

function ensureMarked() {
  if (markedConfigured) return
  marked.use({
    renderer: {
      link({ href, title, text }) {
        const titleAttr = title ? ` title="${title}"` : ''
        return `<a href="${href}"${titleAttr} class="external-link" target="_blank" rel="noopener noreferrer">${text}</a>`
      },
    },
  })
  markedConfigured = true
}

// ── Module-level shared LRU cache ──────────────────────────────────
// Shared across ALL MarkdownContent instances. Switching back to a
// previously-rendered session = cache hit = instant display.
const renderCache = new Map<string, string>()
const CACHE_MAX = 200

function getCached(text: string): string | undefined {
  const cached = renderCache.get(text)
  if (cached !== undefined) {
    renderCache.delete(text)
    renderCache.set(text, cached)
  }
  return cached
}

function setCached(text: string, html: string) {
  if (renderCache.size >= CACHE_MAX) {
    const oldestKey = renderCache.keys().next().value
    if (oldestKey !== undefined) renderCache.delete(oldestKey)
  }
  renderCache.set(text, html)
}

// ── Composable ─────────────────────────────────────────────────────
export function useMarkdown() {
  onMounted(() => {
    ensureMarked()
  })

  // Synchronous cache check — for instant render on cache hits
  function getCachedRender(text: string): string | undefined {
    return getCached(text)
  }

  // Parse markdown to HTML (sync — marked is fast enough for main thread)
  function renderMarkdown(text: string): string {
    if (!text) return ''
    ensureMarked()

    // Cache hit
    const cached = getCached(text)
    if (cached !== undefined) return cached

    // Parse + sanitize
    const html = marked.parse(text, { async: false }) as string
    const sanitized = DOMPurify.sanitize(html)
    setCached(text, sanitized)
    return sanitized
  }

  return { renderMarkdown, getCachedRender }
}
