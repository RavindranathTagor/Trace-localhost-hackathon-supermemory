import { describe, it, expect } from "vitest";
import { classify, align, extractChoices, isAlert, type Prior } from "@/lib/car";

describe("extractChoices", () => {
  it("pulls affirmed and negated choices from generic decision grammar", () => {
    const cs = extractChoices("We standardized on Postgres, no more MongoDB.");
    const pg = cs.find((c) => c.phrase.includes("postgres"));
    const mongo = cs.find((c) => c.phrase.includes("mongodb"));
    expect(pg?.negated).toBe(false);
    expect(mongo?.negated).toBe(true);
  });
});

describe("classify: drift", () => {
  it("catches a direct reversal on a shared choice, even months apart and reworded (age-blind)", () => {
    // The prior forbids MongoDB; the new claim adopts it. No shared words beyond the
    // choice itself, and only a modest topic similarity, yet Rule 1 still fires because
    // the shared choice IS the topic link. This is what similarity search cannot do.
    const v = classify("Let's adopt MongoDB for the analytics pipeline.", "No more MongoDB for new services.", 0.5);
    expect(v.relation).toBe("drift");
    expect(v.stance).toBe(-1);
    expect(v.confidence).toBeGreaterThan(0.66);
  });

  it("catches a migrate/switch to a different choice on a settled topic (replacement grammar)", () => {
    const v = classify("Let's migrate to MongoDB.", "We standardized on Postgres for all services.", 0.75);
    expect(v.relation).toBe("drift");
    expect(v.newChoice).toContain("mongodb");
    expect(v.priorChoice).toContain("postgres");
  });

  it("still returns drift on messier phrasing, even if the labeled choice is imperfect", () => {
    const v = classify("Migrating billing over to MongoDB.", "We standardized on Postgres.", 0.7);
    expect(v.relation).toBe("drift");
  });
});

describe("classify: duplicate", () => {
  it("flags build-vs-build on the same topic", () => {
    const v = classify(
      "Building a retry queue for payments.",
      "The platform team builds a shared retry queue every service reuses.",
      0.7,
    );
    expect(v.relation).toBe("duplicate");
  });
});

describe("classify: reaffirm", () => {
  it("treats a restatement as a strengthening signal, not an alert", () => {
    const v = classify("We are staying on Postgres.", "We standardized on Postgres.", 0.8);
    expect(v.relation).toBe("reaffirm");
    expect(isAlert(v.relation)).toBe(false);
    expect(v.stance).toBe(1);
  });
});

describe("classify: none", () => {
  it("stays silent on an unrelated, low-similarity prior", () => {
    const v = classify("Lunch is at noon on Friday.", "We standardized on Postgres.", 0.1);
    expect(v.relation).toBe("none");
  });

  it("does not fire replacement/build rules when the topic gate is closed", () => {
    // A migrate verb but a different topic (low similarity) must not become a false drift.
    const v = classify("Migrating the newsletter to a new template.", "We standardized on Postgres.", 0.2);
    expect(v.relation).toBe("none");
  });
});

describe("align", () => {
  it("ranks relations by confidence and can filter to alerts only", () => {
    const priors: Prior[] = [
      { text: "No more MongoDB for new services.", similarity: 0.55, id: "m1" },
      { text: "Standup is at 10am.", similarity: 0.05, id: "m2" },
      { text: "We standardized on Postgres.", similarity: 0.8, id: "m3" },
    ];
    const all = align("Let's adopt MongoDB for analytics.", priors);
    expect(all.length).toBeGreaterThanOrEqual(1);
    expect(all[0].relation).toBe("drift");
    expect(all[0].priorId).toBe("m1");

    const alertsOnly = align("Let's adopt MongoDB for analytics.", priors, { relations: ["drift", "duplicate"] });
    expect(alertsOnly.every((v) => isAlert(v.relation))).toBe(true);
  });
});
