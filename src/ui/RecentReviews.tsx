import { useEffect, useId, useRef, useState } from 'react';
import { useT } from './i18n/useT';
import type { Translator } from './i18n/translator';
import type { RecentReview } from './state/sessionStore';

interface Props {
  reviews: RecentReview[];
  onOpen(review: RecentReview): void;
}

/** Digits only, so it reads the same in every UI language (and the pseudo-locale has no stray English). */
const whenChanged = (t: Translator, iso: string) =>
  new Intl.DateTimeFormat(t.formatLocale, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(
    new Date(iso),
  );

/** How many saved reviews the start screen lists before "Show all (N)" (F22 item 6; retention is separate). */
export const RECENT_SHOWN = 8;

/** The start screen's saved reviews, newest first: each row a button that reopens the document and resumes. */
export function RecentReviews({ reviews, onOpen }: Props) {
  const t = useT();
  const titleId = useId();
  const [showAll, setShowAll] = useState(false);
  const list = useRef<HTMLUListElement>(null);
  // "Show all" goes away when chosen: focus moves to the first review it revealed, not to the page.
  useEffect(() => {
    if (showAll) list.current?.querySelectorAll('button')[RECENT_SHOWN]?.focus();
  }, [showAll]);
  if (reviews.length === 0) return null;
  const shown = showAll ? reviews : reviews.slice(0, RECENT_SHOWN);
  return (
    <section className="recent-reviews" aria-labelledby={titleId}>
      <h3 id={titleId}>{t.t('recent.title')}</h3>
      <ul ref={list}>
        {shown.map((review) => (
          <li key={review.key}>
            <button className="recent-review" onClick={() => onOpen(review)}>
              {/* A file name or path is not in any language: lang="zxx" (no linguistic content). */}
              <span className="recent-name">{review.path === null ? t.t('recent.pasted') : <span lang="zxx">{review.name}</span>}</span>
              {review.path !== null && (
                <span className="hint" lang="zxx" dir="ltr">
                  {review.path}
                </span>
              )}
              <span className="hint">
                {t.t('recent.progress', { made: review.made, left: review.left })} · {t.t('recent.updated', { date: whenChanged(t, review.updated) })}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {shown.length < reviews.length && (
        <button className="quiet recent-show-all" onClick={() => setShowAll(true)}>
          {t.t('recent.showAll', { count: reviews.length })}
        </button>
      )}
    </section>
  );
}
