// Contradiction-Aware Retrieval (CAR): the grammar tier of Trace's detection cascade.
//
// Similarity search answers "what is like X" and is blind to negation: "use Postgres"
// and "use MongoDB" are near-identical vectors, so similarity relates them but cannot
// tell you one reverses the other. CAR closes that gap. It decomposes a claim into the
// CHOICES it takes a stance on (each with a polarity) using generic decision grammar,
// then compares those against a prior memory to label the relation:
//
//   drift      new REVERSES prior      (opposing stance on the same choice, or a
//                                        migrate/switch to a different choice on a
//                                        topic the prior already settled)          -> alert
//   duplicate  new REDOES prior         (same choice + a build verb, or build-vs-build
//                                        on the same topic)                        -> alert
//   reaffirm   new RESTATES prior       (same choice, same stance, no new build)    -> signal
//   none       unrelated
//
// It is domain-general: there is NO hardcoded vocabulary of technologies. Whether two
// short phrases name the same choice is decided by an alias map + token overlap here,
// and the "are these even about the same thing" gate is Supermemory Local's own hybrid
// -search `similarity` score, passed in as `topicSim`. That is the key difference from a
// standalone implementation: Trace rides the backend's embeddings for the topic gate and
// only adds fresh grammar for the stance. Zero LLM calls in this tier.

export type Relation = "drift" | "duplicate" | "reaffirm" | "none";

/** Which relations warrant interrupting a human. reaffirm is signal, not noise. */
export const isAlert = (r: Relation): boolean => r === "drift" || r === "duplicate";

export type DetectTier = "grammar" | "nli" | "judge";

export interface Verdict {
  relation: Relation;
  confidence: number; // 0..1
  topicSim: number; // the Supermemory similarity that gated this pair
  stance: -1 | 0 | 1; // -1 opposing, 0 unrelated, +1 same
  reason: string;
  newChoice?: string; // the choice the new claim takes
  priorChoice?: string; // the choice the prior memory settled
  tier: DetectTier;
}

export const NONE: Verdict = {
  relation: "none",
  confidence: 0,
  topicSim: 0,
  stance: 0,
  reason: "",
  tier: "grammar",
};

export const CAR_THRESHOLDS = {
  // A prior below this Supermemory similarity is treated as a different topic, so the
  // topic-gated rules (replacement, build-vs-build) do not fire on it.
  topicGate: 0.4,
  // Build-vs-build duplicate needs at least this topic similarity.
  dupTopic: 0.55,
  // Token-overlap at/above this counts two phrases as the same choice.
  sameChoice: 0.6,
} as const;

// Strong replacement/commitment verbs: their presence means the claim proposes to
// REPLACE an incumbent, so a different choice on an already-settled topic is a reversal.
const REPLACEMENT_RE =
  /\b(migrat\w*|switch\w*|mov(?:e|ing|ed)|rewrit\w*|rebuild\w*|replac\w*|adopt\w*|go(?:ing)? with|instead of|standardiz\w*|convert\w*|port\w*|deprecat\w*)\b/;

// Build/create verbs: an affirmed choice under one of these is new work (duplicate risk).
const BUILD_RE =
  /\b(build\w*|built|creat\w*|implement\w*|start\w*|kick(?:ing)? off|kicked off|ship\w*|add|added|adding|set up|setting up|writ\w*|wrote|mak\w*|roll(?:ing)? out|introduc\w*|stand up)\b/;

// Negation/removal cues: a choice reached via one of these carries a negative polarity.
const NEGATION = [
  "no more", "instead of", "not", "stop using", "stop", "deprecate", "drop", "move off",
  "moving off", "away from", "roll back", "revert", "reverse", "kill", "sunset",
  "abandon", "no", "off", "from",
];

// Generic decision grammar: an object phrase following one of these cues (optionally via
// an article/preposition) is a "choice" the claim takes a stance on. No tech terms.
const OBJECT_RE =
  /\b(?:standardiz\w*|migrat\w*|mov\w*|switch\w*|adopt\w*|use\w*|run\w*|deploy\w*|build\w*|ship\w*|rebuild\w*|rewrit\w*|choos\w*|chose|pick\w*|replac\w*|introduc\w*|convert\w*|port\w*|go with|going with|is|are|on|onto|to|with|off|from|instead of|no more|not|stop|drop|deprecat\w*)\s+(?:the|a|an|our|new|using|over to)?\s*([a-z][a-z0-9.+#-]{2,}(?:\s+[a-z][a-z0-9.+#-]{2,})?)/g;

// Small morphological alias map (abbreviations/spelling), NOT a category taxonomy.
const ALIAS: Record<string, string> = {
  k8s: "kubernetes", mongo: "mongodb", postgres: "postgresql", pg: "postgresql",
  ts: "typescript", js: "javascript", gql: "graphql",
};

const STOP = new Set([
  "the", "a", "an", "our", "new", "using", "service", "services", "team", "this", "that",
  "for", "and", "to", "of", "in", "on", "we", "it", "is", "are", "will", "all", "them",
  "everything", "quarter", "week", "month", "year", "sprint", "today", "now",
]);

function norm(t: string): string {
  return " " + t.toLowerCase().replace(/[^a-z0-9\s#+.-]/g, " ").replace(/\s+/g, " ").trim() + " ";
}

/** Canonicalize a single token: strip edge punctuation, drop a trailing plural s, alias. */
function canonToken(s: string): string {
  const c = s.trim().replace(/^[.\-+#]+|[.\-+#]+$/g, "").replace(/s$/, "");
  return ALIAS[c] ?? c;
}

/** Canonicalize a (possibly multi-word) choice phrase. */
function canon(s: string): string {
  const c = s.trim().replace(/^[.\-+#]+|[.\-+#]+$/g, "");
  return ALIAS[c] ?? c;
}

export interface Choice {
  phrase: string;
  negated: boolean;
}

/** Extract the choices a claim takes a stance on, each with polarity, using generic
 *  decision grammar (no domain vocabulary). "standardize on Postgres, no more Mongo"
 *  yields Postgres:affirm and Mongo:negate. */
export function extractChoices(text: string): Choice[] {
  const n = norm(text);
  const out: Choice[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  OBJECT_RE.lastIndex = 0;
  while ((m = OBJECT_RE.exec(n))) {
    const cue = m[0].slice(0, m[0].length - m[1].length).trim();
    let phrase = m[1].trim();
    const words = phrase.split(" ").filter((w) => !STOP.has(w));
    if (words.length === 0) continue;
    phrase = words.join(" ");
    if (phrase.length < 3 || STOP.has(phrase)) continue;
    const negated = NEGATION.some(
      (c) => cue === c || cue.endsWith(" " + c) || cue.startsWith(c + " "),
    );
    if (seen.has(phrase)) continue;
    seen.add(phrase);
    out.push({ phrase, negated });
  }
  return out;
}

/** Token-overlap coefficient between two short phrases, alias-aware. Used only to decide
 *  whether two extracted choices name the same thing ("mongo" == "mongodb"); the topic
 *  gate itself comes from Supermemory similarity. */
export function phraseSim(a: string, b: string): number {
  const tok = (s: string) =>
    new Set(
      norm(s)
        .split(" ")
        .map(canonToken)
        .filter((w) => w.length > 2 && !STOP.has(w)),
    );
  const ta = tok(a);
  const tb = tok(b);
  if (!ta.size || !tb.size) return 0;
  let shared = 0;
  ta.forEach((t) => {
    if (tb.has(t)) shared++;
  });
  return shared / Math.min(ta.size, tb.size);
}

const hasBuild = (t: string) => BUILD_RE.test(norm(t));

/** Classify a NEW claim against a PRIOR memory, given the Supermemory topic similarity
 *  for the pair. Pure function, zero LLM. */
export function classify(
  newClaim: string,
  prior: string,
  topicSim: number,
  th = CAR_THRESHOLDS,
): Verdict {
  const base: Verdict = { ...NONE, topicSim };
  const na = extractChoices(newClaim);
  const da = extractChoices(prior);

  const sameObject = (a: string, b: string) =>
    canon(a) === canon(b) || phraseSim(a, b) >= th.sameChoice;

  let best: Verdict = base;
  const consider = (v: Verdict) => {
    if (v.relation !== "none" && v.confidence > best.confidence) best = v;
  };

  // Rule 1, shared choice object. A shared choice IS the topic link, so this runs
  // regardless of overall text similarity: naming the exact excluded choice ("MongoDB")
  // conflicts with "no more MongoDB" even months later and with no other shared words.
  for (const a of na) {
    for (const b of da) {
      if (!sameObject(a.phrase, b.phrase)) continue;
      if (a.negated !== b.negated) {
        // An explicit reversal on a named shared choice is the most certain drift there
        // is, so it outranks the inferred replacement-grammar drift below.
        consider({
          relation: "drift", confidence: 0.8 + topicSim * 0.2, topicSim, stance: -1,
          reason: `reverses the decision on "${b.phrase}"`, newChoice: a.phrase,
          priorChoice: b.phrase, tier: "grammar",
        });
      } else if (!a.negated && hasBuild(newClaim)) {
        consider({
          relation: "duplicate", confidence: 0.55 + topicSim * 0.35, topicSim, stance: 1,
          reason: `re-does "${b.phrase}" work already committed`, newChoice: a.phrase,
          priorChoice: b.phrase, tier: "grammar",
        });
      } else {
        consider({
          relation: "reaffirm", confidence: 0.4 + topicSim * 0.4, topicSim, stance: 1,
          reason: `restates the standing decision on "${b.phrase}"`, newChoice: a.phrase,
          priorChoice: b.phrase, tier: "grammar",
        });
      }
    }
  }

  // Rules 2 and 3 have no shared object, so they need the semantic topic gate.
  if (best.relation === "none" && topicSim >= th.topicGate) {
    // Rule 2, replacement grammar: a REPLACE/MIGRATE/SWITCH verb naming a choice
    // DIFFERENT from the one the prior settled is a reversal, without any category band.
    if (REPLACEMENT_RE.test(norm(newClaim))) {
      const claimAff = na.filter((c) => !c.negated);
      const priorAff = da.filter((c) => !c.negated);
      if (claimAff.length && priorAff.length) {
        const different = claimAff.some((a) =>
          priorAff.every((b) => !sameObject(a.phrase, b.phrase)),
        );
        if (different) {
          consider({
            relation: "drift", confidence: 0.6 + topicSim * 0.35, topicSim, stance: -1,
            reason: `switches to "${claimAff[0].phrase}" where the prior chose "${priorAff[0].phrase}"`,
            newChoice: claimAff[0].phrase, priorChoice: priorAff[0].phrase, tier: "grammar",
          });
        }
      }
    }
    // Rule 3, build-vs-build duplicate: both are build actions on the same topic.
    if (best.relation === "none" && hasBuild(newClaim) && hasBuild(prior) && topicSim >= th.dupTopic) {
      consider({
        relation: "duplicate", confidence: 0.45 + topicSim * 0.4, topicSim, stance: 1,
        reason: "builds something the prior already built or is building", tier: "grammar",
      });
    }
  }

  best.confidence = Math.min(1, best.confidence);
  return best;
}

export interface Prior {
  text: string;
  /** Supermemory hybrid-search similarity for this prior vs the new claim, 0..1. */
  similarity: number;
  /** Optional handle back to the source memory (customId / doc id). */
  id?: string;
}

export interface Alignment extends Verdict {
  prior: string;
  priorId?: string;
}

/** align: the general primitive. Given a NEW claim and the priors Supermemory returned
 *  (each carrying its similarity), return every non-trivial relation, ranked. Callers
 *  decide what to do (alert on drift/duplicate, strengthen health on reaffirm). */
export function align(
  newClaim: string,
  priors: Prior[],
  opts: { minConfidence?: number; relations?: Relation[] } = {},
): Alignment[] {
  const min = opts.minConfidence ?? 0.4;
  const keep = new Set<Relation>(opts.relations ?? ["drift", "duplicate", "reaffirm"]);
  return priors
    .map((p) => ({ ...classify(newClaim, p.text, p.similarity), prior: p.text, priorId: p.id }))
    .filter((v) => keep.has(v.relation) && v.confidence >= min)
    .sort((a, b) => b.confidence - a.confidence);
}
