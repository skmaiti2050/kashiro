import { describe, it, expect } from "vitest";
import { LocalLinter } from "harper.js";
import { binaryInlined } from "harper.js/binaryInlined";

describe("harper.js smoke", () => {
  it("flags a typo with the right suggestion", async () => {
    const linter = new LocalLinter({ binary: binaryInlined });
    const lints = await linter.lint("teh cat");
    expect(lints).toHaveLength(1);
    expect(lints[0].lint_kind()).toBe("Typo");
    expect(lints[0].suggestions()[0].get_replacement_text()).toBe("the");
  });
});
