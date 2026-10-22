// Interface language (Task L1): switching at runtime, the page's lang, and axe in Hindi.
import { describe, it, expect, beforeAll, vi } from 'vitest';
import axe from 'axe-core';
import { act, fireEvent, screen, within } from '@testing-library/react';
import { makeController, warmLinter } from './harness';
import { createTranslator } from '@/ui/i18n/translator';
import { installSpeech, LOCAL_VOICE, openAndWait, renderShell } from './shell';

vi.mock('@tauri-apps/api/window', async () => (await import('./platformMocks')).tauriWindow);
vi.mock('@/ui/platform/files', async () => (await import('./platformMocks')).platformFiles);
vi.mock('@/ui/platform/linter', async () => (await import('./platformMocks')).platformLinter);
vi.mock('@/ui/platform/settings', async () => (await import('./platformMocks')).platformSettings);

beforeAll(warmLinter);

async function seriousViolations(): Promise<string[]> {
  await act(() => new Promise((resolve) => setTimeout(resolve, 30)));
  const results = await axe.run(document.body, { resultTypes: ['violations'] });
  return results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id);
}

describe('app language', () => {
  it('switching to Hindi in Settings updates the whole UI at once, without a restart, and is saved', async () => {
    const { controller, saved } = makeController();
    const { container } = renderShell(controller);
    await openAndWait(controller, () => controller.openSample());
    const before = controller.getState();
    const checked = {
      session: before.session,
      variant: before.session!.variant,
      fallback: before.settings.fallbackVariant,
      override: before.variantOverride,
      candidates: before.session!.candidates().map((c) => c.id),
    };
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    fireEvent.change(within(screen.getByRole('dialog')).getByRole('combobox', { name: 'App language' }), { target: { value: 'hi' } });

    // The UI language changes nothing about the check: same session, English variant and candidates.
    const after = controller.getState();
    expect(after.session).toBe(checked.session);
    expect(after.session!.variant).toBe(checked.variant);
    expect(after.settings.fallbackVariant).toBe(checked.fallback);
    expect(after.variantOverride).toBe(checked.override);
    expect(after.session!.candidates().map((c) => c.id)).toEqual(checked.candidates);
    expect(screen.getByRole('dialog', { name: 'सेटिंग्स' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'खोलें' })).toBeTruthy();
    expect(screen.getByRole('complementary', { name: 'समीक्षा' })).toBeTruthy();
    expect(container.querySelector('.app')!.getAttribute('lang')).toBe('hi');
    expect(document.documentElement.lang).toBe('hi');
    expect(document.documentElement.dir).toBe('ltr');
    expect(saved.at(-1)!.uiLanguage).toBe('hi');

    fireEvent.change(within(screen.getByRole('dialog')).getByRole('combobox', { name: 'ऐप की भाषा' }), { target: { value: 'en' } });
    expect(screen.getByRole('button', { name: 'Open' })).toBeTruthy();
  });

  it('switching to Bengali at runtime updates the UI and the page language', async () => {
    const { controller, saved } = makeController();
    const { container } = renderShell(controller);
    await openAndWait(controller, () => controller.openSample());
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    fireEvent.change(within(screen.getByRole('dialog')).getByRole('combobox', { name: 'App language' }), { target: { value: 'bn' } });

    expect(screen.getByRole('dialog', { name: 'সেটিংস' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'খুলুন' })).toBeTruthy();
    expect(screen.getByRole('complementary', { name: 'রিভিউ' })).toBeTruthy();
    expect(container.querySelector('.app')!.getAttribute('lang')).toBe('bn');
    expect(document.documentElement.lang).toBe('bn');
    expect(saved.at(-1)!.uiLanguage).toBe('bn');
    // The document stays English, left to right, whatever the UI language and its direction.
    const text = container.querySelector('.cm-content')!;
    expect(text.getAttribute('lang')).toBe('en');
    expect(text.getAttribute('dir')).toBe('ltr');
  });

  describe('read aloud in Hindi', () => {
    const HINDI_VOICE = { voiceURI: 'Kalpana', name: 'Microsoft Kalpana - Hindi (India)', lang: 'hi-IN', localService: true, default: false };
    const ONLINE_HINDI = { voiceURI: 'Swara', name: 'Microsoft Swara Online (Natural) - Hindi (India)', lang: 'hi-IN', localService: false, default: false };
    const DEVANAGARI = /[ऀ-ॿ]/;

    async function readSuggestionAndSentence(voices: (typeof LOCAL_VOICE)[]) {
      const speech = installSpeech(voices);
      const { controller } = makeController({ uiLanguage: 'hi' });
      renderShell(controller);
      await openAndWait(controller, () => controller.openSample());
      await screen.findByRole('group', { name: 'पढ़कर सुनाएँ' });
      const panel = screen.getByRole('complementary', { name: 'समीक्षा' });
      fireEvent.keyDown(panel, { key: 'r', altKey: true });
      fireEvent.keyDown(panel, { key: 's', altKey: true });
      speech.remove();
      return speech.spoken;
    }

    it('with a local Hindi voice: the card is read in Hindi with it; the English sentence with the English voice', async () => {
      const [suggestion, sentence] = await readSuggestionAndSentence([LOCAL_VOICE, HINDI_VOICE]);
      expect(suggestion.voice).toEqual(HINDI_VOICE);
      expect(suggestion.text).toMatch(DEVANAGARI);
      expect(sentence.voice).toEqual(LOCAL_VOICE);
      expect(sentence.text).not.toMatch(DEVANAGARI);
    });

    it('the document is read by an English voice even when a Hindi voice is the default and listed first', async () => {
      const hindiDefault = { ...HINDI_VOICE, default: true };
      const speech = installSpeech([hindiDefault, LOCAL_VOICE]);
      try {
        const { controller } = makeController();
        renderShell(controller);
        await openAndWait(controller, () => controller.openSample());
        await screen.findByRole('group', { name: 'Read aloud' });
        fireEvent.keyDown(screen.getByRole('complementary', { name: 'Review' }), { key: 's', altKey: true });
        expect(speech.spoken).toHaveLength(1);
        expect(speech.spoken[0].voice).toEqual(LOCAL_VOICE);
      } finally {
        speech.remove();
      }
    });

    it('with only a Hindi voice: Sentence and Paragraph are off and say why; a Hindi card is still read', async () => {
      const speech = installSpeech([HINDI_VOICE]);
      try {
        const { controller } = makeController({ uiLanguage: 'hi' });
        renderShell(controller);
        await openAndWait(controller, () => controller.openSample());
        const bar = await screen.findByRole('group', { name: 'पढ़कर सुनाएँ' });
        const buttons = within(bar).getAllByRole('button');
        expect(buttons.map((b) => (b as HTMLButtonElement).disabled)).toEqual([true, false, true]);
        expect(bar.textContent).toContain(createTranslator('hi', []).t('read.needsEnglishVoice'));
        const panel = screen.getByRole('complementary', { name: 'समीक्षा' });
        fireEvent.keyDown(panel, { key: 's', altKey: true });
        expect(speech.spoken).toEqual([]);
        fireEvent.keyDown(panel, { key: 'r', altKey: true });
        expect(speech.spoken.map((s) => s.voice)).toEqual([HINDI_VOICE]);
        expect(speech.spoken[0].text).toMatch(DEVANAGARI);
      } finally {
        speech.remove();
      }
    });

    it('Settings says a Hindi or Bengali voice reads only the cards in that language', async () => {
      const speech = installSpeech([LOCAL_VOICE, HINDI_VOICE]);
      try {
        const { controller } = makeController();
        renderShell(controller);
        await openAndWait(controller, () => controller.openSample());
        await screen.findByRole('group', { name: 'Read aloud' });
        fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
        expect(screen.getByRole('dialog').textContent).toContain(createTranslator('en', []).t('reading.voiceLanguageHint'));
      } finally {
        speech.remove();
      }
    });

    it('with only an English local voice (a Hindi one only online): the card is read in English, never by the online voice', async () => {
      const spoken = await readSuggestionAndSentence([LOCAL_VOICE, ONLINE_HINDI]);
      expect(spoken.map((s) => s.voice)).toEqual([LOCAL_VOICE, LOCAL_VOICE]);
      expect(spoken[0].text).not.toMatch(DEVANAGARI);
      expect(spoken[0].text).toMatch(/^(Correctness|Clarity|Style|Terms|Names and places)/);
    });
  });

  it.each([
    { language: 'hi' as const, settings: 'सेटिंग्स', close: 'बंद करें', shortcuts: 'शॉर्टकट' },
    { language: 'bn' as const, settings: 'সেটিংস', close: 'বন্ধ করুন', shortcuts: 'শর্টকাট' },
  ])('axe: no serious or critical violations in $language (review panel, Settings, shortcuts)', async ({ language, settings, close, shortcuts }) => {
    const { controller } = makeController({ uiLanguage: language });
    renderShell(controller);
    await openAndWait(controller, () => controller.openSample());
    expect(await seriousViolations()).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: settings }));
    expect(await seriousViolations()).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: close }));
    fireEvent.click(screen.getByRole('button', { name: shortcuts }));
    expect(await seriousViolations()).toEqual([]);
  });
});
