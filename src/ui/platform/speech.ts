// Read aloud: WebView2's Web Speech API with the PC's own voices. The browser does the same (web Task 4), so the
// code lives in src/ui/browserSpeech.ts for both platforms.
export { isSpeaking, loadLocalVoices, onVoicesChanged, pauseSpeaking, resumeSpeaking, speak, stopSpeaking } from '../browserSpeech';
