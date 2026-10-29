// Report a bug (F22 item 4): a non-private diagnostic report. Paths, file names and document text are left out.
import { describe, it, expect } from 'vitest';
import { msg } from '@/ui/i18n/message';
import { explain } from '@/ui/state/errors';
import { bugReport } from '@/ui/state/bugReport';
import { RecentProblems } from '@/ui/state/recentProblems';
import { defaultSettings, type Settings } from '@/ui/state/settings';
import { ISSUES_URL, PROJECT_URL } from '@/ui/projectLinks';

const PATH = 'C:\\Users\\Asha\\Documents\\Q3-salaries.docx';
const NAME = 'Q3-salaries.docx';
const SENTENCE = 'Our merger with Acme closes on Friday.';

const SETTINGS: Settings = {
  ...defaultSettings('en-IN'),
  dictionary: ['Vantix', 'acmeprojectx'],
  modelPath: 'C:\\Users\\Asha\\models\\private-model.gguf',
  helperSpeed: { modelPath: 'C:\\Users\\Asha\\models\\private-model.gguf', seconds: 2.5, backend: 'cpu', gpuFallback: false },
};

function plantedProblems(): RecentProblems {
  const problems = new RecentProblems();
  problems.record('error', msg('error.unsupported', { name: NAME }));
  problems.record('error', explain(msg('error.open', { name: NAME }), new Error(`EACCES: permission denied, open '${PATH}'`), msg('error.openNext')));
  problems.record('notice', msg('error.plain', { cause: SENTENCE }));
  return problems;
}

const report = () =>
  bugReport({ version: '1.0.0', aiBuild: true, windows: '15.0.0', webView2: '130.0.2849.80', settings: SETTINGS, problems: plantedProblems().list() });

describe('bug report contents', () => {
  it('names the version, the build, Windows and WebView2, the modules on, and the settings', () => {
    const text = report();
    expect(text).toContain('Version: 1.0.0');
    expect(text).toContain('Build: with the AI helper');
    expect(text).toContain('Windows (platform version): 15.0.0');
    expect(text).toContain('WebView2: 130.0.2849.80');
    expect(text).toContain('Modules on: namesCard, termsCard, otherLanguageCard, betterSuggestions');
    expect(text).toContain('"fallbackVariant": "Indian"');
    expect(text).toContain('"dictionary": "2 words"');
    expect(bugReport({ version: '1.0.0', aiBuild: false, windows: null, webView2: null, settings: SETTINGS, problems: [] })).toContain('Build: without AI');
  });

  it('lists the recent errors and notices by message key only', () => {
    const text = report();
    expect(text).toMatch(/error {2}error\.unsupported\n/);
    expect(text).toMatch(/error {2}error\.explain \(error\.open, error\.openNext\)\n/);
    expect(text).toMatch(/notice {1}error\.plain\n?/);
  });

  it('leaves out the planted path, file name, document sentence and dictionary words', () => {
    const text = report();
    for (const secret of [PATH, 'Asha', NAME, 'Q3-salaries', SENTENCE, 'Acme', 'acmeprojectx', 'Vantix', 'private-model']) {
      expect(text, secret).not.toContain(secret);
    }
  });

  // Task F24 (F23 adversarial review residue): withSavedSettings keeps unknown keys from a hand-edited settings.json.
  it('copies only the known settings: an unknown key from settings.json is left out with its value', () => {
    const planted = { ...SETTINGS, lastFolder: '/home/asha/Q3-salaries', recentFile: 'board-minutes.docx' } as Settings;
    const text = bugReport({ version: '1.0.0', aiBuild: true, windows: null, webView2: null, settings: planted, problems: [] });
    for (const secret of ['lastFolder', '/home/asha', 'Q3-salaries', 'recentFile', 'board-minutes']) expect(text, secret).not.toContain(secret);
    expect(text).toContain('"sessionRetentionDays": 30');
  });
});

describe('the recent problems ring buffer', () => {
  it('keeps the last 20, oldest first', () => {
    const problems = new RecentProblems();
    for (let i = 0; i < 25; i++) problems.record(i % 2 ? 'notice' : 'error', msg(i % 2 ? 'notice.clipboardNoText' : 'error.drop'));
    expect(problems.list()).toHaveLength(20);
    expect(problems.list()[0].kind).toBe('notice'); // entry 5
  });
});

describe('project links', () => {
  it('PROJECT_URL is the project repository; the issues link uses the bug template', () => {
    expect(PROJECT_URL).toBe('https://github.com/skmaiti2050/kashiro');
    expect(ISSUES_URL).toBe(`${PROJECT_URL}/issues/new?template=bug.yml`);
  });
});
