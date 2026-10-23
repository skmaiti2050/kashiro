import { expect } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { Shell } from '@/ui/App';
import type { SessionController } from '@/ui/state/sessionController';

/** Renders the app shell around `controller` (mock the platform modules first: see platformMocks.ts). */
export function renderShell(controller: SessionController) {
  return render(<Shell controller={controller} />);
}

/** Opens `open` (e.g. () => controller.openSample()) and waits for its check to finish. */
export async function openAndWait(controller: SessionController, open: () => Promise<void>) {
  await act(open);
  await waitFor(() => expect(controller.getState().phase).toBe('ready'), { timeout: 10000 });
}

export const reviewPanel = () => screen.getByRole('complementary', { name: 'Review' });

interface FakeVoice {
  voiceURI: string;
  name: string;
  lang: string;
  localService: boolean;
  default: boolean;
}

export const LOCAL_VOICE: FakeVoice = { voiceURI: 'David', name: 'Microsoft David - English (United States)', lang: 'en-US', localService: true, default: false };
export const ONLINE_VOICE: FakeVoice = { voiceURI: 'Aria', name: 'Microsoft Aria Online (Natural)', lang: 'en-US', localService: false, default: true };

/**
 * A fake Web Speech API with `voices`; `spoken` records every utterance and `synth.cancelled` counts the
 * stops. `changeVoices` replaces the list and fires `voiceschanged`. Remove it with the returned function.
 */
export function installSpeech(voices: FakeVoice[]) {
  const spoken: { text: string; voice: FakeVoice | null; rate: number; pitch: number }[] = [];
  const listeners = new Set<() => void>();
  class Utterance {
    voice: FakeVoice | null = null;
    lang = '';
    rate = 1;
    pitch = 1;
    onend: (() => void) | null = null;
    constructor(readonly text: string) {}
  }
  let current: Utterance | null = null;
  const synth = {
    speaking: false,
    paused: false,
    cancelled: 0,
    getVoices: () => voices,
    speak: (u: Utterance) => {
      spoken.push({ text: u.text, voice: u.voice, rate: u.rate, pitch: u.pitch });
      current = u;
      synth.speaking = true;
    },
    // Like Chromium: cancel ends the utterance (onend fires) but leaves a paused synthesizer paused.
    cancel: () => {
      synth.cancelled++;
      synth.speaking = false;
      const ending = current;
      current = null;
      ending?.onend?.();
    },
    pause: () => {
      if (synth.speaking) synth.paused = true;
    },
    resume: () => {
      synth.paused = false;
    },
    /** The voice reaches the end of the text. */
    finish: () => {
      synth.speaking = false;
      const ending = current;
      current = null;
      ending?.onend?.();
    },
    addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
  };
  const changeVoices = (next: FakeVoice[]) => {
    voices = next;
    for (const listener of [...listeners]) listener();
  };
  Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
  Object.defineProperty(globalThis, 'SpeechSynthesisUtterance', { value: Utterance, configurable: true });
  const remove = () => {
    delete (window as { speechSynthesis?: unknown }).speechSynthesis;
    delete (globalThis as { SpeechSynthesisUtterance?: unknown }).SpeechSynthesisUtterance;
  };
  return { spoken, synth, changeVoices, remove };
}
