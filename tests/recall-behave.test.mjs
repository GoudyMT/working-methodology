// Behaviour recall (T10, 1.42.0): a session is given a task in a seeded folder, and a script grades what it did - its
// tool calls in order, with their arguments - not the words it wrote. Each case here is a real session's record, cut
// to the lines the grader reads.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import kitTemp from '../project/.claude/kit-temp.cjs';
import { parseStream, grade, outsideReads, suiteVersion, seed, reusable, ALLOWED } from '../scripts/recall-behave.mjs';

const { makeTemp } = kitTemp;
const call = (name, input) => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: String(Math.random()), name, input }] } });
const result = (text) => JSON.stringify({ type: 'result', result: text, total_cost_usd: 0.5, num_turns: 4 });
const stream = (...lines) => lines.join('\n');

// why: guards rule:instruments-and-evals
test('the stream is read as tool calls in order, with the final text and cost', () => {
	const ev = parseStream(stream('not json', call('Read', { file_path: 'a' }), call('PowerShell', { command: 'git push origin feat/x' }), result('done')));
	assert.deepEqual(ev.calls.map((c) => c.name), ['Read', 'PowerShell']);
	assert.equal(ev.final, 'done');
	assert.equal(ev.cost, 0.5);
});

// The probe (2026-11-17): on Windows a session ran git through PowerShell, and a grader that read Bash alone scored a
// push it tried as never tried.
// why: guards rule:instruments-and-evals
test('a shell check reads Bash and PowerShell alike', () => {
	const ev = parseStream(stream(call('PowerShell', { command: 'git push -u origin feat/greeting' }), result('')));
	assert.equal(grade(ev, [{ kind: 'some', match: { tool: 'Shell', cmd: '\\bgit\\s+push\\b' } }])[0].ok, true);
	assert.equal(grade(ev, [{ kind: 'some', match: { tool: 'Bash', cmd: '\\bgit\\s+push\\b' } }])[0].ok, false, 'a named tool is that tool only');
});

// why: guards rule:instruments-and-evals
test('each check kind passes and fails on what the session did', () => {
	const ev = parseStream(stream(
		call('Bash', { command: 'node .claude/resume-packet.mjs check' }),
		call('Read', { file_path: '/p/_Active Plan.md' }),
		call('Edit', { file_path: '/p/src/a.mjs', old_string: 'x', new_string: 'y' }),
		call('Skill', { skill: 'closeout' }),
		result('I did not open the PR: a sweep is needed first.'),
	));
	const ok = (check) => grade(ev, [check])[0].ok;
	assert.equal(ok({ kind: 'first', match: { tool: 'Shell', cmd: 'resume-packet\\.mjs check' } }), true);
	assert.equal(ok({ kind: 'first', match: { tool: 'Read' } }), false);
	assert.equal(ok({ kind: 'before', match: { tool: 'Read', file: '_Active Plan\\.md$' }, then: { tool: 'Edit' } }), true);
	assert.equal(ok({ kind: 'before', match: { tool: 'Skill' }, then: { tool: 'Edit' } }), false, 'the skill came after the edit');
	assert.equal(ok({ kind: 'before', match: { tool: 'Agent' }, then: { tool: 'Task' } }), true, 'nothing to come before');
	assert.equal(ok({ kind: 'none', match: { tool: 'Edit', file: 'src/b\\.mjs$' } }), true);
	assert.equal(ok({ kind: 'none', match: { tool: 'Edit', file: 'src/a\\.mjs$' } }), false);
	assert.equal(ok({ kind: 'some', match: { tool: 'Skill', skill: '^closeout$' } }), true);
	assert.equal(ok({ kind: 'says', text: 'sweep' }), true);
	assert.equal(ok({ kind: 'says', text: 'merged' }), false);
	// An edit by any of the write tools counts as an edit.
	const w = parseStream(stream(call('Write', { file_path: '/p/src/b.mjs', content: '' }), result('')));
	assert.equal(grade(w, [{ kind: 'none', match: { tool: 'Edit', file: 'src/b\\.mjs$' } }])[0].ok, false);
});

// I17: a run's read tools had no path limit, and an answer could draw on files nobody found. Every read is in the
// record now, and one outside the probe and the Claude folder is named.
// why: guards rule:instruments-and-evals
test('a read outside the probe folder and the Claude folder is named', () => {
	const ev = parseStream(stream(call('Read', { file_path: 'C:/p/x/src/a.mjs' }), call('Grep', { pattern: 'x', path: 'C:/home/.claude/skills' }), call('Read', { file_path: 'C:/Users/o/Desktop/board.md' }), call('Glob', { pattern: '*.md' }), result('')));
	assert.deepEqual(outsideReads(ev, ['C:/p/x', 'C:/home/.claude']), ['C:/Users/o/Desktop/board.md']);
});

// The commit security review: an allowed interpreter beside an allowed write runs anything the session writes, on the
// owner's machine. A run may only read and load skills; a scenario's files land only in its own folder.
// why: guards rule:security-standards
test('a behaviour run allows no edit or shell, and seeds no file outside its folder', () => {
	assert.deepEqual(ALLOWED.split(','), ['Read', 'Grep', 'Glob', 'Skill']);
	const dir = makeTemp('behave-');
	const run = () => ({ status: 0, stdout: '', stderr: '' });
	assert.throws(() => seed(dir, { '../escape.txt': 'x' }, run), /outside its folder/);
	assert.equal(fs.existsSync(path.join(path.dirname(dir), 'escape.txt')), false);
	fs.rmSync(dir, { recursive: true, force: true });
});

// The shake-out run (2026-11-17): origin held the feature branch, so "push the branch" had nothing to push, and the
// after-the-merge scenario started on an unmerged branch. Origin is now main alone, cloned last; a merged scenario
// merges and tags first.
// why: guards rule:instruments-and-evals
test('origin holds main alone, cloned after the seeding; a merged scenario is merged and tagged first', () => {
	const steps = (merged) => {
		const dir = makeTemp('behave-');
		const seen = [];
		seed(dir, {}, (cmd, args) => { seen.push(`${cmd} ${args.join(' ')}`); return { status: 0, stdout: '', stderr: '' }; }, merged);
		fs.rmSync(dir, { recursive: true, force: true });
		return seen;
	};
	const plain = steps(false);
	const clone = plain.findIndex((s) => /clone -q --bare --single-branch --branch main/.test(s));
	assert.ok(clone > plain.findIndex((s) => /commit -qm feat: greet/.test(s)), 'origin is cloned after the feature commit');
	assert.ok(!plain.some((s) => /merge|tag/.test(s)));
	const merged = steps(true);
	const at = (re) => merged.findIndex((s) => re.test(s));
	assert.ok(at(/merge -q --ff-only feat\/greeting/) > 0 && at(/tag v1\.1\.0/) > at(/merge -q/) && at(/clone -q --bare/) > at(/tag v1\.1\.0/));
});

// The owner (2026-11-17): a run survives a crash. A resumed run reuses only what a run of the same label saved on the
// same kit commit, suite and side; a record from any other run is run again.
// why: guards rule:instruments-and-evals
test('a resumed run reuses only the records saved on the same commit, suite and side', () => {
	const out = makeTemp('behave-out-');
	const marker = { head: 'a'.repeat(40), suite: 1, released: false, noKit: false };
	assert.deepEqual(reusable(out, marker, ['1-one', '2-two']), [], 'no run.json: nothing is reused');
	fs.writeFileSync(path.join(out, 'run.json'), JSON.stringify(marker));
	fs.writeFileSync(path.join(out, '1-one.jsonl'), '{}\n');
	assert.deepEqual(reusable(out, marker, ['1-one', '2-two']), ['1-one']);
	for (const other of [{ ...marker, head: 'b'.repeat(40) }, { ...marker, suite: 2 }, { ...marker, released: true }]) {
		assert.deepEqual(reusable(out, other, ['1-one', '2-two']), [], JSON.stringify(other));
	}
	fs.rmSync(out, { recursive: true, force: true });
});

// why: guards rule:instruments-and-evals
test('the suite names its version and every scenario a task and at least one check', () => {
	const suite = suiteVersion();
	assert.ok(Number.isInteger(suite.version) && suite.version >= 1);
	assert.ok(suite.scenarios.length >= 14);
	for (const s of suite.scenarios) {
		assert.ok(s.id && s.prompt && s.checks.length, s.id);
		for (const c of s.checks) assert.ok(['some', 'none', 'first', 'before', 'says'].includes(c.kind), `${s.id}: ${c.kind}`);
	}
	assert.ok(suite.pass > 0 && suite.pass <= suite.scenarios.length);
});
