import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStudiesStore } from '../lib/studies.js';

test('studies: sorted by fit, deadlines computed, excluded counted, marks persist; bad input rejected', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studies-')); t.after(() => fs.rmSync(dir, { recursive: true }));
  fs.mkdirSync(path.join(dir, 'studies'));
  fs.writeFileSync(path.join(dir, 'studies', 'opportunities.json'), JSON.stringify({ updated_at: '2026-10-22', items: {
    a: { id: 'a', name: 'A', fit_score: 60, deadline: '2026-11-01', status: 'open', url: 'https://a', peru_eligible: true },
    b: { id: 'b', name: 'B', fit_score: 90, deadline: '2026-10-01', status: 'open', url: 'javascript:alert(1)' },
    c: { id: 'c', name: 'C', fit_score: 80, excluded_reason: 'partial funding' },
  } }));
  const store = createStudiesStore({ repoDir: dir, now: () => new Date('2026-10-22T12:00:00Z') });
  const d = store.get();
  assert.deepEqual(d.items.map(i => i.id), ['b', 'c', 'a']);
  assert.equal(d.items.find(i => i.id === 'a').daysLeft, 10);
  assert.equal(d.items.find(i => i.id === 'b').status, 'closed');
  assert.equal(d.items.find(i => i.id === 'b').url, null, 'non-https URL dropped');
  assert.equal(d.stats.excluded, 1);
  assert.equal(d.stats.closingSoon, 1);
  assert.equal(store.mark({ id: 'a', mark: 'saved' }).stats.saved, 1);
  assert.equal(createStudiesStore({ repoDir: dir }).get().items.find(i => i.id === 'a').mark, 'saved');
  assert.throws(() => store.mark({ id: 'zzz', mark: 'saved' }), { status: 404 });
  assert.throws(() => store.mark({ id: 'a', mark: 'apply' }), { status: 400 });
  assert.equal(createStudiesStore({ repoDir: '/nonexistent' }).get().available, false);
});
