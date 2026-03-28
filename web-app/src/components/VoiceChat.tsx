import { useEffect, useRef, useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Mic, MicOff, ArrowUp, Square, Camera, X, FileText, Terminal, Search, Pencil, FilePlus, CheckCircle2, ListTodo, Globe, Wrench, LoaderCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { VoiceWaveform } from '@/components/VoiceWaveform'
import { MarkdownMessage } from '@/components/MarkdownMessage'
import { useBridge, sharedAudio, getAudioLevel, onAudioPlayingChange, stopAllAudio, audioStartedForResult, onAudioStarted, onAudioWillPlay } from '@/hooks/useBridge'
import { useVoice } from '@/hooks/useVoice'
import { resizeImage, MAX_IMAGE_SIZE } from '@/lib/image-utils'
import type { ImageAttachment } from '@/types'

// ── Helpers ──────────────────────────────────────────────────────

function ToolIcon({ text }: { text: string }) {
  const t = text.toLowerCase()
  if (t.startsWith('reading')) return <FileText className="w-3.5 h-3.5 text-violet-400" />
  if (t.startsWith('running')) return <Terminal className="w-3.5 h-3.5 text-violet-400" />
  if (t.startsWith('searching')) return <Search className="w-3.5 h-3.5 text-violet-400" />
  if (t.startsWith('editing')) return <Pencil className="w-3.5 h-3.5 text-violet-400" />
  if (t.startsWith('creating')) return <FilePlus className="w-3.5 h-3.5 text-violet-400" />
  if (t.startsWith('planning') || t.startsWith('checking task')) return <ListTodo className="w-3.5 h-3.5 text-violet-400" />
  if (t.startsWith('searching the web') || t.startsWith('fetching')) return <Globe className="w-3.5 h-3.5 text-violet-400" />
  if (t.startsWith('looking up')) return <Wrench className="w-3.5 h-3.5 text-violet-400" />
  return <CheckCircle2 className="w-3.5 h-3.5 text-violet-400" />
}

function parseDiffStats(lines: string[]): { added: number; removed: number } {
  let added = 0, removed = 0
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.startsWith('⊕')) added++
    else if (trimmed.startsWith('⊖')) removed++
  }
  return { added, removed }
}

function ToolContent({ text, expanded }: { text: string; expanded: boolean }) {
  const lines = text.split('\n')
  const header = lines[0]
  const diffLines = lines.slice(1)
  const { added, removed } = parseDiffStats(diffLines)
  const hasDiff = added > 0 || removed > 0

  return (
    <div className="flex flex-col min-w-0 w-full">
      <div className="flex items-center gap-2">
        <span className="text-[13px] text-white/50 leading-tight">{header}</span>
        {hasDiff && (
          <span className="flex items-center gap-1.5 text-[11px] shrink-0 ml-auto">
            {added > 0 && <span className="text-emerald-400/70">+{added}</span>}
            {removed > 0 && <span className="text-red-400/70">-{removed}</span>}
          </span>
        )}
      </div>
      <AnimatePresence>
        {expanded && diffLines.length > 0 && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
            className="overflow-hidden"
          >
            <div className="mt-2 rounded-lg overflow-hidden border border-white/[0.06] bg-black/40">
              <div className="overflow-x-auto max-h-[200px] overflow-y-auto">
                {diffLines.map((line, i) => {
                  const trimmed = line.trim()
                  const code = trimmed.replace(/^[⊖⊕]\s*/, '')
                  const isRemove = trimmed.startsWith('⊖')
                  const isAdd = trimmed.startsWith('⊕')
                  return (
                    <div
                      key={i}
                      className={cn(
                        'flex items-start font-mono text-[11px] leading-5',
                        isRemove && 'bg-red-500/[0.08]',
                        isAdd && 'bg-emerald-500/[0.08]',
                      )}
                    >
                      <span className={cn(
                        'w-8 shrink-0 text-right pr-2 select-none border-r',
                        isRemove ? 'text-red-400/40 border-red-500/20' :
                        isAdd ? 'text-emerald-400/40 border-emerald-500/20' :
                        'text-white/15 border-white/[0.06]'
                      )}>{i + 1}</span>
                      <span className="w-5 shrink-0 text-center select-none">
                        {isRemove ? <span className="text-red-400/60">−</span> :
                         isAdd ? <span className="text-emerald-400/60">+</span> :
                         null}
                      </span>
                      <code className={cn(
                        'whitespace-pre pr-3',
                        isRemove ? 'text-red-300/70' :
                        isAdd ? 'text-emerald-300/70' :
                        'text-white/30'
                      )}>{code}</code>
                    </div>
                  )
                })}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function TypingMarkdown({ text, animate, onUpdate }: { text: string; animate: boolean; onUpdate?: () => void }) {
  // Skip animation entirely if this text was already shown
  const alreadyDone = animatedTexts.has(text)
  const [chars, setChars] = useState(animate && !alreadyDone ? 0 : text.length)
  const prevTextRef = useRef(text)
  const rafRef = useRef(0)
  const waitingForAudio = useRef(true)
  const fallbackStartRef = useRef(0)

  useEffect(() => {
    if (!animate || alreadyDone) { setChars(text.length); return }
    if (text !== prevTextRef.current) {
      prevTextRef.current = text
      if (animatedTexts.has(text)) { setChars(text.length); return }
      setChars(0)
      waitingForAudio.current = true
      fallbackStartRef.current = 0
    }
  }, [text, animate, alreadyDone])

  // Mark text as animated once complete
  useEffect(() => {
    if (chars >= text.length && text.length > 0) {
      animatedTexts.add(text)
    }
  }, [chars, text])

  // Listen for audio start
  useEffect(() => {
    if (!animate) return
    const cb = () => { waitingForAudio.current = false }
    onAudioStarted(cb)
    return () => onAudioStarted(() => {})
  }, [text, animate])

  useEffect(() => {
    if (!animate || chars >= text.length) return
    const tick = (now: number) => {
      // Wait for audio to start, but give up after 4s and reveal at steady pace
      if (waitingForAudio.current && !audioStartedForResult) {
        if (fallbackStartRef.current === 0) fallbackStartRef.current = now
        if (now - fallbackStartRef.current < 4000) {
          rafRef.current = requestAnimationFrame(tick)
          return
        }
      }

      // Sync to audio playback if available
      if (sharedAudio && sharedAudio.duration > 0 && !sharedAudio.paused) {
        const progress = sharedAudio.currentTime / sharedAudio.duration
        // Audio plays in chunks — use progress but also ensure forward movement
        const audioTarget = Math.floor(progress * text.length)
        setChars((c) => Math.min(Math.max(c, audioTarget), text.length))
      } else if (audioStartedForResult || (fallbackStartRef.current > 0 && now - fallbackStartRef.current >= 4000)) {
        // Audio finished or timed out — reveal remaining at 60 chars/sec
        if (fallbackStartRef.current === 0) fallbackStartRef.current = now
        const elapsed = now - fallbackStartRef.current
        const target = Math.floor(elapsed * 0.06)
        setChars((c) => Math.min(Math.max(c, target), text.length))
      }

      onUpdate?.()
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [text, animate, chars, onUpdate])

  return <MarkdownMessage text={text.slice(0, chars)} />
}

function ThinkingDots() {
  return (
    <div className="flex items-center gap-1.5 px-5 py-4">
      {[0, 1, 2].map((i) => (
        <motion.div
          key={i}
          className="w-2.5 h-2.5 bg-violet-400/50 rounded-full"
          animate={{ opacity: [0.3, 1, 0.3], scale: [0.8, 1.1, 0.8] }}
          transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2 }}
        />
      ))}
    </div>
  )
}

// ── Mic orb with voice-reactive pulse ────────────────────────────

function MicOrb({ isListening, onClick, disabled }: {
  isListening: boolean
  onClick: () => void
  disabled: boolean
}) {
  const ring1Ref = useRef<HTMLSpanElement>(null)
  const ring2Ref = useRef<HTMLSpanElement>(null)
  const ring3Ref = useRef<HTMLSpanElement>(null)
  const micStreamRef = useRef<MediaStream | null>(null)
  const ctxRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const dataRef = useRef<Uint8Array<ArrayBuffer> | null>(null)
  const rafRef = useRef(0)
  const smoothLevelRef = useRef(0)

  useEffect(() => {
    if (!isListening) {
      cancelAnimationFrame(rafRef.current)
      micStreamRef.current?.getTracks().forEach(t => t.stop())
      micStreamRef.current = null
      analyserRef.current = null
      ctxRef.current?.close().catch(() => {})
      ctxRef.current = null
      smoothLevelRef.current = 0
      // Reset ring styles
      ;[ring1Ref, ring2Ref, ring3Ref].forEach(r => {
        if (r.current) {
          r.current.style.transform = 'scale(1)'
          r.current.style.opacity = '0'
        }
      })
      return
    }

    let cancelled = false

    navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
      if (cancelled) { stream.getTracks().forEach(t => t.stop()); return }
      micStreamRef.current = stream
      const ctx = new AudioContext()
      ctxRef.current = ctx
      const source = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 256
      analyser.smoothingTimeConstant = 0.8
      source.connect(analyser)
      analyserRef.current = analyser
      dataRef.current = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount))

      const tick = () => {
        if (!analyserRef.current || !dataRef.current) return
        analyserRef.current.getByteFrequencyData(dataRef.current)
        let sum = 0
        for (let i = 0; i < dataRef.current.length; i++) sum += dataRef.current[i]
        const raw = Math.min(1, sum / dataRef.current.length / 100)

        // Smooth it
        const prev = smoothLevelRef.current
        smoothLevelRef.current = raw > prev ? prev + (raw - prev) * 0.4 : prev + (raw - prev) * 0.15
        const level = smoothLevelRef.current

        // Drive rings from mic level
        if (ring1Ref.current) {
          ring1Ref.current.style.transform = `scale(${1 + level * 0.25})`
          ring1Ref.current.style.opacity = `${0.15 + level * 0.55}`
        }
        if (ring2Ref.current) {
          ring2Ref.current.style.transform = `scale(${1 + level * 0.45})`
          ring2Ref.current.style.opacity = `${0.1 + level * 0.35}`
        }
        if (ring3Ref.current) {
          ring3Ref.current.style.transform = `scale(${1 + level * 0.7})`
          ring3Ref.current.style.opacity = `${0.05 + level * 0.2}`
        }

        rafRef.current = requestAnimationFrame(tick)
      }
      rafRef.current = requestAnimationFrame(tick)
    }).catch(() => {})

    return () => {
      cancelled = true
      cancelAnimationFrame(rafRef.current)
      micStreamRef.current?.getTracks().forEach(t => t.stop())
      micStreamRef.current = null
      ctxRef.current?.close().catch(() => {})
      ctxRef.current = null
    }
  }, [isListening])

  return (
    <motion.button
      initial={{ scale: 0.8, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      exit={{ scale: 0.8, opacity: 0 }}
      transition={{ duration: 0.15 }}
      onClick={onClick}
      disabled={disabled}
      whileTap={{ scale: 0.9 }}
      className={cn(
        'relative flex items-center justify-center w-16 h-16 rounded-full shrink-0 transition-colors',
        isListening
          ? 'bg-violet-500 shadow-[0_0_40px_rgba(139,92,246,0.6)]'
          : 'bg-white/[0.06] hover:bg-white/[0.1]',
        disabled && 'opacity-30 cursor-not-allowed',
      )}
    >
      {/* Voice-reactive pulse rings */}
      <span
        ref={ring1Ref}
        className="absolute inset-0 rounded-full bg-violet-500/30 transition-none"
        style={{ opacity: 0 }}
      />
      <span
        ref={ring2Ref}
        className="absolute -inset-2 rounded-full border-2 border-violet-400/30 transition-none"
        style={{ opacity: 0 }}
      />
      <span
        ref={ring3Ref}
        className="absolute -inset-5 rounded-full border border-violet-400/15 transition-none"
        style={{ opacity: 0 }}
      />
      {isListening ? (
        <MicOff className="w-6 h-6 text-white relative z-10" />
      ) : (
        <Mic className="w-6 h-6 text-white/50 relative z-10" />
      )}
    </motion.button>
  )
}

// ── Global styles ────────────────────────────────────────────────

const globalCSS = `
  .no-scrollbar::-webkit-scrollbar { display: none; }
  .no-scrollbar { scrollbar-width: none; }
  * { scrollbar-width: none; }
  *::-webkit-scrollbar { display: none; }
  @keyframes msgFadeIn {
    from { opacity: 0; transform: translateY(10px); }
    to { opacity: 1; transform: translateY(0); }
  }
  .msg-fade-in { animation: msgFadeIn 0.25s ease-out; }
  .user-bubble {
    margin-left: auto !important;
    width: fit-content !important;
    max-width: 85% !important;
    background: rgb(124, 58, 237) !important;
    border-radius: 1rem !important;
    border-bottom-right-radius: 0.375rem !important;
    padding: 1rem !important;
    overflow-wrap: break-word !important;
    word-break: break-word !important;
  }
`

// Track which result texts have already been animated (survives re-renders and remounts)
const animatedTexts = new Set<string>()

// ── Main Component ───────────────────────────────────────────────

export function VoiceChat() {
  const [pendingMessage, setPendingMessage] = useState('')
  const [isAudioPlaying, setIsAudioPlaying] = useState(false)
  const [expandedTools, setExpandedTools] = useState<Set<number>>(new Set())
  const [pendingImages, setPendingImages] = useState<ImageAttachment[]>([])
  const autoListenRef = useRef<(() => void) | null>(null)
  const hasSentRef = useRef(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const stopListeningRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    onAudioPlayingChange(setIsAudioPlaying)
    // Stop mic when audio is about to play so it doesn't pick up Matthew's voice
    onAudioWillPlay(() => { stopListeningRef.current?.() })
    return () => {
      onAudioPlayingChange(() => {})
      onAudioWillPlay(() => {})
    }
  }, [])

  const [showTerminal, setShowTerminal] = useState(false)
  const terminalEndRef = useRef<HTMLDivElement>(null)

  const { status, messages, sendCommand, sendStop, workspace, activeFile, isWaiting, daemonConnected, daemonLogs } = useBridge(() => {
    autoListenRef.current?.()
  })

  const { isListening, transcript, startListening, stopListening, supported, micError } = useVoice()

  autoListenRef.current = startListening
  stopListeningRef.current = stopListening
  const chatEndRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const userScrolledRef = useRef(false)

  // Detect when user scrolls up — pause auto-scroll
  useEffect(() => {
    const el = scrollContainerRef.current
    if (!el) return
    const handleScroll = () => {
      const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100
      userScrolledRef.current = !isAtBottom
    }
    el.addEventListener('scroll', handleScroll, { passive: true })
    return () => el.removeEventListener('scroll', handleScroll)
  }, [])

  // Auto-scroll terminal logs
  useEffect(() => {
    if (showTerminal) terminalEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [daemonLogs, showTerminal])

  // Clear stale expanded tools when messages get replaced (replay/clear)
  const prevMsgLenRef = useRef(messages.length)
  useEffect(() => {
    if (messages.length < prevMsgLenRef.current) {
      setExpandedTools(new Set())
    }
    prevMsgLenRef.current = messages.length
  }, [messages.length])

  const isProcessing = isWaiting || (messages.length > 0 && messages[messages.length - 1].role !== 'assistant')

  const lastUserIndex = (() => {
    for (let i = messages.length - 1; i >= 0; i--) { if (messages[i].role === 'user') return i }
    return -1
  })()

  const isThinking = isProcessing && messages.length > 0 && messages[messages.length - 1].role === 'user'

  const lastToolIndex = (() => {
    for (let i = messages.length - 1; i >= 0; i--) { if (messages[i].role === 'tool') return i }
    return -1
  })()

  const isCurrentToolLoading = isProcessing && lastToolIndex > lastUserIndex

  const lastResultIndex = (() => {
    for (let i = messages.length - 1; i >= 0; i--) { if (messages[i].role === 'assistant' && !messages[i].narration) return i }
    return -1
  })()

  const hasResultAfterTools = lastResultIndex > lastToolIndex

  const scrollToBottom = useCallback(() => {
    if (!userScrolledRef.current) {
      chatEndRef.current?.scrollIntoView({ behavior: 'instant' })
    }
  }, [])

  useEffect(() => { scrollToBottom() }, [messages, expandedTools, scrollToBottom])
  useEffect(() => {
    const t = setTimeout(scrollToBottom, 300)
    return () => clearTimeout(t)
  }, [messages, expandedTools, scrollToBottom])
  useEffect(() => { if (isListening) hasSentRef.current = false }, [isListening])

  useEffect(() => {
    if (!transcript || hasSentRef.current) return
    const trimmed = transcript.trim()
    if (!trimmed) return

    if (/^(matthew\s+stop|stop|shut up|quiet|be quiet|enough)\s*[.!]?\s*$/i.test(trimmed)) {
      hasSentRef.current = true
      sendStop()
      stopListening()
      setPendingMessage('')
      setTimeout(() => startListening(), 1500)
      return
    }

    if (/\bsend\s*[.!]?\s*$/i.test(trimmed)) {
      const msg = trimmed.replace(/\bsend\s*[.!]?\s*$/i, '').trim()
      if (msg || pendingImages.length > 0) {
        hasSentRef.current = true
        userScrolledRef.current = false
        setExpandedTools(new Set())
        stopListening()
        sendCommand(
          msg || 'What do you see in this image?',
          pendingImages.length > 0 ? pendingImages : undefined
        )
        setPendingMessage('')
        setPendingImages([])
      }
    } else if (!isListening) {
      setPendingMessage(trimmed)
    }
  }, [isListening, transcript, sendCommand, sendStop, stopListening, startListening])

  const handleSend = () => {
    if ((pendingMessage || pendingImages.length > 0) && !hasSentRef.current) {
      hasSentRef.current = true
      userScrolledRef.current = false
      setExpandedTools(new Set())
      sendCommand(
        pendingMessage || 'What do you see in this image?',
        pendingImages.length > 0 ? pendingImages : undefined
      )
      setPendingMessage('')
      setPendingImages([])
    }
  }

  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''

    if (file.size > MAX_IMAGE_SIZE) {
      console.warn('[Image] Large file, resizing...')
    }

    try {
      const { data, mimeType } = await resizeImage(file)
      setPendingImages(prev => [...prev, { data, mimeType, name: file.name }])
    } catch (err) {
      console.error('[Image] Failed to process:', err)
    }
  }

  const handleMicClick = () => {
    if (isListening) {
      stopListening()
    } else {
      stopAllAudio()
      setPendingMessage('')
      hasSentRef.current = false
      setTimeout(() => startListening(), 120)
    }
  }

  const handleStop = () => {
    sendStop()
  }

  const toggleToolExpand = (i: number) => {
    setExpandedTools(prev => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  }

  const statusDot = status === 'connected'
    ? (daemonConnected ? 'bg-emerald-400' : 'bg-yellow-400')
    : status === 'connecting' ? 'bg-yellow-400' : 'bg-red-400'
  const statusLabel = status === 'connected'
    ? (daemonConnected ? (workspace || 'Connected') : 'Bridge connected — waiting for daemon')
    : status === 'connecting' ? 'Connecting...' : 'Disconnected'

  const showStop = isProcessing || isAudioPlaying

  return (
    <div
      className="h-[100dvh] flex flex-col bg-black text-white relative"
      style={{ paddingTop: 'env(safe-area-inset-top)', overscrollBehavior: 'none' }}
    >
      <style>{globalCSS}</style>

      {/* ── Header ── */}
      <div className="shrink-0 flex flex-col items-center px-5 pt-3 pb-2 relative">
        {/* Usage counter — top left */}
        <div className="absolute top-3 left-4 flex flex-col items-start">
          <span className="text-[10px] text-white/25">{messages.filter(m => m.role === 'user').length} msgs</span>
        </div>

        {/* Terminal viewer toggle — top right */}
        <button
          onClick={() => setShowTerminal(prev => !prev)}
          className={cn(
            'absolute top-3 right-4 flex items-center justify-center w-8 h-8 rounded-full transition-colors',
            showTerminal ? 'bg-violet-500/30' : 'bg-white/[0.06]'
          )}
        >
          <Terminal className={cn('w-3.5 h-3.5', showTerminal ? 'text-violet-400' : 'text-white/40')} />
        </button>

        <VoiceWaveform isActive={isAudioPlaying} getAudioLevel={getAudioLevel} size={240} />
        <div className="flex items-center gap-1.5 mt-1">
          <span className={cn('h-1.5 w-1.5 rounded-full', statusDot)} />
          <span className="text-[10px] text-white/30 truncate max-w-[200px]">{statusLabel}</span>
        </div>
        {activeFile && (
          <div className="flex items-center gap-1 mt-0.5">
            <FileText className="w-2.5 h-2.5 text-violet-400/50" />
            <span className="text-[10px] text-violet-300/40 truncate max-w-[220px]">{activeFile}</span>
          </div>
        )}
      </div>

      {/* ── Terminal overlay ── */}
      <AnimatePresence>
        {showTerminal && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.2 }}
            className="absolute inset-x-0 top-0 bottom-0 z-50 flex flex-col bg-[#0A0A0B]/95 backdrop-blur-sm"
            style={{ paddingTop: 'env(safe-area-inset-top)' }}
          >
            {/* Terminal header */}
            <div className="shrink-0 flex items-center justify-between px-4 pt-3 pb-2 border-b border-white/[0.06]">
              <div className="flex items-center gap-2">
                <Terminal className="w-4 h-4 text-violet-400" />
                <span className="text-sm font-medium text-white/70">Terminal</span>
              </div>
              <button
                onClick={() => setShowTerminal(false)}
                className="flex items-center justify-center w-8 h-8 rounded-full bg-white/[0.06] active:scale-90 transition-transform"
              >
                <X className="w-4 h-4 text-white/40" />
              </button>
            </div>

            {/* Log output */}
            <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden no-scrollbar px-3 py-2 font-mono text-[11px] leading-relaxed">
              {daemonLogs.length === 0 ? (
                <p className="text-white/20 text-center mt-8">No logs yet — waiting for daemon output</p>
              ) : (
                daemonLogs.map((log, i) => (
                  <p key={i} className={cn(
                    'whitespace-pre-wrap break-all',
                    log.startsWith('ERROR') ? 'text-red-400/70' :
                    log.startsWith('WARN') ? 'text-yellow-400/70' :
                    log.includes('[Daemon]') ? 'text-emerald-400/60' :
                    log.includes('You:') ? 'text-violet-400/70' :
                    log.includes('Result:') ? 'text-emerald-300/70' :
                    'text-white/40'
                  )}>{log}</p>
                ))
              )}
              <div ref={terminalEndRef} />
            </div>

            {/* Daemon status bar */}
            <div className="shrink-0 flex items-center gap-2 px-4 py-2 border-t border-white/[0.06]"
              style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}
            >
              <span className={cn('h-2 w-2 rounded-full', daemonConnected ? 'bg-emerald-400' : 'bg-red-400')} />
              <span className="text-xs text-white/40">
                {daemonConnected ? 'Daemon connected to bridge' : 'Daemon not connected'}
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Chat messages ── */}
      <div
        ref={scrollContainerRef}
        className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden no-scrollbar"
        style={{ overscrollBehavior: 'none' }}
      >
        <div className="flex flex-col gap-3 px-6 py-4 w-full overflow-hidden box-border">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center mt-20 gap-4">
              <VoiceWaveform isActive={false} getAudioLevel={() => 0} size={200} />
              <p className="text-white/20 text-sm">Tap the mic to start talking</p>
            </div>
          ) : (
            messages.map((msg, i) => {
              const isNextTool = messages[i + 1]?.role === 'tool'
              const isPrevTool = i > 0 && messages[i - 1]?.role === 'tool'
              const isLastTool = i === lastToolIndex
              const defaultExpanded = isLastTool && !hasResultAfterTools
              const isExpanded = expandedTools.has(i) ? !defaultExpanded : defaultExpanded
              const isRecent = i >= messages.length - 3

              // Narrations are spoken via TTS but not displayed
              if (msg.narration) return null

              const content = msg.role === 'user' ? (
                /* ── User bubble — flush right ── */
                <div className="user-bubble">
                  {msg.images && msg.images.length > 0 && (
                    <div className="flex gap-2 mb-2 flex-wrap justify-end">
                      {msg.images.map((img, j) => (
                        img.data ? (
                          <img
                            key={j}
                            src={`data:${img.mimeType};base64,${img.data}`}
                            className="w-28 h-28 rounded-lg object-cover border border-white/10"
                          />
                        ) : (
                          <div key={j} className="w-28 h-28 rounded-lg bg-white/[0.05] border border-white/10 flex items-center justify-center">
                            <Camera className="w-6 h-6 text-white/20" />
                          </div>
                        )
                      ))}
                    </div>
                  )}
                  <p className="text-[15px] text-white leading-relaxed">{msg.text}</p>
                </div>
              ) : msg.role === 'tool' ? (
                /* ── Tool call ── */
                <div
                  className="flex items-stretch gap-2.5 ml-1 cursor-pointer"
                  onClick={() => toggleToolExpand(i)}
                >
                  <div className="flex flex-col items-center w-5 shrink-0">
                    <div className={cn('w-px flex-1 transition-colors', isPrevTool ? 'bg-violet-500/15' : 'bg-transparent')} />
                    {isLastTool && isCurrentToolLoading ? (
                      <LoaderCircle className="w-4 h-4 text-violet-400 animate-spin shrink-0" />
                    ) : (
                      <div className="w-2 h-2 shrink-0 rounded-full bg-violet-500/30" />
                    )}
                    <div className={cn('w-px flex-1 transition-colors', isNextTool ? 'bg-violet-500/15' : 'bg-transparent')} />
                  </div>
                  <div
                    className={cn(
                      'flex-1 flex items-start gap-2.5 py-2.5 px-3.5 rounded-xl min-w-0 overflow-hidden border transition-all duration-200',
                      isExpanded
                        ? 'border-violet-500/20 bg-violet-500/[0.04]'
                        : 'border-white/[0.06] bg-white/[0.02]'
                    )}
                  >
                    <div className="w-5 h-5 flex items-center justify-center shrink-0 mt-0.5">
                      <ToolIcon text={msg.text} />
                    </div>
                    <ToolContent text={msg.text} expanded={isExpanded} />
                  </div>
                </div>
              ) : (
                /* ── Assistant text ── */
                <div className="px-1">
                  {i === lastResultIndex && !msg.replayed ? (
                    <TypingMarkdown text={msg.text} animate={true} onUpdate={scrollToBottom} />
                  ) : (
                    <MarkdownMessage text={msg.text} />
                  )}
                </div>
              )

              return (
                <div key={i} className={cn('min-w-0 overflow-hidden', isRecent && !msg.replayed && 'msg-fade-in')}>
                  {content}
                </div>
              )
            })
          )}
          {isThinking && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
            >
              <div className="px-1">
                <ThinkingDots />
              </div>
            </motion.div>
          )}
          <div ref={chatEndRef} />
        </div>
      </div>

      {/* ── Bottom controls ── */}
      <div
        className="shrink-0 bg-black"
        style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
      >
        {/* Transcript while listening — max 3 lines, scrolls within */}
        <div className="h-[3.5rem] flex items-end justify-center px-5 overflow-hidden w-full min-w-0">
          {isListening && transcript ? (
            <p className="text-xs text-violet-300/60 text-center w-full min-w-0 leading-relaxed line-clamp-3">&ldquo;{transcript}&rdquo;</p>
          ) : micError ? (
            <p className="text-xs text-red-400 text-center">{micError}</p>
          ) : null}
        </div>

        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleImageSelect}
        />

        {/* Pending image thumbnails */}
        <AnimatePresence>
          {pendingImages.length > 0 && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="flex gap-2 px-4 pb-2 overflow-x-auto no-scrollbar justify-center"
            >
              {pendingImages.map((img, i) => (
                <div key={i} className="relative shrink-0">
                  <img
                    src={`data:${img.mimeType};base64,${img.data}`}
                    className="w-16 h-16 rounded-lg object-cover border border-white/10"
                  />
                  <button
                    onClick={() => setPendingImages(prev => prev.filter((_, j) => j !== i))}
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 rounded-full text-white flex items-center justify-center"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Action row — centered orb with flanking buttons */}
        <div className="flex items-center justify-center gap-5 px-4 pb-2">
          {/* Camera button (left) */}
          {!showStop && (
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center justify-center w-10 h-10 rounded-full bg-white/[0.06] shrink-0 active:scale-90 transition-transform"
            >
              <Camera className="w-4 h-4 text-white/40" />
            </button>
          )}

          {/* Central mic orb / stop / send */}
          <AnimatePresence mode="wait">
            {showStop ? (
              <motion.button
                key="stop"
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.8, opacity: 0 }}
                transition={{ duration: 0.15 }}
                onClick={handleStop}
                className="relative flex items-center justify-center w-16 h-16 rounded-full bg-red-500/80 shrink-0 active:scale-90 transition-transform"
              >
                <Square className="w-5 h-5 text-white fill-white" />
              </motion.button>
            ) : pendingMessage ? (
              <motion.button
                key="send"
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.8, opacity: 0 }}
                transition={{ duration: 0.15 }}
                onClick={handleSend}
                className="relative flex items-center justify-center w-16 h-16 rounded-full bg-violet-500 shrink-0"
              >
                <ArrowUp className="w-6 h-6 text-white" />
              </motion.button>
            ) : (
              <MicOrb
                key="mic"
                isListening={isListening}
                onClick={handleMicClick}
                disabled={!supported}
              />
            )}
          </AnimatePresence>

          {/* Right button: X cancel when there's pending text, send for images-only, spacer otherwise */}
          {!showStop && pendingMessage ? (
            <button
              onClick={() => { setPendingMessage(''); setPendingImages([]); }}
              className="flex items-center justify-center w-10 h-10 rounded-full bg-white/[0.06] shrink-0 active:scale-90 transition-transform"
            >
              <X className="w-4 h-4 text-white/40" />
            </button>
          ) : !showStop && !pendingMessage && pendingImages.length > 0 ? (
            <motion.button
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.8, opacity: 0 }}
              transition={{ duration: 0.15 }}
              onClick={handleSend}
              className="flex items-center justify-center w-10 h-10 rounded-full bg-violet-500 shrink-0 active:scale-90 transition-transform"
            >
              <ArrowUp className="w-4 h-4 text-white" />
            </motion.button>
          ) : !showStop ? (
            <div className="w-10 h-10 shrink-0" />
          ) : null}
        </div>
      </div>
    </div>
  )
}
