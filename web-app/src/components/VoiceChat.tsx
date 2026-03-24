import { useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Mic, Volume2, VolumeX } from 'lucide-react'
import { cn } from '@/lib/utils'
import { GeometricSphere } from '@/components/GeometricSphere'
import { useBridge } from '@/hooks/useBridge'
import { useVoice } from '@/hooks/useVoice'

export function VoiceChat() {
  const { status, messages, sendCommand } = useBridge()
  const { isListening, transcript, ttsEnabled, setTtsEnabled, startListening, stopListening, speak, supported } =
    useVoice()

  const lastMessageCount = useRef(0)
  const chatEndRef = useRef<HTMLDivElement>(null)

  const isProcessing = messages.length > 0 && messages[messages.length - 1]?.role === 'user'
  const sphereActive = isListening || isProcessing

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Auto-speak assistant responses
  useEffect(() => {
    if (ttsEnabled && messages.length > lastMessageCount.current) {
      const newest = messages[messages.length - 1]
      if (newest?.role === 'assistant') speak(newest.text)
    }
    lastMessageCount.current = messages.length
  }, [messages, ttsEnabled, speak])

  // Send transcript when done listening
  useEffect(() => {
    if (!isListening && transcript) sendCommand(transcript)
  }, [isListening, transcript, sendCommand])

  const handleMicClick = () => {
    if (isListening) stopListening()
    else startListening()
  }

  const statusColor =
    status === 'connected' ? 'bg-emerald-400' : status === 'connecting' ? 'bg-yellow-400' : 'bg-red-400'
  const statusLabel =
    status === 'connected' ? 'Connected' : status === 'connecting' ? 'Connecting...' : 'Disconnected'

  return (
    <div className="min-h-[100dvh] flex flex-col items-center bg-[#0A0A0B] text-white relative overflow-hidden">
      {/* Background glow */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-violet-500/10 rounded-full blur-[128px] animate-pulse" />
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-indigo-500/10 rounded-full blur-[128px] animate-pulse" style={{ animationDelay: '700ms' }} />
      </div>

      {/* Sphere */}
      <div className="relative z-10 mt-12 mb-2">
        <motion.div
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
        >
          <GeometricSphere isActive={sphereActive} size={180} />
        </motion.div>
      </div>

      {/* Title */}
      <h1 className="relative z-10 text-2xl font-semibold bg-clip-text text-transparent bg-gradient-to-r from-white/90 to-white/60 mb-4">
        Matthews Terminal
      </h1>

      {/* Chat area — the text box */}
      <div className="relative z-10 flex-1 w-full max-w-lg mx-auto px-4 overflow-y-auto">
        <div className="bg-white/[0.03] border border-white/[0.08] rounded-2xl p-4 min-h-[200px] max-h-[40vh] overflow-y-auto backdrop-blur-sm">
          {messages.length === 0 ? (
            <p className="text-white/20 text-sm text-center mt-8">Ask Matthews Terminal...</p>
          ) : (
            <div className="flex flex-col gap-3">
              {messages.map((msg, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={cn(
                    'text-sm leading-relaxed',
                    msg.role === 'user' ? 'text-violet-300' : 'text-white/70',
                  )}
                >
                  <span className="text-[10px] uppercase tracking-wider text-white/25 mr-2">
                    {msg.role === 'user' ? 'You' : 'Claude'}
                  </span>
                  <span className="whitespace-pre-wrap">{msg.text}</span>
                  {msg.streaming && (
                    <span className="inline-block w-1.5 h-1.5 bg-violet-400 rounded-full ml-1 animate-pulse" />
                  )}
                </motion.div>
              ))}
              <div ref={chatEndRef} />
            </div>
          )}
        </div>
      </div>

      {/* Status + controls */}
      <div className="relative z-50 flex flex-col items-center gap-4 pb-10 pt-6">
        {/* Connection status */}
        <div className="flex items-center gap-2">
          <span className={cn('h-2 w-2 rounded-full', statusColor, status === 'connecting' && 'animate-pulse')} />
          <span className="text-xs text-white/30">{statusLabel}</span>
          <button
            onClick={() => setTtsEnabled(!ttsEnabled)}
            className={cn(
              'p-1.5 rounded-lg transition-colors ml-2',
              ttsEnabled ? 'text-violet-300 bg-violet-500/10' : 'text-white/30 hover:text-white/60',
            )}
          >
            {ttsEnabled ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
          </button>
        </div>

        {/* Listening status */}
        <AnimatePresence>
          {isListening && (
            <motion.p
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -5 }}
              className="text-sm text-violet-300 font-medium"
            >
              {transcript ? `"${transcript}"` : 'Listening...'}
            </motion.p>
          )}
        </AnimatePresence>

        {/* Mic button */}
        <motion.button
          onClick={handleMicClick}
          disabled={!supported}
          whileTap={{ scale: 0.92 }}
          className={cn(
            'relative flex items-center justify-center w-16 h-16 rounded-full transition-all duration-500',
            isListening
              ? 'bg-violet-500 shadow-[0_0_40px_rgba(139,92,246,0.5)]'
              : 'bg-white/10 hover:bg-white/15 border border-white/10',
            !supported && 'opacity-30 cursor-not-allowed',
          )}
        >
          {isListening && (
            <>
              <span className="absolute inset-0 rounded-full bg-violet-500/30 animate-ping" style={{ animationDuration: '1.5s' }} />
              <span className="absolute inset-0 rounded-full bg-violet-500/20 animate-ping" style={{ animationDuration: '2s' }} />
            </>
          )}
          <Mic className={cn('w-6 h-6 relative z-10 transition-colors duration-300', isListening ? 'text-white' : 'text-white/70')} />
        </motion.button>
      </div>
    </div>
  )
}
