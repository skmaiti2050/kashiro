import type * as desktop from '../platform/links';
import { ISSUES_URL, PROJECT_URL } from '../projectLinks';

/**
 * Opens one of the project's GitHub pages in a new tab, only when the user clicks. "noopener": the new tab gets no
 * handle on Kashiro's page (window.open then returns null, which is not a failure).
 */
export const openProjectPage: typeof desktop.openProjectPage = async (page) => {
  window.open(page === 'issues' ? ISSUES_URL : `${PROJECT_URL}/releases`, '_blank', 'noopener');
};
