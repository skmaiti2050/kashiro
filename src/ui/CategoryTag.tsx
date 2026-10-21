import { CATEGORIES, type Category } from './state/categories';
import { kindLabel } from './state/kindLabels';

/** The card's category line: glyph and name (and the label of the flag's kind), matching the underline in the text. */
export function CategoryTag({ category, kind }: { category: Category; kind?: string }) {
  return (
    <p className={`category cat-${category}`}>
      <span className="glyph" aria-hidden="true">
        {CATEGORIES[category].glyph}
      </span>{' '}
      {CATEGORIES[category].label}
      {kind && ` · ${kindLabel(kind)}`}
    </p>
  );
}
