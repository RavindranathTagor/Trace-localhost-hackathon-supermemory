#!/usr/bin/env node
// Seed a realistic decision history through Trace so the dashboard has something to show.
// Posts each memory in order to the running Trace app (default http://localhost:7070) and
// prints the verdict Trace returned, so you can watch drift/duplicate/reaffirm fire live.
//
// Run the Trace app first (npm run dev), then: npm run seed

const TRACE = (process.env.TRACE_URL || "http://localhost:7070").replace(/\/+$/, "");

// Ordered so later lines relate to earlier ones. Comments note the expected relation.
const CORPUS = [
  "We standardized on Postgres for all services.", // baseline
  "The platform team builds one shared retry queue every service must reuse.", // baseline
  "Public API is REST with a typed SDK.", // baseline
  "Migrating billing to MongoDB.", // drift vs Postgres
  "Building a retry queue for the payments service.", // duplicate vs shared retry queue
  "Confirming we are keeping the REST + typed SDK approach.", // reaffirm vs REST
  "Standup moved to 10am.", // none
];

async function add(content) {
  const res = await fetch(`${TRACE}/api/v3/documents`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text().catch(() => "")}`);
  return res.json();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log(`Seeding ${CORPUS.length} memories through Trace at ${TRACE}\n`);
  for (const content of CORPUS) {
    try {
      const r = await add(content);
      const t = r.trace;
      const tag = t && t.relation !== "none" ? `${t.relation.toUpperCase()} (${Math.round(t.confidence * 100)}% ${t.tier})` : "stored";
      console.log(`[${tag}] ${content}`);
      if (t && t.prior) console.log(`        ↳ ${t.reason}  (prior: "${t.prior}")`);
    } catch (err) {
      console.error(`[error] ${content}\n        ${err.message}`);
    }
    // Let instant-dreaming index each memory before the next check.
    await sleep(1500);
  }
  console.log("\nDone. Open the dashboard to see the belief timeline and CLAUDE.md.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
