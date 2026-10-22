// The decisions-table check of upgrade:check (Task S8): trust/out/decisions.md against the md5 recorded in
// deps/snapshots/reference-values.json.

export interface DecisionsVerdict {
  failed: boolean;
  /** Whether to write the new md5 to reference-values.json. Never when the table is missing. */
  record: boolean;
  line: string;
}

/** `md5` is undefined when the decisions test did not write the table. */
export function decisionsVerdict(md5: string | undefined, recorded: string | undefined): DecisionsVerdict {
  const label = 'Decisions table (trust/out/decisions.md)';
  if (md5 === undefined) {
    return { failed: true, record: false, line: `${label} is MISSING: the decisions test did not write it. reference-values.json left as it was.` };
  }
  if (md5 === recorded) return { failed: false, record: true, line: `${label} md5 ${md5}: unchanged.` };
  return { failed: false, record: true, line: `${label} md5 ${md5}: CHANGED (was ${recorded ?? 'not recorded'}); read deps/reports/decisions.md.` };
}
