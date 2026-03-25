import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Mic, Send, Volume2, VolumeX, FileText, Terminal, Search, Pencil, FilePlus, CheckCircle2, ListTodo, Globe, Wrench } from 'lucide-react'
import { cn } from '@/lib/utils'
import { VoiceWaveform } from '@/components/VoiceWaveform'
import { MarkdownMessage } from '@/components/MarkdownMessage'
import { useBridge, sharedAudio, getAudioLevel, onAudioPlayingChange } from '@/hooks/useBridge'
import { useVoice } from '@/hooks/useVoice'

function stopAudioPlayback() {
  if (sharedAudio) {
    sharedAudio.pause()
    sharedAudio.currentTime = 0
  }
}

function ToolIcon({ text }: { text: string }) {
  const t = text.toLowerCase()
  if (t.startsWith('reading')) return <FileText className="w-3.5 h-3.5 text-amber-400" />
  if (t.startsWith('running')) return <Terminal className="w-3.5 h-3.5 text-amber-400" />
  if (t.startsWith('searching')) return <Search className="w-3.5 h-3.5 text-amber-400" />
  if (t.startsWith('editing')) return <Pencil className="w-3.5 h-3.5 text-amber-400" />
  if (t.startsWith('creating')) return <FilePlus className="w-3.5 h-3.5 text-amber-400" />
  if (t.startsWith('planning') || t.startsWith('checking task')) return <ListTodo className="w-3.5 h-3.5 text-amber-400" />
  if (t.startsWith('searching the web') || t.startsWith('fetching')) return <Globe className="w-3.5 h-3.5 text-amber-400" />
  if (t.startsWith('looking up')) return <Wrench className="w-3.5 h-3.5 text-amber-400" />
  return <CheckCircle2 className="w-3.5 h-3.5 text-amber-400" />
}

/** Render tool call text with code diff lines highlighted */
function ToolContent({ text }: { text: string }) {
  const lines = text.split('\n')
  if (lines.length === 1) {
    return <span className="text-xs text-white/50 leading-tight">{text}</span>
  }
  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <span className="text-xs text-white/50 leading-tight">{lines[0]}</span>
      {lines.slice(1).map((line, i) => {
        const trimmed = line.trim()
        if (trimmed.startsWith('⊖')) {
          return (
            <span key={i} className="text-[10px] font-mono text-red-400/70 leading-tight truncate">
              {trimmed}
            </span>
          )
        }
        if (trimmed.startsWith('⊕')) {
          return (
            <span key={i} className="text-[10px] font-mono text-emerald-400/70 leading-tight truncate">
              {trimmed}
            </span>
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
    stopAudioPlayback()
    autoListenRef.current?.()
  })

  const { isListening, transcript, ttsEnabled, setTtsEnabled, startListening, stopListening, supported, micError } =
    useVoice()

  autoListenRef.current = startListening

  const chatEndRef = useRef<HTMLDivElement>(null)

  // Waveform only animates when audio is actually playing
  const waveformActive = isAudioPlaying

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
    stopAudioPlayback()
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
    <div className="h-[100dvh] flex flex-col bg-[#0A0A0B] text-white relative overflow-hidden">
      {/* Background glow */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-violet-500/10 rounded-full blur-[128px] animate-pulse" />
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-indigo-500/10 rounded-full blur-[128px] animate-pulse" style={{ animationDelay: '700ms' }} />
      </div>

      {/* Header */}
      <div className="relative z-10 flex flex-col items-center pt-6 pb-3 shrink-0">
        <VoiceWaveform isActive={waveformActive} size={200} getAudioLevel={getAudioLevel} />
        <h1 className="text-xl font-semibold bg-clip-text text-transparent bg-gradient-to-r from-white/90 to-white/60 mt-1">
          Matthews Terminal
        </h1>
        <div className="flex items-center gap-2 mt-1">
          <span className={cn('h-1.5 w-1.5 rounded-full', statusColor, status === 'connecting' && 'animate-pulse')} />
          <span className="text-[11px] text-white/25">{statusLabel}</span>
        </div>
      </div>

      {/* Chat area */}
      <div className="relative z-10 flex-1 min-h-0 overflow-y-auto px-5 pb-4" style={{ WebkitOverflowScrolling: 'touch' }}>
        <div className="max-w-md mx-auto flex flex-col gap-3">
          {messages.length === 0 ? (
            <p className="text-white/15 text-sm text-center mt-12">Tap the mic to start talking</p>
          ) : (
            messages.map((msg, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2 }}
              >
                {msg.role === 'user' ? (
                  <div className="flex justify-end">
                    <div className="max-w-[85%] bg-violet-500/15 border border-violet-500/15 rounded-2xl rounded-br-md px-4 py-2.5">
                      <p className="text-sm text-white/80">{msg.text}</p>
                    </div>
                  </div>
                ) : msg.role === 'tool' ? (
                  <div className="flex items-start gap-2.5 py-2 px-3 rounded-xl bg-white/[0.03] border border-white/[0.06] ml-1">
                    <div className="w-6 h-6 rounded-lg bg-amber-500/15 border border-amber-500/20 flex items-center justify-center shrink-0 mt-0.5">
                      <ToolIcon text={msg.text} />
                    </div>
                    <ToolContent text={msg.text} />
                  </div>
                ) : (
                  <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl rounded-bl-md px-4 py-3 ml-1">
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
            ))
          )}
          <div ref={chatEndRef} />
        </div>
      </div>

      {/* Bottom controls */}
      <div className="relative z-50 shrink-0 flex flex-col items-center gap-3 pb-8 pt-4 bg-gradient-to-t from-[#0A0A0B] via-[#0A0A0B] to-transparent">
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
