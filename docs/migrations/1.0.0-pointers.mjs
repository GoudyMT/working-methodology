#!/usr/bin/env node
// One-time migration (plan rule-modules, Phase 1 unit 3): rewrite every pointer of the form
// `_Working Standards.md "Heading"` (with or without backticks, a markdown link or the word "section") to
// `rule:<id>`. A heading is matched exactly, then as the unique heading the quoted words start. Anything that
// does not resolve is printed and left alone, to be fixed by hand. Kept as the record of how pointers moved.
//
// Usage: node docs/migrations/1.0.0-pointers.mjs [--write]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { headings } from '../../scripts/kit.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SKIP = new Set(['.git', 'node_modules', 'vendor', 'reports', 'migrations', 'evals', 'plans']);
const POINTER = /(?:\[`?_Working Standards\.md`?\]\([^)]*\)|`?_Working Standards\.md`?)(?:,? section)? "([^"]+)"/g;

const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? (SKIP.has(e.name) ? [] : walk(path.join(d, e.name))) : [path.join(d, e.name)]);

const hs = headings(fs.readFileSync(path.join(KIT, 'project', '_Working Standards.md'), 'utf8'));
function resolve(quoted) {
  const exact = hs.find((h) => h.title === quoted);
  if (exact) return exact.id;
  const starts = hs.filter((h) => h.title.startsWith(quoted));
  return starts.length === 1 ? starts[0].id : null;
}

const write = process.argv.includes('--write');
let changed = 0;
const unresolved = [];
for (const file of walk(KIT).filter((f) => /\.(md|mjs|cjs|html|json)$/.test(f))) {
  if (path.basename(file) === '_Working Standards.md') continue;
  const text = fs.readFileSync(file, 'utf8');
  const out = text.replace(POINTER, (all, quoted) => {
    const id = resolve(quoted);
    if (!id) { unresolved.push(`${path.relative(KIT, file)}: "${quoted}"`); return all; }
    changed++;
    return `rule:${id}`;
  });
  if (write && out !== text) fs.writeFileSync(file, out);
}
console.log(`${write ? 'rewrote' : 'would rewrite'} ${changed} pointer(s)`);
for (const u of unresolved) console.log(`    unresolved ${u}`);
