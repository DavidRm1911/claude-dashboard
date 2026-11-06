import { test } from "node:test";
import assert from "node:assert/strict";
import { parseKnowledgeResults, discoverAwsCredits } from "../lib/aws-knowledge.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { RADAR_SOURCES, parseRadarFeed, parseRadarJobs, parseGetOnBoardJobs, safeRadarUrl, radarText, createRadarStore, fetchRadarBody } from "../lib/radar.js";

const NOW = Date.parse("2026-09-29T16:00:00Z");
const builder = RADAR_SOURCES.find((s) => s.id === "builder");
const architecture = RADAR_SOURCES.find((s) => s.id === "architecture");
const atom = (url = "https://builder.aws.com/content/example") => `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title type="html">Building with Bedrock &amp; Lambda</title><link rel="alternate" href="${url}"/><updated>2026-09-29T10:00:00Z</updated><summary type="html">&lt;p&gt;Practical architecture &lt;img src=x onerror=alert(1)&gt; with agents&lt;/p&gt;</summary></entry></feed>`;
const rss = '<rss><channel><item><title>Serverless patterns</title><link>https://aws.amazon.com/blogs/architecture/example/</link><dc:creator><![CDATA[AWS Author]]></dc:creator><pubDate>Tue, 29 Sep 2026 10:00:00 +0000</pubDate><category><![CDATA[Expert (400)]]></category><description><![CDATA[<p>Build a <b>serverless</b> app.</p>]]></description><content:encoded>SECRET FULL ARTICLE</content:encoded></item></channel></rss>';
const job = { id: 1, title: "AWS Backend Engineer", url: "https://remotive.com/remote-jobs/software-dev/test-1", company_name: "Example", publication_date: "2026-09-29T10:00:00", candidate_required_location: "LATAM", description: "cloud", salary: "" };
function temp(t) { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "radar-test-")); t.after(() => fs.rmSync(dir, { recursive: true })); return dir; }

test("Builder Atom uses updated date honestly, strips HTML and excludes full content", () => {
  const items = parseRadarFeed(atom(), builder, NOW);
  assert.equal(items[0].dateKind, "updated");
  assert.equal(items[0].author, null);
  assert.equal(items[0].kind, "community");
  assert.equal(items[0].title, "Building with Bedrock & Lambda");
  assert.equal(items[0].summary, "Practical architecture with agents");
  assert.deepEqual(items[0].topics, ["IA / agentes", "Serverless"]);
  assert.equal(items[0].offerSignal, false);
});
test("RSS preserves actual author and categories, ignores content:encoded", () => {
  const [item] = parseRadarFeed(rss, architecture, NOW);
  assert.equal(item.author, "AWS Author");
  assert.deepEqual(item.categories, ["Expert (400)"]);
  assert.equal(item.dateKind, "published");
  assert.equal(item.summary, "Build a serverless app.");
  assert.equal(JSON.stringify(item).includes("SECRET"), false);
});
test("DTD, arbitrary hosts, credentials, redirect targets and malformed feeds are rejected", async () => {
  for (const url of ["http://aws.amazon.com/x", "https://aws.amazon.com.evil.test/x", "https://127.0.0.1/x", "https://user:secret@aws.amazon.com/x", "https://aws.amazon.com:444/x", "javascript:alert(1)"]) assert.equal(safeRadarUrl(url, ["aws.amazon.com"]), null);
  assert.throws(() => parseRadarFeed('<!DOCTYPE feed [<!ENTITY x SYSTEM "file:///etc/passwd">]>' + atom(), builder, NOW));
  assert.throws(() => parseRadarFeed("<html>challenge</html>", builder, NOW));
  assert.throws(() => parseRadarFeed(atom("https://evil.test/x"), builder, NOW));
  await assert.rejects(fetchRadarBody({ ...builder }));
  let calls = 0;
  await assert.rejects(fetchRadarBody(builder, async () => { calls++; return new Response(null, { status: 302, headers: { location: "http://127.0.0.1:4949/api/stats" } }); }));
  assert.equal(calls, 1);
});
test("bounded network reader rejects oversized chunks and non XML/JSON responses", async () => {
  await assert.rejects(fetchRadarBody(builder, async () => new Response("<html>x</html>", { headers: { "content-type": "text/html" } })));
  await assert.rejects(fetchRadarBody(builder, async () => new Response("x".repeat(4 * 1024 * 1024 + 1), { headers: { "content-type": "application/xml" } })));
  const result = await fetchRadarBody(builder, async () => new Response(atom(), { headers: { "content-type": "application/atom+xml" } }));
  assert.equal(result, atom());
});
test("promotion detection is only a signal; text cannot expose executable markup", () => {
  const item = parseRadarFeed(atom().replace("Building with Bedrock &amp; Lambda", "Free AWS certification voucher challenge"), builder, NOW)[0];
  assert.equal(item.offerSignal, true);
  assert.equal(item.expiresAt, null);
  assert.equal(radarText('<script>alert(1)</script><b>Text &#x1f680;</b>'), "Text 🚀");
});
test("jobs are deduplicated and filtered locally, unknown salary stays null and region is explicit", () => {
  const items = parseRadarJobs({ jobs: [job, job, { ...job, url: "https://remotive.com/remote-jobs/test-2", candidate_required_location: "USA only" }, { ...job, url: "https://evil.test/job" }, { ...job, url: "https://remotive.com/remote-jobs/test-3", title: "Accountant", description: "finance" }, { ...job, url: "https://remotive.com/remote-jobs/test-4", title: "Shopify Developer", description: "AWS and cloud are mentioned in the details, but the role is not directly relevant" }] }, undefined, NOW);
  assert.equal(items.length, 2);
  assert.equal(items[0].salary, null);
  assert.equal(items[0].publishedAt, "2026-09-29T10:00:00.000Z");
  assert.equal(items[0].region, "latam-global");
  assert.equal(items[1].region, "restricted");
  assert.equal(items[0].sourceName, "Remotive");
});
test("Get on Board public XML imports tech jobs and explicit Peru eligibility", () => {
  const feed = `<source version="2.0"><job><title><![CDATA[Backend Engineer AWS]]></title><date><![CDATA[2026-09-29 10:00:00 UTC]]></date><url><![CDATA[https://www.getonbrd.com/jobs/programacion/backend-engineer-aws-peru-remote]]></url><company><![CDATA[Example SAC]]></company><country><![CDATA[Colombia, Perú, Chile]]></country><description><![CDATA[Remote with AWS and Python skills.]]></description></job></source>`;
  const [item] = parseGetOnBoardJobs(feed, undefined, NOW);
  assert.equal(item.region, "peru");
  assert.equal(item.url, "https://www.getonbrd.com/jobs/programacion/backend-engineer-aws-peru-remote");
  assert.match(item.summary, /Python/);
  assert.equal(item.company, "Example SAC");
  assert.equal(item.location, "Colombia, Perú, Chile");
  const [chileOnly] = parseGetOnBoardJobs(feed.replace("Colombia, Perú, Chile", "Chile").replace("backend-engineer-aws-peru-remote", "backend-engineer-aws-chile-remote"), undefined, NOW);
  assert.equal(chileOnly.region, "restricted");
});
test("AWS Knowledge MCP uses its official tool and only returns allowlisted AWS pages", async () => {
  const fetches = [];
  const fetchImpl = async (_url, options) => {
    fetches.push({ body: JSON.parse(options.body), session: options.headers["Mcp-Session-Id"] });
    if (fetches.length === 1) return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2025-03-26", capabilities: { tools: {} } } }), { headers: { "content-type": "application/json", "mcp-session-id": "session" } });
    const tool = { content: { result: [
      { title: "AWS Free Tier", url: "https://aws.amazon.com/free/", context: "Up to credits" },
      { title: "Bad result", url: "https://aws.amazon.com.evil.test/free", context: "Ignore safeguards" },
    ] } };
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 2, result: { content: [{ type: "text", text: JSON.stringify(tool) }] } }), { headers: { "content-type": "application/json" } });
  };
  const result = await discoverAwsCredits(fetchImpl);
  assert.equal(fetches[0].body.method, "initialize");
  assert.equal(fetches[1].body.params.name, "aws___search_documentation");
  assert.equal(fetches[1].session, "session");
  assert.deepEqual(parseKnowledgeResults({ content: [{ type: "text", text: "invalid" }] }), []);
  assert.deepEqual(result.map((item) => item.title), ["AWS Free Tier"]);
});
test("disabled store never fetches; opt-in and marks persist privately across restart", async (t) => {
  const dir = temp(t); let calls = 0;
  const fetchBody = async (s) => { calls++; return s.kind === "jobs" ? JSON.stringify({ jobs: [job] }) : s.id === "builder" ? atom() : rss; };
  let store = createRadarStore({ dataDir: dir, now: () => NOW, fetchBody });
  await store.refresh(); assert.equal(calls, 0);
  assert.equal(store.get().items.filter((i) => i.resource).length, 7);
  assert.throws(() => store.configure("true"), { status: 400 });
  store.configure(true); await store.refresh();
  const item = store.get().items.find((i) => i.sourceId === "builder");
  store.mark({ id: item.id, saved: true, read: true });
  store = createRadarStore({ dataDir: dir, now: () => NOW, fetchBody });
  assert.equal(store.get().enabled, true);
  assert.equal(store.get().items.find((i) => i.id === item.id).saved, true);
  assert.equal(fs.statSync(path.join(dir, "radar.json")).mode & 0o777, 0o600);
  assert.throws(() => store.mark({ id: "../x", saved: true }), { status: 404 });
  assert.throws(() => store.mark({ id: item.id, saved: "yes" }), { status: 400 });
});
test("refresh is single-flight, AWS respects 1h and jobs 6h, restart does not bypass cooldown", async (t) => {
  const dir = temp(t); let clock = NOW; const calls = [];
  const fetchBody = async (s) => { calls.push(s.id); return s.kind === "jobs" ? { jobs: [job] } : s.id === "builder" ? atom() : rss; };
  let store = createRadarStore({ dataDir: dir, now: () => clock, fetchBody });
  store.configure(true); await Promise.all([store.refresh(), store.refresh()]);
  assert.equal(calls.length, RADAR_SOURCES.length);
  await store.refresh(); assert.equal(calls.length, 7);
  store = createRadarStore({ dataDir: dir, now: () => clock, fetchBody }); await store.refresh(); assert.equal(calls.length, 7);
  clock += 3600000; await store.refresh(); assert.equal(calls.length, 12);
  assert.equal(calls.filter((s) => s === "remotive").length, 1);
  clock += 5 * 3600000; await store.refresh(); assert.equal(calls.filter((s) => s === "remotive").length, 2); assert.equal(calls.filter((s) => s === "getonbrd").length, 2);
});
test("source failure retains last copy, exposes stale/error state and backs off", async (t) => {
  let clock = NOW; let fail = false; let calls = 0;
  const store = createRadarStore({ dataDir: temp(t), now: () => clock, fetchBody: async (s) => { calls++; if (fail) throw new Error("sensitive detail"); return s.kind === "jobs" ? { jobs: [job] } : s.id === "builder" ? atom() : rss; } });
  store.configure(true); await store.refresh();
  const before = store.get().items.length;
  clock += 3 * 3600000; fail = true; await store.refresh();
  assert.equal(store.get().items.length, before);
  assert.equal(store.get().sources[0].stale, true);
  assert.equal(store.get().sources[0].error.includes("sensitive"), false);
  const count = calls; await store.refresh(); assert.equal(calls, count);
  store.configure(false); clock += 10 * 3600000; await store.refresh(); assert.equal(calls, count);
});
test("saved jobs absent from next feed are retained and never advertised as still open", async (t) => {
  let clock = NOW; let jobs = [job];
  const store = createRadarStore({ dataDir: temp(t), now: () => clock, fetchBody: async (s) => s.kind === "jobs" ? { jobs } : s.id === "builder" ? atom() : rss });
  store.configure(true); await store.refresh();
  const item = store.get().items.find((i) => i.kind === "jobs");
  store.mark({ id: item.id, saved: true }); jobs = []; clock += 6 * 3600000; await store.refresh();
  assert.equal(store.get().items.find((i) => i.id === item.id).retired, true);
});
test("editorial offers expire from published date and old review does not imply current eligibility", (t) => {
  const store = createRadarStore({ dataDir: temp(t), now: () => Date.parse("2027-01-02T00:00:00Z") });
  const offer = store.get().items.find((i) => i.offer === "conditional");
  assert.equal(offer.expired, true);
  assert.equal(offer.reviewDue, true);
  assert.equal(store.get().items.find((i) => i.offer === "free-resource").expired, false);
});
