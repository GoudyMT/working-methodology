#!/usr/bin/env node
// One-time migration (plan rule-modules, Phase 1 unit 5): split the single standards file into rules/<module>.md,
// moving each ## section (with its ### subsections) word for word, in its original order, into the module the
// approved map names. The preamble opens the core. Each module gains only its frontmatter and, outside the core,
// a title line; the line-conservation test proves nothing else changed. Kept as the record of how the split ran.
//
// Usage: node docs/migrations/1.0.0-split.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { headings, ledger } from '../../scripts/kit.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SOURCE = path.join(KIT, 'project', '_Working Standards.md');
const MAP = JSON.parse(fs.readFileSync(path.join(KIT, 'docs', 'migrations', '1.0.0-modules.json'), 'utf8'));
const OUT = path.join(KIT, 'rules');
const TITLES = {
  'tracking-and-handoff': 'Tracking Files and Handoff', testing: 'Testing', 'agent-teams': 'Agent Teams',
  'reviews-and-findings': 'Reviews and Findings', 'git-and-release': 'Git and Release', 'loop-mode': 'Loop Mode',
  'evidence-and-failures': 'Evidence and Failures', security: 'Security', 'kit-standards': 'Kit Standards',
  'design-and-ux': 'Design and UX', code: 'Code', 'project-adapter': 'Project Adapter',
};

const text = fs.readFileSync(SOURCE, 'utf8');
const lines = text.split('\n');
const rows = ledger(text, MAP);
const hs = headings(text);
// Each ## section runs from its heading to the line before the next ## heading.
const sections = new Map();
const tops = hs.filter((h) => h.level === 2);
tops.forEach((h, i) => {
  const end = i + 1 < tops.length ? tops[i + 1].line - 1 : lines.length;
  sections.set(h.id, lines.slice(h.line - 1, end));
});
const preamble = lines.slice(0, rows.preamble);

fs.mkdirSync(OUT, { recursive: true });
for (const m of MAP.modules) {
  const front = ['---', `id: ${m.id}`, `load: ${m.load}`];
  if (m.paths) front.push('paths:', ...m.paths.map((p) => `  - "${p}"`));
  front.push(`when: ${m.when}`, '---', '');
  const body = m.id === 'core' ? [...preamble] : [`# ${TITLES[m.id]}`, ''];
  for (const s of m.sections) {
    const sec = [...sections.get(s)];
    while (sec.length && sec.at(-1).trim() === '') sec.pop();
    body.push(...sec, '');
  }
  fs.writeFileSync(path.join(OUT, `${m.id}.md`), [...front, ...body].join('\n'));
  console.log(`rules/${m.id}.md: ${m.sections.length} section(s)`);
}
