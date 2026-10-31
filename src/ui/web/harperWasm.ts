import { binary } from 'harper.js/binary';

/** Harper's wasm file, which Vite emits under the site's base path (harper.js/binary loads it as a separate asset). */
export const harperWasmUrl = (): string => (typeof binary.url === 'string' ? binary.url : binary.url.href);
