import { useCallback, useEffect, useRef, useState } from 'react'
import type { ConnectionStatus, Message } from '@/types'

// Auto-detect: if served from the bridge, use same host. Otherwise use env var or localhost.
function getWsUrl(): string {
  if (import.meta.env.VITE_BRIDGE_URL) return import.meta.env.VITE_BRIDGE_URL
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${window.location.host}`
}
const WS_URL = getWsUrl()
const RECONNECT_INTERVAL = 3000

export function useBridge() {
  const [status, setStatus] = useState<ConnectionStatus>('disconnected')
  const [messages, setMessages] = useState<Message[]>([])
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN ||
        wsRef.current?.readyState === WebSocket.CONNECTING) {
      return
    }

    setStatus('connecting')

    try {
      const ws = new WebSocket(WS_URL)
      wsRef.current = ws

      ws.onopen = () => {
        setStatus('connected')
        // Identify as phone client
        ws.send(JSON.stringify({ type: 'identify', client: 'phone' }))
        if (reconnectTimer.current) {
          clearTimeout(reconnectTimer.current)
          reconnectTimer.current = null
        }
      }

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          if (data.type === 'status') {
            // Streaming: update the last assistant message in-place (or create one)
            setMessages((prev) => {
              const last = prev[prev.length - 1]
              if (last && last.role === 'assistant' && last.streaming) {
                // Replace the streaming message
                return [...prev.slice(0, -1), { role: 'assistant' as const, text: data.text, timestamp: Date.now(), streaming: true }]
              }
              // Create new streaming message
              return [...prev, { role: 'assistant' as const, text: data.text, timestamp: Date.now(), streaming: true }]
            })
          } else if (data.type === 'result') {
            // Final response: replace streaming message or add new one
            setMessages((prev) => {
              const last = prev[prev.length - 1]
              if (last && last.role === 'assistant' && last.streaming) {
                return [...prev.slice(0, -1), { role: 'assistant' as const, text: data.text, timestamp: Date.now() }]
              }
              return [...prev, { role: 'assistant' as const, text: data.text, timestamp: Date.now() }]
            })
          } else if (data.type === 'audio' && data.data) {
            // Play ElevenLabs audio
            try {
              const audioBytes = Uint8Array.from(atob(data.data), c => c.charCodeAt(0))
              const blob = new Blob([audioBytes], { type: 'audio/mpeg' })
              const url = URL.createObjectURL(blob)
              const audio = new Audio(url)
              audio.play().catch(() => {})
              audio.onended = () => URL.revokeObjectURL(url)
            } catch {
              // audio playback failed silently
            }
          }
        } catch {
          // ignore malformed messages
        }
      }

      ws.onclose = () => {
        setStatus('disconnected')
        wsRef.current = null
        scheduleReconnect()
      }

      ws.onerror = () => {
        ws.close()
      }
    } catch {
      setStatus('disconnected')
      scheduleReconnect()
    }
  }, [])

  const scheduleReconnect = useCallback(() => {
    if (reconnectTimer.current) return
    reconnectTimer.current = setTimeout(() => {
      reconnectTimer.current = null
      connect()
    }, RECONNECT_INTERVAL)
  }, [connect])

  const sendCommand = useCallback(
    (text: string) => {
      // Add user message immediately
      setMessages((prev) => [
        ...prev,
        { role: 'user' as const, text, timestamp: Date.now() },
      ])

      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'command', text }))
      }
    },
    [],
  )

  useEffect(() => {
    connect()
    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current)
      wsRef.current?.close()
    }
  }, [connect])

  return { status, messages, sendCommand }
}
