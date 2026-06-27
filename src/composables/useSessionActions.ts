import { reactive, ref } from 'vue'
import { useSessionStore } from '@/stores/session'
import { useSessionMessages } from '@/composables/useSessionMessages'
import { useToast } from '@/composables/useToast'
import type { FileDiff, RevertResult } from '@/types'

const REVERT_ERRORS: Record<string, string> = {
  busy: 'Session is running — abort first',
  'not-found': 'Session or message not found',
  'bad-request': 'Invalid message ID',
}

export interface UseSessionActionsReturn {
  inFlight: Record<string, boolean>
  lastError: ReturnType<typeof ref<string | null>>
  diffFiles: ReturnType<typeof ref<FileDiff[]>>
  revertedMessageIds: ReturnType<typeof ref<Set<string>>>
  revert: (sessionId: string, messageID: string) => Promise<void>
  unrevert: (sessionId: string) => Promise<void>
  abortSession: (sessionId: string) => Promise<void>
  fork: (sessionId: string, messageID?: string) => Promise<void>
  viewDiff: (sessionId: string, messageID?: string) => Promise<void>
  refreshParts: (sessionId: string) => Promise<void>
  archiveSession: (sessionId: string) => Promise<void>
  unarchiveSession: (sessionId: string) => Promise<void>
  renameSession: (sessionId: string, newTitle: string) => Promise<void>
}

export function useSessionActions(): UseSessionActionsReturn {
  const store = useSessionStore()
  const { fetchParts } = useSessionMessages()
  const { toast } = useToast()

  const inFlight = reactive<Record<string, boolean>>({})
  const lastError = ref<string | null>(null)
  const diffFiles = ref<FileDiff[]>([])
  const revertedMessageIds = ref<Set<string>>(new Set())

  async function refreshParts(sessionId: string): Promise<void> {
    try {
      const fetched = await fetchParts(sessionId)
      // Use the store action so the shallowRef is actually reassigned —
      // the previous implementation built a new Map but never wrote it
      // back to store.sessions, so revert/unrevert produced no visible
      // effect on tool-call status, file diffs, or message content.
      store.setMessages(sessionId, fetched)
    } catch {
      // silently fail — the SSE will eventually catch up
    }
  }

  async function revert(sessionId: string, messageID: string): Promise<void> {
    const key = `${sessionId}:revert:${messageID}`
    if (inFlight[key]) return
    inFlight[key] = true
    try {
      const result = await store.revertMessage(sessionId, messageID)
      if (result.ok) {
        revertedMessageIds.value = new Set([...revertedMessageIds.value, messageID])
        toast('Message reverted', 'success')
        await refreshParts(sessionId)
      } else {
        const msg = REVERT_ERRORS[result.error] ?? 'Failed to revert message'
        toast(msg, 'error')
        lastError.value = msg
      }
    } finally {
      inFlight[key] = false
    }
  }

  async function unrevert(sessionId: string): Promise<void> {
    const key = `${sessionId}:unrevert`
    if (inFlight[key]) return
    inFlight[key] = true
    try {
      const result: RevertResult = await store.unrevertSession(sessionId)
      if (result.ok) {
        revertedMessageIds.value = new Set()
        toast('Messages restored', 'success')
        await refreshParts(sessionId)
      } else {
        const msg = result.error === 'busy' ? REVERT_ERRORS['busy'] : 'Failed to restore messages'
        toast(msg, 'error')
        lastError.value = msg
      }
    } finally {
      inFlight[key] = false
    }
  }

  async function abortSession(sessionId: string): Promise<void> {
    const key = `${sessionId}:abort`
    if (inFlight[key]) return
    inFlight[key] = true
    try {
      const result = await store.abortSession(sessionId)
      if (result.ok) {
        toast('Session aborted', 'success')
      } else {
        toast('Failed to abort session', 'error')
        lastError.value = result.error
      }
    } finally {
      inFlight[key] = false
    }
  }

  async function fork(sessionId: string, messageID?: string): Promise<void> {
    const key = `${sessionId}:fork:${messageID ?? ''}`
    if (inFlight[key]) return
    inFlight[key] = true
    try {
      const result = await store.forkSession(sessionId, messageID)
      if (result.ok) {
        toast('Session forked', 'success')
        await store.openTab(result.session.id)
      } else {
        toast('Failed to fork session', 'error')
        lastError.value = result.error
      }
    } finally {
      inFlight[key] = false
    }
  }

  async function viewDiff(sessionId: string, messageID?: string): Promise<void> {
    const key = `${sessionId}:diff:${messageID ?? ''}`
    if (inFlight[key]) return
    inFlight[key] = true
    try {
      diffFiles.value = await store.getSessionDiff(sessionId, messageID)
    } finally {
      inFlight[key] = false
    }
  }

  async function archiveSession(sessionId: string): Promise<void> {
    const key = `${sessionId}:archive`
    if (inFlight[key]) return
    inFlight[key] = true
    try {
      const result = await store.archiveSession(sessionId)
      if (result.ok) {
        toast('Session archived', 'success')
      } else {
        toast('Failed to archive session', 'error')
      }
    } finally {
      inFlight[key] = false
    }
  }

  async function unarchiveSession(sessionId: string): Promise<void> {
    const key = `${sessionId}:unarchive`
    if (inFlight[key]) return
    inFlight[key] = true
    try {
      const result = await store.unarchiveSession(sessionId)
      if (result.ok) {
        toast('Session restored', 'success')
      } else {
        toast('Failed to restore session', 'error')
      }
    } finally {
      inFlight[key] = false
    }
  }

  async function renameSession(sessionId: string, newTitle: string): Promise<void> {
    const key = `${sessionId}:rename`
    if (inFlight[key]) return
    inFlight[key] = true
    try {
      const result = await store.renameSession(sessionId, newTitle)
      if (!result.ok) {
        toast('Failed to rename session', 'error')
      }
    } finally {
      inFlight[key] = false
    }
  }

  return {
    inFlight,
    lastError,
    diffFiles,
    revertedMessageIds,
    revert,
    unrevert,
    abortSession,
    fork,
    viewDiff,
    refreshParts,
    archiveSession,
    unarchiveSession,
    renameSession,
  }
}
