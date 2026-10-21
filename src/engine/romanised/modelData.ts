// The file format shared by the build script (scripts/build-romanised.ts) and the runtime (classifier.ts).

/** The Indian languages the card collects, one n-gram model each. */
export const INDIAN_LANGUAGES = [
  'hindi',
  'bengali',
  'tamil',
  'telugu',
  'kannada',
  'malayalam',
  'marathi',
  'gujarati',
  'punjabi',
  'urdu',
] as const;

export type IndianLanguage = (typeof INDIAN_LANGUAGES)[number];

export interface RomanisedModelData {
  format: 2;
  /** Longest character n-gram counted (4: "^bha", "hai$"). */
  order: number;
  /**
   * Per language, n-gram counts for orders 1..order, one string per order: "gram count gram count …".
   * A word is padded with order-1 "^" before it and one "$" after it ("^^^bhai$").
   */
  english: string[];
  indian: Record<IndianLanguage, string[]>;
}
