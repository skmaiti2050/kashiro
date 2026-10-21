import type { ReactNode } from 'react';
import type { Decision } from '@/engine/decisions';
import type { Candidate } from '@/engine/types';
import type { SessionController } from './state/sessionController';
import { CategoryTag } from './CategoryTag';
import { WordTickList } from './WordTickList';
import { useT } from './i18n/useT';
import { wordCardTitle, wordCardWords } from './state/labels';

interface Props {
  controller: SessionController;
  card: Decision & { kind: 'otherLanguage' };
  candidates: Map<string, Candidate>;
}

const emphasis = (chunks: ReactNode[]) => <em lang="en">{chunks}</em>;

/**
 * The words-in-Indian-languages card (spec §5): romanised words of ten Indian languages ("accha", "khub",
 * "konjam") that the English dictionary doesn't know. They are never changed automatically: ticked words join the personal
 * dictionary; unticked ones become their own decisions so a real typo can be fixed. A likely typo ("jion",
 * one letter from "join") starts unticked with a hint, and joins the dictionary only when ticked.
 */
export function OtherLanguageCard({ controller, card, candidates }: Props) {
  const t = useT();
  const words = wordCardWords(card, candidates);
  const typoOf = new Map(card.likelyTypos ?? []);

  return (
    <div className="card other-language">
      <CategoryTag category="terms" />
      <h3>{wordCardTitle(t, card, candidates)}</h3>
      <p className="hint">{t.t('otherLanguage.hint')}</p>
      <WordTickList
        words={words}
        flagged={new Set(typoOf.keys())}
        detail={(word) =>
          typoOf.has(word) && (
            <span className="hint"> {t.rich('otherLanguage.likelyTypo', { word: typoOf.get(word)!, em: emphasis })}</span>
          )
        }
        onAdd={(keepAsTypos, tickedLikelyTypos) => void controller.acceptOtherLanguage(keepAsTypos, tickedLikelyTypos)}
      />
    </div>
  );
}
