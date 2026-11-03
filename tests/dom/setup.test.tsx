import { it, expect } from 'vitest';
import { getConfig } from '@testing-library/react';

it('waits up to 5 s for elements that load on demand (#32: lazily imported dialogs under full-suite load)', () => {
  expect(getConfig().asyncUtilTimeout).toBe(5000);
});
