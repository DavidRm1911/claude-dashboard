const fields = ["input_tokens", "output_tokens", "cache_read_input_tokens", "cache_creation_input_tokens"];

// Claude emits multiple content blocks/notifications for the same message ID.
// Take only increases in its counters, not the full snapshot on each line.
export function takeUsageDelta(seen, id, usage, { includeCacheTTL = false } = {}) {
  const previous = id ? seen.get(id) || {} : {};
  const delta = {};
  const next = {};
  for (const field of fields) {
    const value = Number.isFinite(usage[field]) && usage[field] > 0 ? usage[field] : 0;
    delta[field] = Math.max(0, value - (previous[field] || 0));
    next[field] = Math.max(value, previous[field] || 0);
  }
  if (includeCacheTTL) {
    const number = (value) => Number.isFinite(value) && value >= 0 ? value : 0;
    const breakdown = usage.cache_creation || {};
    next.cache1h = Math.min(next.cache_creation_input_tokens, Math.max(previous.cache1h || 0, number(breakdown.ephemeral_1h_input_tokens)));
    next.cache5m = Math.min(next.cache_creation_input_tokens - next.cache1h, Math.max(previous.cache5m || 0, number(breakdown.ephemeral_5m_input_tokens)));
    next.cacheUnknown = next.cache_creation_input_tokens - next.cache1h - next.cache5m;
    for (const key of ["cache1h", "cache5m", "cacheUnknown"]) delta[key] = next[key] - (previous[key] || 0);
  }
  if (id) seen.set(id, next);
  return delta;
}
