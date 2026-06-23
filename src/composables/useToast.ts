import { ref } from 'vue'

export interface Toast {
  id: number
  message: string
  type: 'success' | 'error' | 'info'
  ttl: number  // milliseconds, 0 = no auto-dismiss
}

const toasts = ref<Toast[]>([])
let nextId = 0

export interface UseToastReturn {
  toasts: typeof toasts
  toast: (message: string, type?: Toast['type'], ttl?: number) => void
  dismiss: (id: number) => void
}

export function useToast(): UseToastReturn {
  function toast(message: string, type: Toast['type'] = 'info', ttl: number = 4000): void {
    const id = ++nextId
    toasts.value = [...toasts.value, { id, message, type, ttl }]
    if (ttl > 0) {
      setTimeout(() => dismiss(id), ttl)
    }
  }

  function dismiss(id: number): void {
    toasts.value = toasts.value.filter(t => t.id !== id)
  }

  return { toasts, toast, dismiss }
}
