import { useEffect, useRef, useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Mic, MicOff, ArrowUp, Square, Camera, X, FileText, Terminal, Search, Pencil, FilePlus, CheckCircle2, ListTodo, Globe, Wrench, LoaderCircle, RotateCcw, FolderOpen, Folder, ChevronLeft, File, Settings, Sun, Moon, Keyboard, Columns2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { VoiceWaveform } from '@/components/VoiceWaveform'
import { MarkdownMessage } from '@/components/MarkdownMessage'
import { useBridge, sharedAudio, getAudioLevel, onAudioPlayingChange, stopAllAudio, audioStartedForResult, lastResultEngine, onAudioWillPlay } from '@/hooks/useBridge'
import { SplashScreen } from '@/components/SplashScreen'
import { useVoice } from '@/hooks/useVoice'
import { resizeImage } from '@/lib/image-utils'
import type { ImageAttachment } from '@/types'

// ── Helpers ──────────────────────────────────────────────────────

function ToolIcon({ text }: { text: string }) {
  const t = text.toLowerCase()
  if (t.startsWith('reading')) return <FileText className="w-3.5 h-3.5 text-amber-400" />
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

function ToolContent({ text, expanded, lightMode, codexMode }: { text: string; expanded: boolean; lightMode?: boolean; codexMode?: boolean }) {
  const lines = text.split('\n')
  const header = lines[0]
  const diffLines = lines.slice(1)
  const { added, removed } = parseDiffStats(diffLines)
  const hasDiff = added > 0 || removed > 0

  return (
    <div className="flex flex-col min-w-0 w-full">
      <div className="flex items-center gap-2">
        <span className="text-[13px] leading-tight" style={{ color: codexMode ? (lightMode ? 'rgba(185, 28, 28, 0.7)' : 'rgba(248, 113, 113, 0.6)') : (lightMode ? 'rgba(0, 0, 0, 0.6)' : 'rgba(255, 255, 255, 0.5)') }}>{header}</span>
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
            <div className="mt-2 rounded-lg overflow-hidden" style={{ border: lightMode ? '2px solid rgba(109, 40, 217, 0.35)' : '2px solid rgba(167, 139, 250, 0.5)', background: lightMode ? 'rgba(0, 0, 0, 0.03)' : 'rgba(0, 0, 0, 0.7)' }}>
              <div className="overflow-x-auto max-h-[200px] overflow-y-auto">
                {diffLines.map((line, i) => {
                  const trimmed = line.trim()
                  const code = trimmed.replace(/^[⊖⊕]\s*/, '')
                  const isRemove = trimmed.startsWith('⊖')
                  const isAdd = trimmed.startsWith('⊕')
                  return (
                    <div
                      key={i}
                      className="flex items-start font-mono text-[11px] leading-5"
                      style={
                        isRemove
                          ? { background: lightMode ? 'rgba(220, 38, 38, 0.15)' : 'rgba(239, 68, 68, 0.2)', borderLeft: '3px solid rgba(239, 68, 68, 0.8)', borderTop: '1px solid rgba(239, 68, 68, 0.15)', borderBottom: '1px solid rgba(239, 68, 68, 0.15)' }
                          : isAdd
                          ? { background: lightMode ? 'rgba(5, 150, 105, 0.15)' : 'rgba(16, 185, 129, 0.2)', borderLeft: '3px solid rgba(16, 185, 129, 0.8)', borderTop: '1px solid rgba(16, 185, 129, 0.15)', borderBottom: '1px solid rgba(16, 185, 129, 0.15)' }
                          : { borderLeft: '3px solid transparent' }
                      }
                    >
                      <span
                        className="shrink-0 text-right select-none"
                        style={{
                          width: '2.5rem',
                          paddingLeft: '0.5rem',
                          paddingRight: '0.5rem',
                          borderRight: isRemove ? '1px solid rgba(239, 68, 68, 0.2)' : isAdd ? '1px solid rgba(16, 185, 129, 0.2)' : '1px solid rgba(255,255,255,0.06)',
                          color: isRemove ? 'rgba(239, 68, 68, 0.5)' : isAdd ? 'rgba(16, 185, 129, 0.5)' : 'rgba(255,255,255,0.15)',
                        }}
                      >{i + 1}</span>
                      <span className="w-5 shrink-0 text-center select-none">
                        {isRemove ? <span style={{ color: 'rgba(239, 68, 68, 0.7)' }}>−</span> :
                         isAdd ? <span style={{ color: 'rgba(16, 185, 129, 0.7)' }}>+</span> :
                         null}
                      </span>
                      <code
                        className="whitespace-pre pr-3"
                        style={{
                          color: isRemove
                            ? (lightMode ? 'rgb(185, 28, 28)' : 'rgba(252, 165, 165, 0.8)')
                            : isAdd
                            ? (lightMode ? 'rgb(5, 120, 85)' : 'rgba(110, 231, 183, 0.8)')
                            : (lightMode ? 'rgba(0,0,0,0.4)' : 'rgba(255,255,255,0.3)')
                        }}
                      >{code}</code>
                    </div>
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
  const alreadyDone = animatedTexts.has(text)
  const [chars, setChars] = useState(animate && !alreadyDone ? 0 : text.length)
  const textRef = useRef(text)
  const charsRef = useRef(animate && !alreadyDone ? 0 : text.length)
  const onUpdateRef = useRef(onUpdate)
  const rafRef = useRef(0)
  onUpdateRef.current = onUpdate

  // Reset when text changes
  useEffect(() => {
    if (text !== textRef.current) {
      textRef.current = text
      if (animatedTexts.has(text)) {
        charsRef.current = text.length
        setChars(text.length)
        return
      }
      charsRef.current = 0
      setChars(0)
    }
  }, [text])

  // Mark text as animated once complete
  useEffect(() => {
    if (chars >= text.length && text.length > 0) {
      animatedTexts.add(text)
    }
  }, [chars, text])

  // Single animation loop — runs once per mount, uses refs for current values
  useEffect(() => {
    if (!animate || alreadyDone) {
      charsRef.current = text.length
      setChars(text.length)
      return
    }

    let revealStart = 0
    let waitStart = 0
    let stopped = false

    const tick = (now: number) => {
      if (stopped) return
      const currentText = textRef.current
      const currentChars = charsRef.current

      // Already done — stop
      if (currentChars >= currentText.length) return

      let newChars = currentChars

      // If result audio is playing, sync text to audio progress
      if (audioStartedForResult && sharedAudio && sharedAudio.duration > 0 && !sharedAudio.paused) {
        const progress = sharedAudio.currentTime / sharedAudio.duration
        newChars = Math.min(Math.max(currentChars, Math.floor(progress * currentText.length)), currentText.length)
        revealStart = 0 // reset so phase 2 starts fresh after audio ends
      } else if (audioStartedForResult) {
        // Audio finished — reveal remaining text at 80 chars/sec
        if (revealStart === 0) revealStart = now
        const elapsed = now - revealStart
        newChars = Math.min(Math.max(currentChars, Math.floor(elapsed * 0.08)), currentText.length)
      } else {
        // No audio started — wait 1.5s then reveal text at 80 chars/sec
        // (covers skipTts flows where narrations already spoke the content)
        if (waitStart === 0) waitStart = now
        const waited = now - waitStart
        if (waited > 1500) {
          if (revealStart === 0) revealStart = now
          const elapsed = now - revealStart
          newChars = Math.min(Math.max(currentChars, Math.floor(elapsed * 0.08)), currentText.length)
        }
      }

      // Update state if changed
      if (newChars !== currentChars) {
        charsRef.current = newChars
        setChars(newChars)
      }

      onUpdateRef.current?.()

      // Continue if not done
      if (newChars < currentText.length) {
        rafRef.current = requestAnimationFrame(tick)
      }
    }

    rafRef.current = requestAnimationFrame(tick)
    return () => { stopped = true; cancelAnimationFrame(rafRef.current) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // intentionally empty — runs once per mount, uses refs

  return <MarkdownMessage text={text.slice(0, chars)} />
}

function ThinkingDots() {
  return (
    <div className="flex items-center gap-1.5 px-1 py-1">
      <span className="text-[11px] text-white/25 italic">thinking</span>
      {[0, 1, 2].map((i) => (
        <motion.div
          key={i}
          className="w-1 h-1 bg-white/30 rounded-full"
          animate={{ opacity: [0.2, 0.8, 0.2] }}
          transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2 }}
        />
      ))}
    </div>
  )
}

// ── Mic orb with voice-reactive pulse ────────────────────────────

function MicOrb({ isListening, onClick, disabled, codexMode }: {
  isListening: boolean
  onClick: () => void
  disabled: boolean
  codexMode?: boolean
}) {
  const ring1Ref = useRef<HTMLSpanElement>(null)
  const ring2Ref = useRef<HTMLSpanElement>(null)
  const ring3Ref = useRef<HTMLSpanElement>(null)
  const micStreamRef = useRef<MediaStream | null>(null)
  const ctxRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const dataRef = useRef<Uint8Array<ArrayBuffer> | null>(null)
  const rafRef = useRef(0)
  const smoothLevelRef = useRef(0)

  useEffect(() => {
    if (!isListening) {
      cancelAnimationFrame(rafRef.current)
      micStreamRef.current?.getTracks().forEach(t => t.stop())
      micStreamRef.current = null
      analyserRef.current = null
      ctxRef.current?.close().catch(() => {})
      ctxRef.current = null
      smoothLevelRef.current = 0
      // Reset ring styles
      ;[ring1Ref, ring2Ref, ring3Ref].forEach(r => {
        if (r.current) {
          r.current.style.transform = 'scale(1)'
          r.current.style.opacity = '0'
        }
      })
      return
    }

    let cancelled = false

    navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
      if (cancelled) { stream.getTracks().forEach(t => t.stop()); return }
      micStreamRef.current = stream
      const ctx = new AudioContext()
      ctxRef.current = ctx
      const source = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 256
      analyser.smoothingTimeConstant = 0.8
      source.connect(analyser)
      analyserRef.current = analyser
      dataRef.current = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount))

      const tick = () => {
        if (!analyserRef.current || !dataRef.current) return
        analyserRef.current.getByteFrequencyData(dataRef.current)
        let sum = 0
        for (let i = 0; i < dataRef.current.length; i++) sum += dataRef.current[i]
        const raw = Math.min(1, sum / dataRef.current.length / 100)

        // Smooth it
        const prev = smoothLevelRef.current
        smoothLevelRef.current = raw > prev ? prev + (raw - prev) * 0.4 : prev + (raw - prev) * 0.15
        const level = smoothLevelRef.current

        // Drive rings from mic level
        if (ring1Ref.current) {
          ring1Ref.current.style.transform = `scale(${1 + level * 0.25})`
          ring1Ref.current.style.opacity = `${0.15 + level * 0.55}`
        }
        if (ring2Ref.current) {
          ring2Ref.current.style.transform = `scale(${1 + level * 0.45})`
          ring2Ref.current.style.opacity = `${0.1 + level * 0.35}`
        }
        if (ring3Ref.current) {
          ring3Ref.current.style.transform = `scale(${1 + level * 0.7})`
          ring3Ref.current.style.opacity = `${0.05 + level * 0.2}`
        }

        rafRef.current = requestAnimationFrame(tick)
      }
      rafRef.current = requestAnimationFrame(tick)
    }).catch(() => {})

    return () => {
      cancelled = true
      cancelAnimationFrame(rafRef.current)
      micStreamRef.current?.getTracks().forEach(t => t.stop())
      micStreamRef.current = null
      ctxRef.current?.close().catch(() => {})
      ctxRef.current = null
    }
  }, [isListening])

  return (
    <div className="flex flex-col items-center gap-1">
      <motion.button
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.8, opacity: 0 }}
        transition={{ duration: 0.15 }}
        onClick={onClick}
        disabled={disabled}
        whileTap={{ scale: 0.9 }}
        className={cn(
          'relative flex items-center justify-center w-16 h-16 rounded-full shrink-0 transition-colors',
          isListening
            ? codexMode
              ? 'bg-red-600 shadow-[0_0_40px_rgba(220,38,38,0.6)]'
              : 'bg-violet-500 shadow-[0_0_40px_rgba(139,92,246,0.6)]'
            : codexMode
              ? 'bg-red-500/15 border-2 border-red-500/30'
              : 'bg-violet-500/15 border-2 border-violet-500/30',
          disabled && 'opacity-30 cursor-not-allowed',
        )}
      >
        {/* Voice-reactive pulse rings */}
        <span
          ref={ring1Ref}
          className={cn('absolute inset-0 rounded-full transition-none', codexMode ? 'bg-red-500/30' : 'bg-violet-500/30')}
          style={{ opacity: 0 }}
        />
        <span
          ref={ring2Ref}
          className={cn('absolute -inset-2 rounded-full border-2 transition-none', codexMode ? 'border-red-400/30' : 'border-violet-400/30')}
          style={{ opacity: 0 }}
        />
        <span
          ref={ring3Ref}
          className={cn('absolute -inset-5 rounded-full border transition-none', codexMode ? 'border-red-400/15' : 'border-violet-400/15')}
          style={{ opacity: 0 }}
        />
        {isListening ? (
          <MicOff className="w-6 h-6 text-white relative z-10" />
        ) : (
          <Mic className={cn('w-6 h-6 relative z-10', codexMode ? 'text-red-400' : 'text-violet-400')} />
        )}
      </motion.button>
      {/* Label under mic */}
      <span className={cn('text-[9px] font-bold uppercase tracking-wider', codexMode ? 'text-red-400/60' : 'text-violet-400/60')}>
        {codexMode ? 'Codex' : 'Claude'}
      </span>
    </div>
  )
}

// ── Global styles ────────────────────────────────────────────────

const globalCSS = `
  .no-scrollbar::-webkit-scrollbar { display: none; }
  .no-scrollbar { scrollbar-width: none; }
  * { scrollbar-width: none; }
  *::-webkit-scrollbar { display: none; }
  @keyframes msgFadeIn {
    from { opacity: 0; transform: translateY(10px); }
    to { opacity: 1; transform: translateY(0); }
  }
  .msg-fade-in { animation: msgFadeIn 0.25s ease-out; }
  .user-bubble {
    margin-left: auto !important;
    margin-right: 0.25rem !important;
    width: fit-content !important;
    max-width: 82% !important;
    background: rgb(76, 29, 149) !important;
    border-radius: 1rem !important;
    border-bottom-right-radius: 0.375rem !important;
    padding: 0.45rem 0.75rem !important;
    overflow-wrap: break-word !important;
    word-break: break-word !important;
  }
  /* Codex panel — red user bubbles */
  .codex-panel .user-bubble {
    background: rgb(185, 28, 28) !important;
  }
  /* Light mode overrides */
  .light-mode .user-bubble {
    background: rgb(91, 33, 182) !important;
  }
  .light-mode .codex-panel .user-bubble {
    background: rgb(185, 28, 28) !important;
  }
  .light-mode .user-bubble p { color: #fff !important; }
  .light-mode .text-white\\/50,
  .light-mode .text-white\\/40,
  .light-mode .text-white\\/30,
  .light-mode .text-white\\/25,
  .light-mode .text-white\\/20 { color: rgba(0, 0, 0, 0.55) !important; }
  .light-mode .text-white\\/70 { color: rgba(0, 0, 0, 0.75) !important; }
  .light-mode .bg-white\\/\\[0\\.06\\] { background: rgba(0, 0, 0, 0.06) !important; }
  .light-mode .bg-white\\/\\[0\\.04\\] { background: rgba(0, 0, 0, 0.04) !important; }
  .light-mode .bg-white\\/\\[0\\.02\\] { background: rgba(0, 0, 0, 0.02) !important; }
  .light-mode .border-white\\/\\[0\\.06\\] { border-color: rgba(0, 0, 0, 0.1) !important; }
  .light-mode .border-white\\/\\[0\\.08\\] { border-color: rgba(0, 0, 0, 0.12) !important; }
  .light-mode .border-white\\/\\[0\\.12\\] { border-color: rgba(0, 0, 0, 0.15) !important; }
  .light-mode .assistant-text,
  .light-mode .assistant-text *:not(code):not(strong) { color: rgb(124, 58, 237) !important; }
  .light-mode .assistant-text strong { color: rgb(109, 40, 217) !important; font-weight: 700 !important; }
  .light-mode .assistant-text code { color: rgb(139, 92, 246) !important; background: rgba(124, 58, 237, 0.08) !important; }
  .light-mode .text-white\\/90 { color: rgb(109, 40, 217) !important; }
  .light-mode .text-violet-300 { color: rgb(76, 29, 149) !important; }
  .light-mode .text-violet-400 { color: rgb(91, 33, 182) !important; }
  .light-mode .text-emerald-300\\/90 { color: rgb(5, 150, 105) !important; }
  .light-mode .bg-black\\/40,
  .light-mode .bg-black\\/50 { background: rgba(0, 0, 0, 0.06) !important; }
  .light-mode .text-violet-400\\/60 { color: rgba(76, 29, 149, 0.7) !important; }
  /* Diff colors stronger in light mode */
  .light-mode .text-red-300\\/80 { color: rgb(185, 28, 28) !important; }
  .light-mode .text-emerald-300\\/80 { color: rgb(5, 120, 85) !important; }
  .light-mode .text-red-400\\/70 { color: rgba(185, 28, 28, 0.8) !important; }
  .light-mode .text-emerald-400\\/70 { color: rgba(5, 120, 85, 0.8) !important; }
  .light-mode .text-red-400\\/50 { color: rgba(185, 28, 28, 0.5) !important; }
  .light-mode .text-emerald-400\\/50 { color: rgba(5, 120, 85, 0.5) !important; }
  .light-mode .bg-red-500\\/\\[0\\.15\\] { background: rgba(220, 38, 38, 0.12) !important; }
  .light-mode .bg-emerald-500\\/\\[0\\.15\\] { background: rgba(5, 150, 105, 0.12) !important; }
  .light-mode .border-l-red-500\\/60 { border-left-color: rgba(220, 38, 38, 0.5) !important; }
  .light-mode .border-l-emerald-500\\/60 { border-left-color: rgba(5, 150, 105, 0.5) !important; }
  .light-mode .border-red-500\\/25 { border-color: rgba(220, 38, 38, 0.2) !important; }
  .light-mode .border-emerald-500\\/25 { border-color: rgba(5, 150, 105, 0.2) !important; }
  /* Tool card amber tints for light mode */
  .light-mode .bg-amber-900\\/30 { background: rgba(245, 158, 11, 0.15) !important; }
  .light-mode .border-amber-600\\/50 { border-color: rgba(217, 119, 6, 0.4) !important; }
  .light-mode .text-amber-400 { color: rgb(180, 83, 9) !important; }
  /* Editing card in light mode */
  .light-mode .bg-violet-900\\/25 { background: rgba(109, 40, 217, 0.08) !important; }
  .light-mode .border-violet-500\\/40 { border-color: rgba(109, 40, 217, 0.3) !important; }
  /* Diff box border in light mode */
  .light-mode .border-violet-400\\/40 { border-color: rgba(109, 40, 217, 0.35) !important; }
  .light-mode .bg-black\\/70 { background: rgba(0, 0, 0, 0.06) !important; }
  .light-mode p, .light-mode span { transition: color 0.5s; }
  /* Codex text — red theme, overrides assistant-text purple */
  .codex-text, .codex-text * { color: rgb(248, 113, 113) !important; }
  .codex-text strong { color: rgb(252, 165, 165) !important; font-weight: 700 !important; }
  .codex-text code { color: rgb(248, 113, 113) !important; background: rgba(248, 113, 113, 0.08) !important; }
  .light-mode .codex-text, .light-mode .codex-text * { color: rgb(185, 28, 28) !important; }
  .light-mode .codex-text strong { color: rgb(153, 27, 27) !important; font-weight: 700 !important; }
  .light-mode .codex-text code { color: rgb(185, 28, 28) !important; background: rgba(185, 28, 28, 0.08) !important; }
  /* Codex panel — tool icons and tool text override violet to red */
  .codex-panel .text-violet-400 { color: rgb(248, 113, 113) !important; }
  .codex-panel .text-amber-400 { color: rgb(248, 113, 113) !important; }
  .light-mode .codex-panel .text-violet-400 { color: rgb(185, 28, 28) !important; }
  .light-mode .codex-panel .text-amber-400 { color: rgb(185, 28, 28) !important; }
`

// Track which result texts have already been animated (survives re-renders and remounts)
const animatedTexts = new Set<string>()

// ── Main Component ───────────────────────────────────────────────

export function VoiceChat() {
  const [showSplash, setShowSplash] = useState(true)
  const [introReady, setIntroReady] = useState(false)
  const [pendingMessage, setPendingMessage] = useState('')
  const [isAudioPlaying, setIsAudioPlaying] = useState(false)
  const [expandedTools, setExpandedTools] = useState<Set<number>>(new Set())
  const [pendingImages, setPendingImages] = useState<ImageAttachment[]>([])
  const autoListenRef = useRef<(() => void) | null>(null)
  const hasSentRef = useRef(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const stopListeningRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    onAudioPlayingChange(setIsAudioPlaying)
    // Stop mic when audio is about to play so it doesn't pick up Matthew's voice
    onAudioWillPlay(() => { stopListeningRef.current?.() })
    return () => {
      onAudioPlayingChange(() => {})
      onAudioWillPlay(() => {})
    }
  }, [])

  const [showTerminal, setShowTerminal] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [splitMode, setSplitMode] = useState(false)
  const [codexPopup, setCodexPopup] = useState(false)
  const [codexExpandedTools, setCodexExpandedTools] = useState<Set<number>>(new Set())
  const [splitRatio, setSplitRatio] = useState(0.5) // 0-1, portion for Claude (top)
  const [lightMode, setLightMode] = useState(() => localStorage.getItem('matthews-light-mode') === 'true')
  const codexEndRef = useRef<HTMLDivElement>(null)
  const codexScrollRef = useRef<HTMLDivElement>(null)
  const codexPopupEndRef = useRef<HTMLDivElement>(null)
  const splitDragRef = useRef({ startY: 0, startRatio: 0.5, dragging: false })
  const [codexPopupHeight, setCodexPopupHeight] = useState(420)
  const [codexPopupWidth, setCodexPopupWidth] = useState(400)
  const popupResizeRef = useRef({ startY: 0, startX: 0, startHeight: 420, startWidth: 400, dragging: false })

  // Track which mic is active — 'claude' for main, 'codex' for Codex panel
  const micTargetRef = useRef<'claude' | 'codex'>('claude')

  // Sync body/html/theme-color with light mode so safe-area + home bar match
  useEffect(() => {
    const isLight = !showSplash && lightMode
    const bg = isLight ? '#ffffff' : '#000000'
    document.body.style.setProperty('background', bg, 'important')
    document.documentElement.style.setProperty('background', bg, 'important')
    const root = document.getElementById('root')
    if (root) root.style.setProperty('background', bg, 'important')
    // Toggle class on html for CSS rules
    if (isLight) {
      document.documentElement.classList.add('light-bg')
    } else {
      document.documentElement.classList.remove('light-bg')
    }
    // Update meta theme-color for iOS status bar / home indicator area
    const meta = document.querySelector('meta[name="theme-color"]')
    if (meta) meta.setAttribute('content', bg)
  }, [lightMode, showSplash])
  const terminalEndRef = useRef<HTMLDivElement>(null)

  const { status, messages, sendCommand, sendStop, sendNewChat, requestFiles, requestFileContent, fileList, filePath, fileContent, workspace, workspacePath, activeFile, isWaiting, isCodexWaiting, daemonConnected, daemonLogs } = useBridge(() => {
    autoListenRef.current?.()
  })

  const [showFiles, setShowFiles] = useState(false)
  const [showTyping, setShowTyping] = useState(false)
  const typingInputRef = useRef<HTMLInputElement>(null)
  const [, setFileNavPath] = useState<string | null>(null)
  const [viewingFile, setViewingFile] = useState<string | null>(null)

  const { isListening, transcript, startListening, stopListening, supported, micError } = useVoice()

  autoListenRef.current = startListening
  stopListeningRef.current = stopListening
  const chatEndRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const userScrolledRef = useRef(false)
  const isAutoScrollingRef = useRef(false)

  // Detect when user scrolls up — pause auto-scroll
  // Skip events caused by our own programmatic scrollIntoView
  useEffect(() => {
    const el = scrollContainerRef.current
    if (!el) return
    const handleScroll = () => {
      if (isAutoScrollingRef.current) return
      const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 200
      userScrolledRef.current = !isAtBottom
    }
    el.addEventListener('scroll', handleScroll, { passive: true })
    return () => el.removeEventListener('scroll', handleScroll)
  }, [])

  // Auto-scroll terminal logs
  useEffect(() => {
    if (showTerminal) terminalEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [daemonLogs, showTerminal])

  // Split messages by engine for dual-panel display
  const claudeMessages = messages.filter(m => !m.engine || m.engine === 'claude')
  const codexMessages = messages.filter(m => m.engine === 'codex')

  // Auto-scroll Codex panel (split + popup)
  useEffect(() => {
    if (splitMode) codexEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    if (codexPopup) codexPopupEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [codexMessages.length, splitMode, codexPopup])

  // Codex-specific processing state
  const codexIsProcessing = isCodexWaiting || (codexMessages.length > 0 && codexMessages[codexMessages.length - 1].role !== 'assistant')
  const codexLastNonNarration = (() => {
    for (let i = codexMessages.length - 1; i >= 0; i--) {
      if (!codexMessages[i].narration) return codexMessages[i]
    }
    return null
  })()
  const codexIsThinking = codexIsProcessing && codexMessages.length > 0 && codexLastNonNarration?.role === 'user'
  const codexLastUserIndex = (() => {
    for (let i = codexMessages.length - 1; i >= 0; i--) { if (codexMessages[i].role === 'user') return i }
    return -1
  })()
  const codexLastToolIndex = (() => {
    for (let i = codexMessages.length - 1; i >= 0; i--) { if (codexMessages[i].role === 'tool') return i }
    return -1
  })()
  const codexIsCurrentToolLoading = codexIsProcessing && codexLastToolIndex > codexLastUserIndex
  const codexLastResultIndex = (() => {
    for (let i = codexMessages.length - 1; i >= 0; i--) { if (codexMessages[i].role === 'assistant' && !codexMessages[i].narration) return i }
    return -1
  })()
  const codexHasResultAfterTools = codexLastResultIndex > codexLastToolIndex

  // Clear stale expanded tools when messages get replaced (replay/clear)
  const prevMsgLenRef = useRef(messages.length)
  useEffect(() => {
    if (messages.length < prevMsgLenRef.current) {
      setExpandedTools(new Set())
    }
    prevMsgLenRef.current = messages.length
  }, [messages.length])

  // Claude-specific processing state (only looks at Claude messages, not Codex)
  const isProcessing = isWaiting || (claudeMessages.length > 0 && claudeMessages[claudeMessages.length - 1].role !== 'assistant')

  const lastUserIndex = (() => {
    for (let i = claudeMessages.length - 1; i >= 0; i--) { if (claudeMessages[i].role === 'user') return i }
    return -1
  })()

  // Show thinking dots when waiting — narration messages shouldn't hide the dots
  const lastNonNarrationMsg = (() => {
    for (let i = claudeMessages.length - 1; i >= 0; i--) {
      if (!(claudeMessages[i] as any).narration) return claudeMessages[i]
    }
    return null
  })()
  const isThinking = isProcessing && claudeMessages.length > 0 && lastNonNarrationMsg?.role === 'user'

  const lastToolIndex = (() => {
    for (let i = claudeMessages.length - 1; i >= 0; i--) { if (claudeMessages[i].role === 'tool') return i }
    return -1
  })()

  const isCurrentToolLoading = isProcessing && lastToolIndex > lastUserIndex

  const lastResultIndex = (() => {
    for (let i = claudeMessages.length - 1; i >= 0; i--) { if (claudeMessages[i].role === 'assistant' && !claudeMessages[i].narration) return i }
    return -1
  })()

  const hasResultAfterTools = lastResultIndex > lastToolIndex

  const scrollToBottom = useCallback(() => {
    if (!userScrolledRef.current) {
      isAutoScrollingRef.current = true
      chatEndRef.current?.scrollIntoView({ behavior: 'instant' })
      // Clear flag after browser processes the scroll
      requestAnimationFrame(() => { isAutoScrollingRef.current = false })
    }
  }, [])

  // Reset user-scrolled flag when new messages arrive so auto-scroll resumes
  const prevMsgCountRef = useRef(messages.length)
  useEffect(() => {
    if (messages.length > prevMsgCountRef.current) {
      userScrolledRef.current = false
    }
    prevMsgCountRef.current = messages.length
  }, [messages.length])

  useEffect(() => { scrollToBottom() }, [messages, expandedTools, scrollToBottom])
  useEffect(() => {
    const t = setTimeout(scrollToBottom, 300)
    return () => clearTimeout(t)
  }, [messages, expandedTools, scrollToBottom])
  useEffect(() => { if (isListening) hasSentRef.current = false }, [isListening])

  useEffect(() => {
    if (!transcript || hasSentRef.current) return
    const trimmed = transcript.trim()
    if (!trimmed) return

    if (/^(matthew\s+stop|stop|shut up|quiet|be quiet|enough)\s*[.!]?\s*$/i.test(trimmed)) {
      hasSentRef.current = true
      sendStop(micTargetRef.current)
      stopListening()
      setPendingMessage('')
      setTimeout(() => startListening(), 1500)
      return
    }

    if (/\bsend\s*[.!]?\s*$/i.test(trimmed)) {
      const msg = trimmed.replace(/\bsend\s*[.!]?\s*$/i, '').trim()
      if (msg || pendingImages.length > 0) {
        hasSentRef.current = true
        userScrolledRef.current = false
        if (micTargetRef.current === 'codex') {
          setCodexExpandedTools(new Set())
        } else {
          setExpandedTools(new Set())
        }
        stopListening()
        sendCommand(
          msg || 'What do you see in this image?',
          pendingImages.length > 0 ? pendingImages : undefined,
          micTargetRef.current
        )
        setPendingMessage('')
        setPendingImages([])
      }
    } else if (!isListening) {
      setPendingMessage(trimmed)
    }
  }, [isListening, transcript, sendCommand, sendStop, stopListening, startListening])

  const handleSend = () => {
    const text = pendingMessage || transcript || ''
    if ((text || pendingImages.length > 0) && !hasSentRef.current) {
      hasSentRef.current = true
      userScrolledRef.current = false
      const target = micTargetRef.current
      if (target === 'codex') {
        setCodexExpandedTools(new Set())
      } else {
        setExpandedTools(new Set())
      }
      if (isListening) stopListening()
      sendCommand(
        text || 'What do you see in this image?',
        pendingImages.length > 0 ? pendingImages : undefined,
        target
      )
      setPendingMessage('')
      setPendingImages([])
    }
  }

  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return
    // Copy to array BEFORE clearing input — mobile browsers invalidate the FileList on reset
    const fileArray = Array.from(files)
    e.target.value = ''

    for (const file of fileArray) {
      try {
        const { data, mimeType } = await resizeImage(file)
        setPendingImages(prev => [...prev, { data, mimeType, name: file.name }])
      } catch (err) {
        console.error('[Image] Failed to process:', err)
      }
    }
  }

  const handleMicClick = () => {
    if (isListening && micTargetRef.current === 'claude') {
      stopListening()
    } else {
      micTargetRef.current = 'claude'
      stopAllAudio()
      setPendingMessage('')
      hasSentRef.current = false
      if (isListening) stopListening()
      setTimeout(() => startListening(), 120)
    }
  }

  const handleCodexMicClick = () => {
    if (isListening && micTargetRef.current === 'codex') {
      stopListening()
    } else {
      micTargetRef.current = 'codex'
      // Open popup if not already in split mode
      if (!splitMode) {
        setCodexPopup(true)
      }
      stopAllAudio()
      setPendingMessage('')
      hasSentRef.current = false
      if (isListening) stopListening()
      setTimeout(() => startListening(), 120)
    }
  }

  const handleStop = () => {
    sendStop('claude')
    sendStop('codex')
  }

  const toggleToolExpand = (i: number) => {
    setExpandedTools(prev => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  }

  const toggleCodexToolExpand = (i: number) => {
    setCodexExpandedTools(prev => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  }

  // Derived mic states — which mic orb shows as active
  const mainMicListening = isListening && micTargetRef.current === 'claude'
  const codexMicListening = isListening && micTargetRef.current === 'codex'

  const statusDot = status === 'connected'
    ? (daemonConnected ? 'bg-emerald-400' : 'bg-yellow-400')
    : status === 'connecting' ? 'bg-yellow-400' : 'bg-red-400'
  const statusLabel = status === 'connected'
    ? (daemonConnected ? 'Connected' : 'Bridge connected — waiting for daemon')
    : status === 'connecting' ? 'Connecting...' : 'Disconnected'

  const showStop = isProcessing || isAudioPlaying || codexIsProcessing

  return (
    <div
      className={cn('flex flex-col relative', lightMode ? 'text-black light-mode' : 'text-white')}
      style={{ paddingTop: 'env(safe-area-inset-top)', paddingLeft: 'env(safe-area-inset-left)', paddingRight: 'env(safe-area-inset-right)', overscrollBehavior: 'none', position: 'fixed', inset: 0, overflow: 'hidden', background: lightMode ? '#ffffff' : '#000000' }}
    >
      <style>{globalCSS}</style>

      {/* ── Splash Screen ── */}
      {showSplash && (
        <SplashScreen onDone={() => {
          setShowSplash(false)
          setTimeout(() => setIntroReady(true), 100)
        }} />
      )}

      {/* Particle wave removed — caused persistent bottom gap on iOS */}

      {/* ── Header (hidden in split mode — each panel has its own) ── */}
      {!splitMode && <div
        className="shrink-0 flex flex-col items-center px-8 pt-3 pb-4 relative transition-all duration-400"
        style={{ opacity: introReady ? 1 : 0, transform: introReady ? 'translateY(0)' : 'translateY(-10px)', transitionDelay: '0.1s' }}
      >
        {/* Top row: restart + waveform + terminal all in line */}
        <div className="flex items-center w-full gap-2">
          <div className="flex items-center gap-2">
            <button
              onClick={sendNewChat}
              className="flex items-center justify-center w-8 h-8 rounded-full bg-white/[0.06] active:bg-violet-500/30 transition-colors"
              title="New Chat"
            >
              <RotateCcw className="w-3.5 h-3.5 text-white/40" />
            </button>
            <span className={cn('text-[10px]', lightMode ? 'text-black/30' : 'text-white/25')}>{messages.filter(m => m.role === 'user').length} msgs</span>
          </div>

          <div className="flex-1 flex justify-center">
            <VoiceWaveform isActive={isAudioPlaying} getAudioLevel={getAudioLevel} size={200} color={isAudioPlaying && lastResultEngine === 'codex' ? 'red' : 'violet'} />
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowTerminal(prev => !prev)}
              className={cn(
                'flex items-center justify-center w-8 h-8 rounded-full transition-colors',
                showTerminal ? 'bg-violet-500/30' : 'bg-white/[0.06]'
              )}
            >
              <Terminal className={cn('w-3.5 h-3.5', showTerminal ? 'text-violet-400' : 'text-white/40')} />
            </button>
            <button
              onClick={() => setShowSettings(prev => !prev)}
              className={cn(
                'flex items-center justify-center w-8 h-8 rounded-full transition-colors',
                showSettings ? 'bg-violet-500/30' : 'bg-white/[0.06]'
              )}
            >
              <Settings className={cn('w-3.5 h-3.5', showSettings ? 'text-violet-400' : 'text-white/40')} />
            </button>
          </div>
        </div>

        {/* Live directory tracker */}
        {workspace && daemonConnected && (
          <div className="flex items-center gap-1.5 mt-1.5 px-3 py-1 rounded-full bg-white/[0.04] border border-white/[0.06]">
            <Terminal className="w-3 h-3 text-violet-400/60 shrink-0" />
            <span className={cn('text-[11px] font-medium truncate max-w-[260px]', lightMode ? 'text-black/50' : 'text-white/50')}>
              {(() => {
                const p = workspacePath || workspace
                // Split on / or \ and filter out empty/drive-letter parts
                const parts = p.replace(/\\/g, '/').split('/').filter(s => s && !/^[A-Z]:$/i.test(s))
                const desktopIdx = parts.findIndex(s => s.toLowerCase() === 'desktop')
                const meaningful = desktopIdx >= 0 ? parts.slice(desktopIdx) : parts.slice(-3)
                // If nothing meaningful, just show the workspace name
                return meaningful.length > 0 ? meaningful.join(' → ') : workspace
              })()}
            </span>
          </div>
        )}

        <div className="flex items-center gap-1.5 mt-1">
          <span className={cn('h-1.5 w-1.5 rounded-full', statusDot)} />
          <span className={cn('text-[10px] truncate max-w-[200px]', lightMode ? 'text-black/40' : 'text-white/30')}>{statusLabel}</span>
        </div>
        {activeFile && (
          <div className="flex items-center gap-1 mt-0.5">
            <FileText className="w-2.5 h-2.5 text-violet-400/50" />
            <span className="text-[10px] text-violet-300/40 truncate max-w-[220px]">{activeFile}</span>
          </div>
        )}
      </div>}

      {/* ── Terminal overlay ── */}
      <AnimatePresence>
        {showTerminal && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.2 }}
            className={cn(
              'absolute inset-x-0 top-0 bottom-0 z-50 flex flex-col backdrop-blur-sm',
              lightMode ? 'bg-white/95' : 'bg-[#0A0A0B]/95'
            )}
            style={{ paddingTop: 'env(safe-area-inset-top)' }}
          >
            {/* Terminal header */}
            <div className={cn('shrink-0 flex items-center justify-between px-4 pt-3 pb-2 border-b', lightMode ? 'border-black/[0.08]' : 'border-white/[0.06]')}>
              <div className="flex items-center gap-2">
                <Terminal className="w-4 h-4 text-violet-400" />
                <span className={cn('text-sm font-medium', lightMode ? 'text-black/70' : 'text-white/70')}>Terminal</span>
              </div>
              <button
                onClick={() => setShowTerminal(false)}
                className={cn('flex items-center justify-center w-8 h-8 rounded-full active:scale-90 transition-transform', lightMode ? 'bg-black/[0.06]' : 'bg-white/[0.06]')}
              >
                <X className={cn('w-4 h-4', lightMode ? 'text-black/40' : 'text-white/40')} />
              </button>
            </div>

            {/* Log output */}
            <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden no-scrollbar px-3 py-2 font-mono text-[11px] leading-relaxed">
              {daemonLogs.length === 0 ? (
                <p className={cn('text-center mt-8', lightMode ? 'text-black/20' : 'text-white/20')}>No logs yet — waiting for daemon output</p>
              ) : (
                daemonLogs.map((log, i) => (
                  <p key={i} className={cn(
                    'whitespace-pre-wrap break-all',
                    log.startsWith('ERROR') ? 'text-red-400/70' :
                    log.startsWith('WARN') ? 'text-yellow-400/70' :
                    log.includes('[Daemon]') ? 'text-emerald-400/60' :
                    log.includes('You:') ? 'text-violet-400/70' :
                    log.includes('Result:') ? 'text-emerald-300/70' :
                    lightMode ? 'text-black/50' : 'text-white/40'
                  )}>{log}</p>
                ))
              )}
              <div ref={terminalEndRef} />
            </div>

            {/* Daemon status bar */}
            <div className={cn('shrink-0 flex items-center gap-2 px-4 py-2 border-t', lightMode ? 'border-black/[0.06]' : 'border-white/[0.06]')}
              style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}
            >
              <span className={cn('h-2 w-2 rounded-full', daemonConnected ? 'bg-emerald-400' : 'bg-red-400')} />
              <span className={cn('text-xs', lightMode ? 'text-black/40' : 'text-white/40')}>
                {daemonConnected ? 'Daemon connected to bridge' : 'Daemon not connected'}
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Settings popup ── */}
      <AnimatePresence>
        {showSettings && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -10 }}
            transition={{ duration: 0.15 }}
            className={cn(
              'absolute right-8 top-16 z-[60] w-56 rounded-2xl border backdrop-blur-xl shadow-2xl overflow-hidden',
              lightMode
                ? 'bg-white/95 border-black/[0.1]'
                : 'bg-[#1A1A1E]/95 border-white/[0.08]'
            )}
            style={{ marginTop: 'env(safe-area-inset-top)' }}
          >
            <div className={cn('px-5 py-3 border-b', lightMode ? 'border-black/[0.08]' : 'border-white/[0.06]')}>
              <span className={cn('text-xs font-semibold uppercase tracking-wider', lightMode ? 'text-black/40' : 'text-white/50')}>Settings</span>
            </div>
            <button
              onClick={() => {
                const next = !lightMode
                setLightMode(next)
                localStorage.setItem('matthews-light-mode', String(next))
              }}
              className={cn('w-full flex items-center gap-3 px-5 py-3.5 transition-colors', lightMode ? 'active:bg-black/[0.04]' : 'active:bg-white/[0.06]')}
            >
              {lightMode ? <Moon className="w-4 h-4 text-violet-500" /> : <Sun className="w-4 h-4 text-amber-400" />}
              <span className={cn('text-sm', lightMode ? 'text-black/70' : 'text-white/70')}>{lightMode ? 'Dark Mode' : 'Daylight Mode'}</span>
            </button>
            <div className={cn('px-5 py-2 border-t text-center', lightMode ? 'border-black/[0.06]' : 'border-white/[0.04]')}>
              <span className={cn('text-[10px]', lightMode ? 'text-black/25' : 'text-white/20')}>v3.3 — Dual Engine</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {/* Backdrop to close settings */}
      {showSettings && (
        <div className="fixed inset-0 z-[55]" onClick={() => setShowSettings(false)} />
      )}


      {/* ── File browser overlay ── */}
      <AnimatePresence>
        {showFiles && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.2 }}
            className={cn(
              'absolute inset-x-0 top-0 bottom-0 z-50 flex flex-col backdrop-blur-sm',
              lightMode ? 'bg-white/95' : 'bg-[#0A0A0B]/95'
            )}
            style={{ paddingTop: 'env(safe-area-inset-top)' }}
          >
            {/* Header */}
            <div className={cn('shrink-0 flex items-center justify-between px-4 pt-3 pb-2 border-b', lightMode ? 'border-black/[0.08]' : 'border-white/[0.06]')}>
              <div className="flex items-center gap-2 min-w-0">
                {/* Back button — always visible when not viewing file, navigates up */}
                {!viewingFile && (
                  <button
                    onClick={() => {
                      if (filePath) {
                        const parent = filePath.replace(/[\\/][^\\/]+$/, '')
                        if (parent && parent !== filePath && parent.length > 2) {
                          setFileNavPath(parent)
                          requestFiles(parent)
                        }
                      }
                    }}
                    className={cn('flex items-center justify-center w-7 h-7 rounded-full active:scale-90 transition-transform shrink-0', lightMode ? 'bg-black/[0.06]' : 'bg-white/[0.06]')}
                  >
                    <ChevronLeft className={cn('w-4 h-4', lightMode ? 'text-black/50' : 'text-white/50')} />
                  </button>
                )}
                {/* Back from file viewer to file list */}
                {viewingFile && (
                  <button
                    onClick={() => setViewingFile(null)}
                    className={cn('flex items-center justify-center w-7 h-7 rounded-full active:scale-90 transition-transform shrink-0', lightMode ? 'bg-black/[0.06]' : 'bg-white/[0.06]')}
                  >
                    <ChevronLeft className={cn('w-4 h-4', lightMode ? 'text-black/50' : 'text-white/50')} />
                  </button>
                )}
                {viewingFile ? (
                  <File className={cn('w-4 h-4 shrink-0', lightMode ? 'text-black/30' : 'text-white/30')} />
                ) : (
                  <FolderOpen className="w-4 h-4 text-violet-400 shrink-0" />
                )}
                <span className={cn('text-sm font-medium truncate', lightMode ? 'text-black/70' : 'text-white/70')}>
                  {viewingFile
                    ? viewingFile.replace(/\\/g, '/').split('/').pop()
                    : filePath ? filePath.replace(/\\/g, '/').split('/').pop() : workspace || 'Files'}
                </span>
              </div>
              <button
                onClick={() => { setShowFiles(false); setViewingFile(null) }}
                className={cn('flex items-center justify-center w-8 h-8 rounded-full active:scale-90 transition-transform', lightMode ? 'bg-black/[0.06]' : 'bg-white/[0.06]')}
              >
                <X className={cn('w-4 h-4', lightMode ? 'text-black/40' : 'text-white/40')} />
              </button>
            </div>

            {/* Breadcrumb */}
            {filePath && !viewingFile && (
              <div className={cn('shrink-0 px-4 py-1.5 border-b', lightMode ? 'border-black/[0.04]' : 'border-white/[0.04]')}>
                <span className={cn('text-[10px] truncate block', lightMode ? 'text-black/30' : 'text-white/20')}>
                  {(() => {
                    const p = filePath.replace(/\\/g, '/')
                    const parts = p.split('/').filter(Boolean)
                    const desktopIdx = parts.findIndex(s => s.toLowerCase() === 'desktop')
                    return (desktopIdx >= 0 ? parts.slice(desktopIdx) : parts.slice(-4)).join(' / ')
                  })()}
                </span>
              </div>
            )}

            {/* File content viewer */}
            {viewingFile ? (
              <div className="flex-1 min-h-0 overflow-y-auto overflow-x-auto no-scrollbar px-3 py-2">
                {fileContent === null ? (
                  <p className="text-white/20 text-center text-sm mt-8">Loading...</p>
                ) : fileContent.error ? (
                  <p className="text-red-400/60 text-center text-sm mt-8">{fileContent.error}</p>
                ) : (
                  <pre className={cn('font-mono text-[11px] leading-relaxed whitespace-pre', lightMode ? 'text-black/60' : 'text-white/50')}>
                    {(fileContent.content || '').split('\n').map((line, i) => (
                      <div key={i} className="flex">
                        <span className={cn('w-10 shrink-0 text-right pr-3 select-none', lightMode ? 'text-black/20' : 'text-white/15')}>{i + 1}</span>
                        <span className="whitespace-pre">{line}</span>
                      </div>
                    ))}
                  </pre>
                )}
              </div>
            ) : (
              /* File list */
              <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar">
                {fileList.length === 0 ? (
                  <p className="text-white/20 text-center text-sm mt-8">No files found</p>
                ) : (
                  fileList.map((f, i) => (
                    <button
                      key={i}
                      className={cn('w-full flex items-center gap-3 px-4 py-2.5 transition-colors text-left', lightMode ? 'active:bg-black/[0.04]' : 'active:bg-white/[0.04]')}
                      onClick={() => {
                        if (f.type === 'dir' && filePath) {
                          const newPath = filePath + (filePath.endsWith('/') || filePath.endsWith('\\') ? '' : '/') + f.name
                          setFileNavPath(newPath)
                          requestFiles(newPath)
                        } else if (f.type === 'file' && filePath) {
                          const fullPath = filePath + (filePath.endsWith('/') || filePath.endsWith('\\') ? '' : '/') + f.name
                          setViewingFile(fullPath)
                          requestFileContent(fullPath)
                        }
                      }}
                    >
                      {f.type === 'dir' ? (
                        <Folder className="w-4 h-4 text-violet-400/60 shrink-0" />
                      ) : (
                        <File className={cn('w-4 h-4 shrink-0', lightMode ? 'text-black/25' : 'text-white/25')} />
                      )}
                      <span className={cn(
                        'text-sm truncate',
                        f.type === 'dir'
                          ? (lightMode ? 'text-black/70' : 'text-white/60')
                          : (lightMode ? 'text-black/50' : 'text-white/40')
                      )}>{f.name}</span>
                    </button>
                  ))
                )}
              </div>
            )}

            {/* Status bar */}
            <div className={cn('shrink-0 flex items-center gap-2 px-4 py-2 border-t', lightMode ? 'border-black/[0.06]' : 'border-white/[0.06]')}
              style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}
            >
              <span className={cn('text-[11px]', lightMode ? 'text-black/30' : 'text-white/25')}>
                {viewingFile
                  ? `${(fileContent?.content || '').split('\n').length} lines`
                  : `${fileList.filter(f => f.type === 'dir').length} folders, ${fileList.filter(f => f.type === 'file').length} files`}
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Chat messages — split or single mode ── */}
      {splitMode ? (
        /* ── SPLIT VIEW — Claude top, Codex bottom, draggable divider ── */
        <div className="flex-1 min-h-0 flex flex-col">
          {/* Claude panel (top) */}
          <div className="flex flex-col min-h-0 overflow-hidden" style={{ flex: `${splitRatio} 1 0%` }}>
            {/* Claude header — matches main header style */}
            <div className={cn('shrink-0 flex flex-col px-4 py-2', lightMode ? 'bg-white/80' : 'bg-black/40')}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <button onClick={sendNewChat} className={cn('flex items-center justify-center w-7 h-7 rounded-full active:scale-90 transition-transform', lightMode ? 'bg-black/[0.06]' : 'bg-white/[0.06]')}>
                    <RotateCcw className={cn('w-3 h-3', lightMode ? 'text-black/40' : 'text-white/40')} />
                  </button>
                  <span className={cn('text-[10px]', lightMode ? 'text-black/30' : 'text-white/25')}>{claudeMessages.filter(m => m.role === 'user').length} msgs</span>
                </div>
                <div className="flex-1 flex justify-center">
                  <VoiceWaveform isActive={isAudioPlaying && lastResultEngine !== 'codex'} getAudioLevel={getAudioLevel} size={120} color="violet" />
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => setShowTerminal(prev => !prev)}
                    className={cn('flex items-center justify-center w-7 h-7 rounded-full transition-colors', showTerminal ? 'bg-violet-500/30' : 'bg-white/[0.06]')}
                  >
                    <Terminal className={cn('w-3 h-3', showTerminal ? 'text-violet-400' : 'text-white/40')} />
                  </button>
                  <button
                    onClick={() => setShowSettings(prev => !prev)}
                    className={cn('flex items-center justify-center w-7 h-7 rounded-full transition-colors', showSettings ? 'bg-violet-500/30' : 'bg-white/[0.06]')}
                  >
                    <Settings className={cn('w-3 h-3', showSettings ? 'text-violet-400' : 'text-white/40')} />
                  </button>
                </div>
              </div>
            </div>
            <div ref={scrollContainerRef} className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden no-scrollbar" style={{ overscrollBehavior: 'none' }}>
              <div className="flex flex-col gap-3 px-4 py-3 w-full overflow-hidden box-border">
                {claudeMessages.map((msg, i) => {
                    const isNextTool = claudeMessages[i + 1]?.role === 'tool'
                    const isPrevTool = i > 0 && claudeMessages[i - 1]?.role === 'tool'
                    const isLastTool = i === lastToolIndex
                    const defaultExpanded = isLastTool && !hasResultAfterTools
                    const isExpanded = expandedTools.has(i) ? !defaultExpanded : defaultExpanded
                    const isRecent = i >= claudeMessages.length - 3
                    if (msg.narration) return null
                    const toolType = msg.role === 'tool' ? msg.text.toLowerCase().startsWith('reading') ? 'read' : msg.text.toLowerCase().startsWith('editing') ? 'edit' : 'other' : 'other'
                    const content = msg.role === 'user' ? (
                      <div className="user-bubble">
                        {msg.images && msg.images.length > 0 && (
                          <div className="flex gap-2 mb-2 flex-wrap justify-end">
                            {msg.images.map((img, j) => img.data ? <img key={j} src={`data:${img.mimeType};base64,${img.data}`} className="w-20 h-20 rounded-lg object-cover border border-white/10" /> : null)}
                          </div>
                        )}
                        <p className="text-[15px] text-white leading-relaxed">{msg.text}</p>
                      </div>
                    ) : msg.role === 'tool' ? (
                      <div className="flex items-stretch gap-2.5 ml-1 mr-1 cursor-pointer" onClick={() => toggleToolExpand(i)}>
                        <div className="flex flex-col items-center w-5 shrink-0">
                          <div className={cn('w-px flex-1 transition-colors', isPrevTool ? 'bg-violet-500/15' : 'bg-transparent')} />
                          {isLastTool && isCurrentToolLoading ? <LoaderCircle className="w-4 h-4 text-violet-400 animate-spin shrink-0" /> : <div className="w-2 h-2 shrink-0 rounded-full bg-violet-500/30" />}
                          <div className={cn('w-px flex-1 transition-colors', isNextTool ? 'bg-violet-500/15' : 'bg-transparent')} />
                        </div>
                        <div className="flex-1 flex items-start gap-2.5 py-2.5 px-3.5 rounded-xl min-w-0 overflow-hidden transition-all duration-200" style={toolType === 'read' ? { border: lightMode ? '2px solid rgba(200, 140, 0, 0.6)' : '2px solid rgba(250, 204, 21, 0.5)', background: lightMode ? 'rgba(250, 190, 0, 0.25)' : 'rgba(250, 204, 21, 0.15)' } : toolType === 'edit' ? { border: lightMode ? '2px solid rgba(109, 40, 217, 0.5)' : '2px solid rgba(167, 139, 250, 0.5)', background: lightMode ? 'rgba(109, 40, 217, 0.1)' : 'rgba(139, 92, 246, 0.12)' } : isExpanded ? { border: '1px solid rgba(139, 92, 246, 0.3)', background: 'rgba(139, 92, 246, 0.06)' } : { border: lightMode ? '1px solid rgba(0, 0, 0, 0.12)' : '1px solid rgba(255, 255, 255, 0.08)', background: lightMode ? 'rgba(0, 0, 0, 0.03)' : 'rgba(255, 255, 255, 0.03)' }}>
                          <div className="w-5 h-5 flex items-center justify-center shrink-0 mt-0.5"><ToolIcon text={msg.text} /></div>
                          <ToolContent text={msg.text} expanded={isExpanded} lightMode={lightMode} />
                        </div>
                      </div>
                    ) : (
                      <div className="px-1 assistant-text" style={lightMode ? { color: 'rgb(124, 58, 237)' } : undefined}>
                        {i === lastResultIndex && !msg.replayed ? <TypingMarkdown text={msg.text} animate={true} onUpdate={scrollToBottom} /> : <MarkdownMessage text={msg.text} />}
                      </div>
                    )
                    return <div key={i} className={cn('min-w-0 overflow-hidden', isRecent && !msg.replayed && 'msg-fade-in')}>{content}</div>
                })}
                {isThinking && <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}><div className="px-1"><ThinkingDots /></div></motion.div>}
                <div ref={chatEndRef} />
              </div>
            </div>
            {/* Claude transcript in split mode */}
            {mainMicListening && transcript ? (
              <div className={cn('shrink-0 border-t px-4 py-1', lightMode ? 'border-black/[0.08]' : 'border-white/[0.06]')}>
                <p className="text-[11px] text-center w-full leading-relaxed line-clamp-2" style={{ color: lightMode ? 'rgb(109, 40, 217)' : 'rgba(196, 181, 253, 0.7)' }}>&ldquo;{transcript}&rdquo;</p>
              </div>
            ) : null}
          </div>

          {/* ── Draggable divider ── */}
          <div
            className={cn('shrink-0 flex items-center justify-center touch-none cursor-row-resize', lightMode ? 'bg-black/[0.04]' : 'bg-white/[0.04]')}
            style={{ height: 10 }}
            onTouchStart={(e) => {
              splitDragRef.current = { startY: e.touches[0].clientY, startRatio: splitRatio, dragging: true }
            }}
            onTouchMove={(e) => {
              if (!splitDragRef.current.dragging) return
              const container = e.currentTarget.parentElement
              if (!container) return
              const containerH = container.clientHeight
              const dy = e.touches[0].clientY - splitDragRef.current.startY
              const newRatio = Math.max(0.2, Math.min(0.8, splitDragRef.current.startRatio + dy / containerH))
              setSplitRatio(newRatio)
            }}
            onTouchEnd={() => { splitDragRef.current.dragging = false }}
          >
            <div className={cn('w-8 h-0.5 rounded-full', lightMode ? 'bg-black/15' : 'bg-white/20')} />
          </div>

          {/* Codex panel (bottom) */}
          <div className="flex flex-col min-h-0 overflow-hidden codex-panel" style={{ flex: `${1 - splitRatio} 1 0%` }}>
            {/* Codex header — matches Claude header style but red */}
            <div className={cn('shrink-0 flex flex-col px-4 py-2', lightMode ? 'bg-white/80' : 'bg-black/40')}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <button onClick={() => { /* TODO: new chat for codex only */ }} className={cn('flex items-center justify-center w-7 h-7 rounded-full active:scale-90 transition-transform', lightMode ? 'bg-black/[0.06]' : 'bg-white/[0.06]')}>
                    <RotateCcw className={cn('w-3 h-3', lightMode ? 'text-black/40' : 'text-white/40')} />
                  </button>
                  <span className={cn('text-[10px]', lightMode ? 'text-black/30' : 'text-white/25')}>{codexMessages.filter(m => m.role === 'user').length} msgs</span>
                </div>
                <div className="flex-1 flex justify-center">
                  <VoiceWaveform isActive={isAudioPlaying && lastResultEngine === 'codex'} getAudioLevel={getAudioLevel} size={120} color="red" />
                </div>
                {/* Spacer to match Claude header's right buttons so waveform stays centered */}
                <div className="flex items-center gap-1.5" style={{ minWidth: 62 }}>
                </div>
              </div>
            </div>
            <div ref={codexScrollRef} className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden no-scrollbar">
              <div className="flex flex-col gap-3 px-4 py-3 w-full overflow-hidden box-border">
                {codexMessages.map((msg, i) => {
                    const isNextTool = codexMessages[i + 1]?.role === 'tool'
                    const isPrevTool = i > 0 && codexMessages[i - 1]?.role === 'tool'
                    const isLastTool = i === codexLastToolIndex
                    const defaultExpanded = isLastTool && !codexHasResultAfterTools
                    const isExpanded = codexExpandedTools.has(i) ? !defaultExpanded : defaultExpanded
                    const isRecent = i >= codexMessages.length - 3
                    if (msg.narration) return null
                    const toolType = msg.role === 'tool' ? msg.text.toLowerCase().startsWith('reading') ? 'read' : msg.text.toLowerCase().startsWith('editing') ? 'edit' : 'other' : 'other'
                    const content = msg.role === 'user' ? (
                      <div className="user-bubble" style={{ background: 'rgb(185, 28, 28)' }}>
                        {msg.images && msg.images.length > 0 && (
                          <div className="flex gap-2 mb-2 flex-wrap justify-end">
                            {msg.images.map((img, j) => img.data ? <img key={j} src={`data:${img.mimeType};base64,${img.data}`} className="w-20 h-20 rounded-lg object-cover border border-white/10" /> : null)}
                          </div>
                        )}
                        <p className="text-[15px] text-white leading-relaxed">{msg.text}</p>
                      </div>
                    ) : msg.role === 'tool' ? (
                      <div className="flex items-stretch gap-2.5 ml-1 mr-1 cursor-pointer" onClick={() => toggleCodexToolExpand(i)}>
                        <div className="flex flex-col items-center w-5 shrink-0">
                          <div className={cn('w-px flex-1 transition-colors', isPrevTool ? 'bg-red-500/15' : 'bg-transparent')} />
                          {isLastTool && codexIsCurrentToolLoading ? <LoaderCircle className="w-4 h-4 text-red-400 animate-spin shrink-0" /> : <div className="w-2 h-2 shrink-0 rounded-full bg-red-500/30" />}
                          <div className={cn('w-px flex-1 transition-colors', isNextTool ? 'bg-red-500/15' : 'bg-transparent')} />
                        </div>
                        <div className="flex-1 flex items-start gap-2.5 py-2.5 px-3.5 rounded-xl min-w-0 overflow-hidden transition-all duration-200" style={toolType === 'read' ? { border: lightMode ? '2px solid rgba(185, 28, 28, 0.4)' : '2px solid rgba(248, 113, 113, 0.4)', background: lightMode ? 'rgba(185, 28, 28, 0.08)' : 'rgba(248, 113, 113, 0.1)' } : toolType === 'edit' ? { border: lightMode ? '2px solid rgba(185, 28, 28, 0.5)' : '2px solid rgba(248, 113, 113, 0.5)', background: lightMode ? 'rgba(185, 28, 28, 0.1)' : 'rgba(248, 113, 113, 0.12)' } : isExpanded ? { border: '1px solid rgba(248, 113, 113, 0.3)', background: 'rgba(248, 113, 113, 0.06)' } : { border: lightMode ? '1px solid rgba(0, 0, 0, 0.12)' : '1px solid rgba(255, 255, 255, 0.08)', background: lightMode ? 'rgba(0, 0, 0, 0.03)' : 'rgba(255, 255, 255, 0.03)' }}>
                          <div className="w-5 h-5 flex items-center justify-center shrink-0 mt-0.5"><ToolIcon text={msg.text} /></div>
                          <ToolContent text={msg.text} expanded={isExpanded} lightMode={lightMode} codexMode />
                        </div>
                      </div>
                    ) : (
                      <div className="px-1 codex-text">
                        {i === codexLastResultIndex && !msg.replayed ? <TypingMarkdown text={msg.text} animate={true} onUpdate={() => codexEndRef.current?.scrollIntoView({ behavior: 'instant' })} /> : <MarkdownMessage text={msg.text} />}
                      </div>
                    )
                    return <div key={i} className={cn('min-w-0 overflow-hidden', isRecent && !msg.replayed && 'msg-fade-in')}>{content}</div>
                })}
                {codexIsThinking && <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}><div className="px-1"><ThinkingDots /></div></motion.div>}
                <div ref={codexEndRef} />
              </div>
            </div>
            {/* Codex transcript */}
            {codexMicListening && transcript ? (
              <div className={cn('shrink-0 border-t px-4 py-1', lightMode ? 'border-red-200/30' : 'border-red-500/10')}>
                <p className="text-[11px] text-center w-full leading-relaxed line-clamp-2" style={{ color: lightMode ? 'rgb(185, 28, 28)' : 'rgba(252, 165, 165, 0.7)' }}>&ldquo;{transcript}&rdquo;</p>
              </div>
            ) : null}
          </div>
        </div>
      ) : (
        /* ── SINGLE VIEW — Claude only (original layout) ── */
        <div
          ref={scrollContainerRef}
          className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden no-scrollbar"
          style={{ overscrollBehavior: 'none' }}
        >
          <div className="flex flex-col gap-3 px-5 py-4 w-full overflow-hidden box-border">
            {claudeMessages.length === 0 ? (
              <div className="flex flex-col items-center justify-center mt-20 gap-4">
                <p className={cn('text-sm', lightMode ? 'text-black/25' : 'text-white/20')}>Tap the mic to start talking</p>
              </div>
            ) : (
              claudeMessages.map((msg, i) => {
                const isNextTool = claudeMessages[i + 1]?.role === 'tool'
                const isPrevTool = i > 0 && claudeMessages[i - 1]?.role === 'tool'
                const isLastTool = i === lastToolIndex
                const defaultExpanded = isLastTool && !hasResultAfterTools
                const isExpanded = expandedTools.has(i) ? !defaultExpanded : defaultExpanded
                const isRecent = i >= claudeMessages.length - 3
                if (msg.narration) return null
                const toolType = msg.role === 'tool' ? msg.text.toLowerCase().startsWith('reading') ? 'read' : msg.text.toLowerCase().startsWith('editing') ? 'edit' : 'other' : 'other'
                const content = msg.role === 'user' ? (
                  <div className="user-bubble">
                    {msg.images && msg.images.length > 0 && (
                      <div className="flex gap-2 mb-2 flex-wrap justify-end">
                        {msg.images.map((img, j) => (
                          img.data ? <img key={j} src={`data:${img.mimeType};base64,${img.data}`} className="w-28 h-28 rounded-lg object-cover border border-white/10" /> : (
                            <div key={j} className="w-28 h-28 rounded-lg bg-white/[0.05] border border-white/10 flex items-center justify-center"><Camera className="w-6 h-6 text-white/20" /></div>
                          )
                        ))}
                      </div>
                    )}
                    <p className="text-[15px] text-white leading-relaxed">{msg.text}</p>
                  </div>
                ) : msg.role === 'tool' ? (
                  <div className="flex items-stretch gap-2.5 ml-1 mr-1 cursor-pointer" onClick={() => toggleToolExpand(i)}>
                    <div className="flex flex-col items-center w-5 shrink-0">
                      <div className={cn('w-px flex-1 transition-colors', isPrevTool ? 'bg-violet-500/15' : 'bg-transparent')} />
                      {isLastTool && isCurrentToolLoading ? <LoaderCircle className="w-4 h-4 text-violet-400 animate-spin shrink-0" /> : <div className="w-2 h-2 shrink-0 rounded-full bg-violet-500/30" />}
                      <div className={cn('w-px flex-1 transition-colors', isNextTool ? 'bg-violet-500/15' : 'bg-transparent')} />
                    </div>
                    <div className="flex-1 flex items-start gap-2.5 py-2.5 px-3.5 rounded-xl min-w-0 overflow-hidden transition-all duration-200" style={toolType === 'read' ? { border: lightMode ? '2px solid rgba(200, 140, 0, 0.6)' : '2px solid rgba(250, 204, 21, 0.5)', background: lightMode ? 'rgba(250, 190, 0, 0.25)' : 'rgba(250, 204, 21, 0.15)' } : toolType === 'edit' ? { border: lightMode ? '2px solid rgba(109, 40, 217, 0.5)' : '2px solid rgba(167, 139, 250, 0.5)', background: lightMode ? 'rgba(109, 40, 217, 0.1)' : 'rgba(139, 92, 246, 0.12)' } : isExpanded ? { border: '1px solid rgba(139, 92, 246, 0.3)', background: 'rgba(139, 92, 246, 0.06)' } : { border: lightMode ? '1px solid rgba(0, 0, 0, 0.12)' : '1px solid rgba(255, 255, 255, 0.08)', background: lightMode ? 'rgba(0, 0, 0, 0.03)' : 'rgba(255, 255, 255, 0.03)' }}>
                      <div className="w-5 h-5 flex items-center justify-center shrink-0 mt-0.5"><ToolIcon text={msg.text} /></div>
                      <ToolContent text={msg.text} expanded={isExpanded} lightMode={lightMode} />
                    </div>
                  </div>
                ) : (
                  <div className="px-1 assistant-text" style={lightMode ? { color: 'rgb(124, 58, 237)' } : undefined}>
                    {i === lastResultIndex && !msg.replayed ? <TypingMarkdown text={msg.text} animate={true} onUpdate={scrollToBottom} /> : <MarkdownMessage text={msg.text} />}
                  </div>
                )
                return <div key={i} className={cn('min-w-0 overflow-hidden', isRecent && !msg.replayed && 'msg-fade-in')}>{content}</div>
              })
            )}
            {isThinking && (
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>
                <div className="px-1"><ThinkingDots /></div>
              </motion.div>
            )}
            <div ref={chatEndRef} />
          </div>
        </div>
      )}

      {/* ── Codex popup panel ── */}
      <AnimatePresence>
        {codexPopup && !splitMode && (
          <motion.div
            initial={{ opacity: 0, y: 30, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 30, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className="absolute z-[45] flex flex-col codex-panel"
            style={{
              bottom: 'calc(5.5rem + env(safe-area-inset-bottom))',
              right: '1rem',
              width: `${codexPopupWidth}px`,
              maxWidth: 'calc(100vw - 2rem)',
              height: `${codexPopupHeight}px`,
              borderRadius: '1rem',
              border: lightMode ? '1px solid rgba(185, 28, 28, 0.2)' : '1px solid rgba(248, 113, 113, 0.15)',
              background: lightMode ? 'rgba(255, 255, 255, 0.95)' : 'rgba(15, 15, 18, 0.92)',
              backdropFilter: 'blur(20px)',
              boxShadow: '0 8px 40px rgba(0, 0, 0, 0.4)',
            }}
          >
            {/* Resize handle — top-left corner, drag to resize height + width */}
            <div
              className="absolute top-0 left-0 z-10 touch-none cursor-nwse-resize flex items-center justify-center"
              style={{ width: 44, height: 44, borderTopLeftRadius: '1rem' }}
              onTouchStart={(e) => {
                popupResizeRef.current = { startY: e.touches[0].clientY, startX: e.touches[0].clientX, startHeight: codexPopupHeight, startWidth: codexPopupWidth, dragging: true }
              }}
              onTouchMove={(e) => {
                if (!popupResizeRef.current.dragging) return
                const dy = popupResizeRef.current.startY - e.touches[0].clientY
                const dx = popupResizeRef.current.startX - e.touches[0].clientX
                const newH = Math.max(200, Math.min(700, popupResizeRef.current.startHeight + dy))
                const newW = Math.max(200, Math.min(window.innerWidth - 32, popupResizeRef.current.startWidth + dx))
                setCodexPopupHeight(newH)
                setCodexPopupWidth(newW)
              }}
              onTouchEnd={() => { popupResizeRef.current.dragging = false }}
            >
              {/* Corner grip lines */}
              <div className="flex flex-col gap-[3px] -rotate-45">
                <div className={cn('w-3 h-[1.5px] rounded-full', lightMode ? 'bg-black/20' : 'bg-white/25')} />
                <div className={cn('w-2 h-[1.5px] rounded-full', lightMode ? 'bg-black/15' : 'bg-white/18')} />
              </div>
            </div>

            {/* Popup header */}
            <div className={cn('shrink-0 flex flex-col border-b rounded-t-[1rem]', lightMode ? 'border-red-200/30' : 'border-red-500/10')} style={{ padding: '14px 18px 10px 18px' }}>
              <div className="flex items-center justify-center relative" style={{ minHeight: 32 }}>
                <VoiceWaveform isActive={isAudioPlaying && lastResultEngine === 'codex'} getAudioLevel={getAudioLevel} size={48} color="red" />
                <button
                  onClick={() => setCodexPopup(false)}
                  style={{ position: 'absolute', right: 0, top: '50%', transform: 'translateY(-50%)' }}
                  className={cn('flex items-center justify-center w-8 h-8 rounded-full active:scale-90 transition-transform shrink-0', lightMode ? 'bg-black/[0.08]' : 'bg-white/[0.08]')}
                >
                  <X className={cn('w-4 h-4', lightMode ? 'text-black/50' : 'text-white/50')} />
                </button>
              </div>
              {workspace && daemonConnected && (
                <div className="flex items-center justify-center gap-1.5 mt-1.5">
                  <Terminal className="w-2.5 h-2.5 text-red-400/60 shrink-0" />
                  <span className={cn('text-[9px] font-medium truncate max-w-[180px]', lightMode ? 'text-black/40' : 'text-white/40')}>
                    {(() => {
                      const p = workspacePath || workspace
                      const parts = p.replace(/\\/g, '/').split('/').filter((s: string) => s && !/^[A-Z]:$/i.test(s))
                      const desktopIdx = parts.findIndex((s: string) => s.toLowerCase() === 'desktop')
                      const meaningful = desktopIdx >= 0 ? parts.slice(desktopIdx) : parts.slice(-3)
                      return meaningful.length > 0 ? meaningful.join(' → ') : workspace
                    })()}
                  </span>
                  <span className={cn('h-1.5 w-1.5 rounded-full ml-1', statusDot)} />
                </div>
              )}
            </div>

            {/* Popup messages */}
            <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden no-scrollbar">
              <div className="flex flex-col gap-2.5 px-3 py-2 w-full overflow-hidden box-border">
                {codexMessages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center flex-1 min-h-[60%] gap-2">
                    <p className={cn('text-xs text-center leading-relaxed', lightMode ? 'text-black/25' : 'text-white/20')}>
                      Tap the red mic to talk to Codex
                    </p>
                  </div>
                ) : (
                  codexMessages.map((msg, i) => {
                    const isNextTool = codexMessages[i + 1]?.role === 'tool'
                    const isPrevTool = i > 0 && codexMessages[i - 1]?.role === 'tool'
                    const isLastTool = i === codexLastToolIndex
                    const defaultExpanded = isLastTool && !codexHasResultAfterTools
                    const isExpanded = codexExpandedTools.has(i) ? !defaultExpanded : defaultExpanded
                    const isRecent = i >= codexMessages.length - 3
                    if (msg.narration) return null
                    const toolType = msg.role === 'tool' ? msg.text.toLowerCase().startsWith('reading') ? 'read' : msg.text.toLowerCase().startsWith('editing') ? 'edit' : 'other' : 'other'
                    const content = msg.role === 'user' ? (
                      <div className="user-bubble" style={{ background: 'rgb(185, 28, 28)' }}>
                        <p className="text-[13px] text-white leading-relaxed">{msg.text}</p>
                      </div>
                    ) : msg.role === 'tool' ? (
                      <div className="flex items-stretch gap-2 ml-0.5 mr-0.5 cursor-pointer" onClick={() => toggleCodexToolExpand(i)}>
                        <div className="flex flex-col items-center w-4 shrink-0">
                          <div className={cn('w-px flex-1 transition-colors', isPrevTool ? 'bg-red-500/15' : 'bg-transparent')} />
                          {isLastTool && codexIsCurrentToolLoading ? <LoaderCircle className="w-3.5 h-3.5 text-red-400 animate-spin shrink-0" /> : <div className="w-1.5 h-1.5 shrink-0 rounded-full bg-red-500/30" />}
                          <div className={cn('w-px flex-1 transition-colors', isNextTool ? 'bg-red-500/15' : 'bg-transparent')} />
                        </div>
                        <div className="flex-1 flex items-start gap-2 py-2 px-3 rounded-xl min-w-0 overflow-hidden transition-all duration-200" style={toolType === 'read' ? { border: lightMode ? '2px solid rgba(185, 28, 28, 0.4)' : '2px solid rgba(248, 113, 113, 0.4)', background: lightMode ? 'rgba(185, 28, 28, 0.08)' : 'rgba(248, 113, 113, 0.1)' } : toolType === 'edit' ? { border: lightMode ? '2px solid rgba(185, 28, 28, 0.5)' : '2px solid rgba(248, 113, 113, 0.5)', background: lightMode ? 'rgba(185, 28, 28, 0.1)' : 'rgba(248, 113, 113, 0.12)' } : isExpanded ? { border: '1px solid rgba(248, 113, 113, 0.3)', background: 'rgba(248, 113, 113, 0.06)' } : { border: lightMode ? '1px solid rgba(0, 0, 0, 0.12)' : '1px solid rgba(255, 255, 255, 0.08)', background: lightMode ? 'rgba(0, 0, 0, 0.03)' : 'rgba(255, 255, 255, 0.03)' }}>
                          <div className="w-4 h-4 flex items-center justify-center shrink-0 mt-0.5"><ToolIcon text={msg.text} /></div>
                          <ToolContent text={msg.text} expanded={isExpanded} lightMode={lightMode} codexMode />
                        </div>
                      </div>
                    ) : (
                      <div className="px-1 codex-text">
                        {i === codexLastResultIndex && !msg.replayed ? <TypingMarkdown text={msg.text} animate={true} onUpdate={() => codexPopupEndRef.current?.scrollIntoView({ behavior: 'instant' })} /> : <MarkdownMessage text={msg.text} />}
                      </div>
                    )
                    return <div key={i} className={cn('min-w-0 overflow-hidden', isRecent && !msg.replayed && 'msg-fade-in')}>{content}</div>
                  })
                )}
                {codexIsThinking && <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}><div className="px-1"><ThinkingDots /></div></motion.div>}
                <div ref={codexPopupEndRef} />
              </div>
            </div>

            {/* Popup transcript when red mic is active */}
            {codexMicListening && transcript ? (
              <div className={cn('shrink-0 border-t px-3 py-1.5 rounded-b-[1rem]', lightMode ? 'border-red-200/30' : 'border-red-500/10')}>
                <p className="text-[11px] text-center w-full leading-relaxed line-clamp-2" style={{ color: lightMode ? 'rgb(185, 28, 28)' : 'rgba(252, 165, 165, 0.7)' }}>&ldquo;{transcript}&rdquo;</p>
              </div>
            ) : null}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Bottom controls ── */}
      <div
        className="shrink-0 relative z-[50] transition-all duration-300"
        style={{ opacity: introReady ? 1 : 0, transitionDelay: '0.2s', background: 'transparent' }}
      >
        {/* Transcript while listening — only show here for Claude mic in single mode */}
        {!splitMode && ((mainMicListening && transcript) || micError) ? (
          <div className="max-h-[3.5rem] flex items-end justify-center px-5 overflow-hidden w-full min-w-0 pb-1">
            {mainMicListening && transcript ? (
              <p className="text-xs text-center w-full min-w-0 leading-relaxed line-clamp-3" style={{ color: lightMode ? 'rgb(109, 40, 217)' : 'rgba(196, 181, 253, 0.7)' }}>&ldquo;{transcript}&rdquo;</p>
            ) : micError ? (
              <p className="text-xs text-red-400 text-center">{micError}</p>
            ) : null}
          </div>
        ) : null}

        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={handleImageSelect}
        />

        {/* Pending image thumbnails + send button */}
        <AnimatePresence>
          {pendingImages.length > 0 && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="flex items-center gap-2 px-4 pb-2 overflow-x-auto no-scrollbar justify-center"
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
              <button
                onClick={() => handleSend()}
                className="flex items-center justify-center w-10 h-10 rounded-full bg-violet-500 shrink-0 active:scale-90 transition-transform ml-1"
              >
                <ArrowUp className="w-4 h-4 text-white" />
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Typing input — shown when keyboard button is tapped */}
        {showTyping && (
          <div className="flex items-center gap-2 px-4 pb-2">
            <input
              ref={typingInputRef}
              type="text"
              placeholder="Type a message..."
              value={pendingMessage}
              onChange={(e) => setPendingMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && pendingMessage.trim()) {
                  handleSend()
                  setShowTyping(false)
                }
              }}
              className={cn(
                'flex-1 rounded-full px-4 py-2.5 text-sm outline-none',
                lightMode
                  ? 'bg-black/[0.06] text-black placeholder:text-black/30'
                  : 'bg-white/[0.08] text-white placeholder:text-white/30'
              )}
              autoFocus
            />
            <button
              onClick={() => {
                if (pendingMessage.trim()) {
                  handleSend()
                }
                setShowTyping(false)
              }}
              className="flex items-center justify-center w-8 h-8 rounded-full shrink-0 active:scale-90 transition-transform bg-violet-500"
            >
              <ArrowUp className="w-3.5 h-3.5 text-white" />
            </button>
          </div>
        )}

        {/* Action row — mic stays dead centre, equal-width sides */}
        <div className="flex items-center px-4" style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}>
          {/* Left side — fixed width to balance right side */}
          <div className="flex items-center justify-start gap-2 flex-1">
            <button
              onClick={() => {
                setShowFiles(true)
                setFileNavPath(null)
                setViewingFile(null)
                requestFiles()
              }}
              className={cn(
                'flex items-center justify-center w-10 h-10 rounded-full shrink-0 active:scale-90 transition-all',
                showFiles ? 'bg-violet-500/30' : 'bg-white/[0.06]'
              )}
            >
              <FolderOpen className={cn('w-4 h-4', showFiles ? 'text-violet-400' : 'text-white/40')} />
            </button>
          </div>

          {/* Centre — dual mics always visible, stop button overlaid when processing */}
          <div className="relative flex items-center gap-3">
            <MicOrb
              isListening={mainMicListening}
              onClick={handleMicClick}
              disabled={!supported}
            />
            {/* Stop button between mics when processing */}
            <AnimatePresence>
              {showStop && (
                <motion.button
                  key="stop"
                  initial={{ scale: 0, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0, opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  onClick={handleStop}
                  className="flex items-center justify-center w-10 h-10 rounded-full bg-red-500/80 shrink-0 active:scale-90 transition-transform"
                >
                  <Square className="w-4 h-4 text-white fill-white" />
                </motion.button>
              )}
            </AnimatePresence>
            <MicOrb
              isListening={codexMicListening}
              onClick={handleCodexMicClick}
              disabled={!supported}
              codexMode={true}
            />
          </div>

          {/* Right side — camera + CX + split + keyboard, always visible */}
          <div className="flex items-center justify-end gap-2 flex-1">
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center justify-center w-10 h-10 rounded-full bg-white/[0.06] shrink-0 active:scale-90 transition-transform"
            >
              <Camera className="w-4 h-4 text-white/40" />
            </button>
            <button
              onClick={() => {
                if (splitMode || codexPopup) {
                  setSplitMode(false)
                  setCodexPopup(false)
                } else {
                  setCodexPopup(true)
                }
              }}
              className={cn(
                'flex items-center justify-center w-10 h-10 rounded-full shrink-0 active:scale-90 transition-all',
                (codexPopup || splitMode) ? 'bg-red-500/30' : 'bg-white/[0.06]'
              )}
            >
              {(codexPopup || splitMode) ? (
                <X className="w-4 h-4 text-red-400" />
              ) : (
                <span className="text-[11px] font-bold text-white/40">CX</span>
              )}
            </button>
            <button
              onClick={() => {
                if (splitMode) {
                  setSplitMode(false)
                } else {
                  setCodexPopup(false)
                  setSplitMode(true)
                }
              }}
              className={cn(
                'flex items-center justify-center w-10 h-10 rounded-full shrink-0 active:scale-90 transition-all',
                splitMode ? 'bg-red-500/30' : 'bg-white/[0.06]'
              )}
            >
              {splitMode ? (
                <X className="w-4 h-4 text-red-400" />
              ) : (
                <Columns2 className="w-4 h-4 text-white/40" />
              )}
            </button>
            <button
              onClick={() => {
                setShowTyping(prev => !prev)
                setTimeout(() => typingInputRef.current?.focus(), 100)
              }}
              className={cn(
                'flex items-center justify-center w-10 h-10 rounded-full shrink-0 active:scale-90 transition-all',
                showTyping ? 'bg-violet-500/30' : 'bg-white/[0.06]'
              )}
            >
              <Keyboard className={cn('w-4 h-4', showTyping ? 'text-violet-400' : 'text-white/40')} />
            </button>
          </div>
        </div>
      </div>

    </div>
  )
}
