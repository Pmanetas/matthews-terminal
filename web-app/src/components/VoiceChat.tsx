import { useEffect, useRef, useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Mic, Send, Volume2, VolumeX, FileText, Terminal, Search, Pencil, FilePlus, CheckCircle2, ListTodo, Globe, Wrench, LoaderCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { VoiceWaveform } from '@/components/VoiceWaveform'
import { MarkdownMessage } from '@/components/MarkdownMessage'
import { useBridge, sharedAudio, getAudioLevel, onAudioPlayingChange, stopAllAudio } from '@/hooks/useBridge'
import { useVoice } from '@/hooks/useVoice'

function ToolIcon({ text }: { text: string }) {
  const t = text.toLowerCase()
  if (t.startsWith('reading')) return <FileText className="w-3 h-3 text-violet-400" />
  if (t.startsWith('running')) return <Terminal className="w-3 h-3 text-violet-400" />
  if (t.startsWith('searching')) return <Search className="w-3 h-3 text-violet-400" />
  if (t.startsWith('editing')) return <Pencil className="w-3 h-3 text-violet-400" />
  if (t.startsWith('creating')) return <FilePlus className="w-3 h-3 text-violet-400" />
  if (t.startsWith('planning') || t.startsWith('checking task')) return <ListTodo className="w-3 h-3 text-violet-400" />
  if (t.startsWith('searching the web') || t.startsWith('fetching')) return <Globe className="w-3 h-3 text-violet-400" />
  if (t.startsWith('looking up')) return <Wrench className="w-3 h-3 text-violet-400" />
  return <CheckCircle2 className="w-3 h-3 text-violet-400" />
}

/** Expanded tool: show header + all accumulated diff lines with aligned dots */
function ToolContent({ text, expanded }: { text: string; expanded: boolean }) {
  const lines = text.split('\n')
  const header = lines[0]
  const diffLines = lines.slice(1)

  if (!expanded || diffLines.length === 0) {
    return <span className="text-xs text-white/50 leading-tight">{header}</span>
  }

  return (
    <div className="flex flex-col min-w-0">
      <span className="text-xs text-white/50 leading-tight mb-1.5">{header}</span>
      <div className="flex flex-col gap-0.5">
        {diffLines.map((line, i) => {
          const trimmed = line.trim()
          const code = trimmed.replace(/^[⊖⊕]\s*/, '')
          const isRemove = trimmed.startsWith('⊖')
          const isAdd = trimmed.startsWith('⊕')
          return (
            <div key={i} className="flex items-center gap-2">
              {/* Sub-dot aligned with each line */}
              <div className="w-1.5 h-1.5 shrink-0 bg-violet-500/30" />
              {/* Code — inline width only */}
              {isRemove ? (
                <code className="text-[10px] font-mono text-red-300/70 bg-red-500/10 border-l border-red-500/40 px-1.5 py-px">{code}</code>
              ) : isAdd ? (
                <code className="text-[10px] font-mono text-emerald-300/70 bg-emerald-500/10 border-l border-emerald-500/40 px-1.5 py-px">{code}</code>
              ) : (
                <span className="text-[10px] text-white/30">{trimmed}</span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** Typing that syncs to audio playback — words appear as Matthew speaks */
function TypingMarkdown({ text, animate, onUpdate }: { text: string; animate: boolean; onUpdate?: () => void }) {
  const [chars, setChars] = useState(animate ? 0 : text.length)
  const prevTextRef = useRef(text)
  const rafRef = useRef(0)

  useEffect(() => {
    if (!animate) { setChars(text.length); return }
    if (text !== prevTextRef.current) {
      prevTextRef.current = text
      setChars(0)
    }
  }, [text, animate])

  useEffect(() => {
    if (!animate || chars >= text.length) return

    const tick = () => {
      // If audio is playing, sync text reveal to audio progress
      if (sharedAudio && sharedAudio.duration > 0 && !sharedAudio.paused) {
        const progress = sharedAudio.currentTime / sharedAudio.duration
        const target = Math.floor(progress * text.length)
        setChars((c) => {
          const next = Math.max(c, target)
          return Math.min(next, text.length)
        })
      } else {
        // No audio / audio finished — reveal remaining text quickly
        setChars((c) => {
          const next = c + 4
          return next >= text.length ? text.length : next
        })
      }
      onUpdate?.()
      rafRef.current = requestAnimationFrame(tick)
    }

    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [text, animate, chars, onUpdate])

  return <MarkdownMessage text={text.slice(0, chars)} />
}

/** Robot head SVG with waveform as mouth */
function RobotHead({ isActive, getAudioLevel: getLevel }: { isActive: boolean; getAudioLevel: () => number }) {
  return (
    <div className="relative flex flex-col items-center">
      <svg width="120" height="110" viewBox="0 0 120 110" fill="none"
           style={{ filter: 'drop-shadow(0 0 15px rgba(139,92,246,0.3))' }}>
        {/* Antenna */}
        <line x1="60" y1="0" x2="60" y2="16" stroke="rgba(139,92,246,0.5)" strokeWidth="2" />
        <circle cx="60" cy="3" r="3" fill="rgba(139,92,246,0.7)">
          <animate attributeName="opacity" values="0.4;1;0.4" dur="2s" repeatCount="indefinite" />
        </circle>
        {/* Head outline */}
        <rect x="10" y="16" width="100" height="80" rx="6" stroke="rgba(139,92,246,0.4)" strokeWidth="1.5" fill="rgba(139,92,246,0.04)" />
        {/* Eyes */}
        <rect x="28" y="32" width="20" height="12" rx="2" fill="rgba(139,92,246,0.6)">
          <animate attributeName="opacity" values="0.6;0.8;0.6" dur="3s" repeatCount="indefinite" />
        </rect>
        <rect x="72" y="32" width="20" height="12" rx="2" fill="rgba(139,92,246,0.6)">
          <animate attributeName="opacity" values="0.6;0.8;0.6" dur="3s" repeatCount="indefinite" />
        </rect>
        {/* Eye glint */}
        <rect x="30" y="34" width="6" height="4" rx="1" fill="rgba(200,180,255,0.3)" />
        <rect x="74" y="34" width="6" height="4" rx="1" fill="rgba(200,180,255,0.3)" />
        {/* Ear bolts */}
        <rect x="2" y="42" width="8" height="14" rx="2" fill="rgba(139,92,246,0.2)" stroke="rgba(139,92,246,0.3)" strokeWidth="1" />
        <rect x="110" y="42" width="8" height="14" rx="2" fill="rgba(139,92,246,0.2)" stroke="rgba(139,92,246,0.3)" strokeWidth="1" />
        {/* Mouth area — transparent so waveform shows through */}
        <rect x="25" y="60" width="70" height="26" rx="3" fill="rgba(139,92,246,0.03)" stroke="rgba(139,92,246,0.15)" strokeWidth="1" />
      </svg>
      {/* Waveform positioned inside the mouth */}
      <div className="absolute" style={{ top: 60, left: '50%', transform: 'translateX(-50%)' }}>
        <VoiceWaveform isActive={isActive} size={70} getAudioLevel={getLevel} />
      </div>
    </div>
  )
}

export function VoiceChat() {
  const [pendingMessage, setPendingMessage] = useState('')
  const [isAudioPlaying, setIsAudioPlaying] = useState(false)
  const autoListenRef = useRef<(() => void) | null>(null)
  const hasSentRef = useRef(false)

  useEffect(() => {
    onAudioPlayingChange(setIsAudioPlaying)
    return () => onAudioPlayingChange(() => {})
  }, [])

  const { status, messages, sendCommand } = useBridge(() => {
    autoListenRef.current?.()
  })

  const { isListening, transcript, ttsEnabled, setTtsEnabled, startListening, stopListening, supported, micError } =
    useVoice()

  autoListenRef.current = startListening
  const chatEndRef = useRef<HTMLDivElement>(null)

  const isProcessing = messages.length > 0 && messages[messages.length - 1].role !== 'assistant'

  const lastToolIndex = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'tool') return i
    }
    return -1
  })()

  const lastAssistantIndex = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant') return i
    }
    return -1
  })()

  const scrollToBottom = useCallback(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [messages, scrollToBottom])

  useEffect(() => {
    if (isListening) hasSentRef.current = false
  }, [isListening])

  useEffect(() => {
    if (!transcript || hasSentRef.current) return
    const trimmed = transcript.trim()
    if (!trimmed) return

    const stopPattern = /^(stop|shut up|quiet|be quiet|enough)\s*[.!]?\s*$/i
    if (stopPattern.test(trimmed)) {
      hasSentRef.current = true
      stopAllAudio()
      stopListening()
      setPendingMessage('')
      return
    }

    const sendPattern = /\bsend\s*[.!]?\s*$/i
    if (sendPattern.test(trimmed)) {
      const msg = trimmed.replace(sendPattern, '').trim()
      if (msg) {
        hasSentRef.current = true
        stopListening()
        setPendingMessage('')
        sendCommand(msg)
      }
    } else if (!isListening) {
      setPendingMessage(trimmed)
    }
  }, [isListening, transcript, sendCommand, stopListening])

  const handleSend = () => {
    if (pendingMessage && !hasSentRef.current) {
      hasSentRef.current = true
      sendCommand(pendingMessage)
      setPendingMessage('')
    }
  }

  const handleMicClick = () => {
    stopAllAudio()
    if (isListening) {
      stopListening()
    } else {
      setPendingMessage('')
      hasSentRef.current = false
      startListening()
    }
  }

  const statusDot =
    status === 'connected' ? 'bg-emerald-400' : status === 'connecting' ? 'bg-yellow-400' : 'bg-red-400'
  const statusText =
    status === 'connected' ? 'Connected' : status === 'connecting' ? 'Connecting...' : 'Disconnected'

  return (
    <div className="h-[100dvh] flex flex-col bg-black text-white relative overflow-hidden">
      {/* Header — robot + status */}
      <div className="relative z-10 flex flex-col items-center pt-4 pb-2 shrink-0">
        <RobotHead isActive={isAudioPlaying} getAudioLevel={getAudioLevel} />
        <div className="flex items-center gap-2 mt-2">
          <span className={cn('h-1.5 w-1.5', statusDot)} />
          <span className="text-[10px] text-white/25 tracking-wide">{statusText}</span>
        </div>
      </div>

      {/* Chat area — generous padding on desktop */}
      <div className="relative z-10 flex-1 min-h-0 overflow-y-auto pb-4" style={{ WebkitOverflowScrolling: 'touch' }}>
        <div className="flex flex-col gap-3 pt-3 mx-6 sm:mx-12 md:mx-20 lg:mx-32 xl:mx-48">
          {messages.length === 0 ? (
            <p className="text-white/15 text-sm text-center mt-12 tracking-wide">Tap the mic to start talking</p>
          ) : (
            messages.map((msg, i) => {
              const isNextTool = messages[i + 1]?.role === 'tool'
              const isPrevTool = i > 0 && messages[i - 1]?.role === 'tool'
              const isLastTool = i === lastToolIndex
              const isExpanded = isLastTool && isProcessing

              return (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.15 }}
                >
                  {msg.role === 'user' ? (
                    <div className="flex justify-end">
                      <div className="max-w-[70%] py-2">
                        <p className="text-sm text-white/80 break-words whitespace-pre-wrap">{msg.text}</p>
                      </div>
                    </div>
                  ) : msg.role === 'tool' ? (
                    <div className="flex items-start gap-2.5">
                      {/* Timeline dot */}
                      <div className="flex flex-col items-center w-4 shrink-0 pt-3">
                        {isPrevTool && <div className="w-px h-2 bg-violet-500/15" />}
                        {isLastTool && isProcessing ? (
                          <LoaderCircle className="w-3.5 h-3.5 text-violet-400 animate-spin shrink-0" />
                        ) : (
                          <div className={cn(
                            'w-1.5 h-1.5 shrink-0',
                            isLastTool ? 'bg-violet-400' : 'bg-violet-500/30'
                          )} />
                        )}
                        {isNextTool && <div className="w-px h-2 bg-violet-500/15 mt-auto" />}
                      </div>
                      {/* Tool content — no box */}
                      <div className="flex items-start gap-2 py-1.5 min-w-0">
                        <div className="w-4 h-4 flex items-center justify-center shrink-0 mt-0.5">
                          <ToolIcon text={msg.text} />
                        </div>
                        <ToolContent text={msg.text} expanded={isExpanded} />
                      </div>
                    </div>
                  ) : (
                    <div className="py-3">
                      <span className="text-[11px] font-medium text-violet-400/50 tracking-wider uppercase mb-2 block">Matthew</span>
                      {i === lastAssistantIndex ? (
                        <TypingMarkdown text={msg.text} animate={true} onUpdate={scrollToBottom} />
                      ) : (
                        <MarkdownMessage text={msg.text} />
                      )}
                    </div>
                  )}
                </motion.div>
              )
            })
          )}
          <div ref={chatEndRef} />
        </div>
      </div>

      {/* Bottom controls — gradient fade */}
      <div className="relative z-50 shrink-0 flex flex-col items-center gap-3 pb-8 pt-6 bg-gradient-to-t from-black via-black to-transparent">

        <AnimatePresence mode="wait">
          {isListening ? (
            <motion.p
              key="listening"
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -5 }}
              className="text-xs text-violet-300 px-4 text-center max-w-[80%]"
            >
              {transcript ? `"${transcript}"` : 'Listening... say "send" when done'}
            </motion.p>
          ) : micError ? (
            <motion.p
              key="error"
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -5 }}
              className="text-xs text-red-400"
            >
              {micError}
            </motion.p>
          ) : pendingMessage ? (
            <motion.p
              key="pending"
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -5 }}
              className="text-xs text-white/50 px-4 text-center max-w-[80%] line-clamp-2"
            >
              &ldquo;{pendingMessage}&rdquo;
            </motion.p>
          ) : null}
        </AnimatePresence>

        <div className="flex items-center gap-4">
          <button
            onClick={() => setTtsEnabled(!ttsEnabled)}
            className={cn(
              'p-2.5 transition-colors',
              ttsEnabled
                ? 'text-violet-300'
                : 'text-white/20 hover:text-white/40',
            )}
          >
            {ttsEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
          </button>

          <motion.button
            onClick={handleMicClick}
            disabled={!supported}
            whileTap={{ scale: 0.92 }}
            className={cn(
              'relative flex items-center justify-center w-14 h-14 transition-all duration-500 rounded-full',
              isListening
                ? 'bg-violet-500/20'
                : 'bg-white/[0.03] hover:bg-white/[0.06]',
              !supported && 'opacity-30 cursor-not-allowed',
            )}
            style={isListening ? { boxShadow: '0 0 25px rgba(139,92,246,0.3)' } : {}}
          >
            {isListening && (
              <span className="absolute inset-0 rounded-full bg-violet-500/20 animate-ping" style={{ animationDuration: '1.5s' }} />
            )}
            <Mic className={cn('w-5 h-5 relative z-10', isListening ? 'text-violet-300' : 'text-white/50')} />
          </motion.button>

          <AnimatePresence>
            {pendingMessage ? (
              <motion.button
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                onClick={handleSend}
                whileTap={{ scale: 0.92 }}
                className="p-2.5 text-violet-300"
              >
                <Send className="w-4 h-4" />
              </motion.button>
            ) : (
              <div className="w-9" />
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  )
}
