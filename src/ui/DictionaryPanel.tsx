import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { duplicateCount } from '@/engine/dictionaryWords';
import { Dialog } from './Dialog';
import { focusButtonAt } from './focus';
import { useT } from './i18n/useT';
import type { SessionController } from './state/sessionController';

/** The words are English: sorted the English way, ignoring case and accents ("ami", "Anjali", "vantix", "Vantix"). */
const collator = new Intl.Collator('en', { sensitivity: 'base' });

interface Props {
  controller: SessionController;
  dictionary: string[];
  onClose(): void;
}

/**
 * ⋯ › Dictionary… (F22 item 1): the personal dictionary, sorted, with a search, a count, Remove per word, Add and
 * "Merge duplicates". Every change goes through the controller's dictionary actions (re-check, take-back rules).
 */
export function DictionaryPanel({ controller, dictionary, onClose }: Props) {
  const t = useT();
  const [query, setQuery] = useState('');
  const [newWord, setNewWord] = useState('');
  const [mergedNote, setMergedNote] = useState('');
  /** After a Remove, the row index whose button should take focus (its button went with it). */
  const [refocus, setRefocus] = useState<number | null>(null);
  const list = useRef<HTMLUListElement>(null);
  const addInput = useRef<HTMLInputElement>(null);
  const hintId = useId();

  // Worked out again only when the dictionary changes, not on every key typed in the search.
  const { sorted, duplicates } = useMemo(
    () => ({
      sorted: [...dictionary].sort(collator.compare).map((word) => ({ word, lower: word.toLocaleLowerCase('en') })),
      duplicates: duplicateCount(dictionary),
    }),
    [dictionary],
  );
  const needle = query.trim().toLocaleLowerCase('en');
  const shown = needle === '' ? sorted : sorted.filter((entry) => entry.lower.includes(needle));

  useEffect(() => {
    if (refocus === null) return;
    const count = list.current?.querySelectorAll('button').length ?? 0;
    if (!focusButtonAt(list.current, Math.min(refocus, count - 1))) addInput.current?.focus();
    setRefocus(null);
  }, [refocus, dictionary]);

  const remove = (word: string, index: number) => {
    void controller.removeWord(word);
    setRefocus(index);
  };
  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (newWord.trim() === '') return;
    await controller.addDictionaryWord(newWord);
    setNewWord('');
  };
  const merge = async () => {
    const merged = await controller.mergeDictionaryDuplicates();
    setMergedNote(t.t('dictionary.merged', { count: merged }));
  };

  return (
    <Dialog title={t.t('dictionary.title')} className="dictionary-panel" describedBy={hintId} onClose={onClose}>
      <p id={hintId} className="hint">
        {t.t('dictionary.count', { count: dictionary.length })}
      </p>
      <form className="dictionary-add" onSubmit={(e) => void add(e)}>
        <label className="field">
          <span>{t.t('dictionary.addLabel')}</span>
          <input ref={addInput} type="text" lang="en" spellCheck={false} value={newWord} onChange={(e) => setNewWord(e.target.value)} />
        </label>
        <button type="submit">{t.t('dictionary.add')}</button>
      </form>
      <label className="field">
        <span>{t.t('dictionary.search')}</span>
        <input type="search" lang="en" spellCheck={false} value={query} onChange={(e) => setQuery(e.target.value)} />
      </label>
      <div className="dictionary-merge">
        <button disabled={duplicates === 0} onClick={() => void merge()}>
          {t.t('dictionary.merge')}
        </button>
        <span role="status">{mergedNote}</span>
      </div>
      {dictionary.length === 0 && <p className="hint">{t.t('settings.dictionaryEmpty')}</p>}
      {dictionary.length > 0 && shown.length === 0 && <p className="hint">{t.t('dictionary.noMatch')}</p>}
      <ul className="dictionary" ref={list}>
        {shown.map(({ word }, index) => (
          <li key={word}>
            <span lang="en">{word}</span>
            <button className="quiet" aria-label={t.t('settings.removeLabel', { word })} onClick={() => remove(word, index)}>
              {t.t('settings.remove')}
            </button>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
