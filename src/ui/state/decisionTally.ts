/**
 * Decisions the user made since the document was opened (the progress header's "of M"). A rejection counts
 * once however many places it covers, and "Review again" gives it back once: the first of its places to come
 * back gives back the decision, the others give back nothing. Callers update it only after the engine call
 * succeeded, so a failed action never moves the count.
 */
export class DecisionTally {
  private count = 0;
  /** Rejected candidate id → the rejection it was part of. */
  private readonly rejectedAs = new Map<string, string>();
  /** Rejections already given back. */
  private readonly reopened = new Set<string>();
  private rejections = 0;

  get decided(): number {
    return this.count;
  }

  /** `n` decisions made (an accept, a card, a dismissed rule: 1; an undo of an applied edit: 0). */
  made(n: number): void {
    this.count = Math.max(0, this.count + n);
  }

  /** A rejection of `decisionId`, covering the candidates `places`: one decision made. */
  rejected(decisionId: string, places: string[]): void {
    const rejection = `${decisionId}#${++this.rejections}`;
    for (const id of places) this.rejectedAs.set(id, rejection);
    this.made(1);
  }

  /**
   * A rejected candidate went back to review: gives back its rejection's decision, once per rejection. A
   * candidate rejected outside this tally (carried over by a re-check) gives back one.
   */
  reopen(candidateId: string): void {
    const rejection = this.rejectedAs.get(candidateId);
    this.rejectedAs.delete(candidateId);
    if (rejection === undefined) {
      this.made(-1);
      return;
    }
    if (this.reopened.has(rejection)) return;
    this.reopened.add(rejection);
    this.made(-1);
  }

  /**
   * A re-check renumbered the candidates (`ids`: old id → new id, from carryDecisions). Rejections follow their
   * candidates; a rejection whose candidate was not carried is forgotten (its paragraph changed).
   */
  remap(ids: ReadonlyMap<string, string>): void {
    const entries = [...this.rejectedAs];
    this.rejectedAs.clear();
    for (const [oldId, rejection] of entries) {
      const newId = ids.get(oldId);
      if (newId !== undefined) this.rejectedAs.set(newId, rejection);
    }
  }

  /** A new document: nothing decided yet. */
  reset(): void {
    this.count = 0;
    this.rejectedAs.clear();
    this.reopened.clear();
  }
}
