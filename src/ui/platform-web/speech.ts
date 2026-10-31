// Read aloud in the browser: the desktop's code (src/ui/browserSpeech.ts), which lists and speaks with on-device
// voices only (localService true). Chrome's "Google …" voices would send the text to Google (web design).
export { isSpeaking, loadLocalVoices, onVoicesChanged, pauseSpeaking, resumeSpeaking, speak, stopSpeaking } from '../browserSpeech';
