// The build 22 sweep (role 5, data loss): a second look, a rerun or a second blind step could write over runs and
// records already paid for, and the hook could lose its whole reply to one failed write. Each test here plants the
// earlier record, runs the step again, and reads the record back unchanged.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { caseKit, copyKitCli, makeTemp, read } from './kit-helpers.mjs';

const thrown = (fn) => { try { fn(); return null; } catch (e) { return e; } };

// why: catches a --just second look run under a first-look label that wipes that label's saved runs
test('a --just run refuses a label that already holds saved runs', async () => {
  const { startRun } = await import('../scripts/recall-behave.mjs');
  const out = makeTemp('just-label-');
  fs.writeFileSync(path.join(out, '2-b.jsonl'), 'first look record');
  fs.writeFileSync(path.join(out, 'result.json'), '{"label":"cand-1"}');
  const marker = { head: 'abc', suite: 2, released: false, noKit: false };
  const e = thrown(() => startRun(out, marker, ['2-b'], { just: new Set(['2-b']), name: 'cand-1' }));
  assert.match(String(e?.message), /cand-1 already holds saved runs/, 'a second look takes a new label');
  assert.equal(read(path.join(out, '2-b.jsonl')), 'first look record');
  // A new label is free.
  const fresh = makeTemp('just-fresh-');
  assert.doesNotThrow(() => startRun(fresh, marker, ['2-b'], { just: new Set(['2-b']), name: 'cand-x-1' }));
});

// A recall run, a second look above all, wrote over a saved run of the same label.
// why: guards rule:instruments-and-evals
test('a recall run refuses a label whose run is already saved, before any session', async () => {
  const { recallRun } = await import('../scripts/recall.mjs');
  const outDir = makeTemp('recall-label-');
  fs.writeFileSync(path.join(outDir, 'cand-1.md'), 'first look answers');
  let sessions = 0;
  const run = () => { sessions++; return { status: 0, stdout: '', stderr: '' }; };
  const e = thrown(() => recallRun({ label: 'cand-1', outDir, only: [6], run }));
  assert.match(String(e?.message), /cand-1 is already saved/);
  assert.equal(sessions, 0, 'refused before any session is paid for');
  assert.equal(read(path.join(outDir, 'cand-1.md')), 'first look answers');
});

// why: catches a second blind step into the same folder, which writes over the sealed map the first look is scored by
test('the blind step refuses an out folder that already holds a sealed map or scorer files', async () => {
  const { blind } = await import('../scripts/recall-score.mjs');
  const dir = makeTemp('blind-reuse-');
  const run = path.join(dir, 'cand-1.md');
  fs.writeFileSync(run, '# Recall run: cand-1\n\nWhen: 2026-11-20T10:00:00.000Z\n\n## 1. Q?\n\nKey: k\n\nAnswer:\n\n> a\n\nScore: _\n');
  const out = path.join(dir, 'out');
  blind(out, [run], () => 0);
  const sealed = read(path.join(out, 'sealed-map.json'));
  const e = thrown(() => blind(out, [run], () => 0));
  assert.match(String(e?.message), /already holds a blind/);
  assert.equal(read(path.join(out, 'sealed-map.json')), sealed);
  const scorerOnly = path.join(dir, 'out2');
  fs.mkdirSync(path.join(scorerOnly, 'scorer'), { recursive: true });
  fs.writeFileSync(path.join(scorerOnly, 'scorer', 'R01.md'), 'x');
  assert.match(String(thrown(() => blind(scorerOnly, [run], () => 0))?.message), /already holds a blind/);
});

// why: guards the owner's throwaway-only rule: the {{CLAUDE_HOME}} fill never writes through a link outside the probe
// planted: {"file":"scripts/recall-behave.mjs","was":"else if (e.isFile() && e.name.endsWith('.md'))","to":"else if ((e.isFile() || e.isSymbolicLink()) && e.name.endsWith('.md'))"}
test('filling a probe user layer never writes through a link to a file outside it', async (t) => {
  const { copyUserLayer } = await import('../scripts/recall-behave.mjs');
  const root = makeTemp('layer-link-');
  const kit = path.join(root, 'kit');
  const outside = path.join(root, 'outside.md');
  fs.writeFileSync(outside, 'run {{CLAUDE_HOME}}/skills/x first');
  fs.mkdirSync(path.join(kit, 'user', 'skills', 'x'), { recursive: true });
  fs.writeFileSync(path.join(kit, 'user', 'skills', 'x', 'SKILL.md'), 'see {{CLAUDE_HOME}}/x');
  // K251 (1.49.0): Windows without symlink rights (no Developer Mode) cannot make the link; that is a skip, not a fault.
  try { fs.symlinkSync(outside, path.join(kit, 'user', 'skills', 'x', 'linked.md')); } catch (e) {
    if (e.code !== 'EPERM') throw e;
    t.skip('this Windows account cannot make a symlink (EPERM)');
    return;
  }
  const probe = path.join(root, 'probe');
  copyUserLayer(kit, probe, path.join(root, 'home'));
  assert.equal(read(outside), 'run {{CLAUDE_HOME}}/skills/x first', 'the file outside the probe is untouched');
  assert.doesNotMatch(read(path.join(probe, '.claude', 'skills', 'x', 'SKILL.md')), /\{\{CLAUDE_HOME\}\}/);
});

// why: catches a closeout cue write that fails and takes the prompt hook's rule cues down with it
test('the prompt hook keeps its rule cues when the closeout cue cannot be recorded', async () => {
  const { kit, home, proj } = caseKit();
  fs.writeFileSync(path.join(home, 'kit-install.json'), JSON.stringify({ kitDir: kit.replace(/\\/g, '/') }));
  fs.mkdirSync(path.join(kit, 'scripts'), { recursive: true });
  copyKitCli(kit);
  fs.mkdirSync(path.join(kit, 'rules'), { recursive: true });
  // One cue of the kit's shape, written here so the test needs no file from the repo it runs against.
  fs.writeFileSync(path.join(kit, 'rules', 'cues.json'), JSON.stringify({ cues: [{ rule: 'outward-acts', home: 'AGENTS.md', source: 'rules/core.md', when: '\\bpush\\b', quotes: ['the push bound'] }] }));
  const git = (...a) => assert.equal(spawnSync('git', ['-C', proj, ...a], { encoding: 'utf8' }).status, 0, a.join(' '));
  git('init', '-q', '-b', 'main');
  git('-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '--allow-empty', '-m', 'feat: x');
  git('tag', 'v1.0.0');
  // The cue's record is a folder, so writing it fails.
  fs.mkdirSync(path.join(proj, '.git', 'kit-closeout-cue'));
  const r = spawnSync(process.execPath, [path.resolve('project/.claude/kit-hook.cjs'), 'prompt'], { cwd: proj, input: JSON.stringify({ prompt: 'Push the branch and open its PR.' }), encoding: 'utf8', env: { ...process.env, KIT_CLAUDE_HOME: home, CLAUDE_PROJECT_DIR: proj } });
  assert.notEqual(r.stdout, '', 'the hook still replies');
  assert.match(JSON.parse(r.stdout).hookSpecificOutput.additionalContext, /rule:outward-acts/);
});
