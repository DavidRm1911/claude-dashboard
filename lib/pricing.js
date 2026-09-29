// USD per million tokens, standard first-party API reference rates.
// This is a current-price comparison, not historical billing or plan usage.
export const PRICING_METADATA = {
  version: "2026-09-29", verifiedAt: "2026-09-29",
  source: "https://platform.claude.com/docs/en/about-claude/pricing",
  basis: "Precios API actuales; no factura ni deuda de tu plan",
};
const rate = (input, output, cacheWrite, cacheWrite1h, cacheRead) => ({ input, output, cacheWrite, cacheWrite1h, cacheRead });
export const PRICING_PER_MTOK = {
  "claude-fable-5-1": rate(10, 50, 12.5, 20, 0.25),
  "claude-fable-5": rate(10, 50, 12.5, 20, 1),
  "claude-opus-5-5": rate(4, 20, 5, 8, 0.2),
  "claude-opus-5": rate(5, 25, 6.25, 10, 0.5),
  "claude-opus-4-8": rate(5, 25, 6.25, 10, 0.5),
  "claude-opus-4-7": rate(5, 25, 6.25, 10, 0.5),
  "claude-opus-4-6": rate(5, 25, 6.25, 10, 0.5),
  "claude-opus-4-5": rate(5, 25, 6.25, 10, 0.5),
  "claude-opus-4-1": rate(15, 75, 18.75, 30, 1.5),
  "claude-opus-4": rate(15, 75, 18.75, 30, 1.5),
  "claude-sonnet-5-5": rate(2, 10, 2.5, 4, 0.2),
  "claude-sonnet-5": rate(2, 10, 2.5, 4, 0.2),
  "claude-sonnet-4-6": rate(3, 15, 3.75, 6, 0.3),
  "claude-sonnet-4-5": rate(3, 15, 3.75, 6, 0.3),
  "claude-sonnet-4": rate(3, 15, 3.75, 6, 0.3),
  "claude-haiku-4-5": rate(1, 5, 1.25, 2, 0.1),
  "claude-haiku-3-5": rate(0.8, 4, 1, 1.6, 0.08),
};
export function getPricing(model) {
  // Only exact names and dated snapshots are aliases. Never price a future
  // model such as opus-5-6 or sonnet-5-unknown as the older family member.
  const key = typeof model === "string" ? model.replace(/-\d{8}$/, "") : "";
  return PRICING_PER_MTOK[key] || { ...rate(0, 0, 0, 0, 0), unknown: true };
}
export function estimateCost(model, input, output, cacheCreate, cacheRead, cacheCreate1h = 0) {
  const p = getPricing(model);
  if (p.unknown) return null;
  // Signed TTL reclassification deltas correct a prior 5m assumption without
  // adding tokens again when a later snapshot supplies the duration breakdown.
  return (input * p.input + output * p.output + (cacheCreate - cacheCreate1h) * p.cacheWrite + cacheCreate1h * p.cacheWrite1h + cacheRead * p.cacheRead) / 1e6;
}
export function pricingCoverage(byModel) {
  let knownTokens = 0, totalTokens = 0, unknownCacheTTL = 0, unknownCacheMaxDeltaUSD = 0;
  const unknownModels = [];
  for (const [model, m] of Object.entries(byModel)) {
    const total = m.total ?? m.input + m.output + m.cacheCreate + m.cacheRead;
    totalTokens += total;
    if (getPricing(model).unknown) unknownModels.push(model);
    else { knownTokens += total; unknownCacheTTL += m.cacheUnknown || 0; const p = getPricing(model); unknownCacheMaxDeltaUSD += (m.cacheUnknown || 0) * (p.cacheWrite1h - p.cacheWrite) / 1e6; }
  }
  return { ...PRICING_METADATA, knownTokens, totalTokens, tokenPercent: totalTokens ? 100 * knownTokens / totalTokens : null, unknownModels, unknownCacheTTL, unknownCacheMaxDeltaUSD, complete: unknownModels.length === 0 && unknownCacheTTL === 0 };
}

export const CODEX_REFERENCE = {
  verifiedAt: "2026-09-29", source: "https://developers.openai.com/api/docs/pricing",
  note: "Base API estándar, no factura del plan. Sin recargos de contexto/velocidad/región ni caché creada sin desglose.",
};
const codexRates = { "gpt-6-sol": [2, .2, 10], "gpt-5.6-terra": [2, .2, 12], "gpt-5.5": [5, .5, 30], "gpt-5.4-mini": [.75, .075, 4.5] };
export function codexBaseReference(model, tokens) {
  const p = codexRates[model];
  return p ? (tokens.input*p[0] + tokens.cacheRead*p[1] + tokens.output*p[2]) / 1e6 : null;
}
