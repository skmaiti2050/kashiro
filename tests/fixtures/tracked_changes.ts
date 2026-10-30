import { extractDocx } from '@/formats/docx/extract';

/** One of Kashiro's revisions, whole: `<w:ins w:id="5" w:author="Kashiro" …>…</w:ins>` (never nested). */
const KASHIRO_INS = /<w:ins w:id="\d+" w:author="Kashiro"[^>]*>(.*?)<\/w:ins>/gs;
const KASHIRO_DEL = /<w:del w:id="\d+" w:author="Kashiro"[^>]*>(.*?)<\/w:del>/gs;

/** Deleted text read as normal text again: `<w:delText …>x</w:delText>` → `<w:t …>x</w:t>`. */
const restoreDeleted = (runs: string) => runs.replace(/<w:delText\b/g, '<w:t').replace(/<\/w:delText>/g, '</w:t>');

/** What Word shows after "Accept All Changes" on Kashiro's revisions: insertions kept, deletions gone. */
export function acceptAllTexts(xml: string): string[] {
  const accepted = xml.replace(KASHIRO_DEL, '').replace(KASHIRO_INS, (_, runs: string) => runs);
  return extractDocx(accepted, 0).map((d) => d.para.text);
}

/** What Word shows after "Reject All Changes" on Kashiro's revisions: insertions gone, deletions back. */
export function rejectAllTexts(xml: string): string[] {
  const rejected = xml.replace(KASHIRO_INS, '').replace(KASHIRO_DEL, (_, runs: string) => restoreDeleted(runs));
  return extractDocx(rejected, 0).map((d) => d.para.text);
}
