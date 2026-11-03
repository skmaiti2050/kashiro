import { binary } from 'harper.js/binary';
import { createLinter } from '@/engine/linter';
import { serveLinter } from './serveLinter';

// Harper lives in a Worker so a panicked Harper can be replaced by a fresh one (#19) and its work stays off the
// page's thread (#13). workerLinter.ts is the page side.
const handle = serveLinter((variant, words) => createLinter(variant, words, { binary }));

self.onmessage = async (event: MessageEvent) => {
  self.postMessage(await handle(event.data));
};
