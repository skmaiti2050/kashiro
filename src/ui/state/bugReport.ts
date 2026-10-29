import type { RecentProblem } from './recentProblems';
import { modulesFor, type Settings } from './settings';

export interface BugReportInput {
  version: string;
  /** The installer with the writing helper (true) or the version without AI. */
  aiBuild: boolean;
  /** navigator.userAgentData's platform version (13 and up is Windows 11); null when the webview doesn't say. */
  windows: string | null;
  webView2: string | null;
  settings: Settings;
  problems: RecentProblem[];
}

/** A drive or network path ("C:\Users\…", "\\server\share\…"): left out wherever it appears. */
const PATH = /(?:[A-Za-z]:[\\/]|\\\\)[^\s"']*/g;

/**
 * Every Settings key (the type makes this list complete). The report copies only these: withSavedSettings keeps
 * any other key a hand-edited settings.json holds, with whatever value (Task F24, F23 review).
 */
const SETTINGS_KEYS: Record<keyof Settings, true> = {
  preset: true,
  fallbackVariant: true,
  fallbackVariantChosen: true,
  saveMode: true,
  overwrite: true,
  dictionary: true,
  tierOverrides: true,
  modelPath: true,
  modelSha256: true,
  helperSpeed: true,
  depthByPreset: true,
  termMinRepeats: true,
  ignoredRules: true,
  modules: true,
  modulesByPreset: true,
  reading: true,
  uiLanguage: true,
  keepPastedText: true,
  sessionRetentionDays: true,
};

function knownSettings(settings: Settings): Settings {
  return Object.fromEntries(Object.entries(settings).filter(([key]) => Object.hasOwn(SETTINGS_KEYS, key))) as Settings;
}

/**
 * The text of ⋯ › Report a bug (F22 item 4), in English for the issue tracker. Non-private by construction: only the
 * known settings, no dictionary words (only their count), no model path, and errors and notices by message key only
 * (RecentProblems keeps no values). Any path left anywhere is replaced as a last guard.
 */
export function bugReport(input: BugReportInput): string {
  const { settings } = input;
  const modulesOn = Object.entries(modulesFor(settings))
    .filter(([, on]) => on)
    .map(([name]) => name);
  const shownSettings = {
    ...knownSettings(settings),
    dictionary: `${settings.dictionary.length} ${settings.dictionary.length === 1 ? 'word' : 'words'}`,
    modelPath: settings.modelPath === null ? null : '(chosen; path left out)',
    helperSpeed: settings.helperSpeed && { ...settings.helperSpeed, modelPath: '(path left out)' },
  };
  const problems = input.problems.map((p) => `${p.at}  ${p.kind.padEnd(6)} ${p.key}${p.parts.length ? ` (${p.parts.join(', ')})` : ''}`);
  const lines = [
    'Kashiro bug report. Nothing private: file paths, file names, document text and dictionary words are left out.',
    '',
    `Version: ${input.version}`,
    `Build: ${input.aiBuild ? 'with the AI helper' : 'without AI'}`,
    `Windows (platform version): ${input.windows ?? 'unknown'}`,
    `WebView2: ${input.webView2 ?? 'unknown'}`,
    `Modules on: ${modulesOn.join(', ') || 'none'}`,
    '',
    'Settings:',
    JSON.stringify(shownSettings, null, 2),
    '',
    `Recent errors and notices (last ${problems.length}, oldest first):`,
    ...(problems.length ? problems : ['none']),
  ];
  return lines.join('\n').replace(PATH, '(path left out)');
}
