/**
 * Short texts written for this project that make Harper produce each message the engine or the UI
 * matches by its wording (Task S8): the Oxford comma and heading title case (src/engine/tiers.ts), the
 * missing fragment lint (src/engine/presets.ts) and the rewrites in src/ui/state/plainMessages.ts.
 * They are part of the Harper snapshot, so a changed wording shows up in its diff.
 */
export interface Probe {
  id: string;
  /** .md probes are linted as Markdown (headings), .txt as plain text. */
  fileName: 'probe.md' | 'probe.txt';
  text: string;
}

export const PROBES: Probe[] = [
  { id: 'oxford-comma', fileName: 'probe.txt', text: 'We bought rice, lentils and sugar.' },
  { id: 'heading-title-case', fileName: 'probe.md', text: '# a guide to the monsoon\n\nThe rains came early.' },
  { id: 'fragments', fileName: 'probe.txt', text: 'Big news. Huge. Because reasons.' },
];
