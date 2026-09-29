// Read-only AWS Knowledge MCP discovery. Fixed query, public AWS content only.
const ENDPOINT = "https://knowledge-mcp.global.api.aws";
const LIMIT = 1024 * 1024;
const QUERY = "AWS Free Tier new customer $100 signup additional $100 credits AWS Activate Founders startup promotional credits eligibility";

async function call(fetchImpl, method, params, id, session) {
  const headers = { Accept: "application/json, text/event-stream", "Content-Type": "application/json", "MCP-Protocol-Version": "2025-03-26" };
  if (session) headers["Mcp-Session-Id"] = session;
  const response = await fetchImpl(ENDPOINT, { method: "POST", redirect: "error", headers, body: JSON.stringify({ jsonrpc: "2.0", id, method, params }), signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`MCP HTTP ${response.status}`);
  if (!/application\/json/i.test(response.headers.get("content-type") || "")) throw new Error("Formato MCP no admitido");
  if (Number(response.headers.get("content-length")) > LIMIT) throw new Error("Respuesta MCP demasiado grande");
  const chunks = []; let size = 0;
  for await (const chunk of response.body) {
    size += chunk.byteLength;
    if (size > LIMIT) throw new Error("Respuesta MCP demasiado grande");
    chunks.push(Buffer.from(chunk));
  }
  const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (value.error || value.result?.isError) throw new Error("La búsqueda MCP no está disponible");
  return { result: value.result, session: response.headers.get("mcp-session-id") || session };
}

export function parseKnowledgeResults(result) {
  const raw = result?.content?.find((item) => item.type === "text")?.text;
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return []; }
  const rows = parsed?.content?.result;
  if (!Array.isArray(rows)) return [];
  return rows.slice(0, 5).flatMap((row) => {
    let url;
    try { url = new URL(row.url); } catch { return []; }
    if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443") || !["aws.amazon.com", "docs.aws.amazon.com"].includes(url.hostname)) return [];
    url.hash = "";
    const title = String(row.title || "").replace(/<[^>]*>/g, "").trim().slice(0, 180);
    if (!title) return [];
    const summary = String(row.context || "").replace(/[#*`_\[\]<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, 240);
    return [{ title, url: url.href, summary }];
  });
}

export async function discoverAwsCredits(fetchImpl = fetch) {
  const init = await call(fetchImpl, "initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "local-developer-radar", version: "1.0" } }, 1);
  if (!init.result?.capabilities?.tools) throw new Error("MCP sin herramientas de búsqueda");
  const search = await call(fetchImpl, "tools/call", { name: "aws___search_documentation", arguments: { search_phrase: QUERY, topics: ["general"], limit: 5 } }, 2, init.session);
  return parseKnowledgeResults(search.result);
}
