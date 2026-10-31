import { useRef } from 'react';
import { msg } from './i18n/message';
import { useT } from './i18n/useT';
import { DICTIONARY_FILE_NAME, dictionaryFileText, readDictionaryFile } from './state/dictionaryFile';
import type { SessionController } from './state/sessionController';
import type { Settings } from './state/settings';

interface Props {
  controller: SessionController;
  settings: Settings;
}

/**
 * Settings › Saving on the web (web plan, Task 2): where settings are kept, and Export / Import dictionary, since
 * clearing the browser's site data deletes the dictionary with everything else.
 */
export function WebStorageSettings({ controller, settings }: Props) {
  const t = useT();
  const fileInput = useRef<HTMLInputElement>(null);

  const importFile = async (file: File | undefined) => {
    if (!file) return;
    const words = readDictionaryFile(await file.text());
    if (words) await controller.importDictionaryWords(words);
    else controller.showError(msg('error.dictionaryImport'));
  };

  return (
    <fieldset>
      <legend>{t.t('dictionary.title')}</legend>
      <p className="hint">{t.t('settings.webStorage')}</p>
      <div className="actions">
        <button onClick={() => download(DICTIONARY_FILE_NAME, dictionaryFileText(settings.dictionary))}>{t.t('settings.exportDictionary')}</button>
        <button onClick={() => fileInput.current?.click()}>{t.t('settings.importDictionary')}</button>
        <input
          ref={fileInput}
          type="file"
          accept=".json,application/json"
          hidden
          aria-label={t.t('settings.importDictionary')}
          onChange={(e) => {
            void importFile(e.target.files?.[0]);
            e.target.value = ''; // choosing the same file again still imports it
          }}
        />
      </div>
    </fieldset>
  );
}

/** Hands `text` to the browser as a download named `name`. */
function download(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  // Revoked after the click has started the download.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
