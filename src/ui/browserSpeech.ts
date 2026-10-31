import { localVoices } from './state/readAloud';

// Read aloud through the Web Speech API: the same in the desktop webview and the browser, so both platform
// modules (src/ui/platform/speech.ts and src/ui/platform-web/speech.ts) re-export this file.

/** Chromium fills the voice list after start-up; wait this long for it before deciding there is none. */
const VOICES_WAIT_MS = 1500;

const synth = (): SpeechSynthesis | null => (typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null);

/** The voices on this device (never a network voice); an empty list hides read aloud. */
export function loadLocalVoices(): Promise<SpeechSynthesisVoice[]> {
  const speech = synth();
  if (!speech) return Promise.resolve([]);
  const now = localVoices(speech.getVoices());
  if (now.length > 0) return Promise.resolve(now);
  return new Promise((resolve) => {
    const done = () => {
      speech.removeEventListener('voiceschanged', done);
      clearTimeout(timer);
      resolve(localVoices(speech.getVoices()));
    };
    const timer = setTimeout(done, VOICES_WAIT_MS);
    speech.addEventListener('voiceschanged', done);
  });
}

/**
 * Calls `changed` with the local voices each time the system's voice list changes: a voice can arrive
 * well after start-up (installed, or filled in late). Returns the unsubscribe.
 */
export function onVoicesChanged(changed: (voices: SpeechSynthesisVoice[]) => void): () => void {
  const speech = synth();
  if (!speech) return () => {};
  const listener = () => changed(localVoices(speech.getVoices()));
  speech.addEventListener('voiceschanged', listener);
  return () => speech.removeEventListener('voiceschanged', listener);
}

/**
 * Speaks `text` with `voice`, stopping whatever was being read. A voice that is not local is refused here
 * too, so the text can never go to an online voice, whatever the caller passed.
 */
export function speak(text: string, voice: SpeechSynthesisVoice, options: { rate: number; pitch: number }, onEnd: () => void = () => {}): boolean {
  const speech = synth();
  if (!speech || voice.localService !== true || text.trim() === '') return false;
  stopSpeaking();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.voice = voice;
  utterance.lang = voice.lang;
  utterance.rate = options.rate;
  utterance.pitch = options.pitch;
  utterance.onend = onEnd;
  utterance.onerror = onEnd;
  speech.speak(utterance);
  return true;
}

/** Stops the reading. Chromium keeps a paused synthesizer paused after cancel, which would silence the next reading. */
export function stopSpeaking(): void {
  const speech = synth();
  if (!speech) return;
  speech.cancel();
  if (speech.paused) speech.resume();
}

export function pauseSpeaking(): void {
  synth()?.pause();
}

export function resumeSpeaking(): void {
  synth()?.resume();
}

export function isSpeaking(): boolean {
  return synth()?.speaking ?? false;
}
