/**
 * Focused regression tests for the Cloud Architect interview widget.
 * Run: npm test   (node --test)
 *
 * Covers:
 *  - × close path (CSS [hidden] override + closeBtn handler)
 *  - Cancelar button present / wired
 *  - Provider tabs: General, AWS, GCP, Azure, Kubernetes (UI + server whitelist)
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(root, rel), "utf8");

describe("interview panel close (×)", () => {
  const css = read("public/style.css");
  const js = read("public/app.js");
  const html = read("public/index.html");

  it("has #interviewCloseBtn in markup", () => {
    assert.match(html, /id="interviewCloseBtn"/);
    assert.match(html, /aria-label="Cerrar"/);
  });

  it("CSS forces display:none when [hidden] (fixes flex overriding UA hidden)", () => {
    // Root cause of "X does not close": .interview-panel { display:flex } beats
    // the UA [hidden]{display:none} rule. Explicit attribute selector required.
    assert.match(css, /\.interview-panel\s*\{[^}]*display:\s*flex/s);
    assert.match(css, /\.interview-panel\[hidden\]\s*\{\s*display:\s*none\s*;?\s*\}/);
  });

  it("setupInterviewWidget wires closeBtn to close() and clears localStorage key", () => {
    assert.match(js, /function setupInterviewWidget\s*\(/);
    assert.match(js, /getElementById\("interviewCloseBtn"\)/);
    assert.match(js, /closeBtn\.addEventListener\(\s*"click"/);
    assert.match(
      js,
      /localStorage\.removeItem\(\s*"claude-dashboard-interview-open"\s*\)/
    );
    assert.match(js, /panel\.hidden\s*=\s*true/);
  });

  it("bubble toggle still opens/closes via panel.hidden", () => {
    assert.match(
      js,
      /bubble\.addEventListener\(\s*"click"\s*,\s*\(\)\s*=>\s*\(panel\.hidden\s*\?\s*open\(\)\s*:\s*close\(\)\)\s*\)/
    );
  });
});

describe("interview Cancelar", () => {
  const html = read("public/index.html");
  const js = read("public/app.js");
  const server = read("server.js");

  it("Cancelar button exists in markup", () => {
    assert.match(html, /id="interviewCancelBtn"/);
    assert.match(html, />Cancelar</);
  });

  it("cancelInterview is wired and hits /api/interview/cancel", () => {
    assert.match(js, /async function cancelInterview\s*\(/);
    assert.match(js, /\/api\/interview\/cancel/);
    assert.match(
      js,
      /getElementById\("interviewCancelBtn"\)\.addEventListener\(\s*"click"\s*,\s*cancelInterview\s*\)/
    );
  });

  it("server exposes POST /api/interview/cancel", () => {
    assert.match(server, /\/api\/interview\/cancel/);
    assert.match(server, /status:\s*"cancelled"/);
  });
});

describe("interview providers / focus tabs", () => {
  const html = read("public/index.html");
  const js = read("public/app.js");
  const server = read("server.js");

  const REQUIRED = [
    ["general", "General"],
    ["aws", "AWS"],
    ["gcp", "GCP"],
    ["azure", "Azure"],
    ["kubernetes", "Kubernetes"],
  ];

  it("HTML focus toggle includes General, AWS, GCP, Azure, Kubernetes", () => {
    assert.match(html, /id="interviewFocusToggle"/);
    for (const [focus, label] of REQUIRED) {
      assert.match(
        html,
        new RegExp(`data-focus="${focus}"[^>]*>\\s*${label}\\s*<`),
        `missing tab ${focus}`
      );
    }
  });

  it("app.js history labels include azure + kubernetes", () => {
    assert.match(js, /azure:\s*"Azure"/);
    assert.match(js, /kubernetes:\s*"Kubernetes"/);
  });

  it("server INTERVIEW_FOCUS_LABEL and start whitelist include azure + kubernetes", () => {
    assert.match(server, /azure:\s*"Azure"/);
    assert.match(server, /kubernetes:\s*"Kubernetes"/);
    assert.match(
      server,
      /\["aws",\s*"gcp",\s*"azure",\s*"kubernetes",\s*"general"\]\.includes\(body\.focus\)/
    );
  });
});
