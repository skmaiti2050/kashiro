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

/** A fake Web Speech API with `voices`; `spoken` records every utterance. Remove it with the returned function. */
export function installSpeech(voices: FakeVoice[]) {
  const spoken: { text: string; voice: FakeVoice | null; rate: number; pitch: number }[] = [];
  class Utterance {
    voice: FakeVoice | null = null;
    lang = '';
    rate = 1;
    pitch = 1;
    constructor(readonly text: string) {}
  }
  const synth = {
    speaking: false,
    getVoices: () => voices,
    speak: (u: Utterance) => spoken.push({ text: u.text, voice: u.voice, rate: u.rate, pitch: u.pitch }),
    cancel: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
  Object.defineProperty(globalThis, 'SpeechSynthesisUtterance', { value: Utterance, configurable: true });
  const remove = () => {
    delete (window as { speechSynthesis?: unknown }).speechSynthesis;
    delete (globalThis as { SpeechSynthesisUtterance?: unknown }).SpeechSynthesisUtterance;
  };
  return { spoken, remove };
}
