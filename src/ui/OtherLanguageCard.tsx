import type { Decision } from '@/engine/decisions';
import type { Candidate } from '@/engine/types';
import type { SessionController } from './state/sessionController';
import { CategoryTag } from './CategoryTag';
import { WordTickList } from './WordTickList';

interface Props {
  controller: SessionController;
  card: Decision;
  candidates: Map<string, Candidate>;
}

/**
 * The words-in-Indian-languages card (spec §5): romanised words of ten Indian languages ("accha", "khub",
 * "konjam") that the English dictionary doesn't know. They are never changed automatically: ticked words join the personal
 * dictionary; unticked ones become their own decisions so a real typo can be fixed. A likely typo ("jion",
 * one letter from "join") starts unticked with a hint, and joins the dictionary only when ticked.
 */
export function OtherLanguageCard({ controller, card, candidates }: Props) {
  const words = [...new Set(card.candidateIds.map((id) => candidates.get(id)!.original.toLowerCase()))];
  const typoOf = new Map(card.likelyTypos ?? []);

  return (
    <div className="card other-language">
      <CategoryTag category="terms" />
      <h3>{card.label}</h3>
      <p className="hint">Words that look like Indian-language words written in English letters. Untick any that are real typos.</p>
      <WordTickList
        words={words}
        flagged={new Set(typoOf.keys())}
        detail={(word) =>
          typoOf.has(word) && (
            <span className="hint">
              {' '}
              looks like a typo of <em>{typoOf.get(word)}</em>?
            </span>
          )
        }
        onAdd={(keepAsTypos, tickedLikelyTypos) => void controller.acceptOtherLanguage(keepAsTypos, tickedLikelyTypos)}
      />
    </div>
  );
}
