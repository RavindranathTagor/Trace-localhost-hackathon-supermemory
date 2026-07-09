import { describe, it, expect, vi } from "vitest";
import { detect, type DetectDeps } from "@/lib/detect";
import type { Prior } from "@/lib/car";
import type { NliResult } from "@/lib/nli";

const contradiction: NliResult = { label: "contradiction", scores: { contradiction: 0.95, entailment: 0.02, neutral: 0.03 } };
const entailment: NliResult = { label: "entailment", scores: { contradiction: 0.02, entailment: 0.95, neutral: 0.03 } };

describe("detect cascade", () => {
  it("resolves a confident grammar drift without touching NLI or the judge", async () => {
    const nli = vi.fn(async () => null);
    const judge = vi.fn(async () => null);
    const priors: Prior[] = [{ text: "No more MongoDB for new services.", similarity: 0.5, id: "m1" }];
    const r = await detect("Let's adopt MongoDB for analytics.", priors, { nli, judge });
    expect(r.top?.relation).toBe("drift");
    expect(r.top?.tier).toBe("grammar");
    expect(nli).not.toHaveBeenCalled();
    expect(judge).not.toHaveBeenCalled();
  });

  it("rescues an on-topic pair the grammar missed, via NLI", async () => {
    const nli = vi.fn(async () => contradiction);
    const judge = vi.fn(async () => null);
    // No decision grammar in either line, so the grammar tier returns none.
    const priors: Prior[] = [{ text: "Our system of record is the relational database.", similarity: 0.72, id: "p1" }];
    const r = await detect("Honestly the relational approach has been holding us back lately.", priors, { nli, judge });
    expect(nli).toHaveBeenCalledOnce();
    expect(r.top?.relation).toBe("drift");
    expect(r.top?.tier).toBe("nli");
  });

  it("treats an NLI entailment as a reaffirm signal, not an alert", async () => {
    const nli = vi.fn(async () => entailment);
    const priors: Prior[] = [{ text: "The plan is to keep shipping weekly.", similarity: 0.7, id: "p2" }];
    const r = await detect("We should absolutely continue our weekly cadence.", priors, { nli, judge: async () => null });
    expect(r.alerts).toHaveLength(0);
    expect(r.signals[0]?.relation).toBe("reaffirm");
  });

  it("lets the judge veto a borderline alert", async () => {
    const judge = vi.fn(async () => ({ real: false, relation: "none" as const, reason: "no real conflict" }));
    // Replacement-grammar drift at sim 0.5 lands ~0.775, below judgeSure, so it is judged.
    const priors: Prior[] = [{ text: "We standardized on Postgres.", similarity: 0.5, id: "p3" }];
    const r = await detect("Let's migrate to MongoDB.", priors, { nli: async () => null, judge });
    expect(judge).toHaveBeenCalledOnce();
    expect(r.alerts).toHaveLength(0);
    expect(r.top).toBeNull();
  });

  it("lets the judge confirm and relabel a borderline alert", async () => {
    const judge = vi.fn(async () => ({ real: true, relation: "drift" as const, reason: "switches the datastore the team settled" }));
    const priors: Prior[] = [{ text: "We standardized on Postgres.", similarity: 0.5, id: "p4" }];
    const r = await detect("Let's migrate to MongoDB.", priors, { nli: async () => null, judge });
    expect(r.top?.tier).toBe("judge");
    expect(r.top?.reason).toContain("datastore");
  });
});
