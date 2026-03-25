import { useCallback, useEffect, useRef, useState } from 'react'

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
  const [supported, setSupported] = useState(true)
  const [micError, setMicError] = useState('')
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null)
  const retryCountRef = useRef(0)
  const MAX_RETRIES = 3

  useEffect(() => {
    if (!getSpeechRecognitionConstructor()) {
      setSupported(false)
    }
  }, [])

  const startListening = useCallback((isRetry = false) => {
    const SpeechRecognition = getSpeechRecognitionConstructor()
    if (!SpeechRecognition) return

    if (!isRetry) retryCountRef.current = 0

    // Stop any existing session — detach handlers first so old onend doesn't interfere
    if (recognitionRef.current) {
      recognitionRef.current.onend = null
      recognitionRef.current.onerror = null
      recognitionRef.current.onresult = null
      recognitionRef.current.abort()
      recognitionRef.current = null
    }

    const recognition = new SpeechRecognition()
    recognition.continuous = true // keep listening until user stops
    recognition.interimResults = true
    recognition.lang = 'en-US'
    recognitionRef.current = recognition

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let allFinal = ''
      let currentInterim = ''

      // Accumulate ALL results (including previous pauses)
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
      // Only update state if this is still the active recognition
      if (recognitionRef.current === recognition) {
        setIsListening(false)
        recognitionRef.current = null
      }
    }

    recognition.onerror = (event: { error: string }) => {
      console.error('[Voice] Speech recognition error:', event.error)
      if (recognitionRef.current === recognition) {
        // Auto-retry on network errors (Chrome uses Google's servers)
        if (event.error === 'network' && retryCountRef.current < MAX_RETRIES) {
          retryCountRef.current++
          setMicError(`Connecting... (attempt ${retryCountRef.current + 1})`)
          recognitionRef.current = null
          setTimeout(() => startListening(true), 500)
          return
        }
        setMicError(event.error === 'network' ? 'Speech service unavailable — try your phone instead' : event.error)
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
      console.error('[Voice] Failed to start recognition:', err)
      setIsListening(false)
    }
  }, [])

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop()
      recognitionRef.current = null
    }
    setIsListening(false)
  }, [])

  const speak = useCallback((text: string) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return

    // Cancel any ongoing speech
    window.speechSynthesis.cancel()

    const utterance = new SpeechSynthesisUtterance(text)
    utterance.rate = 1.0
    utterance.pitch = 1.0
    utterance.volume = 1.0
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
