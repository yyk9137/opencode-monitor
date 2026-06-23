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

export function useSessionMessages(): UseSessionMessagesReturn {
  const store = useSessionStore()

  async function fetchParts(sessionId: string): Promise<MessagePart[]> {
    // Use legacy API endpoint which returns full conversation with parts.
    // V2 endpoint (/api/session/:id/message) only returns metadata messages.
    // Multi-instance: the session may live on a different server than the
    // first-known one — look it up via its tagged instanceUrl.
    const node = store.sessions.get(sessionId)
    const url = node?.instanceUrl || store.baseUrl
    const response = await fetch(`${url}/session/${sessionId}/message`)
    if (!response.ok) return []
    const body: LegacyWithParts[] = await response.json()

    // Flatten all parts from all messages into a single array, preserving order
    const parts: MessagePart[] = []
    for (const msg of body) {
      for (const part of msg.parts) {
        // Convert legacy part to our MessagePart type
        // The part already has the right shape (id, sessionID, messageID, type, etc.)
        parts.push(part as unknown as MessagePart)
      }
    }
    return parts
  }

  return { fetchParts }
}
