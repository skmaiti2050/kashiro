import { localVoices } from '../state/readAloud';

/** Chromium fills the voice list after start-up; wait this long for it before deciding there is none. */
const VOICES_WAIT_MS = 1500;

const synth = (): SpeechSynthesis | null => (typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null);

/** The voices on this PC (never a network voice); an empty list hides read aloud. */
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
 * Speaks `text` with `voice`, stopping whatever was being read. A voice that is not local is refused here
 * too, so the text can never go to an online voice, whatever the caller passed.
 */
export function speak(text: string, voice: SpeechSynthesisVoice, options: { rate: number; pitch: number }): void {
  const speech = synth();
  if (!speech || voice.localService !== true || text.trim() === '') return;
  speech.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.voice = voice;
  utterance.lang = voice.lang;
  utterance.rate = options.rate;
  utterance.pitch = options.pitch;
  speech.speak(utterance);
}

export function stopSpeaking(): void {
  synth()?.cancel();
}

export function isSpeaking(): boolean {
  return synth()?.speaking ?? false;
}
