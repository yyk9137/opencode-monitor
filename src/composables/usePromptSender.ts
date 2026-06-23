import { fetch } from '@tauri-apps/plugin-http'
import { useSessionStore } from '@/stores/session'

interface UsePromptSenderReturn {
  sendPrompt: (sessionId: string, text: string) => Promise<void>
}

export function usePromptSender(): UsePromptSenderReturn {
  const store = useSessionStore()

  async function sendPrompt(sessionId: string, text: string): Promise<void> {
    const node = store.sessions.get(sessionId)
    if (!node) {
      throw new Error(`Session ${sessionId} not found`)
    }

    if (node.inferredState === 'running') {
      throw new Error(`Session ${sessionId} is already running`)
    }

    // Multi-instance: send the prompt to the server that owns this session.
    const url = node.instanceUrl || store.baseUrl

    const body = {
      prompt: { text },
      id: `msg_${crypto.randomUUID()}`,  // SessionMessage.ID requires "msg_" prefix
      delivery: 'queue' as const,
    }

    const response = await fetch(`${url}/api/session/${sessionId}/prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      throw new Error(`Failed to send prompt: ${response.status} ${response.statusText}`)
    }
  }

  return { sendPrompt }
}
