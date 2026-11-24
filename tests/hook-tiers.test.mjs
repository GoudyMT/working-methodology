// K375 (patch 1.51.4, U7): every hook has a tier in user/kit-hooks/holds.json ("security", "high" or "small"), and one
// helper acts on it. hold-mode.cjs gains tier(id): anything but an exact tier reads as high, so a damaged list can only make
// a hook stricter. hook-error.cjs exports onError(id, error, where): it appends {kind: "hook-error", id, hook, tier, error
// (first line), at} to <git common dir>/kit-guard-open.log (the log checklist.mjs reads), then returns a deny
// "hook error: lead review: <hook>" for security or high, or null for small. Each test loads the real modules, or a copy
// of the hook folder beside a holds.json it writes, so a missing module fails on an assertion, not on a crash.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import kitTemp from '../project/.claude/kit-temp.cjs';

kitTemp.sessionRoot();
const HOOK_DIR = path.resolve('user/kit-hooks');
const TOOLS_DIR = path.resolve('user/kit-tools');
const GUARD = path.resolve('project/.claude/guard.cjs');
// Files in kit-hooks that are libraries, not hooks: they are never listed in holds.json.
const LIBRARIES = new Set(['hold-mode', 'hook-error', 'prices', 'safe-spawn', 'why-rule']);
const TIERS = new Set(['security', 'high', 'small']);
// Max, 2026-11-23 03:16Z (security, high, small) plus ci-fix: high (K375 F2).
const EXPECTED = {
	'owner-proof': 'security', 'task-gate': 'security', 'guard-outward': 'security', 'guard-delete': 'security', 'guard-read': 'security',
	'agent-model': 'high', 'sweep-guard': 'high', canary: 'high', 'handoff-gate': 'high', 'edit-fence': 'high', 'clean-tree': 'high', 'test-scope': 'high', 'call-cap': 'high', 'ci-fix': 'high',
	grounding: 'small', 'kit-gate': 'small', 'record-counts': 'small',
};

// A hook folder: the real one, or a copy of it with holds.json replaced (text given) or removed (null).
function hookDir(holdsText) {
	if (holdsText === undefined) return HOOK_DIR;
	const dir = kitTemp.makeTemp('hook-tiers-hooks-');
	fs.cpSync(HOOK_DIR, dir, { recursive: true });
	if (holdsText === null) fs.rmSync(path.join(dir, 'holds.json'), { force: true });
	else fs.writeFileSync(path.join(dir, 'holds.json'), holdsText);
	return dir;
}
const holdsOf = (entries) => JSON.stringify({ holds: entries.map(([id, tier]) => ({ id, hook: `${id}.cjs`, mode: 'enforce', ...(tier === undefined ? {} : { tier }) })) });

// The two modules of a hook folder; a module that is not there or does not load reads as undefined.
function load(dir) {
	const req = createRequire(path.join(dir, 'x.cjs'));
	const get = (name) => { try { return req(`./${name}.cjs`); } catch { return {}; } };
	return { tier: get('hold-mode').tier, onError: get('hook-error').onError };
}
const needTier = (m) => assert.equal(typeof m.tier, 'function', 'hold-mode.cjs must export tier(id)');
const needOnError = (m) => assert.equal(typeof m.onError, 'function', 'hook-error.cjs must export onError(id, error, where)');

function repo() {
	const dir = kitTemp.makeTemp('hook-tiers-repo-');
	const r = spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: dir, encoding: 'utf8' });
	assert.equal(r.status, 0, r.stderr);
	return dir;
}
// onError's third argument is the hook call's cwd, a folder inside the repo; the row goes to <git common dir of that
// folder>/kit-guard-open.log (for a plain repo, <dir>/.git), as agent-model.cjs finds it.
const rowsOf = (dir) => {
	const common = spawnSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: dir, encoding: 'utf8' });
	assert.equal(common.status, 0, common.stderr);
	const file = path.join(common.stdout.trim(), 'kit-guard-open.log');
	return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
};
// A linked worktree of `dir` (a commit first, then `git worktree add`), and the rows in its main repo's log, plus any log
// the worktree's own git folder (.git/worktrees/<name>/) holds.
function linkedWorktree(dir) {
	const run = (args, cwd) => { const r = spawnSync('git', args, { cwd, encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); };
	run(['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '--allow-empty', '-m', 'x'], dir);
	const wt = path.join(kitTemp.makeTemp('hook-tiers-wt-'), 'linked');
	run(['worktree', 'add', '-q', '--detach', wt], dir);
	return wt;
}
const mainRows = (dir) => {
	const file = path.join(dir, '.git', 'kit-guard-open.log');
	return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
};
const strayLogs = (dir) => {
	const root = path.join(dir, '.git', 'worktrees');
	return fs.existsSync(root) ? fs.readdirSync(root).filter((n) => fs.existsSync(path.join(root, n, 'kit-guard-open.log'))) : [];
};
const decision = (out) => out && out.hookSpecificOutput && out.hookSpecificOutput.permissionDecision;
const reason = (out) => String((out && out.hookSpecificOutput && out.hookSpecificOutput.permissionDecisionReason) || '');

// why: catches tier(id) reads security, high or small from holds.json (K375 S1)
test('tier(id) reads security, high or small from holds.json', () => {
	const m = load(hookDir(holdsOf([['alpha', 'security'], ['beta', 'high'], ['gamma', 'small']])));
	needTier(m);
	assert.equal(m.tier('alpha'), 'security');
	assert.equal(m.tier('beta'), 'high');
	assert.equal(m.tier('gamma'), 'small');
	// Folded control: the real list gives a security hook and a small hook their own tier, and adding tiers moved no hold's mode.
	const real = load(HOOK_DIR);
	needTier(real);
	assert.equal(real.tier('owner-proof'), 'security');
	assert.equal(real.tier('grounding'), 'small');
	const { mode } = createRequire(path.join(HOOK_DIR, 'x.cjs'))('./hold-mode.cjs');
	assert.equal(mode('agent-model'), 'log', 'agent-model keeps its log mode');
	assert.equal(mode('grounding'), 'enforce', 'a hook listed only for its tier reads as enforce');
});

// why: guards the owner's hook tier decision of 2026-11-23: a hook with no readable tier is treated as high (K375 S1)
test('an unknown id or a missing tier reads as high', () => {
	const m = load(hookDir(holdsOf([['no-tier'], ['null-tier', null], ['number-tier', 3], ['kept', 'small']])));
	needTier(m);
	assert.equal(m.tier('no-such-hook'), 'high', 'an unknown id');
	assert.equal(m.tier('no-tier'), 'high', 'an entry with no tier');
	assert.equal(m.tier('null-tier'), 'high', 'a tier of null');
	assert.equal(m.tier('number-tier'), 'high', 'a tier that is not a string');
	assert.equal(m.tier(undefined), 'high', 'no id at all');
	for (const id of ['constructor', '__proto__', 'toString']) assert.equal(m.tier(id), 'high', `${id} is not a hook`);
	assert.equal(m.tier('kept'), 'small', 'control: a clean entry still reads its tier');
});

// why: guards the owner's hook tier decision of 2026-11-23: every installed hook has the tier the owner approved (K375 S2)
test("every hook the kit installs (kit-hooks/*.cjs and guard.cjs's PROJECT and USER lists) has a tier entry, so a new hook with none fails", () => {
	const ids = new Set(fs.readdirSync(HOOK_DIR).filter((f) => f.endsWith('.cjs')).map((f) => f.slice(0, -4)).filter((id) => !LIBRARIES.has(id)));
	const guardText = fs.readFileSync(GUARD, 'utf8');
	const listed = [...guardText.matchAll(/^\t\['([a-z-]+)\.cjs',/gm)].map((x) => x[1]);
	assert.ok(listed.length >= 10, `guard.cjs PROJECT and USER lists parsed: ${listed.join(',')}`);
	for (const id of listed) ids.add(id);
	for (const id of Object.keys(EXPECTED)) ids.add(id);
	const holds = JSON.parse(fs.readFileSync(path.join(HOOK_DIR, 'holds.json'), 'utf8')).holds;
	const missing = [...ids].filter((id) => !holds.some((h) => h && h.id === id && TIERS.has(h.tier)));
	assert.deepEqual(missing, [], `hooks with no tier entry in holds.json: ${missing.join(', ')}`);
	// Max's list: each hook has exactly the tier he approved, and ci-fix is high.
	for (const [id, tier] of Object.entries(EXPECTED)) {
		const tiers = holds.filter((h) => h && h.id === id).map((h) => h.tier);
		assert.deepEqual(tiers, [tier], `${id} is ${tier}`);
		// A new tier entry must not switch a hook to log mode; agent-model keeps its existing log.
		const modes = holds.filter((h) => h && h.id === id).map((h) => h.mode);
		assert.deepEqual(modes, [id === 'agent-model' ? 'log' : 'enforce'], `${id} mode`);
	}
});

// why: guards the owner's hook tier decision of 2026-11-23: a crashed high or security hook denies and logs one row (K375 S3)
test('onError under high or security returns a deny "hook error: lead review: <hook>" and logs one JSON line', () => {
	const m = load(hookDir(holdsOf([['sec-hook', 'security'], ['high-hook', 'high']])));
	needOnError(m);
	for (const [id, tier] of [['high-hook', 'high'], ['sec-hook', 'security']]) {
		const dir = repo();
		const out = m.onError(id, new Error('boom here\nsecond line'), dir);
		assert.equal(decision(out), 'deny', `${tier}: a deny, got ${JSON.stringify(out)}`);
		assert.ok(reason(out).includes(`hook error: lead review: ${id}`), `${tier}: reason names the hook: ${reason(out)}`);
		const rows = rowsOf(dir);
		assert.equal(rows.length, 1, `${tier}: one row, got ${JSON.stringify(rows)}`);
		assert.equal(rows[0].kind, 'hook-error');
		assert.equal(rows[0].id, id, 'the id lets a lead report name the row');
		assert.equal(rows[0].tier, tier);
		assert.equal(rows[0].error, 'boom here', 'only the first line of the error');
		assert.ok(typeof rows[0].hook === 'string' && rows[0].hook.includes(id), `a hook field: ${JSON.stringify(rows[0])}`);
		assert.ok(!Number.isNaN(Date.parse(rows[0].at)), 'an at that is a time');
	}
	// Folded control: a call whose cwd is a linked worktree logs to the MAIN repo's .git, never under .git/worktrees/<name>/.
	const main = repo();
	const wt = linkedWorktree(main);
	assert.equal(decision(m.onError('high-hook', new Error('from a worktree'), wt)), 'deny');
	const linked = mainRows(main);
	assert.equal(linked.length, 1, `the row is in the main .git: ${JSON.stringify(linked)}`);
	assert.equal(linked[0].id, 'high-hook');
	assert.deepEqual(strayLogs(main), [], 'no log in .git/worktrees/<name>/');
});

// why: guards the owner's hook tier decision of 2026-11-23: a small hook that fails lets the call through and logs one row (K375 S3)
test('onError under small returns nothing (the call goes through) and logs one JSON line with hook, error and time', () => {
	const m = load(hookDir(holdsOf([['small-hook', 'small']])));
	needOnError(m);
	const dir = repo();
	const out = m.onError('small-hook', 'plain string failure\nmore', dir);
	assert.equal(out, null, 'the call goes through');
	const rows = rowsOf(dir);
	assert.equal(rows.length, 1, `one row, got ${JSON.stringify(rows)}`);
	assert.equal(rows[0].kind, 'hook-error');
	assert.equal(rows[0].id, 'small-hook');
	assert.equal(rows[0].tier, 'small');
	assert.equal(rows[0].error, 'plain string failure');
	assert.ok(typeof rows[0].hook === 'string' && rows[0].hook.includes('small-hook'), `a hook field: ${JSON.stringify(rows[0])}`);
	assert.ok(!Number.isNaN(Date.parse(rows[0].at)), 'an at that is a time');
});

// why: guards the owner's hook tier decision of 2026-11-23: only an exact tier spelling counts, any other reads as high (K375 S1)
test('bypass: a tier in another case or with spaces reads as high', () => {
	const spellings = ['Small', 'SMALL', ' small', 'small ', 'sma ll', 'Security', ' security', 'SECURITY', 'High', 'high\n', 'small\t'];
	const m = load(hookDir(holdsOf([...spellings.map((s, i) => [`odd-${i}`, s]), ['exact', 'small']])));
	needTier(m);
	spellings.forEach((s, i) => assert.equal(m.tier(`odd-${i}`), 'high', `tier ${JSON.stringify(s)} reads as high`));
	assert.equal(m.tier('exact'), 'small', 'control: the exact spelling is read');
});

// why: catches repeat: the same id gives the same tier (K375 S1)
test('repeat: the same id gives the same tier', () => {
	const real = load(HOOK_DIR);
	needTier(real);
	const ids = ['owner-proof', 'grounding', 'canary', 'no-such-hook'];
	const first = ids.map((id) => real.tier(id));
	const second = ids.map((id) => real.tier(id));
	assert.deepEqual(second, first, 'a second read gives the same tiers');
	assert.deepEqual(first, ['security', 'small', 'high', 'high']);
	const m = load(hookDir(holdsOf([['sec-hook', 'security']])));
	needOnError(m);
	const dir = repo();
	const a = m.onError('sec-hook', new Error('x'), dir);
	const b = m.onError('sec-hook', new Error('x'), dir);
	assert.deepEqual(b, a, 'the same error twice gives the same answer');
	assert.equal(decision(a), 'deny');
});

// why: guards the owner's hook tier decision of 2026-11-23: an unreadable holds.json reads every tier as high, logged (K375 S4)
test('fail-closed: an unreadable holds.json reads every tier as high, logged', () => {
	// F1: handoff-gate whose hold-mode.cjs will not load reads as its high tier and refuses, not log mode.
	const kit = kitTemp.makeTemp('hook-tiers-kit-');
	fs.cpSync(HOOK_DIR, path.join(kit, 'kit-hooks'), { recursive: true });
	fs.cpSync(TOOLS_DIR, path.join(kit, 'kit-tools'), { recursive: true });
	fs.writeFileSync(path.join(kit, 'kit-hooks', 'holds.json'), holdsOf([['handoff-gate', 'high']]));
	const gate = (hookFile) => {
		const cwd = repo();
		const message = ['Prose.', 'RECORD:', '{"role":"builder"}'].join('\n');
		const r = spawnSync(process.execPath, [path.join(kit, 'kit-hooks', hookFile)], { encoding: 'utf8', input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'SubagentHandback', tool_input: { message }, cwd }) });
		assert.equal(r.status, 0, r.stderr);
		return r.stdout.trim();
	};
	assert.ok(gate('handoff-gate.cjs').includes('"deny"'), 'control: a broken record is refused under enforce');
	fs.writeFileSync(path.join(kit, 'kit-hooks', 'hold-mode.cjs'), "'use strict';\nthrow new Error('hold-mode will not load');\n");
	assert.ok(gate('handoff-gate.cjs').includes('"deny"'), 'a hold-mode that will not load blocks the hand-back (high tier), never log mode');
	fs.writeFileSync(path.join(kit, 'kit-hooks', 'hold-mode.cjs'), "'use strict';\nmodule.exports = { mode() { throw new Error('mode throws'); }, tier() { return 'high'; } };\n");
	assert.ok(gate('handoff-gate.cjs').includes('"deny"'), 'a hold-mode whose mode() throws blocks the hand-back too');
	fs.rmSync(path.join(kit, 'kit-hooks', 'hold-mode.cjs'));
	assert.ok(gate('handoff-gate.cjs').includes('"deny"'), 'a hold-mode that is missing blocks the hand-back too');
	for (const text of ['{ not json', null, JSON.stringify({ holds: 'nope' }), '']) {
		const m = load(hookDir(text));
		needTier(m);
		needOnError(m);
		const label = text === null ? 'a missing file' : JSON.stringify(text);
		for (const id of ['grounding', 'owner-proof', 'canary']) assert.equal(m.tier(id), 'high', `${label}: ${id} reads as high`);
		const dir = repo();
		const out = m.onError('grounding', new Error('late'), dir);
		assert.equal(decision(out), 'deny', `${label}: a small hook is held when the list cannot be read`);
		const rows = rowsOf(dir);
		assert.ok(rows.length >= 1, `${label}: logged`);
		assert.ok(rows.some((r) => r.id === 'grounding' && r.tier === 'high'), `${label}: the row reads high: ${JSON.stringify(rows)}`);
	}
});
