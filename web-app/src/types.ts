export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected'

export type MessageRole = 'user' | 'assistant'

export interface Message {
  role: MessageRole
  text: string
  timestamp: number
}
