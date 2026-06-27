import { fetch } from '@tauri-apps/plugin-http'
import { useSessionStore } from '@/stores/session'
import type { MessagePart } from '@/types'

// Legacy API response shape (GET /session/:id/message)
// Returns { info, parts }[] where parts include text, tool, reasoning, step-finish, etc.
export interface LegacyMessageInfo {
  id: string
  sessionID: string
  role: string  // 'user' | 'assistant' | 'system' | etc.
  time?: { created: string | number }
  [key: string]: unknown
}

export interface LegacyPart {
  id: string
  sessionID: string
  messageID: string
  type: string  // 'text' | 'tool' | 'reasoning' | 'step-start' | 'step-finish' | etc.
  text?: string
  reason?: string
  tool?: { name: string }
  state?: { status: string; output?: unknown; error?: string }
  [key: string]: unknown
}

export interface LegacyWithParts {
  info: LegacyMessageInfo
  parts: LegacyPart[]
}

interface UseSessionMessagesReturn {
  fetchParts: (sessionId: string) => Promise<MessagePart[]>
}

// Bound the number of backfilled parts to limit memory + dedup cost.
// Child-state inference for <task> tags already ran at bootstrap,
// so truncating historical parts is safe for subagent list accuracy.
const BACKFILL_PART_LIMIT = 80

export function useSessionMessages(): UseSessionMessagesReturn {
  const store = useSessionStore()

  async function fetchParts(sessionId: string): Promise<MessagePart[]> {
    const node = store.sessions.get(sessionId)
    const url = node?.instanceUrl || store.baseUrl
    const response = await fetch(`${url}/session/${sessionId}/message`)
    if (!response.ok) return []
    const body: LegacyWithParts[] = await response.json()
    const parts: MessagePart[] = []
    for (const msg of body) {
      for (const part of msg.parts) {
        parts.push(part as unknown as MessagePart)
      }
    }
    // Bounds memory + dedup cost for long sessions.
    // Child-state inference for <task> tags already ran at bootstrap.
    if (parts.length > BACKFILL_PART_LIMIT) {
      return parts.slice(-BACKFILL_PART_LIMIT)
    }
    return parts
  }

  return { fetchParts }
}
