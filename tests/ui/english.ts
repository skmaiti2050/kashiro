import type { Message } from '@/ui/i18n/message';
import { createTranslator } from '@/ui/i18n/translator';

/** The English UI on a US PC, as the tests read it. */
export const en = createTranslator('en', ['en-US']);

/** A kept message (notice, error, announcement) in English; null stays null. */
export const english = (message: Message | null | undefined): string | null => (message ? en.format(message) : null);
