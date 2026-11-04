#!/usr/bin/env node
// Compile a filled sheet into its record. A script does this so the owner's words are copied, never retold: every
// answer sits in a fence, byte for byte, and a confirmed pick is labelled as a pick, because agreeing with a suggestion
// is weaker evidence of intent than the owner's own words. A summary, if any, goes under its own marked heading after.
//
// Usage: node compile-record.mjs <date>-<topic>.sheet.md [out.md]
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSheet, readSheet } from './sheet.mjs';

// A fence longer than any run of tildes in the text, so the owner's text cannot close it. Markdown lets a closing fence
// sit up to three spaces in, so those count too.
function verbatim(text) {
  const longest = Math.max(2, ...(text.match(/^ {0,3}~+/gm) || []).map((t) => t.trim().length));
  const fence = '~'.repeat(longest + 1);
  return ['', fence, text, fence, ''];
}

/** The record's text for a parsed sheet. */
export function compileRecord(sheet, sheetHash = 'not recorded') {
  const who = sheet.askedBy;
  const L = [`# Brainstorm record: ${sheet.title}`, '',
    `Sheet \`${sheet.id}\`, sha256 ${sheetHash}. Sent ${sheet.sent || 'not recorded'}. Compiled by script; the text in each fence is copied exactly from the sheet file.`, '',
    '## Grounding shown to the owner', '', ...verbatim(sheet.grounding)];
  let topic = null;
  let confirmed = 0;
  let own = 0;
  let open = 0;
  for (const q of sheet.questions) {
    if (q.topic !== topic) { topic = q.topic; L.push(`## ${topic}`, ''); }
    L.push(`### Q${q.n}. ${q.text}`, '');
    const label = (key) => q.options.find((o) => o.key === key)?.label ?? key;
    if (q.choice) {
      const kind = !q.pick ? 'no pick was offered' : q.choice === q.pick ? `confirmed ${who}'s pick` : `chose against ${who}'s pick`;
      L.push(`Picked: ${label(q.choice)} (${kind})`, '');
      if (q.choice === q.pick) confirmed += 1;
    }
    if (q.answer.trim()) { L.push("Owner's own answer (verbatim):", ...verbatim(q.answer)); own += 1; }
    if (q.thought.trim()) L.push("Owner's thought (verbatim):", ...verbatim(q.thought));
    if (!q.choice && !q.answer.trim()) { L.push(`Unanswered: ${who}'s call, and any plan must mark it so.`, ''); open += 1; }
    if (q.pick) L.push(`${who}'s pick was: ${label(q.pick)}`, '');
  }
  L.push('## Anything not asked (verbatim)', ...verbatim(sheet.missed || '(blank)'),
    '## Evidence weight', '',
    `${confirmed} of ${sheet.questions.length} answers confirmed ${who}'s pick; ${own} in the owner's own words; ${open} unanswered (${who}'s call). A confirmed pick is weaker evidence of intent than the owner's own words; those carry the most weight.`, '');
  return L.join('\n');
}

function main([file, out]) {
  if (!file) { console.log('Usage: node compile-record.mjs <date>-<topic>.sheet.md [out.md]'); process.exitCode = 2; return; }
  const target = out || file.replace(/\.sheet\.md$/, '') + '.brainstorm.md';
  if (fs.existsSync(target)) throw new Error(`${target} exists: a record may hold a summary, so it is never overwritten`);
  const text = readSheet(file);
  const sheet = parseSheet(text);
  fs.writeFileSync(target, compileRecord(sheet, crypto.createHash('sha256').update(text).digest('hex')));
  console.log(`wrote ${target} (${sheet.questions.length} questions)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exitCode = 1; }
}
