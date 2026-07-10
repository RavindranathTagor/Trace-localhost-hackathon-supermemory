// The detection cascade: grammar -> NLI -> judge, over the priors Supermemory returned.
//
// Precision is the whole product, so the cascade is layered by cost and certainty:
//   0. topic gate      Supermemory's hybrid-search `similarity` decides "same topic?"
//   1. grammar         zero-LLM CAR classifier; a confident hit resolves immediately
//   2. NLI             a local cross-encoder rescues on-topic pairs the grammar missed
//                      or was unsure about (free-form prose)
//   3. judge           a local LLM confirms borderline alerts and phrases the rationale;
//                      it can VETO a weak alert down to nothing
// NLI and judge are injected (defaults are the real local modules) so the orchestration
// is unit-testable without the models.

import { classify, isAlert, type Alignment, type Prior, type Relation, type Verdict } from "@/lib/car";
import { config } from "@/lib/config";
import { nli as defaultNli, type NliResult } from "@/lib/nli";
import { judge as defaultJudge } from "@/lib/judge";

export interface DetectDeps {
  nli?: (premise: string, hypothesis: string) => Promise<NliResult | null>;
  judge?: (next: string, prior: string, candidate: Relation) => Promise<{ real: boolean; relation: Relation; reason: string } | null>;
}

export const BANDS = {
  // Grammar at/below this confidence (or "none") on an on-topic prior escalates to NLI.
  grammarSettled: 0.7,
  // NLI's winning probability must exceed this to count as an opinion.
  nliTrust: 0.55,
  // Alerts below this confidence get a judge confirmation (which may veto them).
  judgeSure: 0.85,
} as const;

export interface DetectResult {
  alerts: Alignment[]; // drift + duplicate, ranked
  signals: Alignment[]; // reaffirm, ranked
  top: Alignment | null; // the single most confident relation overall
}

/** Turn an NLI reading into a Verdict, carrying any choices the grammar found. */
function fromNli(n: NliResult, topicSim: number, grammar: Verdict): Verdict | null {
  if (n.label === "contradiction" && n.scores.contradiction >= BANDS.nliTrust) {
    return {
      relation: "drift", confidence: 0.5 + n.scores.contradiction * 0.4, topicSim, stance: -1,
      reason: "reads as a reversal of the prior note", newChoice: grammar.newChoice,
      priorChoice: grammar.priorChoice, tier: "nli",
    };
  }
  if (n.label === "entailment" && n.scores.entailment >= BANDS.nliTrust) {
    return {
      relation: "reaffirm", confidence: 0.4 + n.scores.entailment * 0.4, topicSim, stance: 1,
      reason: "restates the standing note", newChoice: grammar.newChoice,
      priorChoice: grammar.priorChoice, tier: "nli",
    };
  }
  return null;
}

async function classifyPair(next: string, prior: Prior, deps: DetectDeps): Promise<Alignment | null> {
  const g = classify(next, prior.text, prior.similarity);
  let v: Verdict = g;

  const onTopic = prior.similarity >= config.detect.topicGate;

  // Tier 2: rescue on-topic pairs the grammar was unsure about.
  if (onTopic && (g.relation === "none" || g.confidence < BANDS.grammarSettled) && deps.nli) {
    const n = await deps.nli(prior.text, next);
    if (n) {
      const nv = fromNli(n, prior.similarity, g);
      if (nv && nv.confidence > v.confidence) v = nv;
    }
  }

  // Tier 3: confirm alerts; a veto drops the pair. NLI is the least reliable tier (it can
  // read unrelated same-domain notes as contradictions), so NLI-derived alerts are ALWAYS
  // judged, regardless of confidence; grammar alerts are judged only when not clearly sure.
  const needsJudge = isAlert(v.relation) && (v.tier === "nli" || v.confidence < BANDS.judgeSure);
  if (needsJudge && deps.judge) {
    const j = await deps.judge(next, prior.text, v.relation);
    if (j) {
      if (!j.real || j.relation === "none") return null;
      v = {
        ...v, relation: j.relation, reason: j.reason || v.reason, tier: "judge",
        confidence: Math.max(v.confidence, 0.75),
      };
    } else if (v.tier === "nli") {
      // Fail closed: an NLI-derived alert that the judge could not confirm is dropped
      // rather than trusted, since NLI alone is the least reliable signal.
      return null;
    }
  }

  if (v.relation === "none") return null;
  return { ...v, prior: prior.text, priorId: prior.id };
}

/** Cheap grammar-only score to order priors before spending any LLM calls: grammar
 *  alerts first, then reaffirms, then on-topic priors (NLI candidates) by similarity. */
function gradeScore(next: string, p: Prior): number {
  const g = classify(next, p.text, p.similarity);
  if (isAlert(g.relation)) return 100 + g.confidence;
  if (g.relation === "reaffirm") return 50 + g.confidence;
  return p.similarity;
}

/** Run the cascade and return ranked alerts + reaffirm signals.
 *  Supermemory can return many related priors; judging each with the local LLM would be
 *  slow, so we grade cheaply first, run the full cascade only on the top candidates, and
 *  stop at the first CONFIRMED alert. This bounds LLM calls (typically one) per write. */
export async function detect(
  next: string,
  priors: Prior[],
  deps: DetectDeps = { nli: config.detect.useNli ? defaultNli : undefined, judge: defaultJudge },
): Promise<DetectResult> {
  const ordered = [...priors].sort((a, b) => gradeScore(next, b) - gradeScore(next, a)).slice(0, 5);
  const results: Alignment[] = [];
  for (const p of ordered) {
    const a = await classifyPair(next, p, deps);
    if (a) results.push(a);
    if (a && isAlert(a.relation)) break; // first confirmed alert wins; keeps it fast
  }
  results.sort((a, b) => b.confidence - a.confidence);
  return {
    alerts: results.filter((r) => isAlert(r.relation)),
    signals: results.filter((r) => r.relation === "reaffirm"),
    top: results[0] ?? null,
  };
}
