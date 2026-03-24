import { useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import { Mic, Volume2, VolumeX } from 'lucide-react'
import { cn } from '@/lib/utils'
import { AnimatedAIChat } from '@/components/AnimatedAIChat'
import { useBridge } from '@/hooks/useBridge'
import { useVoice } from '@/hooks/useVoice'

export function VoiceChat() {
  const { status, messages, sendCommand } = useBridge()
  const { isListening, transcript, ttsEnabled, setTtsEnabled, startListening, stopListening, speak, supported } =
    useVoice()

  const lastMessageCount = useRef(0)

  const isProcessing = messages.length > 0 && messages[messages.length - 1]?.role === 'user'

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
    <AnimatedAIChat
      title="Matthews Terminal"
      subtitle=""
      placeholder="Ask Matthews Terminal..."
      onSend={sendCommand}
      isProcessing={isProcessing}
      statusIndicator={
        <div className="flex items-center gap-2 mb-2">
          <span className={cn('h-2 w-2 rounded-full', statusColor, status === 'connecting' && 'animate-pulse')} />
          <span className="text-xs text-white/30">{statusLabel}</span>
          {isListening && (
            <span className="text-xs text-violet-400 animate-pulse ml-2">Listening...</span>
          )}
        </div>
      }
      extraToolbarLeft={
        <div className="flex items-center gap-1">
          <motion.button
            type="button"
            onClick={handleMicClick}
            disabled={!supported}
            whileTap={{ scale: 0.92 }}
            className={cn(
              'p-2 rounded-lg transition-all duration-300 relative group',
              isListening
                ? 'text-violet-300 bg-violet-500/20'
                : 'text-white/40 hover:text-white/90',
              !supported && 'opacity-30 cursor-not-allowed',
            )}
          >
            {isListening && (
              <span className="absolute inset-0 rounded-lg bg-violet-500/20 animate-ping" style={{ animationDuration: '2s' }} />
            )}
            <Mic className="w-4 h-4 relative z-10" />
          </motion.button>
          <button
            onClick={() => setTtsEnabled(!ttsEnabled)}
            className={cn(
              'p-2 rounded-lg transition-colors',
              ttsEnabled ? 'text-violet-300 bg-violet-500/10' : 'text-white/40 hover:text-white/60',
            )}
          >
            {ttsEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
          </button>
        </div>
      }
      attachmentsArea={
        messages.length > 0 ? (
          <div className="px-4 pb-3 flex flex-col gap-2 max-h-[50vh] overflow-y-auto">
            {messages.map((msg, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                className={cn(
                  'text-sm py-2.5 px-3.5 rounded-xl',
                  msg.role === 'user'
                    ? 'bg-violet-500/10 text-white/70 border border-violet-500/10 self-end ml-12'
                    : 'bg-white/[0.04] text-white/60 border border-white/[0.06] self-start mr-12',
                )}
              >
                <span className="text-[10px] uppercase tracking-wider text-white/25 block mb-1">
                  {msg.role === 'user' ? 'You' : 'Claude'}
                </span>
                <span className="whitespace-pre-wrap">{msg.text}</span>
                {msg.streaming && (
                  <span className="inline-block w-1.5 h-1.5 bg-violet-400 rounded-full ml-1 animate-pulse" />
                )}
              </motion.div>
            ))}
          </div>
        ) : undefined
      }
    />
  )
}
