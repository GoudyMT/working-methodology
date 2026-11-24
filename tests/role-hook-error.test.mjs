// K375 (patch 1.51.4, U9): the canary and the plugin's role hooks obey the hook's tier when a hook breaks. canary.cjs runs
// as its own process: when handoff-gate.cjs or record-counts.cjs throws inside it (or the canary's own run throws), the
// catch must call hook-error.cjs onError(id, error, cwd) with that hook's id instead of swallowing the error. The
// plugin launcher's roleHooks does the same for a role hook that exits with a code that is neither 0 nor 2, or times out.
// onError answers by tier: a deny "hook error: lead review: <hook>" for high or security, nothing for small, and one
// {kind: "hook-error", id, tier, ...} row in <git common dir>/kit-guard-open.log of the call's cwd. An unreadable tier list
// reads every tier as high. Each test runs the real canary.cjs or plugin-launch.cjs against a throwaway copy of the hook
// folder with a broken stub in place of one hook. Tiers come from the real holds.json: handoff-gate, canary and edit-fence
// are high; record-counts and kit-gate are small.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import kitTemp from '../project/.claude/kit-temp.cjs';

kitTemp.sessionRoot();
const HOOK_SRC = path.resolve('user/kit-hooks');
const LAUNCH = path.resolve('user/kit-tools/plugin-launch.cjs');
const PHRASE = 'Test Phrase Alpha';
const THROWS = "exports.run = () => { throw new Error('stub boom\\nsecond line'); };\n";
const COUNTS_THROW = "exports.recordCounts = () => { throw new Error('counts boom'); };\n";
// A hand-back message that opens with the phrase and carries a RECORD: block, so the canary itself has nothing to refuse.
const MESSAGE = `${PHRASE}\nprose\nRECORD:\n{"role":"builder","commit":"abc1234"}`;

// A repo whose standards/agent-teams.md holds the phrase line (the canary reads it from the main checkout), and a copy of the
// kit-hooks folder with the given files replaced; holds is the text of holds.json (undefined keeps the real one).
function setup({ hooks = {}, holds, checker = false, drop = [] } = {}) {
	const repo = kitTemp.makeTemp('role-hook-error-repo-');
	const init = spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: repo, encoding: 'utf8' });
	assert.equal(init.status, 0, init.stderr);
	fs.mkdirSync(path.join(repo, 'standards'));
	fs.writeFileSync(path.join(repo, 'standards', 'agent-teams.md'), `Confirmation phrase: open every message with: ${PHRASE}\n`);
	const kit = kitTemp.makeTemp('role-hook-error-kit-');
	fs.cpSync(HOOK_SRC, path.join(kit, 'kit-hooks'), { recursive: true });
	for (const [f, text] of Object.entries(hooks)) fs.writeFileSync(path.join(kit, 'kit-hooks', f), text);
	if (holds !== undefined) fs.writeFileSync(path.join(kit, 'kit-hooks', 'holds.json'), holds);
	for (const f of drop) fs.rmSync(path.join(kit, 'kit-hooks', f));
	// The real hand-back gate runs the record checker from ../kit-tools; without it the gate does nothing.
	if (checker) {
		fs.mkdirSync(path.join(kit, 'kit-tools'));
		fs.copyFileSync(path.resolve('user/kit-tools/handoff.mjs'), path.join(kit, 'kit-tools', 'handoff.mjs'));
	}
	return { repo, kit };
}
// The log is in the git common dir of the call's cwd; for a plain repo that is <repo>/.git.
const rowsOf = (repo) => {
	const file = path.join(repo, '.git', 'kit-guard-open.log');
	return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
};
const errorRows = (repo) => rowsOf(repo).filter((r) => r.kind === 'hook-error');
const canary = (s, input) => {
	const r = spawnSync(process.execPath, [path.join(s.kit, 'kit-hooks', 'canary.cjs')], { input: JSON.stringify({ cwd: s.repo, session_id: 's1', ...input }), encoding: 'utf8' });
	let out = null;
	try { out = r.stdout && r.stdout.trim() ? JSON.parse(r.stdout).hookSpecificOutput : null; } catch { /* not JSON */ }
	return { status: r.status, stderr: r.stderr, stdout: r.stdout, out };
};
const handback = (s, agent_type = 'builder') => canary(s, { hook_event_name: 'PreToolUse', tool_name: 'SubagentHandback', tool_input: { message: MESSAGE }, agent_type });
const reasonOf = (r) => String((r.out && r.out.permissionDecisionReason) || '');

// A plugin root laid out as the launcher reads it: roles.json naming one role hook, and kit-hooks holding the helpers plus
// that hook's stub.
function pluginRoot({ role = 'builder', file, stub, event = 'PreToolUse', holds }) {
	const s = setup({ hooks: { [file]: stub }, holds });
	const lists = event === 'PreToolUse' ? { PreToolUse: [['SubagentHandback', file]] } : { Stop: [file] };
	fs.writeFileSync(path.join(s.kit, 'roles.json'), JSON.stringify({ [role]: lists }));
	return s;
}
const roleCall = (s, event = 'PreToolUse') => {
	const lib = createRequire(import.meta.url)(LAUNCH);
	return lib.roleHooks({ agent_type: 'kit:builder', tool_name: 'SubagentHandback', tool_input: { message: 'x' }, cwd: s.repo }, event, s.kit);
};
const denyReason = (o) => String((o && o.hookSpecificOutput && o.hookSpecificOutput.permissionDecisionReason) || '');

// why: catches handoff-gate throwing inside the canary obeys handoff-gate's tier (K375 S1)
test("handoff-gate throwing inside the canary obeys handoff-gate's tier", () => {
	const s = setup({ hooks: { 'handoff-gate.cjs': THROWS } });
	const r = handback(s);
	assert.equal(r.status, 0, r.stderr);
	assert.equal(r.out && r.out.permissionDecision, 'deny', `handoff-gate is high: ${r.stdout}`);
	assert.match(reasonOf(r), /hook error: lead review: handoff-gate/);
	const rows = errorRows(s.repo);
	assert.equal(rows.length, 1, JSON.stringify(rowsOf(s.repo)));
	assert.equal(rows[0].id, 'handoff-gate');
	assert.equal(rows[0].tier, 'high');
	assert.equal(rows[0].error, 'stub boom', 'the first line of the error');
	// F1: the REAL gate refuses a broken RECORD (a RECORD: line, no valid role line) while its own log write fails (the log
	// path is a directory). The gate's deny stands with its own words; the canary's catch must not turn it into a hook error.
	const gate = (extra) => `exports.run = () => { ${extra} return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'gate refused' } }; };\n`;
	const real = setup({ checker: true });
	fs.mkdirSync(path.join(real.repo, '.git', 'kit-guard-open.log'));
	const f1 = canary(real, { hook_event_name: 'PreToolUse', tool_name: 'SubagentHandback', tool_input: { message: `${PHRASE}\nprose\nRECORD:\nnot a role line` }, agent_type: 'builder' });
	assert.equal(f1.out && f1.out.permissionDecision, 'deny', `the deny stands when the log write fails: ${f1.stdout}`);
	assert.match(reasonOf(f1), /RECORD: block is broken/, 'the gate\'s own text');
	assert.doesNotMatch(reasonOf(f1), /hook error: lead review/, 'not rewritten as a hook error');
	// Folded control: a gate that refuses without throwing keeps its own words and logs no hook error.
	const clean = setup({ hooks: { 'handoff-gate.cjs': gate('') } });
	const c = handback(clean);
	assert.match(reasonOf(c), /gate refused/);
	assert.doesNotMatch(reasonOf(c), /hook error/);
	assert.deepEqual(errorRows(clean.repo), []);
});

// why: catches record-counts throwing obeys its own tier (K375 S1)
test('record-counts throwing obeys its own tier', () => {
	const s = setup({ hooks: { 'record-counts.cjs': COUNTS_THROW } });
	// A reviewer's hand-back is shape-checked through record-counts; one that is well formed on its own goes through.
	const report = `${PHRASE}\nROLE: reviewer\nNo findings\nNot checked: nothing`;
	const r = canary(s, { hook_event_name: 'PreToolUse', tool_name: 'SubagentHandback', tool_input: { message: report }, agent_type: 'reviewer' });
	assert.equal(r.status, 0, r.stderr);
	assert.notEqual(r.out && r.out.permissionDecision, 'deny', `record-counts is small, so the call goes through: ${r.stdout}`);
	const rows = errorRows(s.repo);
	assert.equal(rows.length, 1, JSON.stringify(rowsOf(s.repo)));
	assert.equal(rows[0].id, 'record-counts', 'the row names the hook that broke, not the canary');
	assert.equal(rows[0].tier, 'small');
	assert.equal(rows[0].error, 'counts boom');
	// Folded control: the real record-counts logs no hook error for the same report.
	const real = setup();
	assert.notEqual((canary(real, { hook_event_name: 'PreToolUse', tool_name: 'SubagentHandback', tool_input: { message: report }, agent_type: 'reviewer' }).out || {}).permissionDecision, 'deny');
	assert.deepEqual(errorRows(real.repo), []);
});

// why: catches a plugin role hook that crashes (exit not 0 or 2) obeys its tier (K375 S2)
test('a plugin role hook that crashes (exit not 0 or 2) obeys its tier', () => {
	const high = pluginRoot({ file: 'edit-fence.cjs', stub: 'process.exit(1);\n' });
	const out = roleCall(high);
	assert.equal(out && out.hookSpecificOutput && out.hookSpecificOutput.permissionDecision, 'deny', `a crash under tier high: ${JSON.stringify(out)}`);
	assert.match(denyReason(out), /hook error: lead review: edit-fence/);
	const hi = errorRows(high.repo);
	assert.equal(hi.length, 1, JSON.stringify(rowsOf(high.repo)));
	assert.equal(hi[0].id, 'edit-fence');
	assert.equal(hi[0].tier, 'high');
	const small = pluginRoot({ file: 'kit-gate.cjs', stub: 'process.exit(3);\n' });
	assert.equal(roleCall(small), null, 'a crash under tier small lets the call through');
	const lo = errorRows(small.repo);
	assert.equal(lo.length, 1, JSON.stringify(rowsOf(small.repo)));
	assert.equal(lo[0].id, 'kit-gate');
	assert.equal(lo[0].tier, 'small');
	// A hook that never ends is a timeout: the launcher kills it after 5 s, and that is its error too.
	const slow = pluginRoot({ file: 'clean-tree.cjs', stub: 'setTimeout(() => {}, 60000);\n' });
	const timedOut = roleCall(slow);
	assert.equal(timedOut && timedOut.hookSpecificOutput && timedOut.hookSpecificOutput.permissionDecision, 'deny', `a timeout under tier high: ${JSON.stringify(timedOut)}`);
	assert.equal(errorRows(slow.repo).length, 1, JSON.stringify(rowsOf(slow.repo)));
	// The Stop branch of roleHooks reads a crash the same way: a high hook holds the stop, a small one lets it end.
	const stopHigh = pluginRoot({ file: 'edit-fence.cjs', stub: 'process.exit(1);\n', event: 'Stop' });
	const heldStop = roleCall(stopHigh, 'Stop');
	assert.match(String(heldStop && heldStop.stop), /hook error: lead review: edit-fence/, `a Stop crash under tier high: ${JSON.stringify(heldStop)}`);
	const stopRows = errorRows(stopHigh.repo);
	assert.equal(stopRows.length, 1, JSON.stringify(rowsOf(stopHigh.repo)));
	assert.equal(stopRows[0].id, 'edit-fence');
	assert.equal(stopRows[0].tier, 'high');
	const stopSmall = pluginRoot({ file: 'kit-gate.cjs', stub: 'process.exit(1);\n', event: 'Stop' });
	assert.equal(roleCall(stopSmall, 'Stop'), null, 'a Stop crash under tier small lets the stop end');
	const stopSmallRows = errorRows(stopSmall.repo);
	assert.equal(stopSmallRows.length, 1, JSON.stringify(rowsOf(stopSmall.repo)));
	assert.equal(stopSmallRows[0].tier, 'small');
	// Folded controls: exit 2 stays the hook's own refusal with its words, and exit 0 is no error.
	const refuse = pluginRoot({ file: 'edit-fence.cjs', stub: "process.stderr.write('plain refusal'); process.exit(2);\n" });
	assert.match(denyReason(roleCall(refuse)), /plain refusal/);
	assert.doesNotMatch(denyReason(roleCall(refuse)), /hook error/);
	assert.deepEqual(errorRows(refuse.repo), []);
	const fine = pluginRoot({ file: 'edit-fence.cjs', stub: 'process.exit(0);\n' });
	assert.equal(roleCall(fine), null);
	assert.deepEqual(errorRows(fine.repo), []);
});

// why: catches bypass: a canary crash on the Stop event obeys the tier the same (K375 S1)
test('bypass: a canary crash on the Stop event obeys the tier the same', () => {
	const s = setup();
	// kit-canary-blocked is a file, so the canary cannot make its mark folder when a stop's report misses the phrase.
	fs.writeFileSync(path.join(s.repo, '.git', 'kit-canary-blocked'), 'in the way');
	const r = canary(s, { hook_event_name: 'SubagentStop', agent_type: 'builder', agent_id: 'a1', last_assistant_message: 'a report with no phrase' });
	// A command hook blocks a stop with exit 2 and the reason on stderr.
	assert.equal(r.status, 2, `canary is high, so a crash blocks the stop: exit ${r.status}, stderr ${r.stderr}`);
	assert.match(r.stderr, /hook error: lead review: canary/);
	const rows = errorRows(s.repo);
	assert.equal(rows.length, 1, JSON.stringify(rowsOf(s.repo)));
	assert.equal(rows[0].id, 'canary');
	assert.equal(rows[0].tier, 'high');
	// Input that is not JSON crashes the canary before any event is read (the catch at canary.cjs:219): still tier high.
	const bad = setup();
	const b = spawnSync(process.execPath, [path.join(bad.kit, 'kit-hooks', 'canary.cjs')], { input: 'this is not json', cwd: bad.repo, encoding: 'utf8' });
	assert.match(`${b.stdout}${b.stderr}`, /hook error: lead review: canary/, `non-JSON stdin: exit ${b.status}`);
	const badRows = errorRows(bad.repo);
	assert.equal(badRows.length, 1, JSON.stringify(rowsOf(bad.repo)));
	assert.equal(badRows[0].id, 'canary');
	assert.equal(badRows[0].tier, 'high');
	// The exported check() (the dispatcher's call, canary.cjs:204) gives the tier's answer when run() throws, not null.
	const viaCheck = setup();
	fs.writeFileSync(path.join(viaCheck.repo, '.git', 'kit-canary-blocked'), 'in the way');
	const answer = createRequire(import.meta.url)(path.join(viaCheck.kit, 'kit-hooks', 'canary.cjs')).check({ cwd: viaCheck.repo, session_id: 's1', hook_event_name: 'SubagentStop', agent_type: 'builder', agent_id: 'a1', last_assistant_message: 'a report with no phrase' });
	assert.notEqual(answer, null, 'check() must not read a crash as a pass');
	assert.match(JSON.stringify(answer), /hook error: lead review: canary/);
	assert.equal(errorRows(viaCheck.repo).length, 1, JSON.stringify(rowsOf(viaCheck.repo)));
});

// why: catches repeat: the same crash twice gives the same answer (K375 S1)
test('repeat: the same crash twice gives the same answer', () => {
	const s = setup({ hooks: { 'handoff-gate.cjs': THROWS } });
	const first = handback(s);
	const second = handback(s);
	assert.equal(first.out && first.out.permissionDecision, 'deny', first.stdout);
	assert.match(reasonOf(first), /hook error: lead review: handoff-gate/);
	assert.deepEqual(second.out, first.out, 'the second crash answers as the first');
	assert.equal(second.status, first.status);
	assert.equal(errorRows(s.repo).filter((r) => r.id === 'handoff-gate').length, 2, 'one row per crash');
});

// why: catches fail-closed: an unreadable tier list reads as high and blocks, logged (K375 S3)
test('fail-closed: an unreadable tier list reads as high and blocks, logged', () => {
	// record-counts is small on the real list; with the list unreadable it reads as high, so its crash blocks.
	const report = `${PHRASE}\nROLE: reviewer\nNo findings\nNot checked: nothing`;
	for (const holds of ['{ not json', JSON.stringify({ holds: 'nope' })]) {
		const s = setup({ hooks: { 'record-counts.cjs': COUNTS_THROW }, holds });
		const r = canary(s, { hook_event_name: 'PreToolUse', tool_name: 'SubagentHandback', tool_input: { message: report }, agent_type: 'reviewer' });
		assert.equal(r.out && r.out.permissionDecision, 'deny', `${holds}: the canary blocks: ${r.stdout}`);
		assert.match(reasonOf(r), /hook error: lead review: record-counts/);
		const rows = errorRows(s.repo);
		assert.equal(rows.length, 1, `${holds}: logged: ${JSON.stringify(rowsOf(s.repo))}`);
		assert.equal(rows[0].id, 'record-counts');
		assert.equal(rows[0].tier, 'high');
	}
	// The plugin's role hooks read the same list: a small hook's crash blocks when the list is unreadable.
	const p = pluginRoot({ file: 'kit-gate.cjs', stub: 'process.exit(3);\n', holds: '{ not json' });
	const out = roleCall(p);
	assert.equal(out && out.hookSpecificOutput && out.hookSpecificOutput.permissionDecision, 'deny', `a role hook crash: ${JSON.stringify(out)}`);
	assert.equal(errorRows(p.repo).length, 1, JSON.stringify(rowsOf(p.repo)));
	// With hook-error.cjs missing the canary still loads and refuses: a broken RECORD is denied, and a crash on the Stop event
	// exits 2 with the missing-helper words and one row in the main .git (found by the canary's own fs walk).
	const broken = setup({ checker: true, drop: ['hook-error.cjs'] });
	const hb = canary(broken, { hook_event_name: 'PreToolUse', tool_name: 'SubagentHandback', tool_input: { message: `${PHRASE}\nprose\nRECORD:\nnot a role line` }, agent_type: 'builder' });
	assert.equal(hb.status, 0, `the canary loads without the helper: ${hb.stderr}`);
	assert.equal(hb.out && hb.out.permissionDecision, 'deny', `a broken RECORD is still denied: ${hb.stdout}`);
	const noHelper = setup({ drop: ['hook-error.cjs'] });
	fs.writeFileSync(path.join(noHelper.repo, '.git', 'kit-canary-blocked'), 'in the way');
	const stop = canary(noHelper, { hook_event_name: 'SubagentStop', agent_type: 'builder', agent_id: 'a1', last_assistant_message: 'a report with no phrase' });
	assert.equal(stop.status, 2, `a crash with no helper blocks the stop: exit ${stop.status}, stderr ${stop.stderr}`);
	assert.match(stop.stderr, /hook error: lead review: hook-error\.cjs is missing/);
	assert.equal(errorRows(noHelper.repo).length, 1, JSON.stringify(rowsOf(noHelper.repo)));
});


// why: catches a plugin stop whose hook-error.cjs is missing letting the stop through with no row (S1F4)
test('a plugin stop with hook-error.cjs missing is denied with its own row', () => {
	// A plugin root with a valid manifest (every file the launcher needs, hashed) whose kit-hooks hold one crashing role hook and
	// no hook-error.cjs, so subagentStop reaches the role hooks.
	function manifestRoot() {
		const crypto = createRequire(import.meta.url)('node:crypto');
		const repo = kitTemp.makeTemp('role-hook-error-stop-repo-');
		const init = spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: repo, encoding: 'utf8' });
		assert.equal(init.status, 0, init.stderr);
		const root = kitTemp.makeTemp('role-hook-error-stop-root-');
		const files = { 'launch.cjs': '// stub\n', 'hooks/hooks.json': '{}\n', 'roles.json': JSON.stringify({ builder: { Stop: ['edit-fence.cjs'] } }), 'kit-install.json': '{}\n', 'kit-tools/kit-launch.cjs': '// stub\n', 'kit/project/.claude/guard.cjs': '// stub\n', 'kit-hooks/edit-fence.cjs': 'process.exit(1);\n', 'plugin-launch.cjs': fs.readFileSync(LAUNCH, 'utf8') };
		const sums = {};
		for (const [rel, text] of Object.entries(files)) {
			fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
			fs.writeFileSync(path.join(root, rel), text);
			sums[rel] = crypto.createHash('sha256').update(text).digest('hex');
		}
		fs.writeFileSync(path.join(root, 'guard-manifest.json'), JSON.stringify({ files: sums }));
		return { repo, root };
	}
	const { repo, root } = manifestRoot();
	// The launcher as Claude Code runs it: its own copy, from the plugin root, in subagent-stop mode.
	const r = spawnSync(process.execPath, [path.join(root, 'plugin-launch.cjs'), 'subagent-stop'], { input: JSON.stringify({ agent_type: 'kit:builder', cwd: repo }), cwd: repo, encoding: 'utf8' });
	assert.equal(r.status, 2, `a crashed role hook with no helper holds the stop: exit ${r.status}, stderr ${r.stderr}`);
	assert.match(String(r.stderr), /hook error: lead review/);
	const rows = errorRows(repo);
	assert.equal(rows.length, 1, JSON.stringify(rowsOf(repo)));
});

// why: catches a Stop crash that repeats exiting 2 on every stop so the agent can never stop (S1F5)
test('a Stop crash with stop_hook_active true lets the stop through and logs the row', async () => {
	const { default: os } = await import('node:os');
	for (const hookFile of ['clean-tree.cjs', 'canary.cjs']) {
		const s = setup();
		const input = { hook_event_name: 'SubagentStop', agent_type: 'builder', agent_id: 'a1', session_id: `role-hook-error-${process.pid}-${hookFile}`, cwd: s.repo, last_assistant_message: 'a report with no phrase' };
		const snap = path.join(os.tmpdir(), `kit-clean-tree-${`${input.session_id}-${input.agent_id}`.replace(/[^\w-]/g, '')}.json`);
		if (hookFile === 'clean-tree.cjs') fs.writeFileSync(snap, '{ corrupt snapshot');
		else fs.writeFileSync(path.join(s.repo, '.git', 'kit-canary-blocked'), 'in the way');
		const run = (extra) => spawnSync(process.execPath, [path.join(s.kit, 'kit-hooks', hookFile)], { input: JSON.stringify({ ...input, ...extra }), cwd: s.repo, encoding: 'utf8' });
		try {
			const first = run({});
			assert.equal(first.status, 2, `${hookFile}: the first crashing stop blocks: ${first.stderr}`);
			const again = run({ stop_hook_active: true });
			assert.equal(again.status, 0, `${hookFile}: a repeated crash with stop_hook_active lets the stop through: exit ${again.status}, stderr ${again.stderr}`);
			assert.equal(errorRows(s.repo).length, 2, `${hookFile}: each crash logs its row: ${JSON.stringify(rowsOf(s.repo))}`);
		} finally {
			fs.rmSync(snap, { force: true });
		}
	}
});
