import type { MessageKey } from '../i18n/catalogues';
import type { Message, MessageValue } from '../i18n/message';

/** How many errors and notices "Report a bug" lists (F22 item 4). */
const KEPT = 20;

/**
 * One error or notice the app showed, by message key only: its values (file names, paths, a system error's text,
 * document words) are never kept, so the report can't leak them. `parts` are the keys of messages inside it.
 */
export interface RecentProblem {
  at: string;
  kind: 'error' | 'notice';
  key: MessageKey;
  parts: MessageKey[];
}

const isMessage = (value: MessageValue): value is Message => typeof value === 'object';

/** The last 20 errors and notices, in memory only (nothing is written or sent). */
export class RecentProblems {
  private readonly entries: RecentProblem[] = [];

  constructor(private readonly now: () => Date = () => new Date()) {}

  record(kind: RecentProblem['kind'], message: Message): void {
    const parts = Object.values(message.values ?? {})
      .filter(isMessage)
      .map((part) => part.key);
    this.entries.push({ at: this.now().toISOString(), kind, key: message.key, parts });
    if (this.entries.length > KEPT) this.entries.shift();
  }

  /** Oldest first. */
  list(): RecentProblem[] {
    return [...this.entries];
  }
}
