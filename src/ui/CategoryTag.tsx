import { CATEGORIES, type Category } from './state/categories';

/** The card's category line: glyph and name (and the flag's kind), matching the underline in the text. */
export function CategoryTag({ category, kind }: { category: Category; kind?: string }) {
  return (
    <p className={`category cat-${category}`}>
      <span className="glyph" aria-hidden="true">
        {CATEGORIES[category].glyph}
      </span>{' '}
      {CATEGORIES[category].label}
      {kind && ` · ${kind}`}
    </p>
  );
}
