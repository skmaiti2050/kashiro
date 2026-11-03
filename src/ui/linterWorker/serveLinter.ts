import type { RulesLinter } from '../../engine/linter';
import type { Candidate, Variant } from '../../engine/types';
import type { LinterReply, LinterRequest } from './protocol';

/**
 * The Worker side: answers each request with the linter `create` made on `start`. Requests are answered as they
 * finish, so the main side matches replies by id. Never throws: an error (a Harper panic) becomes `ok: false`.
 */
export function serveLinter(
  create: (variant: Variant, words: string[]) => Promise<RulesLinter>,
): (request: LinterRequest) => Promise<LinterReply> {
  // A promise, so a request that arrives while `start` is still loading Harper waits for it.
  let linter: Promise<RulesLinter> | undefined;

  const run = async (request: LinterRequest): Promise<Candidate[] | undefined> => {
    if (request.op === 'start') {
      linter = create(request.variant, request.words);
      await linter;
      return undefined;
    }
    if (!linter) throw new Error('The proofreader was not started');
    const l = await linter;
    switch (request.op) {
      case 'lintParagraphs':
        return l.lintParagraphs(request.paras, request.language);
      case 'lintSpelling':
        return l.lintSpelling(request.paras, request.variant);
      case 'addWords':
        await l.addWords(request.words);
        return undefined;
      case 'setVariant':
        await l.setVariant(request.variant);
        return undefined;
    }
  };

  return async (request) => {
    try {
      const candidates = await run(request);
      return candidates ? { id: request.id, ok: true, candidates } : { id: request.id, ok: true };
    } catch (error) {
      return { id: request.id, ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  };
}
