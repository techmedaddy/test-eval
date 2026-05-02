import { describe, expect, it } from "bun:test";
import type { ClinicalExtraction } from "@test-evals/shared";
import { detectHallucinations } from "./hallucination.service";

function extractionForHallucination(): ClinicalExtraction {
  return {
    chief_complaint: "cough",
    vitals: { bp: "120/80", hr: 88, temp_f: 99.1, spo2: 98 },
    medications: [
      { name: "paracetamol", dose: "500mg", frequency: "twice daily", route: "by mouth" },
    ],
    diagnoses: [{ description: "viral upper respiratory infection", icd10: "J06.9" }],
    plan: ["hydration"],
    follow_up: { interval_days: 7, reason: "if not improved" },
  };
}

describe("detectHallucinations", () => {
  it("flags unsupported predicted values (positive case)", () => {
    const predicted = extractionForHallucination();
    predicted.medications = [{ name: "warfarin", dose: "5mg", frequency: "daily", route: "po" }];

    const transcript = "Patient reports mild cough for two days. Advised hydration and rest.";

    const result = detectHallucinations(predicted, transcript);

    expect(result.count).toBeGreaterThan(0);
    expect(result.flags.some((flag) => flag.fieldPath.includes("medications[0].name") && !flag.grounded)).toBe(true);
  });

  it("does not flag grounded predicted values (negative case)", () => {
    const predicted = extractionForHallucination();

    const transcript =
      "Patient has cough. Vitals: BP 120/80, HR 88, temp 99.1, spo2 98. " +
      "Started paracetamol 500mg twice daily by mouth. Diagnosed viral upper respiratory infection J06.9. " +
      "Plan hydration. Follow up in 7 days if not improved.";

    const result = detectHallucinations(predicted, transcript);

    expect(result.count).toBe(0);
  });
});
