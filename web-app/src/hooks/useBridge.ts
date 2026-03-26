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
  if (audioUnlocked) return
  sharedAudio.src = 'data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA/+M4wAAAAAAAAAAAAEluZm8AAAAPAAAAAwAAAbAAqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq1dXV1dXV1dXV1dXV1dXV1dXV1dXV1dXV1dXV1dXV1dXV////////////////////////////////////////////AAAAAExhdmM1OC4xMwAAAAAAAAAAAAAAACQAAAAAAAAAAaC0MAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/+M4wAAAAANIAAAAAExBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVQ=='
  sharedAudio.play().then(() => { audioUnlocked = true }).catch(() => {})
}

if (typeof document !== 'undefined') {
  document.addEventListener('touchstart', unlockAudio, { once: false })
  document.addEventListener('click', unlockAudio, { once: false })
}

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

function setPlaying(v: boolean) {
  if (isPlayingAudio !== v) {
    isPlayingAudio = v
    _onPlayingChange?.(v)
  }
}

/** Generate a short silent WAV buffer (duration in seconds) */
function createSilentWav(duration: number, sampleRate = 44100): Blob {
  const numSamples = Math.floor(sampleRate * duration)
  const dataSize = numSamples * 2 // 16-bit mono
  const buf = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buf)
  // WAV header
  const writeStr = (offset: number, str: string) => { for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i)) }
  writeStr(0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeStr(8, 'WAVE')
  writeStr(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeStr(36, 'data')
  view.setUint32(40, dataSize, true)
  // Data is already zeros (silence)
  return new Blob([new Uint8Array(buf)], { type: 'audio/wav' })
}

// Pre-generate 0.5s silent WAV for iOS audio hardware wake-up
const silentWavBlob = createSilentWav(0.5)

function playNextAudio(onAudioDoneRef: { current: (() => void) | undefined }) {
  const queue = _audioQueue
  if (isPlayingAudio || queue.length === 0 || !sharedAudio) return

  setPlaying(true)
  const item = queue.shift()!
  ensureAnalyser()
  audioContext?.resume()
  sharedAudio.volume = 1.0

  // iOS fix: play a short silent WAV first to wake up audio hardware,
  // then immediately play the real audio
  const playSilenceThenAudio = () => {
    if (!sharedAudio) return
    const silentBlob = silentWavBlob
    const silentUrl = URL.createObjectURL(silentBlob)
    sharedAudio.src = silentUrl
    sharedAudio.onended = () => {
      URL.revokeObjectURL(silentUrl)
      // Now play the real audio — hardware is awake
      if (!sharedAudio) return
      sharedAudio.src = item.url
      sharedAudio.onended = () => {
        URL.revokeObjectURL(item.url)
        setPlaying(false)
        if (queue.length > 0) {
          playNextAudio(onAudioDoneRef)
        } else if (item.isFinal) {
          onAudioDoneRef.current?.()
        }
      }
      sharedAudio.play().then(() => {
        audioStartedForResult = true
        _onAudioStarted?.()
      }).catch(() => {
        setPlaying(false)
        if (queue.length > 0) setTimeout(() => playNextAudio(onAudioDoneRef), 100)
      })
    }
    sharedAudio.play().catch(() => {
      // If silent play fails, try real audio directly
      URL.revokeObjectURL(silentUrl)
      playDirect()
    })
  }

  const playDirect = () => {
    if (!sharedAudio) return
    sharedAudio.src = item.url
    sharedAudio.onended = () => {
      URL.revokeObjectURL(item.url)
      setPlaying(false)
      if (queue.length > 0) {
        playNextAudio(onAudioDoneRef)
      } else if (item.isFinal) {
        onAudioDoneRef.current?.()
      }
    }
    sharedAudio.play().then(() => {
      audioStartedForResult = true
      _onAudioStarted?.()
    }).catch((e) => {
      console.error('[Audio] Playback failed:', e)
      URL.revokeObjectURL(item.url)
      setPlaying(false)
      if (queue.length > 0) setTimeout(() => playNextAudio(onAudioDoneRef), 100)
    })
  }

  // Use silence primer on first audio of a batch, direct for subsequent
  if (!audioStartedForResult) {
    playSilenceThenAudio()
  } else {
    playDirect()
  }
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

// ── Hook ─────────────────────────────────────────────────────────

export function useBridge(onAudioDone?: () => void) {
  const [status, setStatus] = useState<ConnectionStatus>('disconnected')
  const [messages, setMessages] = useState<Message[]>([])
  const [workspace, setWorkspace] = useState<string | null>(null)
  const [activeFile, setActiveFile] = useState<string | null>(null)
  const [isWaiting, setIsWaiting] = useState(false)
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
        ws.send(JSON.stringify({ type: 'identify', client: 'phone' }))
        if (reconnectTimer.current) {
          clearTimeout(reconnectTimer.current)
          reconnectTimer.current = null
        }
      }

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          if (data.type === 'user_command') {
            // Replayed from bridge history
            setMessages((prev) => [
              ...prev,
              { role: 'user' as const, text: data.text, timestamp: Date.now() },
            ])
          } else if (data.type === 'tool_status') {
            setMessages((prev) => [
              ...prev,
              { role: 'tool' as const, text: data.text, timestamp: Date.now() },
            ])
          } else if (data.type === 'status') {
            // Intermediate streaming text — ignore for visual display
          } else if (data.type === 'result') {
            audioStartedForResult = false
            setIsWaiting(false)
            setMessages((prev) => [
              ...prev,
              { role: 'assistant' as const, text: data.text, timestamp: Date.now() },
            ])
          } else if (data.type === 'workspace') {
            setWorkspace(data.workspace || data.repo || null)
          } else if (data.type === 'active_file') {
            setActiveFile(data.file || null)
          } else if (data.type === 'audio' && data.data) {
            try {
              const audioBytes = Uint8Array.from(atob(data.data), c => c.charCodeAt(0))
              const isWav = audioBytes[0] === 0x52 && audioBytes[1] === 0x49 && audioBytes[2] === 0x46 && audioBytes[3] === 0x46
              const blob = new Blob([audioBytes], { type: isWav ? 'audio/wav' : 'audio/mpeg' })
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
    (text: string, images?: ImageAttachment[]) => {
      // User gesture context — unlock audio for iOS so TTS can play
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

  useEffect(() => {
    connect()
    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current)
      wsRef.current?.close()
    }
  }, [connect])

  return { status, messages, sendCommand, sendStop, workspace, activeFile, isWaiting }
}
