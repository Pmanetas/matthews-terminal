import { useCallback, useEffect, useRef, useState } from 'react'
import type { ConnectionStatus, Message, ImageAttachment } from '@/types'

// Persistent audio element — unlocked on first user tap so autoplay works on mobile
export const sharedAudio = typeof window !== 'undefined' ? new Audio() : null
let audioUnlocked = false

// ── Web Audio API analyser for sphere visualisation ──────────────
let audioContext: AudioContext | null = null
let analyser: AnalyserNode | null = null
let analyserData: Uint8Array<ArrayBuffer> | null = null
let gainNode: GainNode | null = null
let sourceConnected = false

function ensureAnalyser() {
  if (analyser || !sharedAudio) return
  try {
    audioContext = new (window.AudioContext || (window as any).webkitAudioContext)()
    analyser = audioContext.createAnalyser()
    analyser.fftSize = 256
    analyser.smoothingTimeConstant = 0.7
    analyserData = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount))
    gainNode = audioContext.createGain()
    gainNode.gain.value = 2.0 // Boost volume for iPhone speakers
    if (!sourceConnected) {
      const source = audioContext.createMediaElementSource(sharedAudio)
      source.connect(gainNode)
      gainNode.connect(analyser)
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

/** Unlock audio on user gesture — must be called repeatedly until it succeeds (iOS requirement) */
export function unlockAudio() {
  if (!sharedAudio) return
  ensureAnalyser()
  audioContext?.resume()
  // Don't overwrite src if audio is currently playing or already unlocked
  if (audioUnlocked || isPlayingAudio) return
  sharedAudio.src = 'data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA/+M4wAAAAAAAAAAAAEluZm8AAAAPAAAAAwAAAbAAqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq1dXV1dXV1dXV1dXV1dXV1dXV1dXV1dXV1dXV1dXV1dXV////////////////////////////////////////////AAAAAExhdmM1OC4xMwAAAAAAAAAAAAAAACQAAAAAAAAAAaC0MAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/+M4wAAAAANIAAAAAExBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVQ=='
  sharedAudio.play().then(() => { audioUnlocked = true }).catch(() => {})
}

if (typeof document !== 'undefined') {
  document.addEventListener('touchstart', unlockAudio, { once: false })
  document.addEventListener('click', unlockAudio, { once: false })

  // iOS suspends AudioContext and pauses audio when page goes to background.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return
    audioContext?.resume()
    if (!sharedAudio) return

    if (isPlayingAudio) {
      if (sharedAudio.paused && sharedAudio.src) {
        sharedAudio.play().catch(() => {
          setPlaying(false)
          if (_audioQueue.length > 0) {
            playNextAudio(_fallbackAudioDoneRef)
          }
        })
      }
    } else if (_audioQueue.length > 0) {
      playNextAudio(_fallbackAudioDoneRef)
    }
  })
}

const _fallbackAudioDoneRef: { current: (() => void) | undefined } = { current: undefined }

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

export function onAudioPlayingChange(cb: (playing: boolean) => void) {
  _onPlayingChange = cb
}

// Callback to stop mic when audio starts — set by VoiceChat
let _onAudioWillPlay: (() => void) | null = null
export function onAudioWillPlay(cb: () => void) { _onAudioWillPlay = cb }

function setPlaying(v: boolean) {
  if (isPlayingAudio !== v) {
    isPlayingAudio = v
    _onPlayingChange?.(v)
  }
}

function playNextAudio(onAudioDoneRef: { current: (() => void) | undefined }) {
  const queue = _audioQueue
  if (isPlayingAudio || queue.length === 0 || !sharedAudio) {
    if (isPlayingAudio) console.log('[Audio] playNextAudio skipped — already playing')
    if (queue.length === 0) console.log('[Audio] playNextAudio skipped — queue empty')
    return
  }

  console.log(`[Audio] ▶ Starting playback, queue=${queue.length}`)

  // Stop mic BEFORE playing audio so it doesn't pick up Matthew's voice
  _onAudioWillPlay?.()

  setPlaying(true)
  const item = queue.shift()!
  ensureAnalyser()
  audioContext?.resume()
  sharedAudio.volume = 1.0
  sharedAudio.src = item.url
  sharedAudio.onended = () => {
    console.log(`[Audio] ⏹ Playback ended, remaining=${queue.length}`)
    URL.revokeObjectURL(item.url)
    setPlaying(false)
    if (queue.length > 0) {
      playNextAudio(onAudioDoneRef)
    } else if (item.isFinal) {
      onAudioDoneRef.current?.()
    }
  }
  sharedAudio.play().then(() => {
    console.log('[Audio] ✓ play() succeeded')
    audioStartedForResult = true
    clearResultFallback()
    _onAudioStarted?.()
  }).catch((e) => {
    console.error('[Audio] ✗ Playback failed:', e)
    URL.revokeObjectURL(item.url)
    setPlaying(false)
    if (queue.length > 0) {
      setTimeout(() => playNextAudio(onAudioDoneRef), 100)
    }
  })
}

const _audioQueue: AudioQueueItem[] = []

export function stopAllAudio() {
  while (_audioQueue.length > 0) {
    const item = _audioQueue.pop()
    if (item) URL.revokeObjectURL(item.url)
  }
  if (sharedAudio) {
    sharedAudio.pause()
    sharedAudio.onended = null
    sharedAudio.removeAttribute('src')
    sharedAudio.load()
  }
  setPlaying(false)
}

export let audioStartedForResult = false
let _onAudioStarted: (() => void) | null = null
export function onAudioStarted(cb: () => void) { _onAudioStarted = cb }

// Fallback: if result arrives but no audio plays within timeout, fire onAudioDone anyway
let _resultFallbackTimer: ReturnType<typeof setTimeout> | null = null
function startResultFallback(onAudioDoneRef: { current: (() => void) | undefined }) {
  clearResultFallback()
  _resultFallbackTimer = setTimeout(() => {
    if (!isPlayingAudio && _audioQueue.length === 0) {
      onAudioDoneRef.current?.()
    }
  }, 6000)
}
function clearResultFallback() {
  if (_resultFallbackTimer) {
    clearTimeout(_resultFallbackTimer)
    _resultFallbackTimer = null
  }
}

// ── Hook ─────────────────────────────────────────────────────────

export function useBridge(onAudioDone?: () => void) {
  const [status, setStatus] = useState<ConnectionStatus>('disconnected')
  const [messages, setMessages] = useState<Message[]>([])
  const [workspace, setWorkspace] = useState<string | null>(null)
  const [workspacePath, setWorkspacePath] = useState<string | null>(null)
  const [activeFile, setActiveFile] = useState<string | null>(null)
  const [isWaiting, setIsWaiting] = useState(false)
  const [daemonConnected, setDaemonConnected] = useState(false)
  const [daemonLogs, setDaemonLogs] = useState<string[]>([])
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isReplayingRef = useRef(false)
  const replayBufferRef = useRef<Message[]>([])
  const onAudioDoneRef = useRef(onAudioDone)
  onAudioDoneRef.current = onAudioDone
  _fallbackAudioDoneRef.current = onAudioDone
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
        ws.send(JSON.stringify({ type: 'identify', client: 'phone' }))
        if (reconnectTimer.current) {
          clearTimeout(reconnectTimer.current)
          reconnectTimer.current = null
        }
      }

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          if (data.type === 'replay_start') {
            isReplayingRef.current = true
            replayBufferRef.current = []
            return
          } else if (data.type === 'replay_end') {
            isReplayingRef.current = false
            const buffered = replayBufferRef.current
            replayBufferRef.current = []
            if (buffered.length > 0) {
              setMessages(buffered)
            }
            return
          } else if (data.type === 'clear_history') {
            setMessages([])
            setDaemonLogs([])
            setIsWaiting(false)
            return
          } else if (data.type === 'user_command') {
            // Only add if replaying — live user_commands duplicate the local message
            if (isReplayingRef.current) {
              const msg: Message = { role: 'user' as const, text: data.text, timestamp: Date.now(), replayed: true }
              replayBufferRef.current.push(msg)
            }
            // Skip live user_command — we already added it locally in sendCommand
          } else if (data.type === 'tool_status') {
            const isNarration = typeof data.text === 'string' && data.text.startsWith('💬 ')
            const msg: Message = isNarration
              ? { role: 'assistant' as const, text: data.text.slice(2), timestamp: Date.now(), replayed: isReplayingRef.current, narration: true }
              : { role: 'tool' as const, text: data.text, timestamp: Date.now(), replayed: isReplayingRef.current }
            if (isReplayingRef.current) {
              replayBufferRef.current.push(msg)
            } else {
              setMessages((prev) => [...prev, msg])
            }
          } else if (data.type === 'narration') {
            const msg: Message = { role: 'assistant' as const, text: data.text, timestamp: Date.now(), replayed: isReplayingRef.current, narration: true }
            if (isReplayingRef.current) {
              replayBufferRef.current.push(msg)
            } else {
              setMessages((prev) => [...prev, msg])
            }
          } else if (data.type === 'status') {
            // Intermediate streaming text — ignore for visual display
          } else if (data.type === 'result') {
            if (!isReplayingRef.current) {
              audioStartedForResult = false
              startResultFallback(onAudioDoneRef)
            }
            setIsWaiting(false)
            const msg: Message = { role: 'assistant' as const, text: data.text, timestamp: Date.now(), replayed: isReplayingRef.current }
            if (isReplayingRef.current) {
              replayBufferRef.current.push(msg)
            } else {
              setMessages((prev) => [...prev, msg])
            }
          } else if (data.type === 'workspace') {
            setWorkspace(data.workspace || data.repo || null)
            setWorkspacePath(data.repo || null)
          } else if (data.type === 'active_file') {
            setActiveFile(data.file || null)
          } else if (data.type === 'extension_status') {
            setDaemonConnected(!!data.connected)
          } else if (data.type === 'daemon_log') {
            setDaemonLogs(prev => {
              const next = [...prev, data.text]
              return next.length > 200 ? next.slice(-200) : next
            })
          } else if (data.type === 'audio' && data.data) {
            try {
              const audioBytes = Uint8Array.from(atob(data.data), c => c.charCodeAt(0))
              const isWav = audioBytes[0] === 0x52 && audioBytes[1] === 0x49 && audioBytes[2] === 0x46 && audioBytes[3] === 0x46
              const blob = new Blob([audioBytes], { type: isWav ? 'audio/wav' : 'audio/mpeg' })
              const url = URL.createObjectURL(blob)
              console.log(`[Audio] Received ${Math.round(audioBytes.length / 1024)}KB ${isWav ? 'WAV' : 'MP3'}, queue=${audioQueueRef.current.length}, playing=${isPlayingAudio}, final=${!!data.final}`)
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
    (text: string, images?: ImageAttachment[]) => {
      unlockAudio()
      setIsWaiting(true)
      setMessages((prev) => [
        ...prev,
        { role: 'user' as const, text, timestamp: Date.now(), images },
      ])

      if (wsRef.current?.readyState === WebSocket.OPEN) {
        const payload: Record<string, unknown> = { type: 'command', text }
        if (images && images.length > 0) {
          payload.images = images
        }
        wsRef.current.send(JSON.stringify(payload))
      }
    },
    [],
  )

  const sendStop = useCallback(() => {
    stopAllAudio()
    setIsWaiting(false)
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'stop' }))
    }
  }, [])

  const sendNewChat = useCallback(() => {
    stopAllAudio()
    setMessages([])
    setDaemonLogs([])
    setIsWaiting(false)
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'new_chat' }))
    }
  }, [])

  useEffect(() => {
    connect()
    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current)
      wsRef.current?.close()
    }
  }, [connect])

  return { status, messages, sendCommand, sendStop, sendNewChat, workspace, workspacePath, activeFile, isWaiting, daemonConnected, daemonLogs }
}
