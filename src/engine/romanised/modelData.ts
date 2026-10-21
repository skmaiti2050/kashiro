// The file format shared by the build script (scripts/build-romanised.ts) and the runtime (classifier.ts).
export interface RomanisedModelData {
  format: 1;
  /** Longest character n-gram counted (4: "^bha", "hai$"). */
  order: number;
  /**
   * Per language, n-gram counts for orders 1..order, one string per order: "gram count gram count …".
   * A word is padded with order-1 "^" before it and one "$" after it ("^^^bhai$").
   */
  languages: Record<RomanisedLanguage, string[]>;
}

export type RomanisedLanguage = 'hindi' | 'bengali' | 'english';
