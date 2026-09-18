---
target: index.html top block (nav+hero+toolbar+tabs)
total_score: 17
max_score: 32
na_heuristics: 5,9
p0_count: 2
p1_count: 1
timestamp: 2026-08-22T09-07-46Z
slug: index-html-top-block-nav-hero-toolbar-tabs
---
Method: dual-agent (A: a34ae0df16e64cc30 · B: a31b6b8cacb86c696)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Live-pill + dynamic aria-current work, but split across nav and tabs |
| 2 | Match System / Real World | 2 | Decorative Japanese glyph + vertical "EN VIVO ↗" read as generic-SaaS flourish, not this product |
| 3 | User Control and Freedom | 3 | Filters and tabs are freely reversible, no traps |
| 4 | Consistency and Standards | 2 | Two systems (nav + tier-tabs) encode the same 4-group taxonomy differently |
| 5 | Error Prevention | n/a | No destructive or error-prone actions live in this block |
| 6 | Recognition Rather Than Recall | 3 | Text-labeled throughout, tab sub-labels list contents — but duplicated by nav |
| 7 | Flexibility and Efficiency | 1 | No keyboard shortcuts or accelerators for range/tab switching |
| 8 | Aesthetic and Minimalist Design | 1 | 8/8 cognitive-load checklist items fail — 4 competing "front doors" before any data |
| 9 | Error Recovery | n/a | No error states surface in this block |
| 10 | Help and Documentation | 2 | Tab sub-labels act as lightweight docs; nothing explains the range/account filters |
| **Total** | | **17/32** | **Acceptable (53%)** |

## Design Specificity Verdict

**LLM assessment**: Reads as a generic editorial SaaS-landing template wearing a "personal Claude tool" costume. The poster-hero (huge serif headline, Japanese glyph, vertical side-label, "EN VIVO ↗"), eyebrow/kicker convention, and segmented-pill nav are the visual grammar of a marketing site, not a tool opened 15 times a day to check token spend. Swap "Claude" for any brand and the block works unchanged — nothing here is derived from the actual data. A daily-use dashboard should look like a cockpit; this looks like a hero section waiting for a "Sign up" CTA.

**Deterministic scan**: Detector ran in DEGRADED mode (HTML parser deps unavailable, regex fallback) — exit code 2, one finding: `flat-type-hierarchy` warning on line 152 comparing three inline font-sizes (14.1px/16px/18.4px). Flagged as a likely **false positive**: those three sizes come from unrelated elements, not a designed type scale, and the detector's own degraded-mode caveat (no CSS cascade/custom-property resolution) means this reads as low-confidence. No other mechanical findings.

**Accessibility mechanics** (from manual read, since browser overlay was unavailable — Chrome extension disconnected): actually solid. Contrast ratios documented in code comments (`--muted` 6.7:1, `--accent` 8.6:1 on `--bg`), one global `:focus-visible` rule covers all interactive elements, `#rangeSeg` and `#tierTabs` both use correct `role`/`aria-*` wiring with dynamic `aria-current`/`aria-selected`, heading hierarchy is properly nested (h1→h2→h3, no skips). This block's problem is entirely informational/visual clutter, not accessibility mechanics.

## Overall Impression

The top block tries to be three things at once — a marketing hero, a data toolbar, and a navigation system — and none of them yield to the others. The biggest single opportunity: the newly-added tier-tabs bar and the pre-existing topbar nav do the **exact same job** (jump to a section grouped by the same 4-tier taxonomy) using two different UI patterns, stacked on top of each other. Collapsing that duplication alone would remove roughly a third of the vertical space before any real content appears.

## What's Working

- **The design-token system is disciplined** — real spacing scale, 3-step radii, documented contrast ratios — not ad-hoc CSS. Worth keeping as-is.
- **The tier-tab IA concept is sound**: frequency-based grouping (daily/weekly/monthly/yearly) is a genuinely good idea for this kind of dashboard — it's just fighting the old nav for the same job instead of replacing it.
- **Accessibility wiring is correct and unglamorous** — proper roles, live aria-current/aria-selected updates, one consistent focus-visible rule. Easy to overlook, rare to get right by accident.

## Priority Issues

**[P0] Topbar nav and tier-tabs duplicate the same taxonomy**
*Why it matters*: The nav (filtered to ~3 links matching the active tier) and each tab's sub-label (e.g. "Resumen · actividad · historial") list the **same section names, twice, in the same viewport**. Users have two separate widgets to learn for one job.
*Fix*: Cut `#topbarLinks` entirely, or collapse it to a single small "jump within this tab" overflow control. Make `#tierTabs` the sole navigation+filter mechanism.
*Suggested command*: `/impeccable distill`

**[P0] The poster hero repeats data shown seconds later**
*Why it matters*: `#heroFloatStat` shows cost + fresh tokens — the exact same numbers as the first stat-card (`stat-card--cost`) rendered in `#resumen` immediately below. Plus two purely decorative elements (`.hero-jp`, `.hero-vertical`) add zero information.
*Fix*: Shrink `.hero` from a large poster panel to a compact one-line title bar. Remove `hero-jp`, `hero-vertical`, and `hero-float-stat` — the real numbers already live in Resumen.
*Suggested command*: `/impeccable distill`

**[P1] Toolbar and tier-tabs are two full-width bands stacked**
*Why it matters*: Two separate horizontal control bars (filters, then tabs) before any content adds height without adding clarity — they're both "pick a view" controls conceptually.
*Fix*: Fold range/account/refresh into a slimmer single row shared with (or directly above) the tab bar.
*Suggested command*: `/impeccable layout`

**[P2] Eyebrow text + live-pill + account dropdown + Cuentas tab all gesture at "accounts/live" separately**
*Why it matters*: Four different places reference the same "N accounts, this is live" fact with no single authoritative source.
*Fix*: Pick one indicator (the live-pill is enough) and drop the eyebrow line's redundant restatement.
*Suggested command*: `/impeccable clarify`

**[P2] No keyboard accelerators for range/tab switching**
*Why it matters*: A daily-use tool with no shortcuts costs a power user real time over months of repeated use.
*Fix*: Add number-key or arrow-key switching between tier tabs and range buttons.
*Suggested command*: `/impeccable adapt`

## Persona Red Flags

**Alex (Power User, checks this dashboard daily)**: Has to visually parse 4 stacked control zones (nav, hero, toolbar, tabs) every single visit before reaching a number he already knows he wants. No shortcuts to jump straight to a saved view. The redundant nav-vs-tabs pair forces him to learn two navigation mental models for one dashboard he opens dozens of times.

**Sam (keyboard/screen-reader user)**: Mechanically this block is in good shape (proper roles/aria, one focus-visible rule) — no red flags on access mechanics specifically. The risk is purely navigational redundancy: a screen-reader user tabbing through will hit the same 4 section names twice in a row (nav links, then tab sub-labels), which reads as repetition rather than a fault.

## Minor Observations

- `hero-jp` (利用状況) and the vertical "EN VIVO ↗" label are the only two elements in the whole block carrying zero data or navigational value — cut candidates before anything else.
- The subhead paragraph ("Resumen combinado de tu cuenta personal y de empresa…") restates what the account dropdown + Cuentas tab already communicate structurally; a one-line caption would do.
- The `flat-type-hierarchy` detector finding is very likely noise (degraded-mode regex comparing unrelated inline styles) — safe to ignore without a re-scan once parser deps are available.

## Questions to Consider

- What if the nav bar didn't exist at all, and the tier-tabs were the *only* navigation?
- Does a personal-use tool that you open dozens of times a week need a "hero" at all, or does that pattern only make sense for a first-time visitor?
- If you had to explain this dashboard's top 3 inches to someone in one sentence, what would survive?
