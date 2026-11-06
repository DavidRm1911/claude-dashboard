import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseCodex, parseGrok, parseAgy, createProviderStore, summarizeProvider, normalizeQuota } from "../lib/providers.js";

const tokenEvent = (input, output, cached, timestamp = "2026-09-28T12:00:00Z") => ({ timestamp, type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { input_tokens: input, output_tokens: output, cached_input_tokens: cached } } } });

test("Codex cumulative snapshots, duplicate events, stale snapshots, cache subset", () => {
  const s = parseCodex([
    { type: "session_meta", timestamp: "2026-09-27T12:00:00Z", payload: { id: "a", cwd: "/repo" } },
    { type: "turn_context", payload: { model: "test-model" } },
    tokenEvent(100, 20, 60, "2026-09-27T12:00:00Z"), tokenEvent(100, 20, 60),
    tokenEvent(90, 10, 50), tokenEvent(200, 50, 130),
  ]);
  assert.deepEqual(s.tokens, { input: 70, output: 50, cacheRead: 130, total: 250 });
  assert.equal(s.byDay["2026-09-28"].total, 130);
  assert.equal(s.model, "test-model");
  assert.equal(s.project, "/repo");
});

test("Codex missing token telemetry remains null", () => {
  assert.equal(parseCodex([{ type: "event_msg", payload: { type: "token_count", info: null } }]).tokens, null);
});

test("Grok counts turns once and never adds the session total", () => {
  const turn = { turnNumber: 1, endedAt: "2026-09-28T12:00:00Z", inputTokens: 100, outputTokens: 20, cachedReadTokens: 70 };
  const s = parseGrok({ sessionId: "g", session: { inputTokens: 10000 }, turns: [turn, turn, { ...turn, turnNumber: 2, outputTokens: 30 }] });
  assert.deepEqual(s.tokens, { input: 60, output: 50, cacheRead: 140, total: 250 });
});

test("AGY distinguishes activity from tokens and deduplicates steps", () => {
  const record = { step_index: 0, type: "USER_INPUT", created_at: "2026-09-28T12:00:00Z" };
  const s = parseAgy([record, record, { step_index: 1, type: "PLANNER_RESPONSE", tool_calls: [{}, {}] }], "a");
  assert.equal(s.messages, 2);
  assert.equal(s.tools, 2);
  assert.equal(s.tokens, null);
});

test("Provider opt-in persists privately, invalid providers cannot create config", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dashboard-provider-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true }));
  const store = createProviderStore({ home: dir, dataDir: dir });
  assert.throws(() => store.setEnabled("../outside", true));
  assert.equal(fs.existsSync(path.join(dir, "providers.json")), false);
  store.setEnabled("codex", true);
  assert.equal(fs.statSync(path.join(dir, "providers.json")).mode & 0o777, 0o600);
  const reloaded = createProviderStore({ home: dir, dataDir: dir });
  const result = await reloaded.get();
  assert.equal(result.providers[0].enabled, true);
  assert.equal(result.providers[0].tokens, null);
});

test("AGY real .system_generated/logs layout and dual transcripts count one session", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dashboard-agy-layout-"));
  t.after(() => fs.rmSync(dir, { recursive: true }));
  const root = path.join(dir, ".gemini", "antigravity-cli", "brain");
  for (const id of ["a", "b"]) {
    const logs = path.join(root, id, ".system_generated", "logs");
    fs.mkdirSync(logs, { recursive: true });
    const record = JSON.stringify({ step_index: 0, type: "USER_INPUT", created_at: "2026-09-28T12:00:00Z" });
    fs.writeFileSync(path.join(logs, "transcript.jsonl"), record);
    fs.writeFileSync(path.join(logs, "transcript_full.jsonl"), record + "\ntruncated-json");
  }
  const store = createProviderStore({ home: dir, dataDir: path.join(dir, "data") });
  store.setEnabled("agy", true);
  const p = (await store.get()).providers.find((p) => p.id === "agy");
  assert.equal(p.sessionCount, 2);
  assert.equal(p.tokens, null);
  assert.equal(p.diagnostics.corruptLines, 2);
  assert.deepEqual(p.sessions.map((s) => s.id).sort(), ["agy:a", "agy:b"]);
});

test("Codex model switches attribute increments to their actual turn", () => {
  const s = parseCodex([{ type: "turn_context", payload: { model: "gpt-5.5" } }, tokenEvent(100, 20, 60), { type: "turn_context", payload: { model: "gpt-6-sol" } }, tokenEvent(200, 50, 130)]);
  const p = summarizeProvider([s]);
  assert.equal(p.tokens.total, 250);
  assert.equal(p.byModel.find((m) => m.model === "gpt-5.5").tokens.total, 120);
  assert.equal(p.byModel.find((m) => m.model === "gpt-6-sol").tokens.total, 130);
  assert(p.referenceUSD > 0);
});
test("Provider range uses exact timestamps, not whole UTC calendar buckets", () => {
  const s = parseCodex([tokenEvent(100, 20, 60, "2026-09-28T01:00:00Z"), tokenEvent(200, 50, 130, "2026-09-28T12:00:00Z")]);
  const p = summarizeProvider([s], Date.parse("2026-09-28T06:00:00Z"));
  assert.equal(p.tokens.total, 130);
  assert.equal(p.byDay[0].tokens.total, 130);
  assert.equal(p.sessions[0].tokens.total, 250);
});
test("Grok ticks, zero cost, and model usage do not double-count session/turn totals", () => {
  const turn = { turnNumber: 1, endedAt: "2026-09-28T12:00:00Z", inputTokens: 100, outputTokens: 20, cachedReadTokens: 70, costUsdTicks: 1e10, primaryModelId: "grok", modelUsage: { grok: { inputTokens: 100, outputTokens: 20, cachedReadTokens: 70, costUsdTicks: 1e10 } } };
  const s = parseGrok({ session: { costUsdTicks: 9e10 }, turns: [turn, turn] });
  const p = summarizeProvider([s]);
  assert.equal(p.costUSD, 1); assert.equal(p.tokens.total, 120); assert.equal(p.byModel[0].costUSD, 1);
  assert.equal(summarizeProvider([parseGrok({ turns: [{ ...turn, modelUsage: {}, costUsdTicks: 0 }] })]).costUSD, 0);
  assert.equal(summarizeProvider([parseGrok(null)]).costUSD, null);
});
test("AGY activity has daily/project breakdown but no fabricated tokens or cost", () => {
  const s = parseAgy([{ step_index: 1, type: "USER_INPUT", created_at: "2026-09-28T12:00:00Z", tool_calls: [{}, {}] }], "a");
  const p = summarizeProvider([s]);
  assert.equal(p.tokens, null); assert.equal(p.costUSD, null);
  assert.equal(p.byDay[0].messages, 1); assert.equal(p.byDay[0].tools, 2);
  assert.equal(p.byProject[0].project, "Sin proyecto registrado");
});
test("Codex quotas normalize only safe fields and select newest snapshot independently of range", () => {
  assert.equal(normalizeQuota({ primary: { used_percent: "20" } }, "2026-09-28T12:00:00Z", "s", null), null);
  const s = parseCodex([{ type: "event_msg", timestamp: "2026-09-28T12:00:00Z", payload: { type: "token_count", rate_limits: { plan_type: "plus", primary: { used_percent: 28, window_minutes: 300, resets_at: 1790668981 }, token: "never expose" } } }]);
  const p = summarizeProvider([s], Date.parse("2026-09-29T00:00:00Z"));
  assert.equal(p.sessionCount, 0); assert.equal(p.quota.primary.usedPercent, 28);
  assert.equal(JSON.stringify(p.quota).includes("never expose"), false);
});
