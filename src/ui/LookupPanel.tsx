import { useId } from 'react';
import type { LookupResult, Sense } from '@/engine/dictionary/lookup';
import { Dialog } from './Dialog';
import type { MessageKey } from './i18n/catalogues';
import { useT } from './i18n/useT';
import { sensesToShow, wordLanguage, type LookupState } from './state/wordLookup';

/** Senses shown per word (the dictionary keeps up to 3 per part of speech). */
const MAX_SENSES = 3;

const POS_KEYS: Record<Sense['pos'], MessageKey> = {
  noun: 'lookup.noun',
  verb: 'lookup.verb',
  adjective: 'lookup.adjective',
  adverb: 'lookup.adverb',
};

interface Props {
  lookup: LookupState;
  onClose(): void;
}

/**
 * The word lookup: one column per word (a review item's original and its suggestion side by side), up to three
 * senses each. Definitions are English and marked lang="en". It only shows: nothing here edits the text.
 */
export function LookupPanel({ lookup, onClose }: Props) {
  const t = useT();
  const [original, suggestion] = lookup.words;
  const comparing = suggestion !== undefined;
  const title = comparing ? t.t('lookup.titleCompare', { original, suggestion }) : t.t('lookup.title', { word: original });
  const labels = comparing ? [t.t('lookup.yourText'), t.t('lookup.suggestion')] : [];

  return (
    <Dialog title={title} className="lookup" onClose={onClose}>
      {lookup.status === 'loading' && <p className="hint">{t.t('lookup.loading')}</p>}
      {lookup.status === 'failed' && lookup.error && (
        <p className="lookup-error" role="alert">
          {t.format(lookup.error)}
        </p>
      )}
      {lookup.status === 'ready' && (
        <>
          <div className="lookup-columns">
            {lookup.results.map((result, i) => (
              <LookupColumn key={i} result={result} label={labels[i]} />
            ))}
          </div>
          <p className="hint">{t.t('lookup.englishOnly')}</p>
        </>
      )}
    </Dialog>
  );
}

function LookupColumn({ result, label }: { result: LookupResult; label?: string }) {
  const t = useT();
  const headingId = useId();
  const senses = sensesToShow(result.senses, MAX_SENSES);
  return (
    <section className="lookup-column" aria-labelledby={headingId}>
      <h3 id={headingId}>
        {label && <span className="hint">{label}:</span>} <span lang={wordLanguage(result.word)}>{result.word}</span>
      </h3>
      {(result.inPersonalDictionary || result.inIndianEnglishList) && (
        <p className="lookup-badges">
          {result.inPersonalDictionary && <span className="lookup-badge">{t.t('lookup.inDictionary')}</span>}
          {result.inIndianEnglishList && <span className="lookup-badge">{t.t('lookup.indianEnglish')}</span>}
        </p>
      )}
      {senses.length === 0 ? (
        <p>{t.t('lookup.noneFound')}</p>
      ) : (
        <ol className="lookup-senses">
          {senses.map((sense, i) => (
            <li key={i}>
              <em>{t.t(POS_KEYS[sense.pos])}</em>
              {sense.formOf && <span className="hint"> ({t.t('lookup.formOf', { lemma: sense.formOf })})</span>}{' '}
              <span lang="en">{sense.definition}</span>
              {sense.example && (
                <>
                  {' '}
                  <q lang="en">{sense.example}</q>
                </>
              )}
              {sense.synonyms.length > 0 && (
                <span className="lookup-similar hint">
                  {t.t('lookup.similar')} <span lang="en">{sense.synonyms.join(', ')}</span>
                </span>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
