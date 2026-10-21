import { LETTER_SPACINGS, LINE_SPACINGS, TEXT_SIZES, type ReadingFont, type ReadingSettings as Reading } from './state/readingSettings';
import type { SessionController } from './state/sessionController';
import type { ReadAloud } from './useReadAloud';

const FONT_LABELS: Record<ReadingFont, string> = {
  default: 'Standard (Georgia and Segoe UI)',
  atkinson: 'Atkinson Hyperlegible',
  opendyslexic: 'OpenDyslexic',
};

const LETTER_LABELS: Record<number, string> = { 0: 'Normal', 0.05: 'Wide', 0.12: 'Wider' };

interface Props {
  controller: SessionController;
  reading: Reading;
  readAloud: ReadAloud | null;
}

/** Settings › Text and reading, and Read aloud (Task A1 items 3–5). Changes apply at once and need no new check. */
export function ReadingSettings({ controller, reading, readAloud }: Props) {
  const change = (patch: Partial<Reading>) => controller.changeSettings({ reading: { ...reading, ...patch } });

  return (
    <>
      <fieldset>
        <legend>Text and reading</legend>
        <label className="field">
          <span>App text size</span>
          <select value={reading.uiTextSize} onChange={(e) => change({ uiTextSize: Number(e.target.value) })}>
            {TEXT_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}%
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Document text size</span>
          <select value={reading.documentTextSize} onChange={(e) => change({ documentTextSize: Number(e.target.value) })}>
            {TEXT_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}%
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Font</span>
          <select value={reading.font} onChange={(e) => change({ font: e.target.value as ReadingFont })}>
            {(Object.keys(FONT_LABELS) as ReadingFont[]).map((font) => (
              <option key={font} value={font}>
                {FONT_LABELS[font]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Line spacing in the document</span>
          <select value={reading.lineSpacing} onChange={(e) => change({ lineSpacing: Number(e.target.value) })}>
            {LINE_SPACINGS.map((spacing) => (
              <option key={spacing} value={spacing}>
                {spacing === 1.6 ? '1.6 (normal)' : spacing}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Letter spacing in the document</span>
          <select value={reading.letterSpacing} onChange={(e) => change({ letterSpacing: Number(e.target.value) })}>
            {LETTER_SPACINGS.map((spacing) => (
              <option key={spacing} value={spacing}>
                {LETTER_LABELS[spacing]}
              </option>
            ))}
          </select>
        </label>
      </fieldset>

      <fieldset>
        <legend>Read aloud</legend>
        {readAloud ? (
          <VoiceSettings reading={reading} readAloud={readAloud} change={change} />
        ) : (
          <p className="hint">
            No voice that works offline is installed, so Read aloud is hidden. To add one: Windows Settings › Time &amp; language › Speech › Add voices.
          </p>
        )}
      </fieldset>
    </>
  );
}

const SAMPLE = 'This is how the voice sounds at this speed.';

function VoiceSettings({ reading, readAloud, change }: { reading: Reading; readAloud: ReadAloud; change(patch: Partial<Reading>): void }) {
  return (
    <>
      <label className="field">
        <span>Voice</span>
        <select value={reading.voice ?? ''} onChange={(e) => change({ voice: e.target.value === '' ? null : e.target.value })}>
          <option value="">Default voice</option>
          {readAloud.voices.map((voice) => (
            <option key={voice.voiceURI} value={voice.voiceURI}>
              {voice.name}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Speed</span>
        <input
          type="range"
          min={0.5}
          max={2}
          step={0.1}
          value={reading.rate}
          aria-valuetext={`${reading.rate.toFixed(1)} times`}
          onChange={(e) => change({ rate: Number(e.target.value) })}
        />
      </label>
      <label className="field">
        <span>Pitch</span>
        <input
          type="range"
          min={0.5}
          max={1.5}
          step={0.1}
          value={reading.pitch}
          aria-valuetext={reading.pitch.toFixed(1)}
          onChange={(e) => change({ pitch: Number(e.target.value) })}
        />
      </label>
      <div className="actions">
        <button onClick={() => readAloud.read(SAMPLE)}>Play a sample</button>
      </div>
      <p className="hint">Only voices installed on this PC are used, so your text is never sent anywhere.</p>
    </>
  );
}
