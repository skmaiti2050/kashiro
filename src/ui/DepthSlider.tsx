import type { ReviewDepth } from '@/engine/depth';
import type { MessageKey } from './i18n/catalogues';
import { useT } from './i18n/useT';

const LEVELS: { depth: ReviewDepth; label: MessageKey }[] = [
  { depth: 'light', label: 'depth.light' },
  { depth: 'standard', label: 'depth.standard' },
  { depth: 'thorough', label: 'depth.thorough' },
  { depth: 'everything', label: 'depth.everything' },
];

interface Props {
  value: ReviewDepth;
  onChange(depth: ReviewDepth): void;
  /** The slider's name; "Review depth" by default (Settings names one per goal). */
  label?: string;
}

/** Light / Standard / Thorough / Everything (spec §5): how many decisions show up front. */
export function DepthSlider({ value, onChange, label }: Props) {
  const t = useT();
  const index = LEVELS.findIndex((l) => l.depth === value);
  const level = t.t(LEVELS[index].label);
  return (
    <label className="depth">
      <span>{label ?? t.t('depth.label')}</span>
      <input
        type="range"
        min={0}
        max={LEVELS.length - 1}
        step={1}
        value={index}
        onChange={(e) => onChange(LEVELS[Number(e.target.value)].depth)}
        aria-valuetext={level}
      />
      <span className="depth-value">{level}</span>
    </label>
  );
}
