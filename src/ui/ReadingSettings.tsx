import type { MessageKey } from './i18n/catalogues';
import { useT } from './i18n/useT';
import {
  LETTER_SPACINGS,
  LINE_SPACINGS,
  TEXT_SIZES,
  THEMES,
  type ReadingFont,
  type ReadingSettings as Reading,
  type ThemeChoice,
} from './state/readingSettings';
import type { SessionController } from './state/sessionController';
import type { ReadAloud } from './useReadAloud';

const FONT_LABELS: Record<ReadingFont, MessageKey> = {
  default: 'reading.fontDefault',
  atkinson: 'reading.fontAtkinson',
  opendyslexic: 'reading.fontOpenDyslexic',
};

const THEME_LABELS: Record<ThemeChoice, MessageKey> = { system: 'reading.themeSystem', light: 'reading.themeLight', dark: 'reading.themeDark' };

const LETTER_LABELS: Record<number, MessageKey> = { 0: 'reading.letterNormal', 0.05: 'reading.letterWide', 0.12: 'reading.letterWider' };

/** The line spacing marked "(normal)". */
const NORMAL_LINE_SPACING = 1.6;

interface Props {
  controller: SessionController;
  reading: Reading;
  readAloud: ReadAloud | null;
}

/** Settings › Text and reading, and Read aloud (Task A1 items 3–5). Changes apply at once and need no new check. */
export function ReadingSettings({ controller, reading, readAloud }: Props) {
  const t = useT();
  const change = (patch: Partial<Reading>) => controller.changeSettings({ reading: { ...reading, ...patch } });

  return (
    <>
      <fieldset>
        <legend>{t.t('reading.legend')}</legend>
        <label className="field">
          <span>{t.t('reading.theme')}</span>
          <select value={reading.theme} onChange={(e) => change({ theme: e.target.value as ThemeChoice })}>
            {THEMES.map((theme) => (
              <option key={theme} value={theme}>
                {t.t(THEME_LABELS[theme])}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>{t.t('reading.appSize')}</span>
          <select value={reading.uiTextSize} onChange={(e) => change({ uiTextSize: Number(e.target.value) })}>
            {TEXT_SIZES.map((size) => (
              <option key={size} value={size}>
                {t.t('reading.percent', { value: size / 100 })}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>{t.t('reading.docSize')}</span>
          <select value={reading.documentTextSize} onChange={(e) => change({ documentTextSize: Number(e.target.value) })}>
            {TEXT_SIZES.map((size) => (
              <option key={size} value={size}>
                {t.t('reading.percent', { value: size / 100 })}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>{t.t('reading.font')}</span>
          <select value={reading.font} onChange={(e) => change({ font: e.target.value as ReadingFont })}>
            {(Object.keys(FONT_LABELS) as ReadingFont[]).map((font) => (
              <option key={font} value={font}>
                {t.t(FONT_LABELS[font])}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>{t.t('reading.lineSpacing')}</span>
          <select value={reading.lineSpacing} onChange={(e) => change({ lineSpacing: Number(e.target.value) })}>
            {LINE_SPACINGS.map((spacing) => (
              <option key={spacing} value={spacing}>
                {t.t(spacing === NORMAL_LINE_SPACING ? 'reading.spacingNormal' : 'reading.spacing', { value: spacing })}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>{t.t('reading.letterSpacing')}</span>
          <select value={reading.letterSpacing} onChange={(e) => change({ letterSpacing: Number(e.target.value) })}>
            {LETTER_SPACINGS.map((spacing) => (
              <option key={spacing} value={spacing}>
                {t.t(LETTER_LABELS[spacing])}
              </option>
            ))}
          </select>
        </label>
        <label>
          <input type="checkbox" checked={reading.keyHints} onChange={(e) => change({ keyHints: e.target.checked })} />
          {t.t('reading.keyHints')}
        </label>
      </fieldset>

      <fieldset>
        <legend>{t.t('reading.readAloud')}</legend>
        {readAloud ? <VoiceSettings reading={reading} readAloud={readAloud} change={change} /> : <p className="hint">{t.t('reading.noVoice')}</p>}
      </fieldset>
    </>
  );
}

/**
 * The sample is English on purpose: read aloud reads the (English) document, so this is how that will
 * sound with the chosen voice. It is spoken, never shown.
 */
const SAMPLE = 'This is how the voice sounds at this speed.';

function VoiceSettings({ reading, readAloud, change }: { reading: Reading; readAloud: ReadAloud; change(patch: Partial<Reading>): void }) {
  const t = useT();
  return (
    <>
      <label className="field">
        <span>{t.t('reading.voice')}</span>
        <select value={reading.voice ?? ''} onChange={(e) => change({ voice: e.target.value === '' ? null : e.target.value })}>
          <option value="">{t.t('reading.defaultVoice')}</option>
          {readAloud.voices.map((voice) => (
            <option key={voice.voiceURI} value={voice.voiceURI}>
              {voice.name}
            </option>
          ))}
        </select>
      </label>
      <p className="hint">{t.t('reading.voiceLanguageHint')}</p>
      <label className="field">
        <span>{t.t('reading.speed')}</span>
        <input
          type="range"
          min={0.5}
          max={2}
          step={0.1}
          value={reading.rate}
          aria-valuetext={t.t('reading.speedValue', { value: reading.rate })}
          onChange={(e) => change({ rate: Number(e.target.value) })}
        />
      </label>
      <label className="field">
        <span>{t.t('reading.pitch')}</span>
        <input
          type="range"
          min={0.5}
          max={1.5}
          step={0.1}
          value={reading.pitch}
          aria-valuetext={t.t('reading.pitchValue', { value: reading.pitch })}
          onChange={(e) => change({ pitch: Number(e.target.value) })}
        />
      </label>
      <div className="actions">
        {/* In the chosen voice's language, so a Hindi or Bengali voice can be heard too. */}
        <button onClick={() => readAloud.read(SAMPLE, readAloud.voices.find((v) => v.voiceURI === reading.voice)?.lang ?? 'en')}>
          {t.t('reading.sample')}
        </button>
      </div>
      <p className="hint">{t.t('reading.voiceNote')}</p>
    </>
  );
}
