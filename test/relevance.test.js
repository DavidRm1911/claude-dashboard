import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectThemesInText,
  computeBonus,
  scoreJobBonus,
  clearMem0ThemesCache,
  MEM0_BONUS_CAP,
} from '../lib/relevance.js';

test('detectThemesInText finds agents/llm/evals/gcp; AWS and Terraform alone are ignored', () => {
  const all = detectThemesInText(
    'Multi-agent LangGraph with Claude LLM, evals/rubrica, and GCP Vertex + GKE',
  );
  assert.deepEqual([...all].sort(), ['agents', 'evals', 'gcp', 'llm']);
  const awsOnly = detectThemesInText('Senior AWS Terraform engineer, EKS, CloudFormation');
  assert.equal(awsOnly.size, 0);
});

test('computeBonus only scores themes active in mem0; caps at 15', () => {
  const job = new Set(['agents', 'llm', 'evals', 'gcp']);
  assert.equal(computeBonus(job, {}).bonus, 0);
  assert.equal(computeBonus(job, { agents: true }).bonus, 4);
  assert.equal(computeBonus(job, { agents: true, llm: true }).bonus, 8);
  assert.equal(computeBonus(job, { agents: true, llm: true, evals: true }).bonus, 12);
  const full = computeBonus(job, { agents: true, llm: true, evals: true, gcp: true });
  assert.equal(full.bonus, MEM0_BONUS_CAP); // 16→15
  assert.equal(full.reason, 'mem0: agentes + LLM + evals + GCP');
  // job has AWS keywords only → still 0 even if mem0 has agents
  assert.equal(computeBonus(detectThemesInText('AWS Terraform'), { agents: true, gcp: true }).bonus, 0);
});

test('scoreJobBonus with offline/empty themes is 0; matches on strengths/gaps', () => {
  clearMem0ThemesCache();
  const job = {
    title: 'Platform Engineer',
    company: 'Acme',
    strengths: ['AWS', 'Terraform'],
    gaps: ['LangChain not used', 'GCP experience light'],
  };
  assert.deepEqual(scoreJobBonus(job, { themes: { agents: false, llm: false, evals: false, gcp: false }, source: 'offline' }), {
    bonus: 0, reason: null,
  });
  const hit = scoreJobBonus(job, { themes: { agents: true, llm: false, evals: false, gcp: true } });
  assert.equal(hit.bonus, 8);
  assert.equal(hit.reason, 'mem0: agentes + GCP');
});
