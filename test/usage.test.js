import { test } from "node:test";
import assert from "node:assert/strict";
import { takeUsageDelta } from "../lib/usage.js";

test("Claude identical usage on repeated content blocks must count once", () => {
  const seen = new Map();
  const actual = { input_tokens: 10, output_tokens: 227, cache_creation_input_tokens: 9722, cache_read_input_tokens: 22648 };
  assert.deepEqual(takeUsageDelta(seen, "message", actual), actual);
  assert.deepEqual(takeUsageDelta(seen, "message", actual), { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 });
});

test("Claude updates count only the increase, new message IDs stay independent", () => {
  const seen = new Map();
  takeUsageDelta(seen, "a", { input_tokens: 100, output_tokens: 10 });
  assert.equal(takeUsageDelta(seen, "a", { input_tokens: 100, output_tokens: 30 }).output_tokens, 20);
  assert.equal(takeUsageDelta(seen, "a", { input_tokens: 90, output_tokens: 20 }).output_tokens, 0);
  assert.equal(takeUsageDelta(seen, "b", { input_tokens: 100, output_tokens: 30 }).output_tokens, 30);
});

test("Malformed tokens cannot inject NaN, negatives or strings into totals", () => {
  assert.deepEqual(takeUsageDelta(new Map(), "a", { input_tokens: -2, output_tokens: "30", cache_read_input_tokens: Infinity }), { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 });
});

test("Claude 5m/1h TTL increments deduplicate repeated and stale snapshots", () => {
  const seen = new Map(), options = { includeCacheTTL: true };
  const snapshot = { cache_creation_input_tokens: 100, cache_creation: { ephemeral_5m_input_tokens: 40, ephemeral_1h_input_tokens: 60 } };
  const first = takeUsageDelta(seen, "a", snapshot, options);
  assert.equal(first.cache5m, 40); assert.equal(first.cache1h, 60); assert.equal(first.cacheUnknown, 0);
  const repeated = takeUsageDelta(seen, "a", snapshot, options);
  assert.equal(repeated.cache1h, 0); assert.equal(repeated.cache_creation_input_tokens, 0);
  const stale = takeUsageDelta(seen, "a", { cache_creation_input_tokens: 50, cache_creation: { ephemeral_1h_input_tokens: 10 } }, options);
  assert.equal(stale.cache1h, 0);
});
test("Late TTL classification adjusts price without adding cached tokens again", () => {
  const seen = new Map(), options = { includeCacheTTL: true };
  assert.equal(takeUsageDelta(seen, "a", { cache_creation_input_tokens: 100 }, options).cacheUnknown, 100);
  const second = takeUsageDelta(seen, "a", { cache_creation_input_tokens: 100, cache_creation: { ephemeral_1h_input_tokens: 100 } }, options);
  assert.equal(second.cache_creation_input_tokens, 0); assert.equal(second.cache1h, 100); assert.equal(second.cacheUnknown, -100);
});
