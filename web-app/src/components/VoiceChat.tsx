import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Mic, Volume2, VolumeX } from 'lucide-react'
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
    // Don't clear src or call load() — that causes a long delay on iOS
  }
}

export function VoiceChat() {
  // Track when audio just finished so we can prompt user to tap mic (fallback)
  const [audioJustFinished, setAudioJustFinished] = useState(false)
  const autoListenRef = useRef<(() => void) | null>(null)

  const { status, messages, sendCommand } = useBridge(() => {
    // Called when ElevenLabs audio finishes — stop playback and auto-listen
    stopAudioPlayback()
    setAudioJustFinished(true)
    // Try auto-listen (works on Android/desktop; iOS may block without gesture)
    autoListenRef.current?.()
  })

  const { isListening, transcript, ttsEnabled, setTtsEnabled, startListening, stopListening, supported } =
    useVoice()

  // Keep ref updated so the bridge callback can use it
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

  // Send transcript when done listening
  useEffect(() => {
    if (!isListening && transcript) sendCommand(transcript)
  }, [isListening, transcript, sendCommand])

  const handleMicClick = () => {
    // Stop any playing audio so mic can access the hardware
    stopAudioPlayback()
    setAudioJustFinished(false)
    if (isListening) {
      stopListening()
    } else {
      // Start immediately — must stay in user gesture context for iOS
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

      {/* Chat area */}
      <div className="relative z-10 flex-1 overflow-y-auto px-4 pb-4">
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
                  /* User message — right aligned bubble */
                  <div className="flex justify-end">
                    <div className="max-w-[80%] bg-violet-500/15 border border-violet-500/15 rounded-2xl rounded-br-md px-4 py-2.5">
                      <p className="text-sm text-white/80">{msg.text}</p>
                    </div>
                  </div>
                ) : (
                  /* Claude response — full width, rich formatting */
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
        {/* Listening / prompt status */}
        <AnimatePresence>
          {isListening ? (
            <motion.p
              key="listening"
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -5 }}
              className="text-xs text-violet-300"
            >
              {transcript ? `"${transcript}"` : 'Listening...'}
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

          {/* Spacer for symmetry */}
          <div className="w-9" />
        </div>
      </div>
    </div>
  )
}
