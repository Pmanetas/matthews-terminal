import { useCallback, useRef, useState } from 'react'

interface SpeechRecognitionEvent {
  results: SpeechRecognitionResultList
  resultIndex: number
}

interface SpeechRecognitionInstance extends EventTarget {
  continuous: boolean
  interimResults: boolean
  lang: string
  start(): void
  stop(): void
  abort(): void
  onresult: ((event: SpeechRecognitionEvent) => void) | null
  onend: (() => void) | null
  onerror: ((event: { error: string }) => void) | null
}

declare global {
  interface Window {
    SpeechRecognition: new () => SpeechRecognitionInstance
    webkitSpeechRecognition: new () => SpeechRecognitionInstance
  }
}

function getSpeechRecognitionConstructor(): (new () => SpeechRecognitionInstance) | null {
  if (typeof window === 'undefined') return null
  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null
}

export function useVoice() {
  const [isListening, setIsListening] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [ttsEnabled, setTtsEnabled] = useState(false)
  const [supported, setSupported] = useState(!!getSpeechRecognitionConstructor())
  const [micError, setMicError] = useState('')

  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null)

  const startListening = useCallback(() => {
    const SpeechRecognition = getSpeechRecognitionConstructor()
    if (!SpeechRecognition) {
      setSupported(false)
      return
    }

    // Detach old handlers before abort to prevent stale onend
    if (recognitionRef.current) {
      recognitionRef.current.onend = null
      recognitionRef.current.onerror = null
      recognitionRef.current.onresult = null
      recognitionRef.current.abort()
      recognitionRef.current = null
    }

    const recognition = new SpeechRecognition()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = 'en-US'
    recognitionRef.current = recognition

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let allFinal = ''
      let currentInterim = ''

      // Accumulate ALL results including across pauses
      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i]
        if (result.isFinal) {
          allFinal += result[0].transcript
        } else {
          currentInterim += result[0].transcript
        }
      }

      setTranscript(allFinal + currentInterim)
    }

    recognition.onend = () => {
      if (recognitionRef.current === recognition) {
        setIsListening(false)
        recognitionRef.current = null
      }
    }

    recognition.onerror = (event: { error: string }) => {
      console.error('[Voice] Speech recognition error:', event.error)
      if (recognitionRef.current === recognition) {
        if (event.error === 'no-speech' || event.error === 'aborted') {
          // Not a real error — just no speech detected or we aborted
          return
        }
        setMicError(event.error === 'network'
          ? 'Speech service unavailable — use your phone instead'
          : event.error)
        setIsListening(false)
        recognitionRef.current = null
      }
    }

    setMicError('')
    setTranscript('')
    setIsListening(true)

    try {
      recognition.start()
    } catch (err) {
      console.error('[Voice] Failed to start recognition, retrying:', err)
      // iOS can throw if called too fast — retry once after a short delay
      setTimeout(() => {
        try {
          recognition.start()
        } catch (retryErr) {
          console.error('[Voice] Retry failed:', retryErr)
          setIsListening(false)
          recognitionRef.current = null
        }
      }, 200)
    }
  }, [])

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.onend = null
      recognitionRef.current.onerror = null
      recognitionRef.current.stop()
      recognitionRef.current = null
    }
    setIsListening(false)
  }, [])

  const speak = useCallback((text: string) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return
    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(text)
    window.speechSynthesis.speak(utterance)
  }, [])

  return {
    isListening,
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
