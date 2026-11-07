// Tests for the one temp helper (project/.claude/kit-temp.cjs) and the guarded test runner (scripts/test-run.mjs).
// A killed run once filled the Cowork VM's inodes with test folders; each test here is one way a run can leave
// something behind, and checks that the next run or the runner clears it or refuses to start.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import kitTemp from '../project/.claude/kit-temp.cjs';

const { sessionRoot, makeTemp, withTemp, removeTemp, sweepStale, inodeUse, inodeLevel, ROOT_PREFIX } = kitTemp;
const HELPER = path.resolve('project/.claude/kit-temp.cjs');
const RUNNER = path.resolve('scripts/test-run.mjs');

const tmpRoot = sessionRoot();

// A fresh folder standing in for os.tmpdir(), so a test can count and plant entries without touching the run's root.
const base = () => makeTemp('base-');
const node = (code, env = {}) => spawnSync(process.execPath, ['-e', code], { encoding: 'utf8', env: { ...process.env, ...env } });
const childRoot = (dir, tail = '') => node(`const t = require(${JSON.stringify(HELPER)}); const r = t.sessionRoot(); console.log(r); ${tail}`, { TMPDIR: dir, TEMP: dir, TMP: dir });
// A pid no live process holds: a child that has already exited.
const deadPid = () => spawnSync(process.execPath, ['-e', 'console.log(process.pid)'], { encoding: 'utf8' }).stdout.trim();

test('the run root sits in the real temp folder, names its owner pid, and every later temp folder lands inside it', () => {
	assert.match(path.basename(tmpRoot), new RegExp(`^${ROOT_PREFIX}${process.pid}-`));
	assert.equal(os.tmpdir(), tmpRoot);
	const d = makeTemp('x-');
	assert.equal(path.dirname(d), tmpRoot);
	assert.ok(fs.statSync(d).isDirectory());
});

test('a root is removed on a normal exit and on SIGINT or SIGTERM, with the signal exit code', () => {
	for (const [tail, code] of [['', 0], ["process.emit('SIGINT')", 130], ["process.emit('SIGTERM')", 143]]) {
		const dir = base();
		// The handler exits the process itself; the line after the signal must never run.
		const r = childRoot(dir, tail ? `${tail}; console.log('still running');` : '');
		assert.doesNotMatch(r.stdout, /still running/);
		assert.equal(r.status, code, `${tail || 'normal exit'}: ${r.stderr}`);
		const root = r.stdout.trim();
		assert.ok(root.startsWith(dir), root);
		assert.equal(fs.existsSync(root), false, `${tail || 'normal exit'} left ${root}`);
	}
});

test('a killed run leaves its root, and the next run sweeps it because its owner pid is dead', () => {
	const dir = base();
	const r = childRoot(dir, "process.kill(process.pid, 'SIGKILL');");
	const left = fs.readdirSync(dir).filter((n) => n.startsWith(ROOT_PREFIX));
	assert.equal(left.length, 1, `the kill should leave exactly one root: ${r.status} ${left}`);
	const next = childRoot(dir);
	assert.equal(next.status, 0, next.stderr);
	assert.deepEqual(fs.readdirSync(dir), [], 'the next run swept the killed root and removed its own');
});

test('the sweep keeps a live owner\'s root, so parallel shards never delete each other', () => {
	const dir = base();
	const live = path.join(dir, `${ROOT_PREFIX}${process.pid}-abc123`);
	const dead = path.join(dir, `${ROOT_PREFIX}${deadPid()}-def456`);
	for (const d of [live, dead]) fs.mkdirSync(d);
	const removed = sweepStale(dir);
	assert.deepEqual(removed, [dead]);
	assert.ok(fs.existsSync(live));
});

test('the sweep clears a live pid\'s root only past a day (pid reuse), and an old-style root only past an hour', () => {
	const dir = base();
	const hours = (h) => new Date(Date.now() - h * 3600e3);
	const reused = path.join(dir, `${ROOT_PREFIX}${process.pid}-old111`);
	const fresh = path.join(dir, `${ROOT_PREFIX}${process.pid}-new111`);
	const legacyOld = path.join(dir, `${ROOT_PREFIX}Ab12Cd`);
	const legacyNew = path.join(dir, `${ROOT_PREFIX}Zz98Yy`);
	for (const d of [reused, fresh, legacyOld, legacyNew]) fs.mkdirSync(d);
	fs.utimesSync(reused, hours(25), hours(25));
	fs.utimesSync(legacyOld, hours(2), hours(2));
	assert.deepEqual(sweepStale(dir).sort(), [legacyOld, reused].sort());
	assert.ok(fs.existsSync(fresh) && fs.existsSync(legacyNew));
});

test('the sweep touches only kit run roots: other names, files and look-alikes stay', () => {
	const dir = base();
	const keep = ['approve-abc123', 'kit-tests', 'kit-tests-notes.txt', `x${ROOT_PREFIX}1-abc123`, 'node-compile-cache'];
	for (const n of keep) n.endsWith('.txt') ? fs.writeFileSync(path.join(dir, n), '') : fs.mkdirSync(path.join(dir, n));
	fs.writeFileSync(path.join(dir, `${ROOT_PREFIX}1-abc123`), 'a file, not a root');
	const old = new Date(Date.now() - 48 * 3600e3);
	for (const n of fs.readdirSync(dir)) fs.utimesSync(path.join(dir, n), old, old);
	assert.deepEqual(sweepStale(dir), []);
	assert.equal(fs.readdirSync(dir).length, keep.length + 1);
});

test('withTemp removes its folder when the work throws, and passes the result through when it returns', () => {
	let seen;
	assert.throws(() => withTemp('wt-', (d) => { seen = d; fs.writeFileSync(path.join(d, 'f'), 'x'); throw new Error('boom'); }), /boom/);
	assert.equal(fs.existsSync(seen), false);
	assert.equal(withTemp('wt-', (d) => { seen = d; return 7; }), 7);
	assert.equal(fs.existsSync(seen), false);
});

test('a removal that fails says so on stderr instead of passing silently', () => {
	const r = node(`const t = require(${JSON.stringify(HELPER)}); require('fs').rmSync = () => { throw new Error('EBUSY: locked'); }; console.log(t.removeTemp(${JSON.stringify(path.join(tmpRoot, 'nope'))}));`);
	assert.equal(r.status, 0, r.stderr);
	assert.equal(r.stdout.trim(), 'false');
	assert.match(r.stderr, /kit-temp: could not remove .*nope.*EBUSY/);
	assert.equal(removeTemp(makeTemp('ok-')), true);
});

test('the inode level warns above half used and refuses above 80%, and reads unknown when the disk gives no count', () => {
	assert.equal(inodeLevel({ files: 100, ffree: 60 }).level, 'ok');
	assert.equal(inodeLevel({ files: 100, ffree: 50 }).level, 'ok');
	assert.equal(inodeLevel({ files: 100, ffree: 49 }).level, 'warn');
	assert.equal(inodeLevel({ files: 100, ffree: 20 }).level, 'warn');
	assert.equal(inodeLevel({ files: 100, ffree: 19 }).level, 'refuse');
	assert.equal(inodeLevel({ files: 655360, ffree: 0 }).level, 'refuse');
	assert.equal(inodeLevel({ files: 0, ffree: 0 }).level, 'unknown');
	assert.equal(inodeLevel(null).level, 'unknown');
	assert.ok(['ok', 'warn', 'refuse', 'unknown'].includes(inodeUse(os.tmpdir()).level));
});

test('a run refuses to start on a disk above 80% inodes used, and makes no root', () => {
	const dir = base();
	const r = node(`const t = require(${JSON.stringify(HELPER)}); const fs = require('fs'); fs.statfsSync = () => ({ files: 100, ffree: 10 }); try { t.sessionRoot(); } catch (e) { console.log(e.message); process.exit(3); }`, { TMPDIR: dir, TEMP: dir, TMP: dir });
	assert.equal(r.status, 3, r.stderr);
	assert.match(r.stdout, /90% of inodes used.*refuse/);
	assert.deepEqual(fs.readdirSync(dir), []);
});

// The guarded runner, end to end, on tiny test files of its own.
function runner(files) {
	const dir = base();
	const paths = Object.entries(files).map(([name, body]) => { const f = path.join(makeTemp('suite-'), name); fs.writeFileSync(f, body); return f; });
	const r = spawnSync(process.execPath, [RUNNER, ...paths], { encoding: 'utf8', env: { ...process.env, TMPDIR: dir, TEMP: dir, TMP: dir } });
	return { ...r, dir };
}
const helperUrl = JSON.stringify(pathToFileURL(HELPER).href);
const head = `import { test } from 'node:test'; import t from ${helperUrl}; import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; t.sessionRoot();`;

test('the runner passes a clean suite and leaves the temp folder as it found it', () => {
	const r = runner({ 'a.test.mjs': `${head} test('ok', () => { t.makeTemp('a-'); });` });
	assert.equal(r.status, 0, r.stdout + r.stderr);
	assert.match(r.stdout, /temp growth: 0/);
	assert.deepEqual(fs.readdirSync(r.dir), []);
});

test('the runner fails a suite that leaves a folder in the real temp folder, and names it', () => {
	const r = runner({ 'leak.test.mjs': `import { test } from 'node:test'; import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; test('leaks', () => { fs.mkdirSync(path.join(os.tmpdir(), 'leaked-by-test')); });` });
	assert.notEqual(r.status, 0);
	assert.match(r.stderr, /temp growth: 1.*leaked-by-test/s);
});

test('the runner clears the root of a test file that was killed, so a killed run adds nothing', () => {
	const r = runner({ 'killed.test.mjs': `${head} t.makeTemp('k-'); process.kill(process.pid, 'SIGKILL');` });
	assert.notEqual(r.status, 0, 'the killed file still fails the run');
	assert.match(r.stdout, /temp growth: 0/);
	assert.deepEqual(fs.readdirSync(r.dir), []);
});

test('the runner refuses to start when the temp disk is above 80% inodes used', () => {
	const code = `require('fs').statfsSync = () => ({ files: 100, ffree: 15 }); import(${JSON.stringify(pathToFileURL(RUNNER).href)}).then((m) => m.main(['none.test.mjs'])).then((c) => process.exit(c));`;
	const r = spawnSync(process.execPath, ['-e', code], { encoding: 'utf8' });
	assert.equal(r.status, 2, r.stdout + r.stderr);
	assert.match(r.stderr, /85% of inodes used.*refuse/);
});

// One helper: no other kit code calls mkdtemp itself, so no temp folder escapes the run root and its sweep.
test('no kit file calls mkdtemp except the temp helper', () => {
	const roots = ['scripts', 'tests', 'user', 'project'];
	// The helper, its built copy beside the merge gate, and this file (its pattern names the call).
	const ALLOWED = new Set([HELPER, path.resolve('user/kit-tools/kit-temp.cjs'), path.resolve('tests/kit-temp.test.mjs')]);
	const hits = [];
	const walk = (d) => {
		for (const e of fs.readdirSync(d, { withFileTypes: true })) {
			const p = path.join(d, e.name);
			if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p); continue; }
			if (!/\.(mjs|cjs|js)$/.test(e.name) || ALLOWED.has(path.resolve(p))) continue;
			if (/\bmkdtemp(Sync)?\s*\(/.test(fs.readFileSync(p, 'utf8'))) hits.push(p);
		}
	};
	for (const r of roots) walk(r);
	assert.deepEqual(hits, [], 'use makeTemp or withTemp from kit-temp.cjs');
});
