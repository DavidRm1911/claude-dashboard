import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

// Read-only view of ai-job-search/studies/opportunities.json (filled by /estudios),
// plus David's local marks (guardar / descartar) in studies/marks.json.
export const MARKS = ['saved', 'dismissed', 'none'];
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const read = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return fallback; throw e; } };
const iso = v => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
const url = v => (typeof v === 'string' && /^https:\/\//.test(v) ? v : null);

export function createStudiesStore({ repoDir, now = () => new Date() }) {
  const dataFile = path.join(repoDir, 'studies', 'opportunities.json');
  const marksFile = path.join(repoDir, 'studies', 'marks.json');

  function get() {
    if (!fs.existsSync(dataFile)) return { available: false, items: [] };
    const data = read(dataFile, { items: {} });
    const marks = read(marksFile, { marks: {} }).marks;
    const today = now().toISOString().slice(0, 10);
    const items = Object.values(data.items || {}).filter(i => i && typeof i === 'object' && i.id).map(i => {
      const deadline = iso(i.deadline);
      const days = deadline ? Math.round((Date.parse(deadline) - Date.parse(today)) / 864e5) : null;
      return {
        id: String(i.id), name: String(i.name || i.id), provider: i.provider ?? null, type: i.type ?? null, region: i.region ?? null,
        country: i.country ?? null, level: i.level ?? null, funding: i.funding ?? null, fullyFunded: i.fully_funded === true,
        peruEligible: i.peru_eligible ?? null, languageTest: i.language_test ?? null, opens: iso(i.opens), deadline,
        daysLeft: days, status: deadline && days < 0 ? 'closed' : (i.status ?? 'unknown'), intake: i.intake ?? null,
        fields: Array.isArray(i.fields) ? i.fields.slice(0, 8) : [], fit: Number.isFinite(i.fit_score) ? i.fit_score : null,
        notes: Array.isArray(i.fit_notes) ? i.fit_notes.slice(0, 4) : [], nextStep: i.next_step ?? null,
        url: url(i.url), source: url(i.source), verifiedAt: iso(i.verified_at), excluded: i.excluded_reason ?? null,
        mark: marks[i.id] ?? 'none',
      };
    }).sort((a, b) => (b.fit ?? -1) - (a.fit ?? -1));
    const eligible = items.filter(i => !i.excluded && i.mark !== 'dismissed');
    return {
      available: true, updatedAt: data.updated_at ?? null, items,
      stats: {
        eligible: eligible.length, open: eligible.filter(i => i.status === 'open').length,
        closingSoon: eligible.filter(i => i.daysLeft != null && i.daysLeft >= 0 && i.daysLeft <= 45).length,
        saved: items.filter(i => i.mark === 'saved').length, excluded: items.filter(i => i.excluded).length,
      },
    };
  }

  function mark(body) {
    if (!body || typeof body.id !== 'string' || body.id.length > 120) fail('Programa inválido');
    if (!MARKS.includes(body.mark)) fail('Marca inválida');
    const items = read(dataFile, { items: {} }).items || {};
    if (!items[body.id]) fail('Programa no encontrado', 404);
    const data = read(marksFile, { schema: 1, marks: {} });
    if (body.mark === 'none') delete data.marks[body.id]; else data.marks[body.id] = body.mark;
    const tmp = `${marksFile}.${randomUUID()}.tmp`;
    try { fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', { flag: 'wx' }); fs.renameSync(tmp, marksFile); }
    finally { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); }
    return get();
  }
  return { get, mark };
}
