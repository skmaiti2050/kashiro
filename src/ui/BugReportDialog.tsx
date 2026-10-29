import { useEffect, useId, useState } from 'react';
import { version } from '../../package.json';
import { Dialog } from './Dialog';
import { useT } from './i18n/useT';
import { environmentVersions } from './platform/environment';
import { openProjectPage } from './platform/links';
import { bugReport } from './state/bugReport';
import type { SessionController } from './state/sessionController';

/**
 * ⋯ › Report a bug (F22 item 4): a non-private report to read, Copy, and Open GitHub issues. Nothing is sent: the
 * browser opens only on that click, and the user pastes the report themselves.
 */
export function BugReportDialog({ controller, onClose }: { controller: SessionController; onClose(): void }) {
  const t = useT();
  const [report, setReport] = useState('');
  const [status, setStatus] = useState('');
  const reportId = useId();
  const introId = useId();

  useEffect(() => {
    let current = true;
    void environmentVersions().then(({ windows, webView2 }) => {
      if (!current) return;
      const { settings } = controller.getState();
      setReport(bugReport({ version, aiBuild: controller.helperInstalled, windows, webView2, settings, problems: controller.problems.list() }));
    });
    return () => {
      current = false;
    };
  }, [controller]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(report);
      setStatus(t.t('bug.copied'));
    } catch {
      setStatus(t.t('bug.copyFailed'));
    }
  };
  const openIssues = async () => {
    try {
      await openProjectPage('issues');
    } catch {
      setStatus(t.t('bug.openFailed'));
    }
  };

  return (
    <Dialog title={t.t('bug.title')} className="bug-report" describedBy={introId} onClose={onClose}>
      <p id={introId}>{t.t('bug.intro')}</p>
      <label className="bug-report-label" htmlFor={reportId}>
        {t.t('bug.report')}
      </label>
      {/* The report is English for the issue tracker. */}
      <textarea id={reportId} className="bug-report-text" readOnly rows={12} lang="en" dir="ltr" spellCheck={false} value={report} />
      <div className="actions">
        <button onClick={() => void copy()} disabled={report === ''}>
          {t.t('bug.copy')}
        </button>
        <button onClick={() => void openIssues()}>{t.t('bug.openIssues')}</button>
        <span role="status">{status}</span>
      </div>
      <p className="hint">{t.t('bug.openHint')}</p>
    </Dialog>
  );
}
