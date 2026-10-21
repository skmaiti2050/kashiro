import { useEffect, useState } from 'react';
import { isSpeaking, loadLocalVoices, onVoicesChanged, speak, stopSpeaking } from './platform/speech';
import { pickVoice } from './state/readAloud';
import type { ReadingSettings } from './state/readingSettings';

/** Read aloud, when this PC has a voice that works offline. */
export interface ReadAloud {
  /** The local voices, for Settings. */
  voices: SpeechSynthesisVoice[];
  /** Reads `text` with the chosen voice, rate and pitch, stopping what was being read. */
  read(text: string): void;
}

/**
 * Read aloud with the local Windows voices (Web Speech API). Null while there is no local voice, which
 * hides the feature: a network voice would send the text away. Escape stops the reading.
 */
export function useReadAloud(reading: ReadingSettings): ReadAloud | null {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);

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
      if (e.key === 'Escape' && isSpeaking()) stopSpeaking();
    };
    // Capture: a dialog or menu stops its Escape from bubbling, and that Escape must still stop the reading.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  if (voices.length === 0) return null;
  return {
    voices,
    read(text) {
      const voice = pickVoice(voices, reading.voice);
      if (voice) speak(text, voice, reading);
    },
  };
}
