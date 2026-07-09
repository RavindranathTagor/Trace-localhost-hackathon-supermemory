// The judge tier of the detection cascade.
//
// When the grammar and NLI tiers disagree or land in a low-confidence band, a local LLM
// makes the final call and phrases a one-line, human-readable rationale. It runs against
// Ollama's OpenAI-compatible endpoint, so the whole loop stays offline. Detection never
// depends on it: any failure returns null and the caller keeps the pre-judge verdict.

import { config } from "@/lib/config";
import type { Relation } from "@/lib/car";

export interface JudgeResult {
  real: boolean; // is the candidate relation genuinely present?
  relation: Relation;
  reason: string; // one line, human-facing
}

const SYSTEM = `You judge whether a NEW note conflicts with a PRIOR note in a memory system.
Relations:
- "drift": the NEW note REVERSES or replaces a decision the PRIOR note established.
- "duplicate": the NEW note REDOES work the PRIOR note shows is already done or in progress.
- "reaffirm": the NEW note RESTATES/agrees with the PRIOR note (not a conflict).
- "none": unrelated, or no genuine conflict.
Be conservative: only call "drift"/"duplicate" on a clear, specific conflict. When unsure, prefer "none".
Reply with STRICT JSON only, no prose:
{"relation":"drift|duplicate|reaffirm|none","real":true|false,"reason":"<= 16 words"}`;

interface ChatChoice {
  message?: { content?: string };
}
interface ChatResponse {
  choices?: ChatChoice[];
}

function extractJson(raw: string): JudgeResult | null {
  const cleaned = raw.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const s = cleaned.indexOf("{");
  const e = cleaned.lastIndexOf("}");
  if (s === -1 || e <= s) return null;
  try {
    const o = JSON.parse(cleaned.slice(s, e + 1)) as Partial<JudgeResult>;
    const relation = String(o.relation ?? "none").toLowerCase() as Relation;
    const ok: Relation[] = ["drift", "duplicate", "reaffirm", "none"];
    if (!ok.includes(relation)) return null;
    return {
      relation,
      real: relation !== "none" && o.real !== false,
      reason: String(o.reason ?? "").trim(),
    };
  } catch {
    return null;
  }
}

/** Ask the local model to confirm/deny a candidate relation and phrase the rationale. */
export async function judge(
  nextText: string,
  priorText: string,
  candidate: Relation,
): Promise<JudgeResult | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const res = await fetch(`${config.ollama.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model: config.ollama.model,
        temperature: 0.1,
        max_tokens: 200,
        messages: [
          { role: "system", content: SYSTEM },
          {
            role: "user",
            content:
              `PRIOR note: "${priorText}"\n\nNEW note: "${nextText}"\n\n` +
              `A cheaper detector suspects this is "${candidate}". Judge it.\nJSON:`,
          },
        ],
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as ChatResponse;
    const content = data.choices?.[0]?.message?.content ?? "";
    return extractJson(content);
  } catch (err) {
    console.error("[judge] unavailable:", err instanceof Error ? err.message : err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Whether at least one judge provider is configured (Ollama is always assumed local). */
export function judgeAvailable(): boolean {
  return !!config.ollama.baseUrl;
}
