import { knownModel } from '@/engine/llm/models';
import { useT } from './i18n/useT';
import type { HelperBackend } from './state/optionalModules';
import type { SessionController } from './state/sessionController';
import type { Settings } from './state/settings';

interface Props {
  controller: SessionController;
  settings: Settings;
  checking: boolean;
  backend: HelperBackend | null;
}

const fileName = (path: string) => path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);

/**
 * Settings › Modules › AI rewrites: the model file. The user picks a .gguf file (the app never downloads one);
 * a known file is named with its licence, any other is flagged. Shows which build runs the helper.
 */
export function ModelFile({ controller, settings, checking, backend }: Props) {
  const t = useT();
  const { modelPath, modelSha256 } = settings;
  const known = modelSha256 ? knownModel(modelSha256) : null;

  let status: string;
  if (checking) status = t.t('modules.checkingModel');
  else if (modelPath === null) status = t.t('modules.noModel');
  else if (known) status = t.t('modules.knownModel', { name: known.label, licence: known.licence });
  else status = t.t('modules.unknownModel');

  return (
    <div className="model-file" role="group" aria-labelledby="model-file-label">
      <span id="model-file-label">
        <strong>{t.t('modules.model')}</strong>
        {modelPath !== null && <> {fileName(modelPath)}</>}
      </span>
      <p className={known || modelPath === null || checking ? 'hint' : 'hint warning'} aria-live="polite">
        {status}
      </p>
      {backend && <p className="hint">{t.t(backend === 'vulkan' ? 'modules.runsOnGpu' : 'modules.runsOnCpu')}</p>}
      <button type="button" onClick={() => void controller.chooseModel()} disabled={checking}>
        {t.t('modules.chooseModel')}
      </button>
      <p className="hint">{t.t('modules.modelHint')}</p>
    </div>
  );
}
