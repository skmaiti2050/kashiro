import type { CheckSession } from '@/engine/session';
import { pickSentences, sentenceAt, type PickedSentence } from '@/engine/llm/select';
import { offerRewrite, runBudget } from '@/engine/llm/suggest';
import type { Candidate } from '@/engine/types';
import { msg, type Message } from '../i18n/message';
import { explain } from './errors';
import { helper as startedRewriter, measureSpeed, type HelperHost } from './helperActions';
import { modulesFor } from './settings';

/** The AI group's part of the controller state. */
export interface AiState {
  /** Sentences answered and asked for, while a run lasts (the progress bar). */
  run: { done: number; total: number } | null;
  /** "Check how it reads" ran for this document: the group offers "Check more sentences" now. */
  checkedDocument: boolean;
  /** The group's last word: "No improvement suggested for this sentence", why nothing was sent… */
  notice: Message | null;
  /** A suggestion that came back for "Improve this sentence": the panel brings up its card. `seq` is new each time. */
  ready: { candidateId: string; seq: number } | null;
  /** The first-use speed check is running. */
  measuring: boolean;
}

export const NO_AI: AiState = { run: null, checkedDocument: false, notice: null, ready: null, measuring: false };

/** What the AI suggestions need from the controller: the helper's (see helperActions), and the review's. */
export interface AiHost extends HelperHost {
  /** Says `message` once through the screen-reader announcer. */
  announce(message: Message): void;
  /** "Accept all helper suggestions", as a review action (counted, unsaved, announced). */
  applyRewrites(candidateIds: string[]): void;
}

/** One sentence to ask about. `requested`: the user's "Improve this sentence" (its outcome is always told). */
interface Job {
  sentence: PickedSentence;
  requested: boolean;
  /** Its paragraph changed in a re-check: the answer is dropped. */
  dropped: boolean;
}

/** Sentences sent one at a time until the queue is empty or the run is cancelled. */
interface Run {
  abort: AbortController;
  queue: Job[];
  /** The sentence the helper is working on. */
  current: Job | null;
  done: number;
  total: number;
  added: number;
  /** It holds "Check how it reads" sentences: its end is announced. */
  checksDocument: boolean;
  /** Ended by another document or a resumed review: its answers are dropped and nothing more is said. */
  quiet: boolean;
}

const sameSentence = (a: PickedSentence, b: PickedSentence) => a.paraId === b.paraId && a.span.start === b.span.start && a.span.end === b.span.end;
const rewriteId = (s: PickedSentence) => `llm:${s.paraId}:${s.span.start}-${s.span.end}`;

/** The AI suggestions waiting for review, in document order. */
export function pendingSuggestions(session: CheckSession): Candidate[] {
  return session
    .outcomes()
    .filter((o) => o.candidate.source === 'llm' && o.status === 'pending' && o.unplaceable === undefined)
    .map((o) => o.candidate);
}

/**
 * AI help on demand (Task 13): "Check how it reads" and "Check more sentences" over the document, and "Improve
 * this sentence". One sentence goes to the helper at a time, in the background; each answer is offered as soon as
 * it is back, and nothing is ever applied without a click. Requested sentences go ahead of the document's. Cancel
 * keeps what came back. An answer whose sentence changed meanwhile is dropped (CheckSession.addRewrite). Nothing
 * here runs by itself, except the one-time speed check when AI rewrites are switched on.
 */
export class AiSuggestions {
  private active: Run | null = null;
  private working: Promise<void> = Promise.resolve();
  private measuring: AbortController | null = null;
  private measured: Promise<void> = Promise.resolve();
  private readySeq = 0;

  constructor(private readonly host: AiHost) {}

  /** AI rewrites are on and a model is chosen: the entry points show. */
  available(): boolean {
    return modulesFor(this.host.state().settings).aiRewrites;
  }

  /** "Check how it reads": the budgeted sentences (within the review depth's room). */
  checkDocument(): void {
    this.check(false);
  }

  /** "Check more sentences": the next sentences at the depth's "more" rate, even past the decision budget. */
  checkMore(): void {
    this.check(true);
  }

  /** "Improve this sentence" for the sentence of paragraph `paraId` at `offset`. */
  improveSentence(paraId: number, offset: number): void {
    const session = this.host.state().session;
    if (!session || !this.available()) return;
    const sentence = sentenceAt(session, paraId, offset);
    if (!sentence) return this.tell(msg('ai.cantImprove'));
    if (pendingSuggestions(session).some((c) => c.id === rewriteId(sentence))) {
      this.showReady(rewriteId(sentence));
      this.host.announce(msg('ai.alreadySuggested'));
      return;
    }
    // Asked before with nothing to offer: the same sentence gets the same answer (decision 2: no retry).
    if (session.sentToHelper(paraId, sentence.span)) return this.tell(msg('ai.noImprovement'));
    const run = this.active;
    if (run?.current && sameSentence(run.current.sentence, sentence)) {
      run.current.requested = true;
      return;
    }
    const queue = run?.queue ?? [];
    const queued = queue.findIndex((j) => sameSentence(j.sentence, sentence));
    if (queued >= 0) queue.splice(queued, 1);
    // After the other requested sentences, ahead of the document's.
    const ahead = queue.findIndex((j) => !j.requested);
    queue.splice(ahead === -1 ? queue.length : ahead, 0, { sentence, requested: true, dropped: false });
    this.host.announce(msg('ai.asking'));
    if (run) this.add(run, queued >= 0 ? 0 : 1, false);
    else this.start(queue, false);
  }

  /** "Improve this sentence" with no sentence to take: no cursor in the text, or typing the check has not caught up with. */
  noSentenceAtCursor(why: 'noCaret' | 'waitForCheck'): void {
    this.tell(msg(why === 'noCaret' ? 'ai.noCaret' : 'ai.waitForCheck'));
  }

  /** The module switches changed: AI rewrites off stops the run and the speed check; on runs the first-use speed check. */
  modulesChanged(): void {
    if (this.available()) this.measureSpeedIfNeeded();
    else this.stop();
  }

  /** Stops the run; the suggestions that came back stay. */
  cancel(): void {
    this.active?.abort.abort();
  }

  /** "Accept all helper suggestions" on the ones the user kept ticked. */
  acceptAll(candidateIds: string[]): void {
    this.host.applyRewrites(candidateIds);
  }

  /** AI rewrites went off: the run and the speed check stop (the controller stops the helper). */
  stop(): void {
    this.cancel();
    this.measuring?.abort();
  }

  /** Another document, or a resumed review: the run stops quietly and the group starts afresh. */
  reset(): void {
    const run = this.active;
    if (run) {
      run.quiet = true;
      run.abort.abort();
      this.active = null;
    }
    const { ai } = this.host.state();
    // Only when something shows: opening a document notifies its listeners no more than before.
    if (ai.run || ai.checkedDocument || ai.notice || ai.ready) this.host.set({ ai: { ...NO_AI, measuring: ai.measuring } });
  }

  /**
   * A re-check replaced the session (`unchanged`: old paragraph id → new): the suggestions of unchanged
   * paragraphs come along, and sentences waiting or on their way follow their paragraph; those whose paragraph
   * changed are dropped. Returns old candidate id → new, for the decision tally.
   */
  sessionReplaced(before: CheckSession, after: CheckSession, unchanged: Map<number, number>): Map<string, string> {
    const carried = after.carryRewritesFrom(before, unchanged);
    const run = this.active;
    if (!run) return carried;
    const follow = (job: Job) => {
      const paraId = unchanged.get(job.sentence.paraId);
      if (paraId === undefined) job.dropped = true;
      else job.sentence = { ...job.sentence, paraId };
    };
    run.queue.forEach(follow);
    if (run.current) follow(run.current);
    const kept = run.queue.filter((j) => !j.dropped);
    run.done += run.queue.length - kept.length;
    run.queue = kept;
    this.showProgress(run);
    return carried;
  }

  /** The one-time speed check (helperActions.measureSpeed), when AI rewrites are on; a failure is shown. */
  measureSpeedIfNeeded(): void {
    if (!this.available() || this.measuring) return;
    const abort = new AbortController();
    this.measuring = abort;
    this.updateAi({ measuring: true });
    this.measured = measureSpeed(this.host, abort.signal)
      .catch((e) => {
        if (!abort.signal.aborted) this.host.set({ error: explain(msg('error.helper'), e, msg('error.helperNext')) });
      })
      .finally(() => {
        this.measuring = null;
        this.updateAi({ measuring: false });
      });
  }

  /** Resolves once no run and no speed check is going. */
  async settled(): Promise<void> {
    let working: Promise<void>;
    let measured: Promise<void>;
    do {
      working = this.working;
      measured = this.measured;
      await Promise.all([working, measured]);
    } while (working !== this.working || measured !== this.measured);
  }

  private check(more: boolean): void {
    const session = this.host.state().session;
    if (!session || !this.available() || this.active) return;
    const picks = pickSentences(session, runBudget(session, more));
    this.updateAi({ checkedDocument: true });
    if (picks.length === 0) {
      const anyLeft = pickSentences(session, Infinity).length > 0;
      return this.tell(msg(!more && anyLeft ? 'ai.noRoom' : 'ai.nothingMore'));
    }
    this.host.announce(msg('ai.started', { count: picks.length }));
    this.start(
      picks.map((sentence) => ({ sentence, requested: false, dropped: false })),
      true,
    );
  }

  private start(queue: Job[], checksDocument: boolean): void {
    const run: Run = { abort: new AbortController(), queue, current: null, done: 0, total: queue.length, added: 0, checksDocument, quiet: false };
    this.active = run;
    this.updateAi({ notice: null });
    this.showProgress(run);
    this.working = this.work(run);
  }

  /** Counts `count` more queued sentences in a run that is going. */
  private add(run: Run, count: number, checksDocument: boolean): void {
    run.total += count;
    run.checksDocument ||= checksDocument;
    this.showProgress(run);
  }

  private async work(run: Run): Promise<void> {
    const { signal } = run.abort;
    let failed = false;
    try {
      while (!signal.aborted) {
        const job = run.queue.shift();
        if (!job) break;
        run.current = job;
        const reply = await this.ask(job, signal);
        run.current = null;
        // An answer that came back is kept even if Cancel was pressed while it arrived.
        if (reply !== undefined) this.place(run, job, reply);
        run.done++;
        this.showProgress(run);
      }
    } catch (e) {
      failed = !signal.aborted;
      if (failed && !run.quiet) this.host.set({ error: explain(msg('error.helper'), e, msg('error.helperNext')) });
    } finally {
      this.finish(run, failed);
    }
  }

  /** The helper's answer (null: nothing to change), or undefined when the run was cancelled before one came. */
  private async ask(job: Job, signal: AbortSignal): Promise<string | null | undefined> {
    const helper = startedRewriter(this.host);
    const { session, settings } = this.host.state();
    if (!helper || !session) return undefined;
    try {
      return await (await helper).rewrite(job.sentence.text, settings.preset, session.variant, signal);
    } catch (e) {
      if (signal.aborted) return undefined;
      throw e;
    }
  }

  /** Offers the answer in the session the user now sees; the user hears what became of a requested sentence. */
  private place(run: Run, job: Job, reply: string | null): void {
    const session = this.host.state().session;
    if (!session || run.quiet) return;
    const offer = job.dropped ? 'stale' : offerRewrite(session, job.sentence, reply);
    if (offer === 'added') {
      run.added++;
      if (job.requested) {
        this.showReady(rewriteId(job.sentence));
        this.host.announce(msg('ai.ready'));
      }
      return;
    }
    if (job.requested) this.tell(msg(offer === 'stale' ? 'ai.sentenceChanged' : 'ai.noImprovement'));
  }

  private finish(run: Run, failed: boolean): void {
    if (this.active !== run) return;
    this.active = null;
    this.updateAi({ run: null });
    if (failed) return;
    if (run.abort.signal.aborted) this.host.announce(msg('ai.stopped', { count: run.added }));
    else if (run.checksDocument) this.host.announce(msg('ai.done', { count: run.added }));
  }

  private showProgress(run: Run): void {
    if (this.active === run) this.updateAi({ run: { done: run.done, total: Math.max(run.total, run.done) } });
  }

  private showReady(candidateId: string): void {
    this.updateAi({ ready: { candidateId, seq: ++this.readySeq } });
  }

  /** Shows `message` in the group and says it. */
  private tell(message: Message): void {
    this.updateAi({ notice: message });
    this.host.announce(message);
  }

  private updateAi(patch: Partial<AiState>): void {
    this.host.set({ ai: { ...this.host.state().ai, ...patch } });
  }
}
