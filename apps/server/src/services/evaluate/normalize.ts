const PUNCTUATION_REGEX = /[^a-z0-9\s/\.]/gi;
const MULTI_SPACE_REGEX = /\s+/g;

const FREQUENCY_MAP: Record<string, string> = {
  bid: "twice daily",
  "b.i.d": "twice daily",
  "2x daily": "twice daily",
  "twice/day": "twice daily",
  tid: "three times daily",
  "t.i.d": "three times daily",
  qid: "four times daily",
  "q.i.d": "four times daily",
  qd: "once daily",
  daily: "once daily",
  od: "once daily",
  "once/day": "once daily",
  "qod": "every other day",
  prn: "as needed",
  qhs: "at bedtime",
};

function normalizeUnits(text: string): string {
  return text
    .replace(/(\d)\s*mg\b/gi, "$1mg")
    .replace(/(\d)\s*mcg\b/gi, "$1mcg")
    .replace(/(\d)\s*g\b/gi, "$1g")
    .replace(/(\d)\s*ml\b/gi, "$1ml");
}

export function normalizeText(value: string | null | undefined): string {
  if (!value) {
    return "";
  }

  const cleaned = normalizeUnits(value.toLowerCase())
    .replace(PUNCTUATION_REGEX, " ")
    .replace(MULTI_SPACE_REGEX, " ")
    .trim();

  return cleaned;
}

export function normalizeMedicationFrequency(value: string | null | undefined): string {
  const normalized = normalizeText(value);
  if (!normalized) {
    return "";
  }

  return FREQUENCY_MAP[normalized] ?? normalized;
}

export function normalizeDose(value: string | null | undefined): string {
  return normalizeUnits(normalizeText(value));
}

export function normalizeRoute(value: string | null | undefined): string {
  const normalized = normalizeText(value);
  if (!normalized) {
    return "";
  }

  if (["po", "oral", "by mouth"].includes(normalized)) return "po";
  if (["iv", "intravenous"].includes(normalized)) return "iv";
  if (["im", "intramuscular"].includes(normalized)) return "im";
  if (["sl", "sublingual"].includes(normalized)) return "sl";

  return normalized;
}

export function normalizeBloodPressure(value: string | null | undefined): string {
  return normalizeText(value).replace(/\s+/g, "");
}

export function tokenize(value: string): string[] {
  return normalizeText(value)
    .split(" ")
    .map((token) => token.trim())
    .filter(Boolean);
}
