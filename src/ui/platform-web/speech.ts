// A stub until the web adapters land (web plan, Task 2+): same exports as src/ui/platform/speech.ts.
const notYet = (): never => {
  throw new Error('not available on the web yet');
};

export function loadLocalVoices(): Promise<SpeechSynthesisVoice[]> {
  return notYet();
}

export function onVoicesChanged(_changed: (voices: SpeechSynthesisVoice[]) => void): () => void {
  return notYet();
}

export function speak(_text: string, _voice: SpeechSynthesisVoice, _options: { rate: number; pitch: number }, _onEnd?: () => void): boolean {
  return notYet();
}

export function stopSpeaking(): void {
  notYet();
}

export function pauseSpeaking(): void {
  notYet();
}

export function resumeSpeaking(): void {
  notYet();
}

export function isSpeaking(): boolean {
  return notYet();
}
