import type { ReviewDepth } from '@/engine/depth';

const LEVELS: { depth: ReviewDepth; label: string }[] = [
  { depth: 'light', label: 'Light' },
  { depth: 'standard', label: 'Standard' },
  { depth: 'thorough', label: 'Thorough' },
  { depth: 'everything', label: 'Everything' },
];

interface Props {
  value: ReviewDepth;
  onChange(depth: ReviewDepth): void;
  label?: string;
}

/** Light / Standard / Thorough / Everything (spec §5): how many decisions show up front. */
export function DepthSlider({ value, onChange, label = 'Review depth' }: Props) {
  const index = LEVELS.findIndex((l) => l.depth === value);
  return (
    <label className="depth">
      <span>{label}</span>
      <input
        type="range"
        min={0}
        max={LEVELS.length - 1}
        step={1}
        value={index}
        onChange={(e) => onChange(LEVELS[Number(e.target.value)].depth)}
        aria-valuetext={LEVELS[index].label}
      />
      <span className="depth-value">{LEVELS[index].label}</span>
    </label>
  );
}
