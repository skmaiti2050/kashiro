// @vitest-environment jsdom
// Web Task 4: the project's GitHub pages open in a new tab, without giving that tab a handle on Kashiro's page.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openProjectPage } from '@/ui/platform-web/links';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('opening the project pages', () => {
  it('Releases', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    await openProjectPage('releases');
    expect(open).toHaveBeenCalledWith('https://github.com/skmaiti2050/kashiro/releases', '_blank', 'noopener');
  });

  it('a new bug report', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    await openProjectPage('issues');
    expect(open).toHaveBeenCalledWith('https://github.com/skmaiti2050/kashiro/issues/new?template=bug.yml', '_blank', 'noopener');
  });
});
