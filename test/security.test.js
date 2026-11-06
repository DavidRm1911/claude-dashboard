import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { validateRequest, resolveProject, readJson } from "../lib/security.js";

test("loopback host plus same-origin actions: DNS rebinding, CSRF, methods", () => {
  const req = { method: "GET", headers: { host: "localhost:4949" } };
  assert.equal(validateRequest(req, 4949), null);
  assert.equal(validateRequest({ ...req, headers: { host: "evil.test:4949" } }, 4949), 403);
  assert.equal(validateRequest({ ...req, headers: { ...req.headers, origin: "https://evil.test" } }, 4949), 403);
  assert.equal(validateRequest({ ...req, headers: { ...req.headers, "sec-fetch-site": "cross-site" } }, 4949), 403);
  assert.equal(validateRequest({ ...req, method: "POST" }, 4949), 403);
  assert.equal(validateRequest({ ...req, method: "POST", headers: { ...req.headers, "x-dashboard-request": "1" } }, 4949), null);
  assert.equal(validateRequest({ ...req, method: "DELETE" }, 4949), 405);
});

test("project names cannot escape via traversal, sibling prefix or symlink", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dashboard-path-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true }));
  const root = path.join(dir, "repos");
  fs.mkdirSync(path.join(root, "valid"), { recursive: true });
  fs.mkdirSync(path.join(dir, "outside"));
  fs.symlinkSync(path.join(dir, "outside"), path.join(root, "link"));
  assert.equal(resolveProject(root, "valid"), fs.realpathSync(path.join(root, "valid")));
  for (const name of ["..", ".", "../outside", "a/b", "a\\b", "link", "-option", "\0", ""]) assert.throws(() => resolveProject(root, name));
});

test("request body reports malformed JSON and enforces byte limit", async () => {
  assert.deepEqual(await readJson(Readable.from([Buffer.from('{"enabled":true}')])) , { enabled: true });
  await assert.rejects(readJson(Readable.from([Buffer.from("{")])), { status: 400 });
  await assert.rejects(readJson(Readable.from([Buffer.from("[]")])), { status: 400 });
  await assert.rejects(readJson(Readable.from([Buffer.alloc(9)]), 8), { status: 413 });
});
