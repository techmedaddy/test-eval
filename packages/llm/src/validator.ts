import Ajv from "ajv";
import { clinicalExtractionJsonSchema } from "@test-evals/shared";

const ajv = new Ajv({
  allErrors: true,
  strict: false,
});

const validateClinicalExtractionSchema = ajv.compile(clinicalExtractionJsonSchema);

export function validateClinicalExtraction(value: unknown): {
  valid: boolean;
  errors: string[];
} {
  const valid = validateClinicalExtractionSchema(value);

  if (valid) {
    return {
      valid: true,
      errors: [],
    };
  }

  const errors = (validateClinicalExtractionSchema.errors ?? []).map((error) => {
    const path = error.instancePath || "/";
    return `${path} ${error.message ?? "schema validation error"}`.trim();
  });

  return {
    valid: false,
    errors,
  };
}
