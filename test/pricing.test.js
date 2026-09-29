import { test } from "node:test";
import assert from "node:assert/strict";
import { getPricing, estimateCost, pricingCoverage, codexBaseReference } from "../lib/pricing.js";

test("Current Claude 5 models and dated IDs are priced, future suffixes are not", () => {
  assert.equal(getPricing("claude-sonnet-5").input, 2);
  assert.equal(getPricing("claude-opus-5").output, 25);
  assert.equal(getPricing("claude-opus-5-5").cacheRead, .2);
  assert.equal(getPricing("claude-sonnet-5-5").input, 2);
  assert.equal(getPricing("claude-haiku-4-5-20251001").output, 5);
  for (const model of ["claude-opus-5-6", "claude-sonnet-5-unknown", "unknown"]) {
    assert.equal(getPricing(model).unknown, true);
    assert.equal(estimateCost(model, 100, 100, 100, 100), null);
  }
});
test("Mixed cache TTL is charged once and matches the real Haiku fixture", () => {
  const actual = estimateCost("claude-haiku-4-5-20251001", 14621, 439941, 12645282, 33226554, 12449316);
  assert(Math.abs(actual - 30.6805709) < 1e-9);
  assert.equal(estimateCost("claude-opus-5-5", 1e6, 1e6, 2e6, 1e6, 1e6), 37.2);
});
test("Unknown model and TTL coverage never imply a zero-cost complete total", () => {
  const p = pricingCoverage({ "claude-sonnet-5": { input: 0, output: 0, cacheCreate: 1000, cacheRead: 0, total: 1000, cacheUnknown: 1000 }, missing: { total: 3000 } });
  assert.equal(p.tokenPercent, 25);
  assert.equal(p.complete, false);
  assert.equal(p.unknownCacheMaxDeltaUSD, .0015);
  assert.deepEqual(p.unknownModels, ["missing"]);
});
test("Codex base reference counts cached input once; unsupported model remains null", () => {
  assert.equal(codexBaseReference("gpt-6-sol", { input: 1e6, output: 1e6, cacheRead: 1e6 }), 12.2);
  assert.equal(codexBaseReference("codex-auto-review", { input: 10, output: 20, cacheRead: 0 }), null);
});
