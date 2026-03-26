import { useEffect, useRef, useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Mic, MicOff, ArrowUp, Square, Camera, X, FileText, Terminal, Search, Pencil, FilePlus, CheckCircle2, ListTodo, Globe, Wrench, LoaderCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { VoiceWaveform } from '@/components/VoiceWaveform'
import { MarkdownMessage } from '@/components/MarkdownMessage'
import { useBridge, sharedAudio, getAudioLevel, onAudioPlayingChange, stopAllAudio, audioStartedForResult, onAudioStarted } from '@/hooks/useBridge'
import { useVoice } from '@/hooks/useVoice'
import { resizeImage, MAX_IMAGE_SIZE } from '@/lib/image-utils'
import type { ImageAttachment } from '@/types'

// ── Helpers ──────────────────────────────────────────────────────

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

function parseDiffStats(lines: string[]): { added: number; removed: number } {
  let added = 0, removed = 0
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.startsWith('⊕')) added++
    else if (trimmed.startsWith('⊖')) removed++
  }
  return { added, removed }
}

function ToolContent({ text, expanded }: { text: string; expanded: boolean }) {
  const lines = text.split('\n')
  const header = lines[0]
  const diffLines = lines.slice(1)
  const { added, removed } = parseDiffStats(diffLines)
  const hasDiff = added > 0 || removed > 0

  return (
    <div className="flex flex-col min-w-0 w-full">
      <div className="flex items-center gap-2">
        <span className="text-[13px] text-white/50 leading-tight">{header}</span>
        {hasDiff && (
          <span className="flex items-center gap-1.5 text-[11px] shrink-0 ml-auto">
            {added > 0 && <span className="text-emerald-400/70">+{added}</span>}
            {removed > 0 && <span className="text-red-400/70">-{removed}</span>}
          </span>
        )}
      </div>
      <AnimatePresence>
        {expanded && diffLines.length > 0 && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
            className="overflow-hidden"
          >
            <div className="mt-2 rounded-lg overflow-hidden border border-white/[0.06] bg-black/40">
              <div className="overflow-x-auto">
                {diffLines.map((line, i) => {
                  const trimmed = line.trim()
                  const code = trimmed.replace(/^[⊖⊕]\s*/, '')
                  const isRemove = trimmed.startsWith('⊖')
                  const isAdd = trimmed.startsWith('⊕')
                  return (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ duration: 0.12, delay: i * 0.02 }}
                      className={cn(
                        'flex items-start font-mono text-[11px] leading-5',
                        isRemove && 'bg-red-500/[0.08]',
                        isAdd && 'bg-emerald-500/[0.08]',
                      )}
                    >
                      <span className={cn(
                        'w-8 shrink-0 text-right pr-2 select-none border-r',
                        isRemove ? 'text-red-400/40 border-red-500/20' :
                        isAdd ? 'text-emerald-400/40 border-emerald-500/20' :
                        'text-white/15 border-white/[0.06]'
                      )}>{i + 1}</span>
                      <span className="w-5 shrink-0 text-center select-none">
                        {isRemove ? <span className="text-red-400/60">−</span> :
                         isAdd ? <span className="text-emerald-400/60">+</span> :
                         null}
                      </span>
                      <code className={cn(
                        'whitespace-pre pr-3',
                        isRemove ? 'text-red-300/70' :
                        isAdd ? 'text-emerald-300/70' :
                        'text-white/30'
                      )}>{code}</code>
                    </motion.div>
                  )
                })}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
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

  // Wait up to 8s for audio to start before showing text anyway
  useEffect(() => {
    if (!animate) return
    const timeout = setTimeout(() => { audioTimedOut.current = true }, 8000)
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
        // Slow reveal — ~1 char per frame at 60fps = readable pace
        setChars((c) => Math.min(c + 1, text.length))
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
    <div className="flex items-center gap-1.5 px-5 py-4">
      {[0, 1, 2].map((i) => (
        <motion.div
          key={i}
          className="w-2.5 h-2.5 bg-violet-400/50 rounded-full"
          animate={{ opacity: [0.3, 1, 0.3], scale: [0.8, 1.1, 0.8] }}
          transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2 }}
        />
      ))}
    </div>
  )
}

// (Robot head removed — using VoiceWaveform directly)

// ── Global styles ────────────────────────────────────────────────

const globalCSS = `
  .no-scrollbar::-webkit-scrollbar { display: none; }
  .no-scrollbar { scrollbar-width: none; }
  * { scrollbar-width: none; }
  *::-webkit-scrollbar { display: none; }
`

// ── Main Component ───────────────────────────────────────────────

export function VoiceChat() {
  const [pendingMessage, setPendingMessage] = useState('')
  const [isAudioPlaying, setIsAudioPlaying] = useState(false)
  const [expandedTools, setExpandedTools] = useState<Set<number>>(new Set())
  const [pendingImages, setPendingImages] = useState<ImageAttachment[]>([])
  const autoListenRef = useRef<(() => void) | null>(null)
  const hasSentRef = useRef(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    onAudioPlayingChange(setIsAudioPlaying)
    return () => onAudioPlayingChange(() => {})
  }, [])

  const { status, messages, sendCommand, sendStop, workspace, activeFile, isWaiting } = useBridge(() => {
    autoListenRef.current?.()
  })

  const { isListening, transcript, startListening, stopListening, supported, micError } = useVoice()

  autoListenRef.current = startListening
  const chatEndRef = useRef<HTMLDivElement>(null)

  const isProcessing = isWaiting || (messages.length > 0 && messages[messages.length - 1].role !== 'assistant')

  // Find the last user message index so we only show spinner on tools from the CURRENT command
  const lastUserIndex = (() => {
    for (let i = messages.length - 1; i >= 0; i--) { if (messages[i].role === 'user') return i }
    return -1
  })()

  const isThinking = isProcessing && messages.length > 0 && messages[messages.length - 1].role === 'user'

  const lastToolIndex = (() => {
    for (let i = messages.length - 1; i >= 0; i--) { if (messages[i].role === 'tool') return i }
    return -1
  })()

  // Only show spinner if the last tool is from the current command (after last user message)
  const isCurrentToolLoading = isProcessing && lastToolIndex > lastUserIndex

  const lastAssistantIndex = (() => {
    for (let i = messages.length - 1; i >= 0; i--) { if (messages[i].role === 'assistant') return i }
    return -1
  })()

  const scrollToBottom = useCallback(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'instant' })
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
      if (msg || pendingImages.length > 0) {
        hasSentRef.current = true
        stopListening()
        sendCommand(
          msg || 'What do you see in this image?',
          pendingImages.length > 0 ? pendingImages : undefined
        )
        setPendingMessage('')
        setPendingImages([])
      }
    } else if (!isListening) {
      setPendingMessage(trimmed)
    }
  }, [isListening, transcript, sendCommand, sendStop, stopListening, startListening])

  const handleSend = () => {
    if ((pendingMessage || pendingImages.length > 0) && !hasSentRef.current) {
      hasSentRef.current = true
      sendCommand(
        pendingMessage || 'What do you see in this image?',
        pendingImages.length > 0 ? pendingImages : undefined
      )
      setPendingMessage('')
      setPendingImages([])
    }
  }

  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = '' // reset for re-selection

    if (file.size > MAX_IMAGE_SIZE) {
      // Will be resized anyway, but warn if extremely large
      console.warn('[Image] Large file, resizing...')
    }

    try {
      const { data, mimeType } = await resizeImage(file)
      setPendingImages(prev => [...prev, { data, mimeType, name: file.name }])
    } catch (err) {
      console.error('[Image] Failed to process:', err)
    }
  }

  const handleMicClick = () => {
    if (isListening) {
      stopListening()
    } else {
      stopAllAudio()
      setPendingMessage('')
      hasSentRef.current = false
      setTimeout(() => startListening(), 120)
    }
  }

  const handleStop = () => {
    sendStop()
  }

  const toggleToolExpand = (i: number) => {
    setExpandedTools(prev => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  }

  const statusDot = status === 'connected' ? 'bg-emerald-400' : status === 'connecting' ? 'bg-yellow-400' : 'bg-red-400'
  const statusLabel = status === 'connected'
    ? (workspace || 'Connected')
    : status === 'connecting' ? 'Connecting...' : 'Disconnected'

  const showStop = isProcessing || isAudioPlaying

  return (
    <div
      className="h-[100dvh] flex flex-col bg-black text-white relative"
      style={{ paddingTop: 'env(safe-area-inset-top)', overscrollBehavior: 'none' }}
    >
      <style>{globalCSS}</style>

      {/* ── Header bar ── */}
      <div className="shrink-0 flex items-center justify-center px-5 py-3 border-b border-white/[0.06]">
        <div className="flex flex-col items-center">
          <VoiceWaveform isActive={isAudioPlaying} getAudioLevel={getAudioLevel} size={160} />
          <div className="flex items-center gap-1.5 mt-1">
            <span className={cn('h-1.5 w-1.5 rounded-full', statusDot)} />
            <span className="text-[10px] text-white/30 truncate max-w-[200px]">{statusLabel}</span>
          </div>
          {activeFile && (
            <div className="flex items-center gap-1 mt-0.5">
              <FileText className="w-2.5 h-2.5 text-violet-400/50" />
              <span className="text-[10px] text-violet-300/40 truncate max-w-[220px]">{activeFile}</span>
            </div>
          )}
        </div>
      </div>

      {/* ── Chat messages ── */}
      <div
        className="flex-1 min-h-0 overflow-y-auto no-scrollbar"
        style={{ overscrollBehavior: 'none' }}
      >
        <div className="flex flex-col gap-3 px-5 sm:px-10 md:px-12 lg:px-16 py-6 max-w-5xl mx-auto w-full">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center mt-20 gap-4">
              <VoiceWaveform isActive={false} getAudioLevel={() => 0} size={200} />
              <p className="text-white/20 text-sm">Tap the mic to start talking</p>
            </div>
          ) : (
            messages.map((msg, i) => {
              const isNextTool = messages[i + 1]?.role === 'tool'
              const isPrevTool = i > 0 && messages[i - 1]?.role === 'tool'
              const isLastTool = i === lastToolIndex
              const isExpanded = !expandedTools.has(i) // expanded by default, click to collapse

              return (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.25, ease: 'easeOut' }}
                >
                  {msg.role === 'user' ? (
                    /* ── User text (no bubble) ── */
                    <div className="flex justify-end">
                      <div className="max-w-[85%] sm:max-w-[70%]">
                        {msg.images && msg.images.length > 0 && (
                          <div className="flex gap-2 mb-2 flex-wrap justify-end">
                            {msg.images.map((img, j) => (
                              img.data ? (
                                <img
                                  key={j}
                                  src={`data:${img.mimeType};base64,${img.data}`}
                                  className="w-28 h-28 rounded-lg object-cover border border-white/10"
                                />
                              ) : (
                                <div key={j} className="w-28 h-28 rounded-lg bg-white/[0.05] border border-white/10 flex items-center justify-center">
                                  <Camera className="w-6 h-6 text-white/20" />
                                </div>
                              )
                            ))}
                          </div>
                        )}
                        <p className="text-[13px] text-white/50 break-words whitespace-pre-wrap leading-relaxed text-right">{msg.text}</p>
                      </div>
                    </div>
                  ) : msg.role === 'tool' ? (
                    /* ── Tool call ── */
                    <motion.div
                      className="flex items-stretch gap-2.5 ml-1 cursor-pointer"
                      onClick={() => toggleToolExpand(i)}
                      layout
                      transition={{ duration: 0.2, ease: 'easeOut' }}
                    >
                      <div className="flex flex-col items-center w-5 shrink-0">
                        <div className={cn('w-px flex-1 transition-colors', isPrevTool ? 'bg-violet-500/15' : 'bg-transparent')} />
                        {isLastTool && isCurrentToolLoading ? (
                          <LoaderCircle className="w-4 h-4 text-violet-400 animate-spin shrink-0" />
                        ) : (
                          <div className="w-2 h-2 shrink-0 rounded-full bg-violet-500/30" />
                        )}
                        <div className={cn('w-px flex-1 transition-colors', isNextTool ? 'bg-violet-500/15' : 'bg-transparent')} />
                      </div>
                      <motion.div
                        layout
                        className={cn(
                          'flex-1 flex items-start gap-2.5 py-2.5 px-3.5 rounded-xl min-w-0 overflow-hidden border transition-colors',
                          isExpanded
                            ? 'border-violet-500/20 bg-violet-500/[0.04]'
                            : 'border-white/[0.06] bg-white/[0.02]'
                        )}
                      >
                        <div className="w-5 h-5 flex items-center justify-center shrink-0 mt-0.5">
                          <ToolIcon text={msg.text} />
                        </div>
                        <ToolContent text={msg.text} expanded={isExpanded} />
                      </motion.div>
                    </motion.div>
                  ) : (
                    /* ── Assistant text (no bubble) ── */
                    <div className="px-1">
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
          {isThinking && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
            >
              <div className="px-1">
                <ThinkingDots />
              </div>
            </motion.div>
          )}
          <div ref={chatEndRef} />
        </div>
      </div>

      {/* ── Bottom input bar ── */}
      <div
        className="shrink-0 bg-black"
        style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
      >
        {/* Transcript / listening state */}
        <AnimatePresence mode="wait">
          {(isListening || micError || pendingMessage) && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
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

        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleImageSelect}
        />

        {/* Pending image thumbnails */}
        <AnimatePresence>
          {pendingImages.length > 0 && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="flex gap-2 px-4 pt-2 overflow-x-auto no-scrollbar"
            >
              {pendingImages.map((img, i) => (
                <div key={i} className="relative shrink-0">
                  <img
                    src={`data:${img.mimeType};base64,${img.data}`}
                    className="w-16 h-16 rounded-lg object-cover border border-white/10"
                  />
                  <button
                    onClick={() => setPendingImages(prev => prev.filter((_, j) => j !== i))}
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 rounded-full text-white flex items-center justify-center"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Input row */}
        <div className="flex items-end gap-2 px-4 pt-2 pb-1">
          {/* Camera button */}
          {!showStop && (
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center justify-center w-12 h-12 rounded-full bg-white/[0.06] shrink-0 active:scale-90 transition-transform"
            >
              <Camera className="w-5 h-5 text-white/50" />
            </button>
          )}

          {/* Placeholder input area */}
          <div className="flex-1 flex items-center rounded-2xl border border-white/[0.08] bg-white/[0.03] px-4 py-3 min-h-[48px]">
            <span className="text-sm text-white/25 flex-1 select-none">
              {isListening ? 'Listening...' : pendingMessage || (pendingImages.length > 0 ? 'Add a message or tap send' : 'Tap mic to speak')}
            </span>
          </div>

          {/* Action buttons */}
          <AnimatePresence mode="wait">
            {showStop ? (
              <motion.button
                key="stop"
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.8, opacity: 0 }}
                transition={{ duration: 0.15 }}
                onClick={handleStop}
                className="flex items-center justify-center w-12 h-12 rounded-full bg-red-500/80 shrink-0 active:scale-90 transition-transform"
              >
                <Square className="w-4 h-4 text-white fill-white" />
              </motion.button>
            ) : (pendingMessage || pendingImages.length > 0) ? (
              <motion.button
                key="send"
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.8, opacity: 0 }}
                transition={{ duration: 0.15 }}
                onClick={handleSend}
                className="flex items-center justify-center w-12 h-12 rounded-full bg-violet-500 shrink-0"
              >
                <ArrowUp className="w-5 h-5 text-white" />
              </motion.button>
            ) : (
              <motion.button
                key="mic"
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.8, opacity: 0 }}
                transition={{ duration: 0.15 }}
                onClick={handleMicClick}
                disabled={!supported}
                whileTap={{ scale: 0.9 }}
                className={cn(
                  'relative flex items-center justify-center w-12 h-12 rounded-full shrink-0 transition-all',
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
          </AnimatePresence>
        </div>
      </div>
    </div>
  )
}
