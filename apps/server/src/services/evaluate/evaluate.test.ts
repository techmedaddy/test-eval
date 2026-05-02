import { describe, expect, it } from "bun:test";
import type { ClinicalExtraction } from "@test-evals/shared";
import { evaluateCase } from "./evaluate.service";

function baseExtraction(): ClinicalExtraction {
  return {
    chief_complaint: "Cough",
    vitals: { bp: "120/80", hr: 88, temp_f: 99.1, spo2: 98 },
    medications: [],
    diagnoses: [],
    plan: [],
    follow_up: { interval_days: 7, reason: "if not improved" },
  };
}

describe("evaluateCase metrics", () => {
  it("matches medications with fuzzy name + normalized dose/frequency", () => {
    const gold = baseExtraction();
    gold.medications = [
      {
        name: "Metformin",
        dose: "10 mg",
        frequency: "BID",
        route: "PO",
      },
    ];

    const predicted = baseExtraction();
    predicted.medications = [
      {
        name: "METFORMIN",
        dose: "10mg",
        frequency: "twice daily",
        route: "oral",
      },
    ];

    const score = evaluateCase(predicted, gold);

    expect(score.medications.precision).toBe(1);
    expect(score.medications.recall).toBe(1);
    expect(score.medications.f1).toBe(1);
  });

  it("computes set-F1 correctly for synthetic plan mismatch", () => {
    const gold = baseExtraction();
    gold.plan = ["Hydration", "Rest", "Chest X-ray"];

    const predicted = baseExtraction();
    predicted.plan = ["Hydration", "Use inhaler", "Steam inhalation"];

    const score = evaluateCase(predicted, gold);

    // TP = 1, predicted = 3, gold = 3 => P=1/3, R=1/3, F1=1/3
    expect(score.plan.precision).toBeCloseTo(1 / 3, 6);
    expect(score.plan.recall).toBeCloseTo(1 / 3, 6);
    expect(score.plan.f1).toBeCloseTo(1 / 3, 6);
  });
});
