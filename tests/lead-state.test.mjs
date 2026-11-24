// lead-state.mjs: a script-written JSON lead state record (K374 U4). The script is spawned, never imported, so a missing
// script fails an assertion, not the loader.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'user', 'kit-tools', 'lead-state.mjs');
const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const jsonl = (rows) => rows.map((r) => JSON.stringify(r)).join('\n') + '\n';

const PLAN_TEXT = '# Plan\n\n| Id | Title |\n| --- | --- |\n| U1 | first |\n| U2 | second |\n';
const FIELDS = ['plan', 'planSha', 'locksSha', 'phase', 'head', 'merged', 'next', 'owed', 'questions', 'hookErrors', 'closeout', 'sources'];

// A small git repo holding every source the record reads, as the kit writes them.
function fixture() {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lead-state-'));
	const git = (...a) => execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@example.com', ...a], { cwd: root, encoding: 'utf8' });
	git('init', '-q');
	const dir = path.join(root, 'plans', 'p');
	fs.mkdirSync(dir, { recursive: true });
	fs.mkdirSync(path.join(root, 'docs', 'builds'), { recursive: true });
	const plan = path.join(dir, 'PLAN.md');
	fs.writeFileSync(plan, PLAN_TEXT);
	fs.writeFileSync(`${plan}.locks.json`, JSON.stringify({ U1: 'aaa' }));
	fs.writeFileSync(path.join(root, 'VERSION'), '1.0.0\n');
	fs.writeFileSync(path.join(root, 'docs', 'builds', '1.0.0.closeout.json'), JSON.stringify({ version: '1.0.0', findings: [] }));
	fs.writeFileSync(
		path.join(dir, 'flow.jsonl'),
		jsonl([
			{ unit: 'U1', step: 'tests', at: '2026-01-01T00:00:00Z', by: 'lead' },
			{ unit: 'U1', step: 'merged', at: '2026-01-01T01:00:00Z', by: 'lead' },
			{ kind: 'hook-report', error: 'E2', cause: 'a stale lock', fix: 'cleared it' },
		]),
	);
	fs.writeFileSync(
		path.join(dir, 'lead-checklist.jsonl'),
		jsonl([
			{ phase: 'build', item: 'merge unit U1', done: true, proof: 'abc' },
			{ phase: 'check', item: 'run the opus check on lane D', done: false, proof: '' },
			{ phase: 'check', item: 'ask Max about the release name', done: false, proof: '', question: true },
			{ phase: 'close', item: 'write the closeout', done: false, proof: '' },
		]),
	);
	fs.writeFileSync(
		path.join(root, '.git', 'kit-guard-open.log'),
		jsonl([
			{ at: '2026-01-01T00:30:00Z', kind: 'hook-error', id: 'E1', hook: 'merge-gate', cause: 'crash in merge-gate' },
			{ at: '2026-01-01T00:40:00Z', kind: 'hook-error', id: 'E2', hook: 'kit-gate', cause: 'crash in kit-gate' },
		]),
	);
	git('add', '-A');
	git('commit', '-q', '-m', 'init');
	return { root, dir, plan, git, record: path.join(dir, 'lead-state.json'), hookLog: path.join(root, '.git', 'kit-guard-open.log') };
}

function run(fx, ...args) {
	const r = spawnSync(process.execPath, [SCRIPT, ...args, fx.plan], { cwd: fx.root, encoding: 'utf8' });
	return { code: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
}
const readRecord = (fx) => JSON.parse(fs.readFileSync(fx.record, 'utf8'));
const has = (v, text) => JSON.stringify(v).includes(text);
const lineFor = (out, field) => out.split(/\r?\n/).find((l) => new RegExp(`^\\s*${field}\\b`).test(l)) || '';

// why: catches write builds the record from the plan, its locks, the flow log, the lead checklist, the closeout file and git, with no typed field (K374 S1)
test('write builds the record from the plan, its locks, the flow log, the lead checklist, the closeout file and git, with no typed field', () => {
	const fx = fixture();
	const w = run(fx, 'write');
	assert.equal(w.code, 0, w.out);
	const rec = readRecord(fx);
	assert.equal(rec.planSha, sha256(PLAN_TEXT));
	assert.equal(rec.locksSha, sha256(fs.readFileSync(`${fx.plan}.locks.json`)));
	assert.equal(rec.closeout, sha256(fs.readFileSync(path.join(fx.root, 'docs', 'builds', '1.0.0.closeout.json'))));
	assert.equal(rec.head, fx.git('rev-parse', 'HEAD').trim());
	assert.deepEqual(rec.merged, ['U1']);
	assert.equal(rec.phase, 'check');
	assert.ok(has(rec.next, 'run the opus check on lane D'), 'next is the first undone item');
	assert.ok(Array.isArray(rec.sources) && rec.sources.length >= 4, 'sources lists the files read');
	assert.ok(rec.sources.every((s) => typeof s.file === 'string' && /^[0-9a-f]{64}$/.test(s.sha)), 'each source has a file and a sha');
	assert.ok(rec.version !== undefined && typeof rec.sha === 'string' && rec.sha !== '', 'version and sha are set');
	// control: nothing is typed, so a changed source changes the field on the next write
	fs.appendFileSync(path.join(fx.dir, 'flow.jsonl'), jsonl([{ unit: 'U2', step: 'merged', at: '2026-01-02T00:00:00Z', by: 'lead' }]));
	assert.equal(run(fx, 'write').code, 0);
	assert.deepEqual(readRecord(fx).merged, ['U1', 'U2']);
	// second fixture: no locks file and no closeout file are null fields, not a full-read
	const bare = fixture();
	fs.rmSync(`${bare.plan}.locks.json`);
	fs.rmSync(path.join(bare.root, 'docs', 'builds', '1.0.0.closeout.json'));
	const bw = run(bare, 'write');
	assert.equal(bw.code, 0, bw.out);
	const brec = readRecord(bare);
	assert.equal(brec.locksSha, null);
	assert.equal(brec.closeout, null);
	const bc = run(bare, 'check');
	assert.equal(bc.code, 0, bc.out);
	assert.match(bc.out, /^VERDICT: ok$/m, bc.out);
	assert.doesNotMatch(bc.out, /full-read/);
	// U4-1: a checklist line that carries a kind (warm reset, note, defer) is not a step, so write skips it as checklist.mjs does
	const kinded = fixture();
	fs.appendFileSync(path.join(kinded.dir, 'lead-checklist.jsonl'), jsonl([{ kind: 'reset', agent: 'x', role: 'builder', tokens: 1, reason: 'r', at: '2026-01-02T00:00:00Z' }]));
	const kw = run(kinded, 'write');
	assert.doesNotMatch(kw.out, /VERDICT: full-read/, kw.out);
	assert.equal(kw.code, 0, kw.out);
	assert.deepEqual(readRecord(kinded).owed, rec.owed, 'the kind line adds no owed step');
	// U4-2: a defer line carries a kind but is an owed step; only a kind line with no item (a reset) stays out
	fs.appendFileSync(path.join(kinded.dir, 'lead-checklist.jsonl'), jsonl([{ kind: 'defer', phase: 'P3', item: 'carry the retest to the next patch', done: 'false' }]));
	assert.equal(run(kinded, 'write').code, 0);
	const owedNow = readRecord(kinded).owed;
	assert.ok(owedNow.includes('carry the retest to the next patch'), `a defer line is an owed step, got ${JSON.stringify(owedNow)}`);
	assert.equal(owedNow.length, rec.owed.length + 1, 'the reset line with no item stays out');
});

// why: catches check rebuilds the record from the live sources and prints same or CHANGED per field and one VERDICT line (K374 S2)
test('check rebuilds the record from the live sources and prints same or CHANGED per field and one VERDICT line', () => {
	const fx = fixture();
	assert.equal(run(fx, 'write').code, 0);
	const c = run(fx, 'check');
	assert.equal(c.code, 0, c.out);
	for (const f of FIELDS) {
		const l = lineFor(c.out, f);
		assert.match(l, /same/i, `field ${f}: ${c.out}`);
		assert.doesNotMatch(l, /CHANGED/, `field ${f}`);
	}
	assert.equal(c.out.split(/\r?\n/).filter((l) => l.startsWith('VERDICT')).length, 1);
	assert.match(c.out, /^VERDICT: ok$/m);
	// control: a changed source prints CHANGED on that field and not on an untouched one
	fs.appendFileSync(path.join(fx.dir, 'lead-checklist.jsonl'), jsonl([{ phase: 'close', item: 'tag it', done: false, proof: '' }]));
	const d = run(fx, 'check');
	assert.match(lineFor(d.out, 'owed'), /CHANGED/);
	assert.match(lineFor(d.out, 'planSha'), /same/i);
});

// why: catches a unit merged since write gives VERDICT stale and exit 1 (K374 S2)
test('a unit merged since write gives VERDICT stale and exit 1', () => {
	const fx = fixture();
	assert.equal(run(fx, 'write').code, 0);
	fs.appendFileSync(path.join(fx.dir, 'flow.jsonl'), jsonl([{ unit: 'U2', step: 'merged', at: '2026-01-02T00:00:00Z', by: 'lead' }]));
	const c = run(fx, 'check');
	assert.equal(c.code, 1, c.out);
	assert.match(c.out, /^VERDICT: stale \(.*merged.*\)$/m);
	assert.match(lineFor(c.out, 'merged'), /CHANGED/);
});

// why: catches the record names owed steps: undone checklist items, open questions and hook errors with no report (K374 S3)
test('the record names owed steps: undone checklist items, open questions and hook errors with no report', () => {
	const fx = fixture();
	assert.equal(run(fx, 'write').code, 0);
	const rec = readRecord(fx);
	assert.ok(has(rec.owed, 'run the opus check on lane D'), 'owed names an undone item by text');
	assert.ok(has(rec.owed, 'write the closeout'), 'owed names every undone item');
	assert.ok(!has(rec.owed, 'merge unit U1'), 'a done item is not owed');
	assert.ok(has(rec.questions, 'ask Max about the release name'), 'the open question is listed by text');
	assert.ok(has(rec.hookErrors, 'E1'), 'a hook error with no report is listed');
	assert.ok(has(rec.hookErrors, 'merge-gate'), 'the entry carries its text, the hook name');
	assert.ok(!has(rec.hookErrors, 'E2'), 'a hook error the flow log reports is not listed');
});

// why: catches bypass: a record edited by hand fails its own hash and is refused (K374 S4)
test('bypass: a record edited by hand fails its own hash and is refused', () => {
	const fx = fixture();
	assert.equal(run(fx, 'write').code, 0);
	assert.equal(run(fx, 'check').code, 0, 'control: an untouched record passes');
	const orig = fs.readFileSync(fx.record, 'utf8');
	// each edit differs from the live sources, so a stale verdict would also fit: the test proves refused is checked before stale
	for (const field of ['version', ...FIELDS]) {
		const copy = JSON.parse(orig);
		assert.ok(field in copy, `the record holds ${field}`);
		copy[field] = 'HAND-EDIT';
		fs.writeFileSync(fx.record, JSON.stringify(copy, null, 2));
		const c = run(fx, 'check');
		assert.notEqual(c.code, 0, `${field}: ${c.out}`);
		assert.match(c.out, /^VERDICT: refused \(record edited by hand\)$/m, `${field}: ${c.out}`);
	}
});

// why: catches repeat: write twice on the same state gives the same bytes (K374 S1)
test('repeat: write twice on the same state gives the same bytes', () => {
	const fx = fixture();
	assert.equal(run(fx, 'write').code, 0);
	const first = fs.readFileSync(fx.record);
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1100);
	assert.equal(run(fx, 'write').code, 0);
	assert.ok(first.equals(fs.readFileSync(fx.record)), 'the record holds no time or random value');
});

// why: catches fail-closed: a missing or unreadable source gives VERDICT full-read and exit 1, logged (K374 S5)
test('fail-closed: a missing or unreadable source gives VERDICT full-read and exit 1, logged', () => {
	const fx = fixture();
	assert.equal(run(fx, 'write').code, 0);
	const flow = path.join(fx.dir, 'flow.jsonl');
	const lines = () => fs.readFileSync(fx.hookLog, 'utf8').split(/\r?\n/).filter((l) => l.trim()).map((l) => JSON.parse(l));
	const before = lines().length;
	fs.rmSync(flow);
	const c = run(fx, 'check');
	assert.equal(c.code, 1, c.out);
	assert.match(c.out, /^VERDICT: full-read \(.*flow\.jsonl.*\)$/m, c.out);
	const added = lines().slice(before);
	assert.equal(added.length, 1, 'one log line');
	assert.equal(added[0].hook, 'lead-state');
	assert.ok(typeof added[0].at === 'string' && added[0].at && typeof added[0].cause === 'string' && added[0].cause, 'at and cause are set');
	// unreadable: the checklist is a directory, so it cannot be read as a file
	fs.writeFileSync(flow, jsonl([{ unit: 'U1', step: 'merged', at: '2026-01-01T01:00:00Z', by: 'lead' }]));
	const cl = path.join(fx.dir, 'lead-checklist.jsonl');
	fs.rmSync(cl);
	fs.mkdirSync(cl);
	const u = run(fx, 'check');
	assert.equal(u.code, 1, u.out);
	assert.match(u.out, /^VERDICT: full-read \(.*lead-checklist\.jsonl.*\)$/m, u.out);
	assert.equal(lines().slice(before).length, 2, 'a second log line for the second failure');
	// U4-1 control: a checklist line that is not JSON at all is still a full-read
	fs.rmSync(cl, { recursive: true });
	fs.writeFileSync(cl, `${JSON.stringify({ phase: 'build', item: 'x', done: false, proof: '' })}\nthis is not json\n`);
	const bad = run(fx, 'write');
	assert.equal(bad.code, 1, bad.out);
	assert.match(bad.out, /^VERDICT: full-read \(.*lead-checklist\.jsonl.*\)$/m, bad.out);
});
