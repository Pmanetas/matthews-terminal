export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected'

export type MessageRole = 'user' | 'assistant' | 'tool'

export interface ImageAttachment {
  data: string       // base64-encoded image data
  mimeType: string   // e.g. 'image/png', 'image/jpeg'
  name?: string
}

export interface Message {
  role: MessageRole
  text: string
  timestamp: number
  streaming?: boolean
  images?: ImageAttachment[]
  replayed?: boolean
  narration?: boolean
  engine?: 'claude' | 'codex'
}
