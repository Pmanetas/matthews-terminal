export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected'

export type MessageRole = 'user' | 'assistant' | 'tool'

export interface Message {
  role: MessageRole
  text: string
  timestamp: number
  streaming?: boolean
}
