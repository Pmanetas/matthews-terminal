import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Mic, Volume2, VolumeX, Keyboard, Terminal, FileText, HelpCircle, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'
import { AnimatedAIChat } from '@/components/AnimatedAIChat'
import { GeometricSphere } from '@/components/GeometricSphere'
import { useBridge } from '@/hooks/useBridge'
import { useVoice } from '@/hooks/useVoice'

export function VoiceChat() {
  const { status, messages, sendCommand } = useBridge()
  const { isListening, transcript, ttsEnabled, setTtsEnabled, startListening, stopListening, speak, supported } =
    useVoice()

  const [mode, setMode] = useState<'voice' | 'text'>('voice')
  const [showDemo, setShowDemo] = useState(false)
  const lastMessageCount = useRef(0)

  const isProcessing = messages.length > 0 && messages[messages.length - 1]?.role === 'user'
  const latestResponse = [...messages].reverse().find((m) => m.role === 'assistant')

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

  // Sphere is active when listening, processing, or demo mode
  const sphereActive = isListening || isProcessing || showDemo

  // ---- Text mode ----
  if (mode === 'text') {
    return (
      <AnimatedAIChat
        title="Matthews Terminal"
        subtitle="Type a command or ask a question"
        placeholder="Ask Matthews Terminal..."
        onSend={sendCommand}
        isProcessing={isProcessing}
        commandSuggestions={[
          { icon: <Terminal className="w-4 h-4" />, label: 'Run Command', description: 'Execute in terminal', prefix: '/run' },
          { icon: <FileText className="w-4 h-4" />, label: 'Open File', description: 'Open a file in VS Code', prefix: '/open' },
          { icon: <HelpCircle className="w-4 h-4" />, label: 'Status', description: "What's happening", prefix: '/status' },
          { icon: <Sparkles className="w-4 h-4" />, label: 'Ask Agent', description: 'Ask the coding agent', prefix: '/ask' },
        ]}
        extraToolbarLeft={
          <motion.button
            type="button"
            onClick={() => setMode('voice')}
            whileTap={{ scale: 0.94 }}
            className="p-2 text-white/40 hover:text-white/90 rounded-lg transition-colors relative group"
          >
            <Mic className="w-4 h-4" />
            <motion.span className="absolute inset-0 bg-white/[0.05] rounded-lg opacity-0 group-hover:opacity-100 transition-opacity" />
          </motion.button>
        }
        attachmentsArea={
          messages.length > 0 ? (
            <div className="px-4 pb-3 flex flex-col gap-1.5 max-h-40 overflow-y-auto">
              {messages.map((msg, i) => (
                <div
                  key={i}
                  className={cn(
                    'text-xs py-1.5 px-3 rounded-lg',
                    msg.role === 'user' ? 'bg-white/[0.03] text-white/50' : 'bg-violet-500/[0.05] text-white/70',
                  )}
                >
                  <span className="text-white/30 mr-2">{msg.role === 'user' ? 'You:' : 'MT:'}</span>
                  {msg.text}
                </div>
              ))}
            </div>
          ) : undefined
        }
      />
    )
  }

  // ---- Voice mode ----
  return (
    <div className="min-h-[100dvh] flex flex-col items-center justify-center bg-[#0A0A0B] text-white relative overflow-hidden">
      {/* Background glow */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-violet-500/10 rounded-full blur-[128px] animate-pulse" />
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-indigo-500/10 rounded-full blur-[128px] animate-pulse" style={{ animationDelay: '700ms' }} />
        <div className="absolute top-1/4 right-1/3 w-64 h-64 bg-fuchsia-500/10 rounded-full blur-[96px] animate-pulse" style={{ animationDelay: '1000ms' }} />
      </div>

      {/* Top bar */}
      <div className="absolute top-0 left-0 right-0 z-50 flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-2">
          <span className={cn('h-2 w-2 rounded-full', statusColor, status === 'connecting' && 'animate-pulse')} />
          <span className="text-xs text-white/30">{statusLabel}</span>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setTtsEnabled(!ttsEnabled)}
            className={cn(
              'p-2 rounded-lg transition-colors',
              ttsEnabled ? 'text-violet-300 bg-violet-500/10' : 'text-white/30 hover:text-white/60',
            )}
          >
            {ttsEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
          </button>
          <button
            onClick={() => setMode('text')}
            className="p-2 text-white/30 hover:text-white/60 rounded-lg transition-colors"
          >
            <Keyboard className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Sphere + status */}
      <div className="relative z-10 flex flex-col items-center gap-8">
        <motion.div
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
        >
          <GeometricSphere isActive={sphereActive} size={350} />
        </motion.div>

        {/* Status text */}
        <div className="text-center space-y-2">
          <AnimatePresence mode="wait">
            {isListening ? (
              <motion.p
                key="listening"
                className="text-lg font-medium text-violet-300"
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -5 }}
              >
                Listening...
              </motion.p>
            ) : isProcessing ? (
              <motion.p
                key="processing"
                className="text-lg font-medium text-white/60"
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -5 }}
              >
                Thinking...
              </motion.p>
            ) : latestResponse ? (
              <motion.p
                key="response"
                className="text-sm text-white/50 max-w-md"
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -5 }}
              >
                {latestResponse.text}
              </motion.p>
            ) : (
              <motion.p
                key="idle"
                className="text-lg font-medium bg-clip-text text-transparent bg-gradient-to-r from-white/60 to-white/30"
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -5 }}
              >
                Tap to speak
              </motion.p>
            )}
          </AnimatePresence>

          {isListening && transcript && (
            <motion.p
              className="text-sm text-white/40 italic max-w-sm"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
            >
              "{transcript}"
            </motion.p>
          )}
        </div>
      </div>

      {/* Bottom controls */}
      <div className="absolute bottom-0 left-0 right-0 z-50 flex flex-col items-center gap-4 pb-10 pt-6">
        <button
          onClick={() => setShowDemo(!showDemo)}
          className={cn(
            'text-xs px-3 py-1.5 rounded-full border transition-all duration-500',
            showDemo
              ? 'border-violet-500/30 bg-violet-500/10 text-violet-300'
              : 'border-white/10 bg-white/[0.03] text-white/30 hover:text-white/50',
          )}
        >
          {showDemo ? 'Stop Demo' : 'Preview Animation'}
        </button>

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
