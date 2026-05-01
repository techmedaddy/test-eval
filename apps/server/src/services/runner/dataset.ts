import { readdir } from "node:fs/promises";
import type { ClinicalExtraction, DatasetCase } from "@test-evals/shared";

const TRANSCRIPTS_DIR = new URL("../../../../../data/transcripts/", import.meta.url);
const GOLD_DIR = new URL("../../../../../data/gold/", import.meta.url);

export async function listDatasetCaseIds(): Promise<string[]> {
  const files = await readdir(TRANSCRIPTS_DIR, { withFileTypes: true });

  return files
    .filter((entry) => entry.isFile() && entry.name.endsWith(".txt"))
    .map((entry) => entry.name.replace(/\.txt$/i, ""))
    .sort();
}

export async function loadDatasetCase(transcriptId: string): Promise<DatasetCase> {
  const transcriptFile = new URL(`${transcriptId}.txt`, TRANSCRIPTS_DIR);
  const goldFile = new URL(`${transcriptId}.json`, GOLD_DIR);

  const transcript = await Bun.file(transcriptFile).text();
  const gold = (await Bun.file(goldFile).json()) as ClinicalExtraction;

  return {
    transcriptId,
    transcript,
    gold,
  };
}
