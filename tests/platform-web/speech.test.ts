// @vitest-environment jsdom
// Web Task 4: read aloud in the browser uses on-device voices only (web design: "Read-aloud"). Chrome's "Google …"
// voices are network voices (localService false) that send the text to Google, so they are never listed or used.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadLocalVoices, onVoicesChanged, speak } from '@/ui/platform-web/speech';

interface FakeVoice {
  voiceURI: string;
  name: string;
  lang: string;
  localService: boolean;
  default: boolean;
}

const NETWORK_HINDI: FakeVoice = { voiceURI: 'Google हिन्दी', name: 'Google हिन्दी', lang: 'hi-IN', localService: false, default: false };
const LOCAL_HINDI: FakeVoice = { voiceURI: 'Kalpana', name: 'Microsoft Kalpana - Hindi (India)', lang: 'hi-IN', localService: true, default: false };

/** A browser speech engine holding `voices`; `changeVoices` swaps them and fires voiceschanged. */
function installSpeech(voices: FakeVoice[]) {
  const listeners = new Set<() => void>();
  const spoken: string[] = [];
  const synth = {
    speaking: false,
    paused: false,
    getVoices: () => voices,
    speak: (utterance: { text: string }) => void spoken.push(utterance.text),
    cancel: () => {},
    pause: () => {},
    resume: () => {},
    addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
  };
  Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
  Object.defineProperty(globalThis, 'SpeechSynthesisUtterance', { value: class { constructor(readonly text: string) {} }, configurable: true });
  const changeVoices = (next: FakeVoice[]) => {
    voices = next;
    listeners.forEach((listener) => listener());
  };
  return { spoken, changeVoices };
}

const asVoice = (voice: FakeVoice) => voice as unknown as SpeechSynthesisVoice;

afterEach(() => {
  vi.useRealTimers();
  delete (window as { speechSynthesis?: unknown }).speechSynthesis;
});

describe('voices in the browser', () => {
  it('lists only the on-device voice, not "Google हिन्दी"', async () => {
    installSpeech([NETWORK_HINDI, LOCAL_HINDI]);
    expect((await loadLocalVoices()).map((v) => v.name)).toEqual([LOCAL_HINDI.name]);
  });

  it('with only network voices, resolves no voices once the browser has had time to fill its list', async () => {
    vi.useFakeTimers();
    installSpeech([NETWORK_HINDI]);
    const voices = loadLocalVoices();
    await vi.advanceTimersByTimeAsync(1500);
    expect(await voices).toEqual([]);
  });

  it('a changed voice list reports only the on-device voices', () => {
    const { changeVoices } = installSpeech([]);
    const reported: string[][] = [];
    const stop = onVoicesChanged((voices) => reported.push(voices.map((v) => v.name)));
    changeVoices([NETWORK_HINDI, LOCAL_HINDI]);
    stop();
    expect(reported).toEqual([[LOCAL_HINDI.name]]);
  });

  it('never speaks with a network voice', () => {
    const { spoken } = installSpeech([NETWORK_HINDI]);
    expect(speak('नमस्ते', asVoice(NETWORK_HINDI), { rate: 1, pitch: 1 })).toBe(false);
    expect(spoken).toEqual([]);
  });
});
