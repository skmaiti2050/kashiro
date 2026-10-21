import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// React's act() warnings are only silenced when it knows it runs under a test environment.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom has no layout: CodeMirror measures text with these, so give it empty boxes.
const emptyRects = () => Object.assign([], { item: () => null }) as unknown as DOMRectList;
const emptyRect = () => new DOMRect(0, 0, 0, 0);
Range.prototype.getClientRects ??= emptyRects;
Range.prototype.getBoundingClientRect ??= emptyRect;
Element.prototype.scrollIntoView ??= () => {};

afterEach(() => cleanup());
