import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Mic, Send, Volume2, VolumeX } from 'lucide-react'
import { cn } from '@/lib/utils'
import { GeometricSphere } from '@/components/GeometricSphere'
import { MarkdownMessage } from '@/components/MarkdownMessage'
import { useBridge, sharedAudio, getAudioLevel } from '@/hooks/useBridge'
import { useVoice } from '@/hooks/useVoice'

// Stop audio playback so microphone can be used
function stopAudioPlayback() {
  if (sharedAudio) {
    sharedAudio.pause()
    sharedAudio.currentTime = 0
  }
}

export function VoiceChat() {
  const [audioJustFinished, setAudioJustFinished] = useState(false)
  const [pendingMessage, setPendingMessage] = useState('')
  const autoListenRef = useRef<(() => void) | null>(null)

  const { status, messages, sendCommand } = useBridge(() => {
    stopAudioPlayback()
    setAudioJustFinished(true)
    autoListenRef.current?.()
  })

  const { isListening, transcript, ttsEnabled, setTtsEnabled, startListening, stopListening, supported, micError } =
    useVoice()

  autoListenRef.current = startListening

  const chatEndRef = useRef<HTMLDivElement>(null)

  const isProcessing = messages.length > 0 && messages[messages.length - 1]?.role === 'user'
  const sphereActive = isListening || isProcessing

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Clear prompt when user starts listening
  useEffect(() => {
    if (isListening) setAudioJustFinished(false)
  }, [isListening])

  // Detect "send" keyword in real-time while still listening (desktop)
  // OR when done listening (phone — where continuous mode may not work)
  useEffect(() => {
    if (!transcript) return
    const trimmed = transcript.trim()
    const sendPattern = /\bsend\s*[.!]?\s*$/i

    if (sendPattern.test(trimmed)) {
      // User said "send" — strip it, stop listening, and send
      const msg = trimmed.replace(sendPattern, '').trim()
      if (msg) {
        stopListening()
        setPendingMessage('')
        sendCommand(msg)
      }
    } else if (!isListening) {
      // Stopped listening without saying "send" — hold as pending
      setPendingMessage(trimmed)
    }
  }, [isListening, transcript, sendCommand, stopListening])

  const handleSend = () => {
    if (pendingMessage) {
      sendCommand(pendingMessage)
      setPendingMessage('')
    }
  }

  const handleMicClick = () => {
    stopAudioPlayback()
    setAudioJustFinished(false)
    if (isListening) {
      stopListening()
    } else {
      setPendingMessage('') // clear old pending when re-recording
      startListening()
    }
  }

  const statusColor =
    status === 'connected' ? 'bg-emerald-400' : status === 'connecting' ? 'bg-yellow-400' : 'bg-red-400'
  const statusLabel =
    status === 'connected' ? 'Connected' : status === 'connecting' ? 'Connecting...' : 'Disconnected'

  return (
    <div className="min-h-[100dvh] flex flex-col bg-[#0A0A0B] text-white relative overflow-hidden">
      {/* Background glow */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-violet-500/10 rounded-full blur-[128px] animate-pulse" />
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-indigo-500/10 rounded-full blur-[128px] animate-pulse" style={{ animationDelay: '700ms' }} />
      </div>

      {/* Header — sphere + title + status */}
      <div className="relative z-10 flex flex-col items-center pt-8 pb-4 shrink-0">
        <motion.div
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
        >
          <GeometricSphere isActive={sphereActive} size={140} getAudioLevel={getAudioLevel} />
        </motion.div>
        <h1 className="text-xl font-semibold bg-clip-text text-transparent bg-gradient-to-r from-white/90 to-white/60 mt-2">
          Matthews Terminal
        </h1>
        <div className="flex items-center gap-2 mt-1">
          <span className={cn('h-1.5 w-1.5 rounded-full', statusColor, status === 'connecting' && 'animate-pulse')} />
          <span className="text-[11px] text-white/25">{statusLabel}</span>
        </div>
      </div>

      {/* Chat area — scrollable */}
      <div className="relative z-10 flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 pb-4 -webkit-overflow-scrolling-touch">
        <div className="max-w-lg mx-auto space-y-4">
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
                    <div className="max-w-[80%] bg-violet-500/15 border border-violet-500/15 rounded-2xl rounded-br-md px-4 py-2.5">
                      <p className="text-sm text-white/80">{msg.text}</p>
                    </div>
                  </div>
                ) : (
                  <div className="bg-white/[0.02] border border-white/[0.05] rounded-2xl rounded-bl-md px-4 py-3">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-5 h-5 rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center">
                        <span className="text-[10px] font-bold">C</span>
                      </div>
                      <span className="text-[11px] font-medium text-white/40">Claude</span>
                      {msg.streaming && (
                        <span className="flex gap-0.5 ml-1">
                          <span className="w-1 h-1 bg-violet-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                          <span className="w-1 h-1 bg-violet-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                          <span className="w-1 h-1 bg-violet-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                        </span>
                      )}
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
        {/* Status text / pending message preview */}
        <AnimatePresence mode="wait">
          {isListening ? (
            <motion.p
              key="listening"
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -5 }}
              className="text-xs text-violet-300 px-4 text-center"
            >
              {transcript ? `"${transcript}"` : 'Listening...'}
            </motion.p>
          ) : pendingMessage ? (
            <motion.p
              key="pending"
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -5 }}
              className="text-xs text-white/50 px-4 text-center max-w-[80%] line-clamp-2"
            >
              "{pendingMessage}"
            </motion.p>
          ) : micError ? (
            <motion.p
              key="error"
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -5 }}
              className="text-xs text-red-400"
            >
              Mic error: {micError}
            </motion.p>
          ) : audioJustFinished ? (
            <motion.p
              key="tap-prompt"
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -5 }}
              className="text-xs text-violet-300/70"
            >
              Tap to respond
            </motion.p>
          ) : null}
        </AnimatePresence>

        <div className="flex items-center gap-4">
          {/* TTS toggle */}
          <button
            onClick={() => setTtsEnabled(!ttsEnabled)}
            className={cn(
              'p-2.5 rounded-full transition-colors',
              ttsEnabled ? 'text-violet-300 bg-violet-500/10' : 'text-white/20 hover:text-white/40',
            )}
          >
            {ttsEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
          </button>

          {/* Mic button */}
          <motion.button
            onClick={handleMicClick}
            disabled={!supported}
            whileTap={{ scale: 0.92 }}
            className={cn(
              'relative flex items-center justify-center w-14 h-14 rounded-full transition-all duration-500',
              isListening
                ? 'bg-violet-500 shadow-[0_0_40px_rgba(139,92,246,0.5)]'
                : audioJustFinished
                  ? 'bg-violet-500/30 shadow-[0_0_30px_rgba(139,92,246,0.3)] border border-violet-400/30 animate-pulse'
                  : 'bg-white/10 hover:bg-white/15 border border-white/10',
              !supported && 'opacity-30 cursor-not-allowed',
            )}
          >
            {isListening && (
              <span className="absolute inset-0 rounded-full bg-violet-500/30 animate-ping" style={{ animationDuration: '1.5s' }} />
            )}
            <Mic className={cn('w-5 h-5 relative z-10', isListening ? 'text-white' : 'text-white/70')} />
          </motion.button>

          {/* Send button — appears when there's a pending message */}
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
