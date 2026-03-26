import { useEffect, useRef, useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Mic, MicOff, ArrowUp, Square, Camera, X, FileText, Terminal, Search, Pencil, FilePlus, CheckCircle2, ListTodo, Globe, Wrench, LoaderCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { VoiceWaveform } from '@/components/VoiceWaveform'
import { MarkdownMessage } from '@/components/MarkdownMessage'
import { useBridge, sharedAudio, getAudioLevel, onAudioPlayingChange, stopAllAudio, audioStartedForResult, onAudioStarted } from '@/hooks/useBridge'
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

function ToolContent({ text, expanded }: { text: string; expanded: boolean }) {
  const lines = text.split('\n')
  const header = lines[0]
  const diffLines = lines.slice(1)

  if (!expanded || diffLines.length === 0) {
    return <span className="text-[13px] text-white/50 leading-tight">{header}</span>
  }

  return (
    <div className="flex flex-col min-w-0 w-full">
      <span className="text-[13px] text-white/50 leading-tight mb-2">{header}</span>
      <div className="flex flex-col gap-0.5 overflow-x-auto">
        {diffLines.map((line, i) => {
          const trimmed = line.trim()
          const code = trimmed.replace(/^[⊖⊕]\s*/, '')
          const isRemove = trimmed.startsWith('⊖')
          const isAdd = trimmed.startsWith('⊕')
          return (
            <div key={i} className="flex items-start gap-2">
              {isRemove ? (
                <code className="text-[11px] font-mono text-red-300/70 bg-red-500/10 border-l-2 border-red-500/40 px-2 py-0.5 whitespace-pre w-full">{code}</code>
              ) : isAdd ? (
                <code className="text-[11px] font-mono text-emerald-300/70 bg-emerald-500/10 border-l-2 border-emerald-500/40 px-2 py-0.5 whitespace-pre w-full">{code}</code>
              ) : (
                <span className="text-[11px] text-white/30 whitespace-pre">{trimmed}</span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function TypingMarkdown({ text, animate, onUpdate }: { text: string; animate: boolean; onUpdate?: () => void }) {
  const [chars, setChars] = useState(animate ? 0 : text.length)
  const prevTextRef = useRef(text)
  const rafRef = useRef(0)
  const waitingForAudio = useRef(true)
  const audioTimedOut = useRef(false)

  useEffect(() => {
    if (!animate) { setChars(text.length); return }
    if (text !== prevTextRef.current) {
      prevTextRef.current = text
      setChars(0)
      waitingForAudio.current = true
      audioTimedOut.current = false
    }
  }, [text, animate])

  // Wait up to 6s for audio to start before showing text anyway
  useEffect(() => {
    if (!animate) return
    const timeout = setTimeout(() => { audioTimedOut.current = true }, 6000)
    return () => clearTimeout(timeout)
  }, [text, animate])

  useEffect(() => {
    if (!animate) return
    const cb = () => { waitingForAudio.current = false }
    onAudioStarted(cb)
    return () => onAudioStarted(() => {})
  }, [text, animate])

  useEffect(() => {
    if (!animate || chars >= text.length) return
    const tick = () => {
      if (waitingForAudio.current && !audioTimedOut.current && !audioStartedForResult) {
        rafRef.current = requestAnimationFrame(tick)
        return
      }
      if (sharedAudio && sharedAudio.duration > 0 && !sharedAudio.paused) {
        const progress = sharedAudio.currentTime / sharedAudio.duration
        const target = Math.floor(progress * text.length)
        setChars((c) => Math.min(Math.max(c, target), text.length))
      } else if (audioStartedForResult || audioTimedOut.current) {
        setChars((c) => Math.min(c + 3, text.length))
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

// ── Robot Head ───────────────────────────────────────────────────

function RobotHead({ isActive, getAudioLevel: getLevel, size = 56 }: { isActive: boolean; getAudioLevel: () => number; size?: number }) {
  const scale = size / 56
  const h = Math.round(52 * scale)
  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: h }}>
      <svg width={size} height={h} viewBox="0 0 56 52" fill="none"
           style={{ filter: 'drop-shadow(0 0 8px rgba(139,92,246,0.3))' }}>
        <line x1="28" y1="0" x2="28" y2="8" stroke="rgba(139,92,246,0.5)" strokeWidth="1.5" />
        <circle cx="28" cy="2" r="1.5" fill="rgba(139,92,246,0.7)">
          <animate attributeName="opacity" values="0.4;1;0.4" dur="2s" repeatCount="indefinite" />
        </circle>
        <rect x="5" y="8" width="46" height="38" rx="4" stroke="rgba(139,92,246,0.4)" strokeWidth="1.2" fill="rgba(139,92,246,0.04)" />
        <rect x="14" y="16" width="9" height="6" rx="1.5" fill="rgba(139,92,246,0.6)">
          <animate attributeName="opacity" values="0.6;0.9;0.6" dur="3s" repeatCount="indefinite" />
        </rect>
        <rect x="33" y="16" width="9" height="6" rx="1.5" fill="rgba(139,92,246,0.6)">
          <animate attributeName="opacity" values="0.6;0.9;0.6" dur="3s" repeatCount="indefinite" />
        </rect>
        <rect x="12" y="29" width="32" height="12" rx="2" fill="rgba(139,92,246,0.03)" stroke="rgba(139,92,246,0.15)" strokeWidth="0.8" />
        <rect x="1" y="20" width="4" height="7" rx="1" fill="rgba(139,92,246,0.2)" />
        <rect x="51" y="20" width="4" height="7" rx="1" fill="rgba(139,92,246,0.2)" />
      </svg>
      <div className="absolute" style={{ top: Math.round(28 * scale), left: '50%', transform: 'translateX(-50%)' }}>
        <VoiceWaveform isActive={isActive} size={Math.round(32 * scale)} getAudioLevel={getLevel} />
      </div>
    </div>
  )
}

// ── Global styles ────────────────────────────────────────────────

const globalCSS = `
  .no-scrollbar::-webkit-scrollbar { display: none; }
  .no-scrollbar { scrollbar-width: none; }
`

// ── Main Component ───────────────────────────────────────────────

export function VoiceChat() {
  const [pendingMessage, setPendingMessage] = useState('')
  const [isAudioPlaying, setIsAudioPlaying] = useState(false)
  const [expandedTools, setExpandedTools] = useState<Set<number>>(new Set())
  const [pendingImages, setPendingImages] = useState<ImageAttachment[]>([])
  const autoListenRef = useRef<(() => void) | null>(null)
  const hasSentRef = useRef(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    onAudioPlayingChange(setIsAudioPlaying)
    return () => onAudioPlayingChange(() => {})
  }, [])

  const { status, messages, sendCommand, sendStop, workspace, isWaiting } = useBridge(() => {
    autoListenRef.current?.()
  })

  const { isListening, transcript, startListening, stopListening, supported, micError } = useVoice()

  autoListenRef.current = startListening
  const chatEndRef = useRef<HTMLDivElement>(null)

  const isProcessing = isWaiting || (messages.length > 0 && messages[messages.length - 1].role !== 'assistant')
  const isThinking = isProcessing && messages.length > 0 && messages[messages.length - 1].role === 'user'

  const lastToolIndex = (() => {
    for (let i = messages.length - 1; i >= 0; i--) { if (messages[i].role === 'tool') return i }
    return -1
  })()

  const lastAssistantIndex = (() => {
    for (let i = messages.length - 1; i >= 0; i--) { if (messages[i].role === 'assistant') return i }
    return -1
  })()

  const scrollToBottom = useCallback(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  useEffect(() => { scrollToBottom() }, [messages, scrollToBottom])
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
    e.target.value = '' // reset for re-selection

    if (file.size > MAX_IMAGE_SIZE) {
      // Will be resized anyway, but warn if extremely large
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
    stopListening()
    setPendingMessage('')
  }

  const toggleToolExpand = (i: number) => {
    setExpandedTools(prev => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  }

  const statusDot = status === 'connected' ? 'bg-emerald-400' : status === 'connecting' ? 'bg-yellow-400' : 'bg-red-400'
  const statusLabel = status === 'connected'
    ? (workspace || 'Connected')
    : status === 'connecting' ? 'Connecting...' : 'Disconnected'

  const showStop = isProcessing || isAudioPlaying

  return (
    <div
      className="h-[100dvh] flex flex-col bg-[#0a0a0a] text-white relative"
      style={{ paddingTop: 'env(safe-area-inset-top)', overscrollBehavior: 'none' }}
    >
      <style>{globalCSS}</style>

      {/* ── Header bar ── */}
      <div className="shrink-0 flex items-center justify-center px-5 py-3 border-b border-white/[0.06]">
        <div className="flex flex-col items-center">
          <RobotHead isActive={isAudioPlaying} getAudioLevel={getAudioLevel} size={48} />
          <div className="flex items-center gap-1.5 mt-1">
            <span className={cn('h-1.5 w-1.5 rounded-full', statusDot)} />
            <span className="text-[10px] text-white/30 truncate max-w-[200px]">{statusLabel}</span>
          </div>
        </div>
      </div>

      {/* ── Chat messages ── */}
      <div
        className="flex-1 min-h-0 overflow-y-auto no-scrollbar"
        style={{ overscrollBehavior: 'none' }}
      >
        <div className="flex flex-col gap-3 px-4 sm:px-8 md:px-16 lg:px-32 xl:px-48 py-4 max-w-4xl mx-auto">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center mt-20 gap-4">
              <RobotHead isActive={false} getAudioLevel={() => 0} size={72} />
              <p className="text-white/20 text-sm">Tap the mic to start talking</p>
            </div>
          ) : (
            messages.map((msg, i) => {
              const isNextTool = messages[i + 1]?.role === 'tool'
              const isPrevTool = i > 0 && messages[i - 1]?.role === 'tool'
              const isLastTool = i === lastToolIndex
              const isExpanded = (isLastTool && isProcessing) || expandedTools.has(i)

              return (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.25, ease: 'easeOut' }}
                >
                  {msg.role === 'user' ? (
                    /* ── User bubble ── */
                    <div className="flex justify-end">
                      <div className="max-w-[85%] sm:max-w-[70%] px-5 py-3.5 rounded-2xl rounded-br-md bg-violet-600/20 border border-violet-500/10">
                        {msg.images && msg.images.length > 0 && (
                          <div className="flex gap-2 mb-2 flex-wrap">
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
                        <p className="text-[15px] text-white/90 break-words whitespace-pre-wrap leading-relaxed">{msg.text}</p>
                      </div>
                    </div>
                  ) : msg.role === 'tool' ? (
                    /* ── Tool call ── */
                    <motion.div
                      className="flex items-stretch gap-2.5 ml-1 cursor-pointer"
                      onClick={() => toggleToolExpand(i)}
                      layout
                      transition={{ duration: 0.2, ease: 'easeOut' }}
                    >
                      <div className="flex flex-col items-center w-5 shrink-0">
                        <div className={cn('w-px flex-1 transition-colors', isPrevTool ? 'bg-violet-500/15' : 'bg-transparent')} />
                        {isLastTool && isProcessing ? (
                          <LoaderCircle className="w-4 h-4 text-violet-400 animate-spin shrink-0" />
                        ) : (
                          <div className="w-2 h-2 shrink-0 rounded-full bg-violet-500/30" />
                        )}
                        <div className={cn('w-px flex-1 transition-colors', isNextTool ? 'bg-violet-500/15' : 'bg-transparent')} />
                      </div>
                      <motion.div
                        layout
                        className={cn(
                          'flex-1 flex items-start gap-2.5 py-2.5 px-3.5 rounded-xl min-w-0 overflow-hidden border transition-colors',
                          isExpanded
                            ? 'border-violet-500/20 bg-violet-500/[0.04]'
                            : 'border-white/[0.06] bg-white/[0.02]'
                        )}
                      >
                        <div className="w-5 h-5 flex items-center justify-center shrink-0 mt-0.5">
                          <ToolIcon text={msg.text} />
                        </div>
                        <ToolContent text={msg.text} expanded={isExpanded} />
                      </motion.div>
                    </motion.div>
                  ) : (
                    /* ── Assistant bubble ── */
                    <div className="flex justify-start">
                      <div className="max-w-[90%] sm:max-w-[80%] px-5 py-3.5 rounded-2xl rounded-bl-md bg-white/[0.05] border border-white/[0.06]">
                        {i === lastAssistantIndex ? (
                          <TypingMarkdown text={msg.text} animate={true} onUpdate={scrollToBottom} />
                        ) : (
                          <MarkdownMessage text={msg.text} />
                        )}
                      </div>
                    </div>
                  )}
                </motion.div>
              )
            })
          )}
          {isThinking && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
            >
              <div className="flex justify-start">
                <div className="px-5 py-2 rounded-2xl rounded-bl-md bg-white/[0.05] border border-white/[0.06]">
                  <ThinkingDots />
                </div>
              </div>
            </motion.div>
          )}
          <div ref={chatEndRef} />
        </div>
      </div>

      {/* ── Bottom input bar ── */}
      <div
        className="shrink-0 border-t border-white/[0.06] bg-[#0a0a0a]"
        style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
      >
        {/* Transcript / listening state */}
        <AnimatePresence mode="wait">
          {(isListening || micError || pendingMessage) && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              className="px-5 pt-2 overflow-hidden"
            >
              {isListening ? (
                <p className="text-xs text-violet-300 text-center">
                  {transcript ? `"${transcript}"` : 'Listening... say "send" when done'}
                </p>
              ) : micError ? (
                <p className="text-xs text-red-400 text-center">{micError}</p>
              ) : pendingMessage ? (
                <p className="text-xs text-white/40 text-center line-clamp-2">&ldquo;{pendingMessage}&rdquo;</p>
              ) : null}
            </motion.div>
          )}
        </AnimatePresence>

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
              className="flex gap-2 px-4 pt-2 overflow-x-auto no-scrollbar"
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

        {/* Input row */}
        <div className="flex items-end gap-2 px-4 pt-2 pb-1">
          {/* Camera button */}
          {!showStop && (
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center justify-center w-12 h-12 rounded-full bg-white/[0.06] shrink-0 active:scale-90 transition-transform"
            >
              <Camera className="w-5 h-5 text-white/50" />
            </button>
          )}

          {/* Placeholder input area */}
          <div className="flex-1 flex items-center rounded-2xl border border-white/[0.08] bg-white/[0.03] px-4 py-3 min-h-[48px]">
            <span className="text-sm text-white/25 flex-1 select-none">
              {isListening ? 'Listening...' : pendingMessage || (pendingImages.length > 0 ? 'Add a message or tap send' : 'Tap mic to speak')}
            </span>
          </div>

          {/* Action buttons */}
          <AnimatePresence mode="wait">
            {showStop ? (
              <motion.button
                key="stop"
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.8, opacity: 0 }}
                transition={{ duration: 0.15 }}
                onClick={handleStop}
                className="flex items-center justify-center w-12 h-12 rounded-full bg-red-500/80 shrink-0 active:scale-90 transition-transform"
              >
                <Square className="w-4 h-4 text-white fill-white" />
              </motion.button>
            ) : (pendingMessage || pendingImages.length > 0) ? (
              <motion.button
                key="send"
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.8, opacity: 0 }}
                transition={{ duration: 0.15 }}
                onClick={handleSend}
                className="flex items-center justify-center w-12 h-12 rounded-full bg-violet-500 shrink-0"
              >
                <ArrowUp className="w-5 h-5 text-white" />
              </motion.button>
            ) : (
              <motion.button
                key="mic"
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.8, opacity: 0 }}
                transition={{ duration: 0.15 }}
                onClick={handleMicClick}
                disabled={!supported}
                whileTap={{ scale: 0.9 }}
                className={cn(
                  'relative flex items-center justify-center w-12 h-12 rounded-full shrink-0 transition-all',
                  isListening
                    ? 'bg-violet-500'
                    : 'bg-white/[0.08] hover:bg-white/[0.12]',
                  !supported && 'opacity-30 cursor-not-allowed',
                )}
              >
                {isListening && (
                  <span className="absolute inset-0 rounded-full bg-violet-500/30 animate-ping" style={{ animationDuration: '1.5s' }} />
                )}
                {isListening ? (
                  <MicOff className="w-5 h-5 text-white relative z-10" />
                ) : (
                  <Mic className="w-5 h-5 text-white/60 relative z-10" />
                )}
              </motion.button>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  )
}
