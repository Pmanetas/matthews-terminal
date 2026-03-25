import { useCallback, useRef, useState } from 'react'

export function useVoice() {
  const [isListening, setIsListening] = useState(false)
  const [isTranscribing, setIsTranscribing] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [ttsEnabled, setTtsEnabled] = useState(false)
  const [supported, setSupported] = useState(true)
  const [micError, setMicError] = useState('')

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)

  const startListening = useCallback(() => {
    // Reset state
    setTranscript('')
    setMicError('')
    setIsListening(true)

    navigator.mediaDevices.getUserMedia({ audio: true })
      .then((stream) => {
        streamRef.current = stream

        // Pick a supported mime type
        const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : MediaRecorder.isTypeSupported('audio/webm')
            ? 'audio/webm'
            : 'audio/mp4'

        const recorder = new MediaRecorder(stream, { mimeType })
        mediaRecorderRef.current = recorder
        chunksRef.current = []

        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) chunksRef.current.push(e.data)
        }

        recorder.onstop = async () => {
          // Release mic immediately
          stream.getTracks().forEach((t) => t.stop())
          streamRef.current = null

          if (chunksRef.current.length === 0) return

          const blob = new Blob(chunksRef.current, { type: mimeType })
          setIsTranscribing(true)

          try {
            const res = await fetch('/transcribe', {
              method: 'POST',
              headers: { 'Content-Type': mimeType },
              body: blob,
            })

            if (res.ok) {
              const data = await res.json()
              const text = (data.text || '').trim()
              setTranscript(text)
            } else {
              const err = await res.json().catch(() => ({ error: 'Unknown error' }))
              setMicError(err.error || 'Transcription failed')
            }
          } catch {
            setMicError('Could not reach transcription service')
          } finally {
            setIsTranscribing(false)
          }
        }

        // Record in 1-second chunks for reliability
        recorder.start(1000)
      })
      .catch((err) => {
        console.error('[Voice] getUserMedia error:', err)
        setMicError('Microphone access denied')
        setIsListening(false)
        setSupported(false)
      })
  }, [])

  const stopListening = useCallback(() => {
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop()
    }
    mediaRecorderRef.current = null
    setIsListening(false)
  }, [])

  const speak = useCallback((text: string) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return
    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.rate = 1.0
    utterance.pitch = 1.0
    utterance.volume = 1.0
    window.speechSynthesis.speak(utterance)
  }, [])

  return {
    isListening,
    isTranscribing,
    transcript,
    ttsEnabled,
    setTtsEnabled,
    startListening,
    stopListening,
    speak,
    supported,
    micError,
  }
}
