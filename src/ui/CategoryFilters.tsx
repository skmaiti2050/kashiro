import { useT } from './i18n/useT';
import { CATEGORIES, type Category } from './state/categories';

interface Props {
  counts: Map<Category, number>;
  /** The category shown alone, or null for all. */
  active: Category | null;
  onToggle(category: Category): void;
}

/** "● Correctness 3 · ◆ Clarity 2 …": toggle buttons (aria-pressed); a second press clears the filter (F23 item 2). */
export function CategoryFilters({ counts, active, onToggle }: Props) {
  const t = useT();
  if (counts.size === 0) return null;
  return (
    <div className="category-filters" role="group" aria-label={t.t('filter.label')}>
      {[...counts].map(([category, count]) => (
        <button key={category} className={`quiet cat-${category}`} aria-pressed={active === category} onClick={() => onToggle(category)}>
          {/* A symbol, not words ("Aa" for names): lang="zxx", no language. */}
          <span className="glyph" aria-hidden="true" lang="zxx">
            {CATEGORIES[category].glyph}
          </span>{' '}
          {t.t(CATEGORIES[category].label)} <span className="count">{count}</span>
        </button>
      ))}
    </div>
  );
}
