#!/usr/bin/env node
// Runs the frozen rule recall test (docs/evals/recall-questions.md) against one project folder.
//
// Why a fresh headless session per question: an answer must come only from what a new session loads and can
// read, never from an earlier answer. Only project settings load (--setting-sources project), so the owner's
// own ~/.claude rules do not leak into the score. Tools are read-only, the way a careful session would look
// a rule up. Answers are saved word for word; scoring against the keys is done after, by hand.
//
// Usage: node scripts/recall.mjs <project folder> <label>
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const QUESTIONS = path.join(KIT, 'docs', 'evals', 'recall-questions.md');
// Raw answers quote local paths, so they stay in the gitignored reports folder; only scores are committed.
const OUT_DIR = path.join(KIT, 'reports', 'evals');
const MAX_TURNS = '8';

function questions() {
  return fs.readFileSync(QUESTIONS, 'utf8').split('\n')
    .map((l) => l.match(/^\| (\d+) \| (.+?) \| (.+?) \|$/))
    .filter(Boolean)
    .map((m) => ({ n: Number(m[1]), q: m[2], key: m[3] }));
}

function main([projectDir, label]) {
  if (!projectDir || !label) throw new Error('usage: node scripts/recall.mjs <project folder> <label>');
  const qs = questions();
  if (qs.length !== 10) throw new Error(`expected 10 questions, found ${qs.length}`);
  const lines = [`# Recall run: ${label}`, '', `Project: ${path.basename(path.resolve(projectDir))}; ${new Date().toISOString()}`, ''];
  for (const { n, q, key } of qs) {
    const r = spawnSync('claude', ['-p', '--setting-sources', 'project', '--allowedTools', 'Read,Grep,Glob',
      '--disallowedTools', 'Edit,Write,Bash,PowerShell,WebFetch,WebSearch,Agent', '--max-turns', MAX_TURNS,
      '--no-session-persistence'], { cwd: projectDir, input: q, encoding: 'utf8', timeout: 600000 });
    const answer = (r.stdout || '').trim();
    // A failed session is not an answer: stop rather than save a run that would score as a wrong answer.
    if (r.status !== 0 || !answer || /Not logged in/i.test(answer)) {
      throw new Error(`question ${n}: no answer (exit ${r.status}): ${(answer || r.stderr || '').trim().slice(0, 200)}`);
    }
    lines.push(`## ${n}. ${q}`, '', `Key: ${key}`, '', 'Answer:', '', answer.split('\n').map((l) => '> ' + l).join('\n'), '', 'Score: _', '');
    console.log(`[${n}/10] answered (${answer.length} chars)`);
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const out = path.join(OUT_DIR, `${label}.md`);
  fs.writeFileSync(out, lines.join('\n'));
  console.log(`saved ${out}`);
}

main(process.argv.slice(2));
