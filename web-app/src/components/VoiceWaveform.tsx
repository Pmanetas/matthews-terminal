import { useEffect, useRef } from 'react'

interface VoiceWaveformProps {
  /** Only animate when audio is actually playing */
  isActive?: boolean
  size?: number
  getAudioLevel?: () => number
  /** 'violet' (default) or 'red' for Codex */
  color?: 'violet' | 'red'
}

const BAR_COUNT = 100
const BAR_WIDTH = 1
const BAR_GAP = 1
const MIN_HEIGHT = 1
const MAX_HEIGHT_RATIO = 0.9

export function VoiceWaveform({ isActive = false, size = 200, getAudioLevel, color = 'violet' }: VoiceWaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rafRef = useRef(0)
  const barsRef = useRef<number[]>(Array(BAR_COUNT).fill(MIN_HEIGHT))
  const getAudioLevelRef = useRef(getAudioLevel)
  getAudioLevelRef.current = getAudioLevel

  const canvasW = size
  const canvasH = Math.round(size * 0.3)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')!
    const dpr = window.devicePixelRatio || 1
    canvas.width = canvasW * dpr
    canvas.height = canvasH * dpr
    ctx.scale(dpr, dpr)

    const maxBarH = canvasH * MAX_HEIGHT_RATIO
    let time = 0

    const tick = () => {
      time += 0.06
      ctx.clearRect(0, 0, canvasW, canvasH)

      const audioLevel = getAudioLevelRef.current?.() ?? 0
      const bars = barsRef.current
      const totalWidth = BAR_COUNT * BAR_WIDTH + (BAR_COUNT - 1) * BAR_GAP
      const startX = (canvasW - totalWidth) / 2
      const centerY = canvasH / 2

      for (let i = 0; i < BAR_COUNT; i++) {
        let targetHeight: number

        if (isActive && audioLevel > 0.02) {
          // Bell curve — tall in centre, short at edges
          const centre = (BAR_COUNT - 1) / 2
          const dist = Math.abs(i - centre) / centre // 0 at centre, 1 at edges
          const bellCurve = Math.exp(-dist * dist * 3) // gaussian falloff
          const phase = time * 3 + i * 0.15
          const variation = 0.4 + 0.6 * Math.sin(phase)
          const wave2 = 0.5 + 0.5 * Math.sin(time * 1.7 + i * 0.08)
          targetHeight = MIN_HEIGHT + (maxBarH - MIN_HEIGHT) * audioLevel * bellCurve * (0.2 + 0.5 * variation + 0.3 * wave2)
        } else if (isActive) {
          // Active but quiet — gentle idle breathing
          const centre = (BAR_COUNT - 1) / 2
          const dist = Math.abs(i - centre) / centre
          const bellCurve = Math.exp(-dist * dist * 4)
          const idle = 0.5 + 0.5 * Math.sin(time * 1.5 + i * 0.1)
          targetHeight = MIN_HEIGHT + maxBarH * 0.05 * bellCurve * idle
        } else {
          targetHeight = MIN_HEIGHT
        }

        // Smooth lerp
        const lerpSpeed = targetHeight > bars[i] ? 0.3 : 0.08
        bars[i] += (targetHeight - bars[i]) * lerpSpeed

        const x = startX + i * (BAR_WIDTH + BAR_GAP)
        const h = Math.max(MIN_HEIGHT, bars[i])

        // Gradient with glow — violet for Claude, red for Codex
        const intensity = Math.min(1, h / (maxBarH * 0.4))
        const alpha = MIN_HEIGHT + 0.1 < h ? 0.3 + 0.6 * intensity : 0.1
        const gradient = ctx.createLinearGradient(x, centerY - h / 2, x, centerY + h / 2)
        if (color === 'red') {
          gradient.addColorStop(0, `rgba(252, 165, 165, ${alpha * 0.6})`)
          gradient.addColorStop(0.5, `rgba(239, 68, 68, ${alpha})`)
          gradient.addColorStop(1, `rgba(252, 165, 165, ${alpha * 0.6})`)
        } else {
          gradient.addColorStop(0, `rgba(167, 139, 250, ${alpha * 0.6})`)
          gradient.addColorStop(0.5, `rgba(139, 92, 246, ${alpha})`)
          gradient.addColorStop(1, `rgba(167, 139, 250, ${alpha * 0.6})`)
        }

        ctx.fillStyle = gradient
        ctx.beginPath()
        ctx.roundRect(x, centerY - h / 2, BAR_WIDTH, h, BAR_WIDTH / 2)
        ctx.fill()
      }

      rafRef.current = requestAnimationFrame(tick)
    }

    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [isActive, canvasW, canvasH, color])

  return (
    <div className="flex items-center justify-center" style={{ width: canvasW, height: canvasH }}>
      <canvas
        ref={canvasRef}
        style={{ width: canvasW, height: canvasH }}
      />
    </div>
  )
}
