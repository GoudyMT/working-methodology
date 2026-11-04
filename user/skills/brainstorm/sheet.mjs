#!/usr/bin/env node
// The question sheet: a plain markdown file any person or model can read and fill in. It is the one truth; a page is
// only another way to fill it in. Accuracy comes first, so what this cannot read is refused, never guessed at: a line
// that looks like structure inside an answer stops the parse rather than cut the owner's words short.
//
// Usage: node sheet.mjs check <sheet.md>                     exit 0 when every question is answered
//        node sheet.mjs export <rows folder> <id> <sheet.md> page rows (sheets/, questions/, answers/) to a sheet file
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const fail = (why) => { throw new Error(`sheet: ${why}`); };

// A value is the lines given, without the blank lines around them; inside, nothing changes.
function value(lines) {
  const out = [...lines];
  const blank = (l) => l === undefined || l.replace(/\r$/, '') === '';
  while (out.length && blank(out[0])) out.shift();
  while (out.length && blank(out[out.length - 1])) out.pop();
  return out.join('\n').replace(/\r$/, '');
}

const FIELDS = [['why', /^Why it matters:(.*)$/], ['pick', /^Pick:(.*)$/], ['pickWhy', /^Why this pick:(.*)$/], ['options', /^Options:(.*)$/],
  ['answer', /^Your answer:(.*)$/], ['thought', /^What I thought:(.*)$/]];

function parseQuestion(n, text, topic, body) {
  const q = { n, text, topic, options: [], choice: null };
  const seen = {};
  let field = null;
  for (const raw of body) {
    const line = raw.replace(/\r$/, '');
    const hit = FIELDS.map(([name, re]) => [name, line.match(re)]).find(([, m]) => m);
    if (hit) {
      const [name, m] = hit;
      if (seen[name]) fail(`Q${n} has "${name}" twice; an answer may not repeat a field line`);
      seen[name] = [m[1].replace(/^ /, '')];
      field = name;
    } else if (field) seen[field].push(raw);
    else if (line) fail(`Q${n}: text before its first field: ${line.slice(0, 40)}`);
  }
  for (const line of seen.options || []) {
    const clean = line.replace(/\r$/, '');
    if (!clean) continue;
    const m = clean.match(/^- \[( |x|X)\] ([^:\s]+): (.*)$/);
    if (!m) fail(`Q${n}: cannot read the option line: ${clean.slice(0, 40)}`);
    q.options.push({ key: m[2], label: m[3] });
    if (m[1] !== ' ') {
      if (q.choice) fail(`Q${n}: two boxes ticked`);
      q.choice = m[2];
    }
  }
  q.why = value(seen.why || []);
  q.pick = value(seen.pick || []) || null;
  q.pickWhy = value(seen.pickWhy || []);
  q.answer = value(seen.answer || []);
  q.thought = value(seen.thought || []);
  if (!seen.answer || !seen.thought) fail(`Q${n} needs "Your answer:" and "What I thought:"`);
  if (q.pick && !q.options.some((o) => o.key === q.pick)) fail(`Q${n}: the pick "${q.pick}" is not an option`);
  return q;
}

/**
 * Read a sheet file.
 *
 * Args:
 *     text: the sheet as written
 *
 * Returns:
 *     { title, id, askedBy, sent, grounding, questions: [{ n, text, topic, why, options, choice, pick, pickWhy,
 *     answer, thought }], missed }
 */
export function parseSheet(text) {
  const lines = text.split('\n');
  const heading = /^(#{1,3}) (.*?)\r?$/;
  const parts = [];
  for (const line of lines) {
    const m = line.match(heading);
    if (m) parts.push({ level: m[1].length, title: m[2], body: [] });
    else if (parts.length) parts[parts.length - 1].body.push(line);
    else if (line.replace(/\r$/, '')) fail('text before the title');
  }
  const top = parts.shift();
  const title = top?.level === 1 && top.title.match(/^Sheet: (.+)$/)?.[1];
  if (!title) fail('the first line must be "# Sheet: <title>"');
  const meta = (name) => top.body.map((l) => l.replace(/\r$/, '').match(new RegExp(`^${name}: (.+)$`))).find(Boolean)?.[1] || '';
  const sheet = { title, id: meta('id'), askedBy: meta('asked by') || 'the asker', sent: meta('sent'), grounding: '', questions: [], missed: null };
  if (!sheet.id) fail('no "id:" line');
  let topic = null;
  let empty = null;
  for (const p of parts) {
    if (sheet.missed !== null) fail(`"${p.title}" after the closing box`);
    if (p.level === 2 && p.title === 'Grounding') sheet.grounding = value(p.body);
    else if (p.level === 2 && p.title === 'Anything I did not ask?') sheet.missed = value(p.body);
    else if (p.level === 2 && p.title.startsWith('Topic: ')) {
      if (empty) fail(`topic "${empty}" has no questions`);
      if (value(p.body)) fail(`text under topic "${p.title}" outside a question`);
      topic = p.title.slice(7);
      empty = topic;
    } else if (p.level === 3 && topic) {
      const m = p.title.match(/^Q(\d+)\. (.+)$/);
      const n = sheet.questions.length + 1;
      if (!m || Number(m[1]) !== n) fail(`expected Q${n}, found "${p.title}"`);
      sheet.questions.push(parseQuestion(n, m[2], topic, p.body));
      empty = null;
    } else fail(`a heading the sheet does not have: "${p.title}"`);
  }
  if (empty) fail(`topic "${empty}" has no questions`);
  if (!sheet.grounding) fail('no grounding: every sheet opens with one');
  if (sheet.missed === null) fail('no "## Anything I did not ask?" box at the end');
  if (!sheet.questions.length) fail('no questions');
  return sheet;
}

/** Which questions still lack a pick or the owner's own answer. A thought alone is not an answer. */
export function checkComplete(sheet) {
  const unanswered = sheet.questions.filter((q) => !q.choice && !q.answer.trim()).map((q) => q.n);
  return { ok: unanswered.length === 0, unanswered };
}

/** A sheet as file text, in the one layout. */
export function renderSheet(s) {
  const out = [`# Sheet: ${s.title}`, '', `id: ${s.id}`, `asked by: ${s.askedBy}`, ...(s.sent ? [`sent: ${s.sent}`] : []), '', '## Grounding', '', s.grounding, ''];
  let topic = null;
  for (const q of s.questions) {
    if (q.topic !== topic) { topic = q.topic; out.push(`## Topic: ${topic}`, ''); }
    out.push(`### Q${q.n}. ${q.text}`, '');
    if (q.why) out.push(`Why it matters: ${q.why}`, '');
    if (q.options.length) {
      out.push('Options:', ...q.options.map((o) => `- [${o.key === q.choice ? 'x' : ' '}] ${o.key}: ${o.label}`), '');
    }
    if (q.pick) out.push(`Pick: ${q.pick}`, ...(q.pickWhy ? [`Why this pick: ${q.pickWhy}`] : []), '');
    out.push('Your answer:', '', ...(q.answer ? [q.answer, ''] : []), 'What I thought:', '', ...(q.thought ? [q.thought, ''] : []));
  }
  out.push('## Anything I did not ask?', '', ...(s.missed ? [s.missed, ''] : []));
  return out.join('\n');
}

/**
 * Turn a page's saved rows into sheet file text, so the file stays the one truth.
 *
 * Args:
 *     rows: { sheet, questions, answers } - answers keyed by question id, the closing box by <sheet id>__finish
 *
 * Returns:
 *     the sheet file's text, already proven to parse
 */
export function sheetFromRows({ sheet, questions, answers }) {
  const order = [...questions].sort((a, b) => (a.section || 0) - (b.section || 0) || (a.order || 0) - (b.order || 0));
  const finish = answers[`${sheet.id}__finish`] || {};
  const text = renderSheet({
    title: sheet.title, id: sheet.id, askedBy: sheet.askedBy || 'Claude', sent: finish.submitted || '', grounding: sheet.grounding || '',
    missed: finish.missed || '',
    questions: order.map((q, i) => {
      const a = answers[q.id] || {};
      return {
        n: i + 1, text: q.text, topic: q.sectionTitle || `Part ${q.section || 1}`, why: q.why || '', pick: q.rec || null, pickWhy: q.recWhy || '',
        options: (q.options || []).map((o) => ({ key: o.key, label: o.detail ? `${o.label} - ${o.detail}` : o.label })),
        choice: a.choice || null, answer: a.own || '', thought: a.thought || '',
      };
    }),
  });
  parseSheet(text);
  return text;
}

function main([cmd, ...args]) {
  if (cmd === 'check' && args.length === 1) {
    const r = checkComplete(parseSheet(fs.readFileSync(args[0], 'utf8')));
    console.log(r.ok ? 'Sheet complete: every question is answered' : `Not answered: ${r.unanswered.map((n) => `Q${n}`).join(', ')}`);
    process.exitCode = r.ok ? 0 : 1;
  } else if (cmd === 'export' && args.length === 3) {
    const [dir, id, out] = args;
    const load = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
    const rows = (name) => fs.readdirSync(path.join(dir, name)).filter((f) => f.endsWith('.json')).map((f) => ({ id: path.basename(f, '.json'), ...load(path.join(dir, name, f)) }));
    const answers = Object.fromEntries(rows('answers').map((a) => [a.id, a]));
    fs.writeFileSync(out, sheetFromRows({ sheet: { id, ...load(path.join(dir, 'sheets', `${id}.json`)) }, questions: rows('questions').filter((q) => q.sheet === id), answers }));
    console.log(`wrote ${out}`);
  } else {
    console.log('Usage: node sheet.mjs check <sheet.md> | export <rows folder> <id> <sheet.md>');
    process.exitCode = 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exitCode = 1; }
}
