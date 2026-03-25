import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Mic, Send, Volume2, VolumeX, FileText, Terminal, Search, Pencil, FilePlus, CheckCircle2, ListTodo, Globe, Wrench, LoaderCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { VoiceWaveform } from '@/components/VoiceWaveform'
import { MarkdownMessage } from '@/components/MarkdownMessage'
import { useBridge, getAudioLevel, onAudioPlayingChange, stopAllAudio } from '@/hooks/useBridge'
import { useVoice } from '@/hooks/useVoice'

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

/** Render tool call — expanded shows diff lines, collapsed shows only header */
function ToolContent({ text, expanded }: { text: string; expanded: boolean }) {
  const lines = text.split('\n')
  const header = lines[0]

  if (!expanded || lines.length === 1) {
    return <span className="text-xs text-white/50 leading-tight">{header}</span>
  }

  return (
    <div className="flex flex-col gap-0.5 min-w-0 w-full">
      <span className="text-xs text-white/50 leading-tight">{header}</span>
      {lines.slice(1).map((line, i) => {
        const trimmed = line.trim()
        const code = trimmed.replace(/^[⊖⊕]\s*/, '')
        if (trimmed.startsWith('⊖')) {
          return (
            <div key={i} className="bg-red-500/15 border-l-2 border-red-500/50 px-2 py-0.5 rounded-r-sm -mx-1">
              <span className="text-[10px] font-mono text-red-300/80 leading-tight block truncate">{code}</span>
            </div>
          )
        }
        if (trimmed.startsWith('⊕')) {
          return (
            <div key={i} className="bg-emerald-500/15 border-l-2 border-emerald-500/50 px-2 py-0.5 rounded-r-sm -mx-1">
              <span className="text-[10px] font-mono text-emerald-300/80 leading-tight block truncate">{code}</span>
            </div>
          )
        }
        return (
          <span key={i} className="text-xs text-white/40 leading-tight">{trimmed}</span>
        )
      })}
    </div>
  )
}

export function VoiceChat() {
  const [pendingMessage, setPendingMessage] = useState('')
  const [isAudioPlaying, setIsAudioPlaying] = useState(false)
  const autoListenRef = useRef<(() => void) | null>(null)
  const hasSentRef = useRef(false)

  // Track audio playing state for waveform
  useEffect(() => {
    onAudioPlayingChange(setIsAudioPlaying)
    return () => onAudioPlayingChange(() => {})
  }, [])

  const { status, messages, sendCommand } = useBridge(() => {
    // Called when final TTS audio finishes — auto-listen
    autoListenRef.current?.()
  })

  const { isListening, transcript, ttsEnabled, setTtsEnabled, startListening, stopListening, supported, micError } =
    useVoice()

  autoListenRef.current = startListening

  const chatEndRef = useRef<HTMLDivElement>(null)

  // Waveform only animates when audio is actually playing
  const waveformActive = isAudioPlaying

  // Detect if processing (last message is user or tool — no assistant reply yet)
  const isProcessing = messages.length > 0 && messages[messages.length - 1].role !== 'assistant'

  // Find the index of the last tool message (for expand/collapse)
  const lastToolIndex = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'tool') return i
    }
    return -1
  })()

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    if (isListening) hasSentRef.current = false
  }, [isListening])

  useEffect(() => {
    if (!transcript || hasSentRef.current) return
    const trimmed = transcript.trim()
    if (!trimmed) return

    // "stop" / "shut up" / "quiet" — interrupt Matthew
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
    // Stop all audio immediately (clears queue + resets state)
    stopAllAudio()
    if (isListening) {
      stopListening()
    } else {
      setPendingMessage('')
      hasSentRef.current = false
      startListening()
    }
  }

  const statusColor =
    status === 'connected' ? 'bg-emerald-400' : status === 'connecting' ? 'bg-yellow-400' : 'bg-red-400'
  const statusLabel =
    status === 'connected' ? 'Connected' : status === 'connecting' ? 'Connecting...' : 'Disconnected'

  return (
    <div className="h-[100dvh] flex flex-col bg-black text-white relative overflow-hidden">
      {/* Background glow — subtle purple ambient */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-violet-500/8 rounded-full blur-[128px] animate-pulse" />
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-indigo-500/8 rounded-full blur-[128px] animate-pulse" style={{ animationDelay: '700ms' }} />
      </div>

      {/* Header */}
      <div className="relative z-10 flex flex-col items-center pt-6 pb-3 shrink-0">
        <VoiceWaveform isActive={waveformActive} size={200} getAudioLevel={getAudioLevel} />
        <h1 className="text-xl font-semibold tracking-wide bg-clip-text text-transparent bg-gradient-to-r from-violet-300 to-white/70 mt-1">
          Matthews Terminal
        </h1>
        <div className="flex items-center gap-2 mt-1">
          <span className={cn('h-1.5 w-1.5 rounded-full', statusColor, status === 'connecting' && 'animate-pulse')} />
          <span className="text-[11px] text-white/25">{statusLabel}</span>
        </div>
      </div>

      {/* Chat area */}
      <div className="relative z-10 flex-1 min-h-0 overflow-y-auto px-5 pb-4" style={{ WebkitOverflowScrolling: 'touch' }}>
        <div className="max-w-2xl mx-auto flex flex-col gap-3">
          {messages.length === 0 ? (
            <p className="text-white/15 text-sm text-center mt-12">Tap the mic to start talking</p>
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
                  transition={{ duration: 0.2 }}
                >
                  {msg.role === 'user' ? (
                    <div className="flex justify-end">
                      <div className="max-w-[85%] bg-violet-500/15 border border-violet-500/20 rounded-2xl rounded-br-md px-4 py-2.5">
                        <p className="text-sm text-white/80">{msg.text}</p>
                      </div>
                    </div>
                  ) : msg.role === 'tool' ? (
                    <div className="flex items-stretch gap-2.5 ml-2">
                      {/* Timeline line + dot */}
                      <div className="flex flex-col items-center w-3 shrink-0">
                        <div className={cn('w-px flex-1', isPrevTool ? 'bg-violet-500/25' : 'bg-transparent')} />
                        <div className={cn(
                          'w-2 h-2 rounded-full shrink-0 transition-all',
                          isLastTool && isProcessing
                            ? 'bg-violet-400 shadow-[0_0_8px_rgba(139,92,246,0.6)]'
                            : 'bg-violet-400/50'
                        )} />
                        <div className={cn('w-px flex-1', isNextTool ? 'bg-violet-500/25' : 'bg-transparent')} />
                      </div>
                      {/* Tool content */}
                      <div className={cn(
                        'flex-1 flex items-start gap-2.5 py-2 px-3 rounded-xl border transition-all',
                        isExpanded
                          ? 'bg-white/[0.04] border-violet-500/20'
                          : 'bg-white/[0.02] border-white/[0.06]'
                      )}>
                        <div className="w-6 h-6 rounded-lg bg-violet-500/15 border border-violet-500/20 flex items-center justify-center shrink-0 mt-0.5">
                          <ToolIcon text={msg.text} />
                        </div>
                        <ToolContent text={msg.text} expanded={isExpanded} />
                      </div>
                    </div>
                  ) : (
                    <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl rounded-bl-md px-4 py-3 ml-2">
                      <div className="flex items-center gap-2 mb-2">
                        <div className="w-5 h-5 rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center">
                          <span className="text-[10px] font-bold">M</span>
                        </div>
                        <span className="text-[11px] font-medium text-white/40">Matthew</span>
                      </div>
                      <MarkdownMessage text={msg.text} />
                    </div>
                  )}
                </motion.div>
              )
            })
          )}

          {/* Loading spinner while processing */}
          {isProcessing && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex items-center gap-2 ml-8 py-2"
            >
              <LoaderCircle className="w-4 h-4 text-violet-400 animate-spin" />
              <span className="text-xs text-white/30">Working...</span>
            </motion.div>
          )}

          <div ref={chatEndRef} />
        </div>
      </div>

      {/* Bottom controls */}
      <div className="relative z-50 shrink-0 flex flex-col items-center gap-3 pb-8 pt-4 bg-gradient-to-t from-black via-black to-transparent">
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
              'p-2.5 rounded-full transition-colors',
              ttsEnabled ? 'text-violet-300 bg-violet-500/10' : 'text-white/20 hover:text-white/40',
            )}
          >
            {ttsEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
          </button>

          <motion.button
            onClick={handleMicClick}
            disabled={!supported}
            whileTap={{ scale: 0.92 }}
            className={cn(
              'relative flex items-center justify-center w-14 h-14 rounded-full transition-all duration-500',
              isListening
                ? 'bg-violet-500 shadow-[0_0_40px_rgba(139,92,246,0.5)]'
                : 'bg-white/10 hover:bg-white/15 border border-white/10',
              !supported && 'opacity-30 cursor-not-allowed',
            )}
          >
            {isListening && (
              <span className="absolute inset-0 rounded-full bg-violet-500/30 animate-ping" style={{ animationDuration: '1.5s' }} />
            )}
            <Mic className={cn('w-5 h-5 relative z-10', isListening ? 'text-white' : 'text-white/70')} />
          </motion.button>

          <AnimatePresence>
            {pendingMessage ? (
              <motion.button
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                onClick={handleSend}
                whileTap={{ scale: 0.92 }}
                className="p-2.5 rounded-full bg-violet-500 text-white shadow-[0_0_20px_rgba(139,92,246,0.4)]"
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
