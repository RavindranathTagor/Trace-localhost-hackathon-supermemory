// The NLI tier of the detection cascade.
//
// The grammar tier is fast and precise but literal: it can miss a contradiction phrased
// in free-form prose ("I think we should move away from the relational model" vs "our
// system of record is Postgres"). A natural-language-inference cross-encoder reads the
// pair directly and decides entailment / contradiction / neutral. It runs fully on-device
// via transformers.js (ONNX on CPU); the model downloads once and is cached under
// .models/. Any failure (model missing, offline first-run) returns null, so the cascade
// simply skips this tier rather than breaking.

import { config } from "@/lib/config";

export interface NliScores {
  contradiction: number;
  entailment: number;
  neutral: number;
}
export interface NliResult {
  label: "contradiction" | "entailment" | "neutral";
  scores: NliScores;
}

// Lazy singletons, cached on globalThis so the model loads at most once per process.
interface NliState {
  ready?: Promise<{ tokenizer: unknown; model: unknown; map: NliLabelMap } | null>;
}
interface NliLabelMap {
  contradiction: number;
  entailment: number;
  neutral: number;
}
const g = globalThis as unknown as { __traceNli?: NliState };
const nliState: NliState = (g.__traceNli ??= {});

function softmax(arr: number[]): number[] {
  const max = Math.max(...arr);
  const exps = arr.map((x) => Math.exp(x - max));
  const sum = exps.reduce((a, b) => a + b, 0) || 1;
  return exps.map((e) => e / sum);
}

/** Map the model's id2label to our fixed slots, tolerant of label spelling/order. */
function buildLabelMap(id2label: Record<string, string>): NliLabelMap {
  const map: NliLabelMap = { contradiction: 0, entailment: 1, neutral: 2 };
  for (const [idx, raw] of Object.entries(id2label)) {
    const label = raw.toLowerCase();
    const i = Number(idx);
    if (label.startsWith("contradict")) map.contradiction = i;
    else if (label.startsWith("entail")) map.entailment = i;
    else if (label.startsWith("neutral")) map.neutral = i;
  }
  return map;
}

async function ensureModel() {
  if (nliState.ready) return nliState.ready;
  nliState.ready = (async () => {
    try {
      const t = await import("@xenova/transformers");
      // Cache downloaded weights locally so subsequent runs are fully offline.
      t.env.cacheDir = ".models";
      const model = await t.AutoModelForSequenceClassification.from_pretrained(config.nli.model, {
        quantized: true,
      });
      const tokenizer = await t.AutoTokenizer.from_pretrained(config.nli.model);
      const id2label = (model.config as { id2label?: Record<string, string> }).id2label ?? {
        "0": "contradiction",
        "1": "entailment",
        "2": "neutral",
      };
      return { tokenizer, model, map: buildLabelMap(id2label) };
    } catch (err) {
      console.error("[nli] model unavailable, skipping tier:", err instanceof Error ? err.message : err);
      return null;
    }
  })();
  return nliState.ready;
}

/** Classify the relation from `prior` (premise) to `next` (hypothesis). Returns null if
 *  the model could not run, so callers treat NLI as "no opinion". */
export async function nli(premise: string, hypothesis: string): Promise<NliResult | null> {
  const loaded = await ensureModel();
  if (!loaded) return null;
  try {
    const { tokenizer, model, map } = loaded;
    // transformers.js tokenizers accept a sentence pair via text_pair.
    const encode = tokenizer as (t: string, o: Record<string, unknown>) => Promise<unknown>;
    const inputs = await encode(premise, { text_pair: hypothesis, truncation: true });
    const run = model as (i: unknown) => Promise<{ logits: { data: Float32Array | number[] } }>;
    const { logits } = await run(inputs);
    const raw = Array.from(logits.data as ArrayLike<number>);
    const probs = softmax(raw);
    const scores: NliScores = {
      contradiction: probs[map.contradiction] ?? 0,
      entailment: probs[map.entailment] ?? 0,
      neutral: probs[map.neutral] ?? 0,
    };
    let label: NliResult["label"] = "neutral";
    if (scores.contradiction >= scores.entailment && scores.contradiction >= scores.neutral) {
      label = "contradiction";
    } else if (scores.entailment >= scores.neutral) {
      label = "entailment";
    }
    return { label, scores };
  } catch (err) {
    console.error("[nli] inference failed:", err instanceof Error ? err.message : err);
    return null;
  }
}
