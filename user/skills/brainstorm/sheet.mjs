#!/usr/bin/env node
// The question sheet: a plain markdown file any person or model can read and fill in. It is the one truth; a page is
// only another way to fill it in. Accuracy comes first. The asker's parts are one-line fields in a fixed order; once
// "Your answer:" opens, every line is the owner's own text until "What I thought:", and after that until the next
// question, topic or closing box. So a line that merely looks like a label or a heading stays the owner's words, and
// what cannot be read is refused, never guessed at.
//
// Usage: node sheet.mjs check <sheet.md>                     exit 0 when every question is answered
//        node sheet.mjs export <rows folder> <id> <sheet.md> page rows (sheets/, questions/, answers/) to a sheet file
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const fail = (why) => { throw new Error(`sheet: ${why}`); };
const clean = (line) => line.replace(/\r$/, '');
const QUESTION = /^### Q(\d+)\. (.+)$/;
const CLOSING = '## Anything I did not ask?';
const ASKER_LABELS = [['why', 'Why it matters:'], ['pick', "Asker's pick:"], ['pickWhy', 'Why this pick:']];

// A value is the lines given, without the blank lines around them; inside, nothing changes.
function value(lines) {
  const out = [...lines];
  while (out.length && !clean(out[0])) out.shift();
  while (out.length && !clean(out[out.length - 1])) out.pop();
  return clean(out.join('\n'));
}

function parseQuestion(n, text, topic, body) {
  const q = { n, text, topic, options: [], choice: null, why: '', pick: null, pickWhy: '' };
  const answerAt = body.findIndex((l) => clean(l) === 'Your answer:' || clean(l).startsWith('Your answer: '));
  if (answerAt < 0) fail(`Q${n} has no "Your answer:" line`);
  const thoughtAt = body.findIndex((l, i) => i > answerAt && (clean(l) === 'What I thought:' || clean(l).startsWith('What I thought: ')));
  if (thoughtAt < 0) fail(`Q${n} has no "What I thought:" line after "Your answer:"`);
  let inOptions = false;
  for (const raw of body.slice(0, answerAt)) {
    const line = clean(raw);
    if (!line) continue;
    const asker = ASKER_LABELS.find(([, label]) => line.startsWith(label));
    const box = line.match(/^- \[( |x|X)\] ([^:\s]+): (.*)$/);
    if (asker) {
      const [name, label] = asker;
      if (q[name]) fail(`Q${n} has "${label}" twice`);
      q[name] = line.slice(label.length).trim();
      inOptions = false;
    } else if (line === 'Options:') inOptions = true;
    else if (inOptions && box) {
      if (q.options.some((o) => o.key === box[2])) fail(`Q${n}: option "${box[2]}" appears twice`);
      q.options.push({ key: box[2], label: box[3] });
      if (box[1] !== ' ') {
        if (q.choice) fail(`Q${n}: two boxes ticked. Tick one, or say both under "Your answer:"`);
        q.choice = box[2];
      }
    } else fail(`Q${n}: this line is above "Your answer:", where nothing is kept. Move it under "Your answer:" or "What I thought:": ${line.slice(0, 60)}`);
  }
  q.answer = value([clean(body[answerAt]).slice('Your answer:'.length).replace(/^ /, ''), ...body.slice(answerAt + 1, thoughtAt)]);
  q.thought = value([clean(body[thoughtAt]).slice('What I thought:'.length).replace(/^ /, ''), ...body.slice(thoughtAt + 1)]);
  if (q.pick && !q.options.some((o) => o.key === q.pick)) fail(`Q${n}: the asker's pick "${q.pick}" is not an option`);
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
  const title = clean(lines[0]).match(/^# Sheet: (.+)$/)?.[1];
  if (!title) fail('the first line must be "# Sheet: <title>"');
  const groundingAt = lines.findIndex((l) => clean(l) === '## Grounding');
  if (groundingAt < 0) fail('no grounding: every sheet opens with one');
  const meta = {};
  for (const raw of lines.slice(1, groundingAt)) {
    const line = clean(raw);
    if (!line) continue;
    const m = line.match(/^(id|asked by|sent): (.+)$/);
    if (!m) fail(`a line the sheet's top does not have, and it would be lost: ${line.slice(0, 60)}`);
    meta[m[1]] = m[2];
  }
  if (!meta.id) fail('no "id:" line');
  const sheet = { title, id: meta.id, askedBy: meta['asked by'] || 'the asker', sent: meta.sent || '', grounding: '', questions: [], missed: null };
  const firstTopic = lines.findIndex((l, i) => i > groundingAt && clean(l).startsWith('## Topic: '));
  if (firstTopic < 0) fail('no questions');
  sheet.grounding = value(lines.slice(groundingAt + 1, firstTopic));
  if (!sheet.grounding) fail('no grounding: every sheet opens with one');
  // Only the next question's number, a topic or the closing box ends a question, so any other heading is the owner's.
  let topic = null;
  let open = null;
  const close = () => {
    if (!open) return;
    sheet.questions.push(parseQuestion(open.n, open.text, open.topic, open.body));
    open = null;
  };
  let i = firstTopic;
  for (; i < lines.length; i++) {
    const line = clean(lines[i]);
    const next = line.match(QUESTION);
    if (line === CLOSING) { close(); break; }
    if (line.startsWith('## Topic: ')) {
      close();
      if (topic && !sheet.questions.some((q) => q.topic === topic)) fail(`topic "${topic}" has no questions`);
      topic = line.slice(10);
    } else if (next && Number(next[1]) === sheet.questions.length + (open ? 2 : 1)) {
      close();
      open = { n: Number(next[1]), text: next[2], topic, body: [] };
    } else if (open) open.body.push(lines[i]);
    else if (line) fail(`expected Q${sheet.questions.length + 1} under topic "${topic}", found: ${line.slice(0, 60)}`);
  }
  if (i === lines.length) { close(); fail(`no "${CLOSING}" box at the end`); }
  if (!sheet.questions.length) fail('no questions');
  if (!sheet.questions.some((q) => q.topic === topic)) fail(`topic "${topic}" has no questions`);
  sheet.missed = value(lines.slice(i + 1));
  return sheet;
}

/** Read a sheet file from disk. Anything but UTF-8 is refused, because a wrong decode changes the owner's words. */
export function readSheet(file) {
  const bytes = fs.readFileSync(file);
  if ((bytes[0] === 0xFF && bytes[1] === 0xFE) || (bytes[0] === 0xFE && bytes[1] === 0xFF)) fail(`${file} is saved as UTF-16: save it as UTF-8 and run this again`);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return fail(`${file} is not saved as UTF-8: save it as UTF-8 and run this again`);
  }
}

/** Which questions still lack a pick or the owner's own answer. A thought alone is not an answer. */
export function checkComplete(sheet) {
  const open = sheet.questions.filter((q) => !q.choice && !q.answer.trim());
  return { ok: open.length === 0, unanswered: open.map((q) => q.n), thoughtOnly: open.filter((q) => q.thought.trim()).map((q) => q.n) };
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
    if (q.pick) out.push(`Asker's pick: ${q.pick}`, ...(q.pickWhy ? [`Why this pick: ${q.pickWhy}`] : []), '');
    out.push('Your answer:', '', ...(q.answer ? [q.answer, ''] : []), 'What I thought:', '', ...(q.thought ? [q.thought, ''] : []));
  }
  out.push(CLOSING, '', ...(s.missed ? [s.missed, ''] : []));
  return out.join('\n');
}

const oneLine = (what, text) => { if (/[\r\n]/.test(String(text ?? ''))) fail(`${what} holds a line break, and only an answer may: ${String(text).slice(0, 40)}`); };

/**
 * Turn a page's saved rows into sheet file text, so the file stays the one truth.
 *
 * Args:
 *     rows: { sheet, questions, answers } - answers keyed by question id, the closing box by <sheet id>__finish
 *
 * Returns:
 *     the sheet file's text, read back and matched against the rows
 */
export function sheetFromRows({ sheet, questions, answers }) {
  const order = [...questions].sort((a, b) => (a.section || 0) - (b.section || 0) || (a.order || 0) - (b.order || 0));
  const mine = (a) => (a && (a.sheet === undefined || a.sheet === sheet.id) ? a : {});
  const finish = mine(answers[`${sheet.id}__finish`]);
  if (!finish.submitted) fail(`${sheet.id} was never sent, so its answers may be half typed`);
  oneLine('the title', sheet.title);
  const parsed = {
    title: sheet.title, id: sheet.id, askedBy: sheet.askedBy || 'Claude', sent: finish.submitted, grounding: sheet.grounding || '',
    missed: finish.missed || '',
    questions: order.map((q, i) => {
      const a = mine(answers[q.id]);
      for (const [what, text] of [['a question', q.text], ['a topic', q.sectionTitle], ['a why', q.why], ['a pick reason', q.recWhy], ...(q.options || []).flatMap((o) => [['an option', o.label], ['an option', o.detail]])]) oneLine(what, text);
      return {
        n: i + 1, text: q.text, topic: q.sectionTitle || `Part ${q.section || 1}`, why: q.why || '', pick: q.rec || null, pickWhy: q.recWhy || '',
        options: (q.options || []).map((o) => ({ key: o.key, label: o.detail ? `${o.label} - ${o.detail}` : o.label })),
        choice: a.choice || null, answer: a.own || '', thought: a.thought || '',
      };
    }),
  };
  const text = renderSheet(parsed);
  // The file must say what the rows say: reading it back proves no owner text was taken for structure.
  let back;
  try { back = parseSheet(text); } catch (e) { fail(`an answer holds a line that reads as sheet structure; the owner must change it on the page (${e.message})`); }
  const same = (a, b) => value(String(a).split('\n')) === value(String(b).split('\n'));
  if (back.questions.length !== parsed.questions.length || !same(back.missed, parsed.missed)) fail('an answer holds a line that reads as sheet structure; the owner must change it on the page');
  parsed.questions.forEach((q, i) => {
    const b = back.questions[i];
    if (!same(b.answer, q.answer) || !same(b.thought, q.thought) || b.choice !== q.choice) fail(`Q${q.n}: an answer holds a line that reads as sheet structure; the owner must change it on the page`);
  });
  return text;
}

function main([cmd, ...args]) {
  if (cmd === 'check' && args.length === 1) {
    const r = checkComplete(parseSheet(readSheet(args[0])));
    const thought = r.thoughtOnly.length ? ` (${r.thoughtOnly.map((n) => `Q${n}`).join(', ')}: a thought but no answer)` : '';
    console.log(r.ok ? 'Sheet complete: every question is answered' : `Not answered: ${r.unanswered.map((n) => `Q${n}`).join(', ')}${thought}`);
    process.exitCode = r.ok ? 0 : 1;
  } else if (cmd === 'export' && args.length === 3) {
    const [dir, id, out] = args;
    if (!/^[\w-]+$/.test(id)) fail(`a sheet id is letters, digits, _ and -: ${id}`);
    if (fs.existsSync(out)) fail(`${out} exists: a sheet may hold answers, so it is never overwritten`);
    const load = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
    const rows = (name) => fs.readdirSync(path.join(dir, name)).filter((f) => f.endsWith('.json')).map((f) => ({ ...load(path.join(dir, name, f)), id: path.basename(f, '.json') }));
    const answers = Object.fromEntries(rows('answers').map((a) => [a.id, a]));
    fs.writeFileSync(out, sheetFromRows({ sheet: { ...load(path.join(dir, 'sheets', `${id}.json`)), id }, questions: rows('questions').filter((q) => q.sheet === id), answers }));
    console.log(`wrote ${out}`);
  } else {
    console.log('Usage: node sheet.mjs check <sheet.md> | export <rows folder> <id> <sheet.md>');
    process.exitCode = 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exitCode = 1; }
}
