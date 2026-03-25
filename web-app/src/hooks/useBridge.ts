import { useCallback, useEffect, useRef, useState } from 'react'
import type { ConnectionStatus, Message } from '@/types'

// Persistent audio element — unlocked on first user tap so autoplay works on mobile
export const sharedAudio = typeof window !== 'undefined' ? new Audio() : null
let audioUnlocked = false

// ── Web Audio API analyser for sphere visualisation ──────────────
let audioContext: AudioContext | null = null
let analyser: AnalyserNode | null = null
let analyserData: Uint8Array<ArrayBuffer> | null = null
let sourceConnected = false

function ensureAnalyser() {
  if (analyser || !sharedAudio) return
  try {
    audioContext = new (window.AudioContext || (window as any).webkitAudioContext)()
    analyser = audioContext.createAnalyser()
    analyser.fftSize = 256
    analyser.smoothingTimeConstant = 0.7
    analyserData = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount))
    if (!sourceConnected) {
      const source = audioContext.createMediaElementSource(sharedAudio)
      source.connect(analyser)
      analyser.connect(audioContext.destination)
      sourceConnected = true
    }
  } catch (e) {
    console.error('[Audio] Analyser setup failed:', e)
  }
}

/** Returns 0–1 amplitude of current audio playback */
export function getAudioLevel(): number {
  if (!analyser || !analyserData) return 0
  analyser.getByteFrequencyData(analyserData)
  let sum = 0
  for (let i = 0; i < analyserData.length; i++) sum += analyserData[i]
  return Math.min(1, (sum / analyserData.length / 128))
}

function unlockAudio() {
  if (audioUnlocked || !sharedAudio) return
  // Play a silent buffer to unlock audio on iOS
  sharedAudio.src = 'data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA/+M4wAAAAAAAAAAAAEluZm8AAAAPAAAAAwAAAbAAqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq1dXV1dXV1dXV1dXV1dXV1dXV1dXV1dXV1dXV1dXV1dXV////////////////////////////////////////////AAAAAExhdmM1OC4xMwAAAAAAAAAAAAAAACQAAAAAAAAAAaC0MAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/+M4wAAAAANIAAAAAExBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVQ=='
  sharedAudio.play().then(() => { audioUnlocked = true }).catch(() => {})
  // Also init analyser on user gesture (required for AudioContext)
  ensureAnalyser()
  audioContext?.resume()
}

// Call this on any user interaction
if (typeof document !== 'undefined') {
  document.addEventListener('touchstart', unlockAudio, { once: true })
  document.addEventListener('click', unlockAudio, { once: true })
}

// Auto-detect: if served from the bridge, use same host. Otherwise use env var or localhost.
function getWsUrl(): string {
  if (import.meta.env.VITE_BRIDGE_URL) return import.meta.env.VITE_BRIDGE_URL
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${window.location.host}`
}
const WS_URL = getWsUrl()
const RECONNECT_INTERVAL = 3000

interface AudioQueueItem {
  url: string
  isFinal: boolean
}

let isPlayingAudio = false
let _onPlayingChange: ((playing: boolean) => void) | null = null

/** Subscribe to audio playing state changes */
export function onAudioPlayingChange(cb: (playing: boolean) => void) {
  _onPlayingChange = cb
}

function setPlaying(v: boolean) {
  if (isPlayingAudio !== v) {
    isPlayingAudio = v
    _onPlayingChange?.(v)
  }
}

function playNextAudio(onAudioDoneRef: { current: (() => void) | undefined }) {
  const queue = _audioQueue
  if (isPlayingAudio || queue.length === 0 || !sharedAudio) return

  setPlaying(true)
  const item = queue.shift()!
  ensureAnalyser()
  audioContext?.resume()
  sharedAudio.volume = 1.0
  sharedAudio.src = item.url
  sharedAudio.play().catch((e) => {
    console.error('[Audio] Playback failed:', e)
    setPlaying(false)
  })
  sharedAudio.onended = () => {
    URL.revokeObjectURL(item.url)
    setPlaying(false)
    if (queue.length > 0) {
      playNextAudio(onAudioDoneRef)
    } else if (item.isFinal) {
      onAudioDoneRef.current?.()
    }
  }
}

const _audioQueue: AudioQueueItem[] = []

/** Stop all audio playback and clear the queue */
export function stopAllAudio() {
  // Clear queue
  while (_audioQueue.length > 0) {
    const item = _audioQueue.pop()
    if (item) URL.revokeObjectURL(item.url)
  }
  // Stop current playback
  if (sharedAudio) {
    sharedAudio.pause()
    sharedAudio.currentTime = 0
    sharedAudio.onended = null
    sharedAudio.src = ''
  }
  setPlaying(false)
}

export function useBridge(onAudioDone?: () => void) {
  const [status, setStatus] = useState<ConnectionStatus>('disconnected')
  const [messages, setMessages] = useState<Message[]>([])
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onAudioDoneRef = useRef(onAudioDone)
  onAudioDoneRef.current = onAudioDone
  const audioQueueRef = useRef(_audioQueue)

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
          if (data.type === 'tool_status') {
            setMessages((prev) => {
              // Aggressively collapse consecutive tool calls on the SAME file
              const last = prev[prev.length - 1]
              if (last && last.role === 'tool') {
                // Extract file/target from tool text (everything after the action word, minus count suffix)
                const getTarget = (text: string) => {
                  const line = text.split('\n')[0]
                  const clean = line.replace(/\s*\(\d+\s+steps?\)\s*$/, '')
                  const m = clean.match(/^\w+\s+(.+)$/)
                  return m?.[1] || ''
                }
                const lastTarget = getTarget(last.text)
                const newTarget = getTarget(data.text)

                if (lastTarget && newTarget && lastTarget === newTarget) {
                  // Same file — collapse into single entry with step count, keep latest diff lines
                  const countMatch = last.text.match(/\((\d+) steps?\)/)
                  const count = countMatch ? parseInt(countMatch[1], 10) + 1 : 2
                  const newLines = data.text.split('\n')
                  const actionMatch = newLines[0].match(/^(\w+)\s+(.+)$/)
                  if (actionMatch) {
                    const label = count === 1 ? 'step' : 'steps'
                    const header = `${actionMatch[1]} ${actionMatch[2]} (${count} ${label})`
                    // Keep diff lines (⊖/⊕) from the latest tool call
                    const diffLines = newLines.slice(1).filter((l: string) => l.trim().startsWith('⊖') || l.trim().startsWith('⊕'))
                    const merged = diffLines.length > 0 ? header + '\n' + diffLines.join('\n') : header
                    return [...prev.slice(0, -1), { role: 'tool' as const, text: merged, timestamp: Date.now() }]
                  }
                }
              }
              return [...prev, { role: 'tool' as const, text: data.text, timestamp: Date.now() }]
            })
          } else if (data.type === 'status') {
            // Intermediate streaming text — don't show on screen (spoken via TTS only)
            // Just ignore for visual display
          } else if (data.type === 'result') {
            // Final response — the only visible assistant message
            setMessages((prev) => [
              ...prev,
              { role: 'assistant' as const, text: data.text, timestamp: Date.now() },
            ])
          } else if (data.type === 'audio' && data.data) {
            try {
              const audioBytes = Uint8Array.from(atob(data.data), c => c.charCodeAt(0))
              const blob = new Blob([audioBytes], { type: 'audio/mpeg' })
              const url = URL.createObjectURL(blob)
              audioQueueRef.current.push({ url, isFinal: !!data.final })
              playNextAudio(onAudioDoneRef)
            } catch (e) {
              console.error('[Audio] Error:', e)
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
