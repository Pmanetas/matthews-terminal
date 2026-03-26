import { useEffect, useRef, useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Mic, MicOff, ArrowUp, FileText, Terminal, Search, Pencil, FilePlus, CheckCircle2, ListTodo, Globe, Wrench, LoaderCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { VoiceWaveform } from '@/components/VoiceWaveform'
import { MarkdownMessage } from '@/components/MarkdownMessage'
import { useBridge, sharedAudio, getAudioLevel, onAudioPlayingChange, stopAllAudio, audioStartedForResult, onAudioStarted } from '@/hooks/useBridge'
import { useVoice } from '@/hooks/useVoice'

// ── Helpers ──────────────────────────────────────────────────────

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

function ToolContent({ text, expanded }: { text: string; expanded: boolean }) {
  const lines = text.split('\n')
  const header = lines[0]
  const diffLines = lines.slice(1)

  if (!expanded || diffLines.length === 0) {
    return <span className="text-xs text-white/50 leading-tight">{header}</span>
  }

  return (
    <div className="flex flex-col min-w-0 w-full">
      <span className="text-xs text-white/50 leading-tight mb-1.5">{header}</span>
      <div className="flex flex-col gap-0.5 overflow-x-auto">
        {diffLines.map((line, i) => {
          const trimmed = line.trim()
          const code = trimmed.replace(/^[⊖⊕]\s*/, '')
          const isRemove = trimmed.startsWith('⊖')
          const isAdd = trimmed.startsWith('⊕')
          return (
            <div key={i} className="flex items-center gap-2">
              <div className="w-1 h-1 shrink-0 bg-violet-500/30" />
              {isRemove ? (
                <code className="text-[10px] font-mono text-red-300/70 bg-red-500/10 border-l border-red-500/40 px-1.5 py-px whitespace-pre">{code}</code>
              ) : isAdd ? (
                <code className="text-[10px] font-mono text-emerald-300/70 bg-emerald-500/10 border-l border-emerald-500/40 px-1.5 py-px whitespace-pre">{code}</code>
              ) : (
                <span className="text-[10px] text-white/30 whitespace-pre">{trimmed}</span>
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

  useEffect(() => {
    if (!animate) return
    const timeout = setTimeout(() => { audioTimedOut.current = true }, 2000)
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
        setChars((c) => Math.min(c + 4, text.length))
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
    <div className="flex items-center gap-1 px-4 py-3">
      {[0, 1, 2].map((i) => (
        <motion.div
          key={i}
          className="w-2 h-2 bg-violet-400/50 rounded-full"
          animate={{ opacity: [0.3, 1, 0.3], scale: [0.8, 1.1, 0.8] }}
          transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2 }}
        />
      ))}
    </div>
  )
}

// ── Robot Head (compact for header) ──────────────────────────────

function RobotHead({ isActive, getAudioLevel: getLevel }: { isActive: boolean; getAudioLevel: () => number }) {
  return (
    <div className="relative flex items-center justify-center" style={{ width: 56, height: 52 }}>
      <svg width="56" height="52" viewBox="0 0 56 52" fill="none"
           style={{ filter: 'drop-shadow(0 0 8px rgba(139,92,246,0.3))' }}>
        {/* Antenna */}
        <line x1="28" y1="0" x2="28" y2="8" stroke="rgba(139,92,246,0.5)" strokeWidth="1.5" />
        <circle cx="28" cy="2" r="1.5" fill="rgba(139,92,246,0.7)">
          <animate attributeName="opacity" values="0.4;1;0.4" dur="2s" repeatCount="indefinite" />
        </circle>
        {/* Head */}
        <rect x="5" y="8" width="46" height="38" rx="4" stroke="rgba(139,92,246,0.4)" strokeWidth="1.2" fill="rgba(139,92,246,0.04)" />
        {/* Eyes */}
        <rect x="14" y="16" width="9" height="6" rx="1.5" fill="rgba(139,92,246,0.6)">
          <animate attributeName="opacity" values="0.6;0.9;0.6" dur="3s" repeatCount="indefinite" />
        </rect>
        <rect x="33" y="16" width="9" height="6" rx="1.5" fill="rgba(139,92,246,0.6)">
          <animate attributeName="opacity" values="0.6;0.9;0.6" dur="3s" repeatCount="indefinite" />
        </rect>
        {/* Mouth area */}
        <rect x="12" y="29" width="32" height="12" rx="2" fill="rgba(139,92,246,0.03)" stroke="rgba(139,92,246,0.15)" strokeWidth="0.8" />
        {/* Ear bolts */}
        <rect x="1" y="20" width="4" height="7" rx="1" fill="rgba(139,92,246,0.2)" />
        <rect x="51" y="20" width="4" height="7" rx="1" fill="rgba(139,92,246,0.2)" />
      </svg>
      {/* Waveform as mouth */}
      <div className="absolute" style={{ top: 28, left: '50%', transform: 'translateX(-50%)' }}>
        <VoiceWaveform isActive={isActive} size={32} getAudioLevel={getLevel} />
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
  const autoListenRef = useRef<(() => void) | null>(null)
  const hasSentRef = useRef(false)

  useEffect(() => {
    onAudioPlayingChange(setIsAudioPlaying)
    return () => onAudioPlayingChange(() => {})
  }, [])

  const { status, messages, sendCommand, sendStop, workspace } = useBridge(() => {
    autoListenRef.current?.()
  })

  const { isListening, transcript, startListening, stopListening, supported, micError } = useVoice()

  autoListenRef.current = startListening
  const chatEndRef = useRef<HTMLDivElement>(null)

  const isProcessing = messages.length > 0 && messages[messages.length - 1].role !== 'assistant'
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
      if (msg) {
        hasSentRef.current = true
        stopListening()
        setPendingMessage('')
        sendCommand(msg)
      }
    } else if (!isListening) {
      setPendingMessage(trimmed)
    }
  }, [isListening, transcript, sendCommand, sendStop, stopListening, startListening])

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

  const statusDot = status === 'connected' ? 'bg-emerald-400' : status === 'connecting' ? 'bg-yellow-400' : 'bg-red-400'
  const statusLabel = status === 'connected'
    ? (workspace || 'Connected')
    : status === 'connecting' ? 'Connecting...' : 'Disconnected'

  return (
    <div
      className="h-[100dvh] flex flex-col bg-[#0a0a0a] text-white relative"
      style={{ paddingTop: 'env(safe-area-inset-top)', overscrollBehavior: 'none' }}
    >
      <style>{globalCSS}</style>

      {/* ── Header bar (like Claude app) ── */}
      <div className="shrink-0 flex items-center justify-between px-5 py-3 border-b border-white/[0.06]">
        {/* Left — robot head */}
        <RobotHead isActive={isAudioPlaying} getAudioLevel={getAudioLevel} />
        {/* Center — title + status */}
        <div className="flex flex-col items-center flex-1 min-w-0 px-3">
          <span className="text-sm font-semibold text-white/90 tracking-wide">Matthew</span>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className={cn('h-1.5 w-1.5 rounded-full', statusDot)} />
            <span className="text-[10px] text-white/30 truncate max-w-[200px]">{statusLabel}</span>
          </div>
        </div>
        {/* Right — spacer for balance */}
        <div style={{ width: 56 }} />
      </div>

      {/* ── Chat messages ── */}
      <div
        className="flex-1 min-h-0 overflow-y-auto no-scrollbar"
        style={{ overscrollBehavior: 'none' }}
      >
        <div className="flex flex-col gap-4 px-4 sm:px-8 md:px-16 lg:px-32 xl:px-48 py-4 max-w-4xl mx-auto">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center mt-20 gap-3">
              <RobotHead isActive={false} getAudioLevel={() => 0} />
              <p className="text-white/20 text-sm">Tap the mic to start talking</p>
            </div>
          ) : (
            messages.map((msg, i) => {
              const isNextTool = messages[i + 1]?.role === 'tool'
              const isPrevTool = i > 0 && messages[i - 1]?.role === 'tool'
              const isLastTool = i === lastToolIndex
              const isExpanded = isLastTool && isProcessing

              return (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.15 }}
                >
                  {msg.role === 'user' ? (
                    /* ── User bubble ── */
                    <div className="flex justify-end">
                      <div className="max-w-[80%] sm:max-w-[65%] px-4 py-3 rounded-3xl rounded-br-lg bg-violet-600/20">
                        <p className="text-[15px] text-white/90 break-words whitespace-pre-wrap leading-relaxed">{msg.text}</p>
                      </div>
                    </div>
                  ) : msg.role === 'tool' ? (
                    /* ── Tool call ── */
                    <div className="flex items-stretch gap-2.5 ml-1">
                      <div className="flex flex-col items-center w-4 shrink-0">
                        <div className={cn('w-px flex-1', isPrevTool ? 'bg-violet-500/15' : 'bg-transparent')} />
                        {isLastTool && isProcessing ? (
                          <LoaderCircle className="w-3.5 h-3.5 text-violet-400 animate-spin shrink-0" />
                        ) : (
                          <div className={cn('w-1.5 h-1.5 shrink-0 rounded-full', isLastTool && isProcessing ? 'bg-violet-400' : 'bg-violet-500/30')} />
                        )}
                        <div className={cn('w-px flex-1', isNextTool ? 'bg-violet-500/15' : 'bg-transparent')} />
                      </div>
                      <div className={cn(
                        'flex-1 flex items-start gap-2 py-2 px-3 rounded-xl min-w-0 overflow-hidden border',
                        isExpanded
                          ? 'border-violet-500/20 bg-violet-500/[0.04]'
                          : 'border-white/[0.06] bg-white/[0.02]'
                      )}>
                        <div className="w-4 h-4 flex items-center justify-center shrink-0 mt-0.5">
                          <ToolIcon text={msg.text} />
                        </div>
                        <ToolContent text={msg.text} expanded={isExpanded} />
                      </div>
                    </div>
                  ) : (
                    /* ── Assistant bubble ── */
                    <div className="flex justify-start">
                      <div className="max-w-[90%] sm:max-w-[75%]">
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
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              <ThinkingDots />
            </motion.div>
          )}
          <div ref={chatEndRef} />
        </div>
      </div>

      {/* ── Bottom input bar (like Claude app) ── */}
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

        {/* Input row */}
        <div className="flex items-end gap-2 px-4 pt-2 pb-1">
          {/* Mic button (main action — like Claude's text input area) */}
          <div className="flex-1 flex items-center rounded-full border border-white/[0.08] bg-white/[0.03] px-4 py-2.5 min-h-[48px]">
            <span className="text-sm text-white/25 flex-1 select-none">
              {isListening ? 'Listening...' : pendingMessage || 'Tap mic to speak'}
            </span>
          </div>

          {/* Action button — mic or send */}
          {pendingMessage ? (
            <motion.button
              key="send"
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.8, opacity: 0 }}
              onClick={handleSend}
              className="flex items-center justify-center w-11 h-11 rounded-full bg-violet-500 shrink-0"
            >
              <ArrowUp className="w-5 h-5 text-white" />
            </motion.button>
          ) : (
            <motion.button
              key="mic"
              onClick={handleMicClick}
              disabled={!supported}
              whileTap={{ scale: 0.9 }}
              className={cn(
                'relative flex items-center justify-center w-11 h-11 rounded-full shrink-0 transition-all',
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
        </div>
      </div>
    </div>
  )
}
