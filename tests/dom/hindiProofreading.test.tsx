/** A document the Hindi engine proofreads is worded as Hindi proofreading (#1 gates 2, 3, 7, 8). */
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import { CheckSession } from '@/engine/session';
import { makeController, warmLinter } from './harness';
import { installSpeech, LOCAL_VOICE, openAndWait, renderShell, reviewPanel, settingsTab } from './shell';
import { english } from '../ui/english';
import { devanagariEngines, fakeEngine } from '../fixtures/fakeEngines';

vi.mock('@tauri-apps/api/window', async () => (await import('./platformMocks')).tauriWindow);
vi.mock('@/ui/platform/files', async () => (await import('./platformMocks')).platformFiles);
vi.mock('@/ui/platform/linter', async () => (await import('./platformMocks')).platformLinter);
vi.mock('@/ui/platform/settings', async () => (await import('./platformMocks')).platformSettings);

beforeAll(warmLinter);

/** A Hindi engine that finds nothing. */
const fakeHindi = fakeEngine({ id: 'hi' });

const HINDI = 'यह एक छोटा सा परीक्षण है। हम कल बाज़ार गए थे।';
const MOSTLY_HINDI = `${HINDI}\n\n${HINDI}\n\n${HINDI}\n\nThe cat sat on the mat.`;

async function openHindi() {
  const { controller } = makeController({}, undefined, undefined, undefined, { scriptEngines: devanagariEngines(fakeHindi) });
  renderShell(controller);
  await openAndWait(controller, () => controller.openText(MOSTLY_HINDI));
  return controller;
}

/** Every session started from now on reports a mixed-spelling document (the flag is set once, at construction). */
function forceMixedVariant() {
  const start = CheckSession.start.bind(CheckSession);
  vi.spyOn(CheckSession, 'start').mockImplementation(async (...args) => {
    const session = await start(...args);
    Object.defineProperty(session, 'mixedVariant', { value: true });
    return session;
  });
}

/** Opens Settings › Checking and returns its default-variant list, as shown. */
function settingsVariants(): (string | null)[] {
  fireEvent.keyDown(document.body, { key: ',', ctrlKey: true });
  settingsTab('Checking');
  const settings = screen.getByRole('dialog', { name: 'Settings' });
  const select = within(settings).getByRole('combobox', { name: 'Default English variant' });
  return within(select).getAllByRole('option').map((o) => o.textContent);
}

const FIVE_VARIANTS = ['American', 'British', 'Australian', 'Canadian', 'Indian'];

describe('a document the Hindi engine proofreads', () => {
  it('the panel names Hindi', async () => {
    await openHindi();
    const panel = within(reviewPanel());
    expect(panel.getByText('All clear in the Hindi text')).toBeTruthy();
    expect(panel.getByText("1 paragraph isn't in Hindi and was not checked.")).toBeTruthy();
    expect(panel.queryByText('Kashiro proofreads English. Text in other scripts is shown but not checked.')).toBeNull();
    expect(panel.queryByText('Nothing to check: no English words')).toBeNull();
  });

  it('the toolbar chip says Hindi proofreading', async () => {
    await openHindi();
    expect(screen.getByText('Hindi proofreading')).toBeTruthy();
    expect(screen.queryByText('English proofreading')).toBeNull();
  });

  it('the completion announcement names Hindi', async () => {
    const controller = await openHindi();
    // One English paragraph was set aside, so the whole-paragraph branch is reached.
    expect(english(controller.getState().announcement!.message)).toBe(
      'Check finished: nothing to decide. Kashiro proofreads Hindi in this document. Text in other scripts was not checked.',
    );
  });
});

describe('an English document', () => {
  it('with one Hindi paragraph keeps today\'s wording', async () => {
    const { controller } = makeController();
    renderShell(controller);
    await openAndWait(controller, () => controller.openText(`The cat sat on the mat.\n\nWe met on Monday.\n\n${HINDI}`));
    const panel = within(reviewPanel());
    expect(panel.getByText("1 paragraph isn't in English and was not checked.")).toBeTruthy();
    expect(screen.getByText('English proofreading')).toBeTruthy();
  });
});

describe('English-only controls', () => {
  const variantPicker = () => screen.queryByRole('combobox', { name: /English proofreading|Hindi proofreading/ });

  it('a Hindi-proofread document hides the English variant picker and the status-bar variant', async () => {
    await openHindi();
    expect(variantPicker()).toBeNull();
    expect(screen.queryByText(/English \(/)).toBeNull();
  });

  afterEach(() => vi.restoreAllMocks());

  it('the mixed-spelling chip is English spelling, so a Hindi-proofread document never shows it', async () => {
    forceMixedVariant();
    await openHindi();
    expect(screen.queryByText('Mixed spelling')).toBeNull();
    expect(screen.getByText('Hindi proofreading')).toBeTruthy();
  });

  it('an English document still shows the mixed-spelling chip', async () => {
    forceMixedVariant();
    const { controller } = makeController();
    renderShell(controller);
    await openAndWait(controller, () => controller.openText('The cat sat on the mat.'));
    expect(screen.getByText('Mixed spelling')).toBeTruthy();
  });

  it('an English document still shows them', async () => {
    const { controller } = makeController();
    renderShell(controller);
    await openAndWait(controller, () => controller.openText('The cat sat on the mat.'));
    expect(variantPicker()).toBeTruthy();
    expect(screen.getByText(/English \(/)).toBeTruthy();
  });
});

describe('read aloud on Hindi text', () => {
  it('Read sentence asks for a Hindi voice', async () => {
    const hindiVoice = { voiceURI: 'Kalpana', name: 'Microsoft Kalpana - Hindi (India)', lang: 'hi-IN', localService: true, default: false };
    const speech = installSpeech([LOCAL_VOICE, hindiVoice]);
    try {
      const { controller } = makeController({}, undefined, undefined, undefined, { scriptEngines: devanagariEngines(fakeHindi) });
      renderShell(controller);
      await openAndWait(controller, () => controller.openText(MOSTLY_HINDI));
      const bar = await within(reviewPanel()).findByRole('group', { name: 'Read aloud' });
      fireEvent.click(within(bar).getByRole('button', { name: /Sentence/ }));
      expect(speech.spoken.map((s) => s.voice?.lang)).toEqual(['hi-IN']);
    } finally {
      speech.remove();
    }
  });
  it('with only a Hindi voice installed, Sentence is enabled on a Hindi document and speaks with it', async () => {
    const hindiVoice = { voiceURI: 'Kalpana', name: 'Microsoft Kalpana - Hindi (India)', lang: 'hi-IN', localService: true, default: false };
    const speech = installSpeech([hindiVoice]);
    try {
      const { controller } = makeController({}, undefined, undefined, undefined, { scriptEngines: devanagariEngines(fakeHindi) });
      renderShell(controller);
      await openAndWait(controller, () => controller.openText(MOSTLY_HINDI));
      const bar = await within(reviewPanel()).findByRole('group', { name: 'Read aloud' });
      const sentence = within(bar).getByRole('button', { name: /Sentence/ }) as HTMLButtonElement;
      expect(sentence.disabled).toBe(false);
      expect(within(bar).queryByText(/English voice/)).toBeNull();
      fireEvent.click(sentence);
      expect(speech.spoken.map((s) => s.voice?.lang)).toEqual(['hi-IN']);
    } finally {
      speech.remove();
    }
  });
});

describe('the English-only controls (variant picker, status-bar variant, mixed-spelling chip)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('a Hindi-proofread document shows none of them', async () => {
    forceMixedVariant();
    await openHindi();
    expect(screen.queryByRole('option', { name: 'British' })).toBeNull();
    expect(screen.queryByText(/ English( \(|$)/)).toBeNull();
    expect(screen.queryByText('Mixed spelling')).toBeNull();
  });

  it('an English document lists exactly the five variants', async () => {
    const { controller } = makeController();
    renderShell(controller);
    await openAndWait(controller, () => controller.openText('The cat sat on the mat.'));
    const picker = screen.getByRole('option', { name: 'British' }).closest('select')!;
    expect(within(picker).getAllByRole('option').slice(1).map((o) => o.textContent)).toEqual(FIVE_VARIANTS);
    // The positive control for the status-bar pattern above.
    expect(screen.getByText(/ English( \(|$)/)).toBeTruthy();
  });
});

describe('Settings › Checking › Default English variant (the default for English text, whatever is open)', () => {
  it('lists the five variants with an English document open', async () => {
    const { controller } = makeController();
    renderShell(controller);
    await openAndWait(controller, () => controller.openText('The cat sat on the mat.'));
    expect(settingsVariants()).toEqual(FIVE_VARIANTS);
  });

  it('lists the five variants while a Hindi-proofread document is open', async () => {
    await openHindi();
    expect(screen.getByText('Hindi proofreading')).toBeTruthy();
    expect(settingsVariants()).toEqual(FIVE_VARIANTS);
  });
});

describe('a Hindi-proofread document with no Hindi letters in the checked text', () => {
  afterEach(() => vi.restoreAllMocks());

  it('says "Nothing to check: no Hindi words" in the panel and the announcement', async () => {
    const hindi = fakeEngine({ id: 'hi' }).capabilities;
    vi.spyOn(CheckSession.prototype, 'proofreadingEngines').mockReturnValue([hindi]);
    const { controller } = makeController();
    renderShell(controller);
    await openAndWait(controller, () => controller.openText('2024!\n\n(1) 3.5 - 7'));
    expect(within(reviewPanel()).getByRole('heading', { name: 'Nothing to check: no Hindi words' })).toBeTruthy();
    expect(english(controller.getState().announcement!.message)).toBe('Check finished: nothing to check, no Hindi words.');
  });
});
