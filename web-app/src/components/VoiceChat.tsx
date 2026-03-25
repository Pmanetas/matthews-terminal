import { useEffect, useRef, useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Mic, Send, Volume2, VolumeX, FileText, Terminal, Search, Pencil, FilePlus, CheckCircle2, ListTodo, Globe, Wrench, LoaderCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { VoiceWaveform } from '@/components/VoiceWaveform'
import { MarkdownMessage } from '@/components/MarkdownMessage'
import { useBridge, getAudioLevel, onAudioPlayingChange, stopAllAudio } from '@/hooks/useBridge'
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

/** Expanded tool: show header + all accumulated diff lines with sub-dots */
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
      <div className="flex gap-2.5">
        {/* Mini sub-timeline */}
        <div className="flex flex-col items-center w-2 shrink-0">
          {diffLines.map((_, idx) => (
            <div key={idx} className="flex flex-col items-center flex-1 min-h-[18px]">
              <div className="w-1 h-1 bg-violet-500/40 shrink-0 mt-1.5" />
              {idx < diffLines.length - 1 && <div className="w-px flex-1 bg-violet-500/10" />}
            </div>
          ))}
        </div>
        {/* Diff content */}
        <div className="flex flex-col gap-px flex-1 min-w-0">
          {diffLines.map((line, i) => {
            const trimmed = line.trim()
            const code = trimmed.replace(/^[⊖⊕]\s*/, '')
            if (trimmed.startsWith('⊖')) {
              return (
                <div key={i} className="bg-red-500/10 border-l border-red-500/40 px-2 py-0.5">
                  <span className="text-[10px] font-mono text-red-300/70 leading-tight block">{code}</span>
                </div>
              )
            }
            if (trimmed.startsWith('⊕')) {
              return (
                <div key={i} className="bg-emerald-500/10 border-l border-emerald-500/40 px-2 py-0.5">
                  <span className="text-[10px] font-mono text-emerald-300/70 leading-tight block">{code}</span>
                </div>
              )
            }
            return (
              <span key={i} className="text-[10px] text-white/30 leading-tight px-2">{trimmed}</span>
            )
          })}
        </div>
      </div>
    </div>
  )
}

/** Typing animation — scrolls as it types */
function TypingMarkdown({ text, animate, onUpdate }: { text: string; animate: boolean; onUpdate?: () => void }) {
  const [chars, setChars] = useState(animate ? 0 : text.length)
  const prevTextRef = useRef(text)

  useEffect(() => {
    if (!animate) { setChars(text.length); return }
    if (text !== prevTextRef.current) {
      prevTextRef.current = text
      setChars(0)
    }
    if (chars >= text.length) return
    const id = setInterval(() => {
      setChars((c) => {
        const next = c + 3
        if (next >= text.length) { clearInterval(id); return text.length }
        return next
      })
      onUpdate?.()
    }, 8)
    return () => clearInterval(id)
  }, [text, animate, chars, onUpdate])

  return <MarkdownMessage text={text.slice(0, chars)} />
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
  const waveformActive = isAudioPlaying

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
      {/* Header */}
      <div className="relative z-10 flex flex-col items-center pt-6 pb-2 shrink-0">
        <h1 className="text-base font-bold tracking-[0.25em] uppercase text-violet-400/80 mb-3"
            style={{ textShadow: '0 0 20px rgba(139,92,246,0.3)' }}>
          MATTHEWS TERMINAL
        </h1>
        <VoiceWaveform isActive={waveformActive} size={200} getAudioLevel={getAudioLevel} />
        <div className="flex items-center gap-2 mt-3">
          <span className={cn('h-1.5 w-1.5', statusDot)} />
          <span className="text-[10px] text-white/25 tracking-wide">{statusText}</span>
        </div>
        <div className="w-full mt-4 h-px bg-gradient-to-r from-transparent via-violet-500/15 to-transparent" />
      </div>

      {/* Chat area */}
      <div className="relative z-10 flex-1 min-h-0 overflow-y-auto pb-4" style={{ WebkitOverflowScrolling: 'touch' }}>
        <div className="flex flex-col gap-3 pt-3 mx-8">
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
                      <div className="max-w-[60%] border border-violet-500/20 px-5 py-3"
                           style={{ background: 'rgba(139,92,246,0.06)' }}>
                        <p className="text-sm text-white/80 break-words whitespace-pre-wrap">{msg.text}</p>
                      </div>
                    </div>
                  ) : msg.role === 'tool' ? (
                    <div className="flex items-stretch gap-3">
                      {/* Timeline */}
                      <div className="flex flex-col items-center w-4 shrink-0">
                        <div className={cn('w-px flex-1', isPrevTool ? 'bg-violet-500/15' : 'bg-transparent')} />
                        {isLastTool && isProcessing ? (
                          <LoaderCircle className="w-4 h-4 text-violet-400 animate-spin shrink-0" />
                        ) : (
                          <div className={cn(
                            'w-2 h-2 shrink-0',
                            isLastTool ? 'bg-violet-400' : 'bg-violet-500/30'
                          )} />
                        )}
                        <div className={cn('w-px flex-1', isNextTool ? 'bg-violet-500/15' : 'bg-transparent')} />
                      </div>
                      {/* Tool box */}
                      <div className={cn(
                        'flex-1 flex items-start gap-2.5 py-2.5 px-4 border transition-all',
                        isExpanded
                          ? 'border-violet-500/25 bg-violet-500/[0.04]'
                          : 'border-white/[0.06] bg-white/[0.02]'
                      )}>
                        <div className="w-5 h-5 border border-violet-500/20 bg-violet-500/10 flex items-center justify-center shrink-0 mt-0.5">
                          <ToolIcon text={msg.text} />
                        </div>
                        <ToolContent text={msg.text} expanded={isExpanded} />
                      </div>
                    </div>
                  ) : (
                    <div className="border border-white/[0.06] bg-white/[0.02] px-5 py-4">
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

      {/* Bottom controls */}
      <div className="relative z-50 shrink-0 flex flex-col items-center gap-3 pb-8 pt-3 bg-black">
        <div className="w-full h-px bg-gradient-to-r from-transparent via-violet-500/15 to-transparent mb-1" />

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
              'p-2.5 transition-colors border',
              ttsEnabled
                ? 'text-violet-300 border-violet-500/20 bg-violet-500/10'
                : 'text-white/20 border-white/[0.06] hover:text-white/40',
            )}
          >
            {ttsEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
          </button>

          <motion.button
            onClick={handleMicClick}
            disabled={!supported}
            whileTap={{ scale: 0.92 }}
            className={cn(
              'relative flex items-center justify-center w-14 h-14 transition-all duration-500 border',
              isListening
                ? 'bg-violet-500/20 border-violet-500/50'
                : 'bg-white/[0.03] border-violet-500/15 hover:border-violet-500/30',
              !supported && 'opacity-30 cursor-not-allowed',
            )}
            style={isListening ? { boxShadow: '0 0 25px rgba(139,92,246,0.3), inset 0 0 15px rgba(139,92,246,0.1)' } : {}}
          >
            {isListening && (
              <span className="absolute inset-0 bg-violet-500/20 animate-ping" style={{ animationDuration: '1.5s' }} />
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
                className="p-2.5 border border-violet-500/30 bg-violet-500/15 text-violet-300"
                style={{ boxShadow: '0 0 15px rgba(139,92,246,0.2)' }}
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
