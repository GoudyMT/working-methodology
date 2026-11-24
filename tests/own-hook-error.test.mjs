// K375 (patch 1.51.4, U10): the three kit hooks that run as their own process (edit-fence, clean-tree, kit-gate) obey the
// hook's tier when their own code throws. Each wraps its main run: an error calls hook-error.cjs onError(id, error, cwd),
// and a deny is written as exit 2 with the reason on stderr (Claude Code's blocking exit for a command hook); a small hook
// answers nothing, so the call goes through. A crash before the input is parsed is caught by the same wrap. A missing
// hook-error.cjs exits 2, logged. Each test runs the real hook file from a throwaway copy of the kit-hooks folder, with
// safe-spawn.cjs swapped for a stub that throws (a crash after the input is read) or with unreadable stdin. Tiers come from
// the real holds.json: edit-fence and clean-tree are high, kit-gate is small. The row is {kind: "hook-error", id, tier, ...}
// in <git common dir>/kit-guard-open.log of the hook call's cwd.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import kitTemp from '../project/.claude/kit-temp.cjs';

kitTemp.sessionRoot();
const HOOK_SRC = path.resolve('user/kit-hooks');
const GIT_THROWS = "exports.gitRead = () => { throw new Error('git boom\\nsecond line'); };\n";
let counter = 0;

// A repo (the hook call's cwd) and a copy of the kit-hooks folder; drop lists helper files left out of the copy.
function setup({ spawnStub = false, drop = [] } = {}) {
	const repo = kitTemp.makeTemp('own-hook-error-repo-');
	const init = spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: repo, encoding: 'utf8' });
	assert.equal(init.status, 0, init.stderr);
	const kit = kitTemp.makeTemp('own-hook-error-kit-');
	fs.cpSync(HOOK_SRC, path.join(kit, 'kit-hooks'), { recursive: true });
	if (spawnStub) fs.writeFileSync(path.join(kit, 'kit-hooks', 'safe-spawn.cjs'), GIT_THROWS);
	for (const f of drop) fs.rmSync(path.join(kit, 'kit-hooks', f));
	return { repo, kit };
}
const rowsOf = (repo) => {
	const file = path.join(repo, '.git', 'kit-guard-open.log');
	return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
};
const errorRows = (repo) => rowsOf(repo).filter((r) => r.kind === 'hook-error');
// A linked worktree of the repo (a commit first, then `git worktree add`); a hook call from it logs to the MAIN repo's .git.
function linkedWorktree(repo) {
	const run = (args, cwd) => { const r = spawnSync('git', args, { cwd, encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); };
	run(['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '--allow-empty', '-m', 'x'], repo);
	const wt = path.join(kitTemp.makeTemp('own-hook-error-wt-'), 'linked');
	run(['worktree', 'add', '-q', '--detach', wt], repo);
	return wt;
}
const strayLogs = (repo) => {
	const root = path.join(repo, '.git', 'worktrees');
	return fs.existsSync(root) ? fs.readdirSync(root).filter((n) => fs.existsSync(path.join(root, n, 'kit-guard-open.log'))) : [];
};
// The hook as its own process: stdin is the call's JSON, or raw text; the process cwd is the repo.
function runHook(s, file, input, raw, from) {
	const r = spawnSync(process.execPath, [path.join(s.kit, 'kit-hooks', file)], { input: raw !== undefined ? raw : JSON.stringify(input), cwd: from || s.repo, encoding: 'utf8' });
	return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}
const editCall = (s) => ({ hook_event_name: 'PreToolUse', tool_name: 'Edit', agent_type: 'builder', cwd: s.repo, tool_input: { file_path: path.join(s.repo, 'a.txt') } });
const treeCall = (s) => ({ hook_event_name: 'PreToolUse', session_id: `own-hook-error-${process.pid}-${counter++}`, agent_id: 'a1', cwd: s.repo });
const gateCall = (s) => ({ hook_event_name: 'UserPromptSubmit', prompt: 'hello', cwd: s.repo });

// why: catches edit-fence crashing under tier high exits 2 with "hook error: lead review" (K375 S1)
test('edit-fence crashing under tier high exits 2 with "hook error: lead review"', () => {
	const s = setup({ spawnStub: true });
	// The process runs from a folder that is no repo; the row goes to the git common dir of the call's own cwd (the repo).
	const elsewhere = kitTemp.makeTemp('own-hook-error-elsewhere-');
	const r = runHook(s, 'edit-fence.cjs', editCall(s), undefined, elsewhere);
	assert.equal(r.status, 2, `edit-fence is high, so a crash blocks: exit ${r.status}, stderr ${r.stderr}`);
	assert.match(r.stderr, /hook error: lead review: edit-fence/);
	const rows = errorRows(s.repo);
	assert.equal(rows.length, 1, JSON.stringify(rowsOf(s.repo)));
	assert.equal(rows[0].id, 'edit-fence');
	assert.equal(rows[0].hook, 'edit-fence.cjs');
	assert.equal(rows[0].tier, 'high');
	assert.equal(rows[0].error, 'git boom', 'the first line of the error');
	assert.ok(Number.isFinite(Date.parse(rows[0].at)), 'a time');
	// Folded control: a call from inside a linked worktree logs to the main repo's .git, never under .git/worktrees/<name>/.
	const wt = linkedWorktree(s.repo);
	const fromWt = runHook(s, 'edit-fence.cjs', { ...editCall(s), cwd: wt }, undefined, wt);
	assert.equal(fromWt.status, 2, fromWt.stderr);
	assert.equal(errorRows(s.repo).length, 2, `the worktree call's row is in the main .git: ${JSON.stringify(rowsOf(s.repo))}`);
	assert.deepEqual(strayLogs(s.repo), [], 'no log in .git/worktrees/<name>/');
	// Folded control: the same edit with a working git is allowed and logs no hook error.
	const fine = setup();
	const ok = runHook(fine, 'edit-fence.cjs', editCall(fine));
	assert.equal(ok.status, 0, ok.stderr);
	assert.deepEqual(errorRows(fine.repo), []);
});

// why: catches clean-tree crashing under tier high exits 2 the same way (K375 S1)
test('clean-tree crashing under tier high exits 2 the same way', () => {
	const s = setup({ spawnStub: true });
	const r = runHook(s, 'clean-tree.cjs', treeCall(s));
	assert.equal(r.status, 2, `clean-tree is high, so a crash blocks: exit ${r.status}, stderr ${r.stderr}`);
	assert.match(r.stderr, /hook error: lead review: clean-tree/);
	const rows = errorRows(s.repo);
	assert.equal(rows.length, 1, JSON.stringify(rowsOf(s.repo)));
	assert.equal(rows[0].id, 'clean-tree');
	assert.equal(rows[0].hook, 'clean-tree.cjs');
	assert.equal(rows[0].tier, 'high');
	assert.equal(rows[0].error, 'git boom', 'the first line of the error');
	assert.ok(Number.isFinite(Date.parse(rows[0].at)), 'a time');
	// From a linked worktree the row still lands in the main repo's .git.
	const wt = linkedWorktree(s.repo);
	const fromWt = runHook(s, 'clean-tree.cjs', { ...treeCall(s), cwd: wt }, undefined, wt);
	assert.equal(fromWt.status, 2, fromWt.stderr);
	assert.equal(errorRows(s.repo).length, 2, `the worktree call's row is in the main .git: ${JSON.stringify(rowsOf(s.repo))}`);
	assert.deepEqual(strayLogs(s.repo), [], 'no log in .git/worktrees/<name>/');
	// The stop path: a snapshot that cannot be read crashes the SubagentStop compare, and that blocks too.
	const stop = setup();
	const call = { hook_event_name: 'SubagentStop', session_id: `own-hook-error-${process.pid}-stop${counter++}`, agent_id: 'a1', cwd: stop.repo };
	const snap = path.join(os.tmpdir(), `kit-clean-tree-${`${call.session_id}-${call.agent_id}`.replace(/[^\w-]/g, '')}.json`);
	fs.writeFileSync(snap, '{ corrupt snapshot');
	try {
		const st = runHook(stop, 'clean-tree.cjs', call);
		assert.equal(st.status, 2, `a crash on the stop path blocks: exit ${st.status}, stderr ${st.stderr}`);
		assert.match(st.stderr, /hook error: lead review: clean-tree/);
		assert.equal(errorRows(stop.repo).length, 1, JSON.stringify(rowsOf(stop.repo)));
	} finally {
		fs.rmSync(snap, { force: true });
	}
});

// why: catches kit-gate crashing under tier small lets the prompt through and logs (K375 S1)
test('kit-gate crashing under tier small lets the prompt through and logs', () => {
	const s = setup({ spawnStub: true });
	const r = runHook(s, 'kit-gate.cjs', gateCall(s));
	assert.equal(r.status, 0, `kit-gate is small, so a crash lets the prompt through: ${r.stderr}`);
	assert.equal(r.stdout.trim(), '', 'no block is printed');
	assert.doesNotMatch(r.stderr, /hook error: lead review/);
	const rows = errorRows(s.repo);
	assert.equal(rows.length, 1, JSON.stringify(rowsOf(s.repo)));
	assert.equal(rows[0].id, 'kit-gate');
	assert.equal(rows[0].hook, 'kit-gate.cjs');
	assert.equal(rows[0].tier, 'small');
	assert.equal(rows[0].error, 'git boom', 'the first line of the error');
	assert.ok(Number.isFinite(Date.parse(rows[0].at)), 'a time');
	// From a linked worktree the row still lands in the main repo's .git.
	const wt = linkedWorktree(s.repo);
	const fromWt = runHook(s, 'kit-gate.cjs', { ...gateCall(s), cwd: wt }, undefined, wt);
	assert.equal(fromWt.status, 0, fromWt.stderr);
	assert.equal(errorRows(s.repo).length, 2, `the worktree call's row is in the main .git: ${JSON.stringify(rowsOf(s.repo))}`);
	assert.deepEqual(strayLogs(s.repo), [], 'no log in .git/worktrees/<name>/');
});

// why: catches bypass: a crash on unreadable stdin, before the input is parsed, obeys the tier (K375 S2)
test('bypass: a crash on unreadable stdin, before the input is parsed, obeys the tier', () => {
	for (const [file, id, tier] of [['edit-fence.cjs', 'edit-fence', 'high'], ['clean-tree.cjs', 'clean-tree', 'high'], ['kit-gate.cjs', 'kit-gate', 'small']]) {
		const s = setup();
		const r = runHook(s, file, null, '{ this is not json');
		if (tier === 'high') {
			assert.equal(r.status, 2, `${id}: unreadable input blocks under tier high: exit ${r.status}, stderr ${r.stderr}`);
			assert.match(r.stderr, new RegExp(`hook error: lead review: ${id}`));
		} else {
			assert.equal(r.status, 0, `${id}: unreadable input lets the prompt through under tier small: ${r.stderr}`);
		}
		const rows = errorRows(s.repo);
		assert.equal(rows.length, 1, `${id}: ${JSON.stringify(rowsOf(s.repo))}`);
		assert.equal(rows[0].id, id);
		assert.equal(rows[0].tier, tier);
	}
});

// why: catches repeat: the same crash twice gives the same answer (K375 S1)
test('repeat: the same crash twice gives the same answer', () => {
	const s = setup({ spawnStub: true });
	const first = runHook(s, 'edit-fence.cjs', editCall(s));
	const second = runHook(s, 'edit-fence.cjs', editCall(s));
	assert.equal(first.status, 2, `first: ${first.stderr}`);
	assert.match(first.stderr, /hook error: lead review: edit-fence/);
	assert.equal(second.status, first.status);
	assert.equal(second.stderr, first.stderr, 'the second crash answers as the first');
	assert.equal(errorRows(s.repo).filter((r) => r.id === 'edit-fence').length, 2, 'one row per crash');
});

// why: catches fail-closed: a missing hook-error.cjs exits 2, logged (K375 S3)
test('fail-closed: a missing hook-error.cjs exits 2, logged', () => {
	// The small tier is no exception: with no helper there is no tier to read, so all three hooks block.
	for (const [file, call] of [['edit-fence.cjs', editCall], ['clean-tree.cjs', treeCall], ['kit-gate.cjs', gateCall]]) {
		const s = setup({ spawnStub: true, drop: ['hook-error.cjs'] });
		const r = runHook(s, file, call(s));
		assert.equal(r.status, 2, `${file}: no helper blocks: exit ${r.status}, stderr ${r.stderr}`);
		assert.match(r.stderr, /hook error: lead review: hook-error\.cjs is missing/, file);
		const rows = errorRows(s.repo);
		assert.equal(rows.length, 1, `${file}: logged once: ${JSON.stringify(rowsOf(s.repo))}`);
		assert.equal(rows[0].id, 'hook-error', file);
		assert.equal(rows[0].hook, file, 'the row names the hook that writes it');
		assert.match(String(rows[0].error), /hook-error\.cjs/, file);
		// With no helper the hook finds the git dir itself: from a linked worktree the row is in the main repo's .git.
		const wt = linkedWorktree(s.repo);
		const fromWt = runHook(s, file, { ...call(s), cwd: wt }, undefined, wt);
		assert.equal(fromWt.status, 2, `${file}: ${fromWt.stderr}`);
		assert.equal(errorRows(s.repo).length, 2, `${file}: the worktree call's row is in the main .git: ${JSON.stringify(rowsOf(s.repo))}`);
		assert.deepEqual(strayLogs(s.repo), [], `${file}: no log in .git/worktrees/<name>/`);
	}
	// Folded control: with the helper missing and no crash, the edit is not held for it.
	const fine = setup({ drop: ['hook-error.cjs'] });
	const ok = runHook(fine, 'edit-fence.cjs', editCall(fine));
	assert.equal(ok.status, 0, ok.stderr);
});
