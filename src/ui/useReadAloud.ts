import { useEffect, useRef, useState } from 'react';
import { isSpeaking, loadLocalVoices, onVoicesChanged, pauseSpeaking, resumeSpeaking, speak, stopSpeaking } from './platform/speech';
import { voiceFor } from './state/readAloud';
import type { ReadingSettings } from './state/readingSettings';

/** What read aloud is doing: the bar shows Pause/Resume and Stop while it is not idle. */
export type ReadAloudStatus = 'idle' | 'reading' | 'paused';

/** Read aloud, when this PC has a voice that works offline. */
export interface ReadAloud {
  /** The local voices, for Settings. */
  voices: SpeechSynthesisVoice[];
  /**
   * Reads `text` (in `language`, English by default) with the chosen rate and pitch and a local voice for
   * that language (see voiceFor), stopping what was being read. Nothing is read without such a voice.
   */
  read(text: string, language?: string): void;
  /** True when a local voice can read text in `language` ("hi"). */
  speaks(language: string): boolean;
  status: ReadAloudStatus;
  /** Pause while reading, resume while paused (Alt+K). */
  pauseOrResume(): void;
  /** Alt+X, Escape, another document. */
  stop(): void;
}

/**
 * Read aloud with the local Windows voices (Web Speech API). Null while there is no local voice, which
 * hides the feature: a network voice would send the text away. Escape stops the reading, and so does
 * opening or closing a document (`documentId` changes).
 */
export function useReadAloud(reading: ReadingSettings, documentId: number | null): ReadAloud | null {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [status, setStatus] = useState<ReadAloudStatus>('idle');
  /** The current reading's number: the end of a reading that was replaced must not mark the new one idle. */
  const readings = useRef(0);

  const stop = () => {
    readings.current++;
    stopSpeaking();
    setStatus('idle');
  };

  useEffect(() => {
    let mounted = true;
    void loadLocalVoices().then((found) => {
      if (mounted && found.length > 0) setVoices(found);
    });
    // No new state while there is still no voice: an empty list for an empty list would only re-render.
    const stopListening = onVoicesChanged((found) => setVoices((current) => (current.length === 0 && found.length === 0 ? current : found)));
    return () => {
      mounted = false;
      stopListening();
      stopSpeaking();
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Not prevented: the same Escape still closes a menu or dialog.
      if (e.key === 'Escape' && isSpeaking()) stop();
    };
    // Capture: a dialog or menu stops its Escape from bubbling, and that Escape must still stop the reading.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  // Another document (or none): what was being read belongs to the old one.
  useEffect(() => stop, [documentId]);

  if (voices.length === 0) return null;
  return {
    voices,
    read(text, language = 'en') {
      const voice = voiceFor(voices, language, reading.voice);
      if (!voice) return;
      const id = ++readings.current;
      const ended = () => {
        if (readings.current === id) setStatus('idle');
      };
      if (speak(text, voice, reading, ended) && readings.current === id) setStatus('reading');
    },
    speaks: (language) => voiceFor(voices, language, reading.voice) !== null,
    status,
    pauseOrResume() {
      if (status === 'reading') {
        pauseSpeaking();
        setStatus('paused');
      } else if (status === 'paused') {
        resumeSpeaking();
        setStatus('reading');
      }
    },
    stop,
  };
}
