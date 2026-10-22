import type { Decision } from '@/engine/decisions';
import type { Candidate } from '@/engine/types';
import { useT } from './i18n/useT';
import { decisionTitleParts } from './state/labels';

/**
 * A card's or More row's title. Only the document's words are marked English (lang="en"), so a screen reader
 * reads them in English and the UI's own words ("(delete)", "2 places") in the UI language.
 */
export function DecisionTitle({ decision, candidates }: { decision: Decision; candidates: Map<string, Candidate> }) {
  const t = useT();
  return (
    <>
      {decisionTitleParts(t, decision, candidates).map((part, i) =>
        part.document ? (
          <span key={i} lang="en">
            {part.text}
          </span>
        ) : (
          part.text
        ),
      )}
    </>
  );
}
