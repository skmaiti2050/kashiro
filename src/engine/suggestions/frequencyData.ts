// The file format shared by the build script (scripts/build-frequency.ts) and the runtime (frequency.ts).
export interface FrequencyData {
  format: 1;
  /** [Zipf frequency rounded to 0.1, space-separated lowercase words], most frequent bucket first. */
  buckets: [number, string][];
}
