// Tests for K379: owner-proof reads a 98 KB command once, so the guard answers in time under the coverage-map run.
// The proof is work done, never the clock (CIFP): a child process runs owner-proof.cjs with the environment
// scripts/test-run.mjs --map sets, and V8 precise coverage counts how often each owner-proof function is called.
// No function may be called more than once per character of the command (98,000 for the 98 KB command).
// The "under half the 8 s limit" target is proven by that call count (CIFP); the 8 s limit itself is never raised.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import kitTemp from '../project/.claude/kit-temp.cjs';

kitTemp.sessionRoot();
const HOOK = path.resolve('project/.claude/owner-proof.cjs');
const TRACE = path.resolve('tests/map-trace.cjs');
const scratch = kitTemp.makeTemp('opl-');
// The child's own Claude folder: never the caller's, so the protected projects folder is this one.
const CONFIG = kitTemp.makeTemp('cfg-');
const PROJECTS = `${CONFIG.split(path.sep).join('/')}/projects/C--repo`;
fs.mkdirSync(path.join(CONFIG, 'projects', 'C--repo'), { recursive: true });

// The child: runs each command through check() and reports the verdict and the most calls any owner-proof function got.
const CHILD = `
const inspector = require('node:inspector');
const fs = require('node:fs');
const { hook, jobs, out } = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const s = new inspector.Session();
s.connect();
const post = (m, p) => new Promise((res, rej) => s.post(m, p, (e, r) => (e ? rej(e) : res(r))));
(async () => {
	await post('Profiler.enable');
	await post('Profiler.startPreciseCoverage', { callCount: true, detailed: false });
	const { check } = require(hook);
	const runs = [];
	for (const job of jobs) {
		await post('Profiler.takePreciseCoverage');
		const verdict = check({ hook_event_name: 'PreToolUse', tool_name: job.tool || 'Bash', tool_input: { command: job.command }, cwd: job.cwd });
		const { result } = await post('Profiler.takePreciseCoverage');
		let max = 0; let name = '';
		for (const script of result) {
			if (!script.url.endsWith('owner-proof.cjs')) continue;
			for (const f of script.functions) { const c = f.ranges[0].count; if (c > max) { max = c; name = f.functionName || '(anon)'; } }
		}
		runs.push({ decision: verdict && verdict.hookSpecificOutput ? verdict.hookSpecificOutput.permissionDecision : null, reason: verdict && verdict.hookSpecificOutput ? verdict.hookSpecificOutput.permissionDecisionReason : null, max, name });
	}
	fs.writeFileSync(out, JSON.stringify(runs));
})().catch((e) => { process.stderr.write(String(e && e.stack || e)); process.exit(1); });
`;
const CHILD_FILE = path.join(scratch, 'child.cjs');
fs.writeFileSync(CHILD_FILE, CHILD);

// A temp folder that is a git repo, so the fail-closed log has a git common dir to land in.
function repoDir() {
	const dir = kitTemp.makeTemp('repo-');
	spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
	fs.mkdirSync(path.join(dir, '.claude'));
	fs.writeFileSync(path.join(dir, '.claude', 'settings.json'), '{\n  "permissions": {}\n}\n');
	return dir;
}

// Each job runs in one child with the coverage-map environment set as test-run --map sets it.
function counted(jobs, cwd, extraEnv = {}) {
	const mapDir = kitTemp.makeTemp('map-');
	const covDir = kitTemp.makeTemp('cov-');
	const id = 'owner-proof-long';
	fs.mkdirSync(path.join(mapDir, id));
	const out = path.join(scratch, `out-${Math.random().toString(36).slice(2)}.json`);
	const spec = path.join(scratch, `spec-${Math.random().toString(36).slice(2)}.json`);
	fs.writeFileSync(spec, JSON.stringify({ hook: HOOK, jobs: jobs.map((j) => ({ ...j, cwd })), out }));
	const env = {
		...process.env,
		KIT_MAP_DIR: mapDir,
		KIT_MAP_TEST: id,
		NODE_V8_COVERAGE: covDir,
		NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --import ${pathToFileURL(TRACE).href}`.trim(),
		CLAUDE_CONFIG_DIR: CONFIG,
		...extraEnv,
	};
	delete env.KIT_MAP_OFF;
	delete env.CLAUDE_PROJECT_DIR;
	const r = spawnSync(process.execPath, [CHILD_FILE, spec], { cwd, encoding: 'utf8', env, maxBuffer: 1 << 26 });
	assert.equal(r.status, 0, `the counting child failed: ${r.stderr}`);
	return JSON.parse(fs.readFileSync(out, 'utf8'));
}

const LONG = 'a;'.repeat(49000); // 98,000 characters
const withinBound = (run, command, label) => assert.ok(run.max <= command.length, `${label}: ${run.name} was called ${run.max} times for ${command.length} characters`);

// why: guard proof: owner-proof reads a 98 KB command within its work bound (K379 S1)
test('with the coverage-map environment set as test-run --map sets it, the 98 KB command through owner-proof alone takes under half the 8 s limit', () => {
	const dir = repoDir();
	const [run] = counted([{ command: LONG }], dir);
	assert.equal(LONG.length, 98000);
	withinBound(run, LONG, 'one read of the command');
});

// why: guard proof: owner-proof's verdicts on long and existing commands (K379 S2)
test("the verdicts for the long command and for the guard's existing cases are unchanged", () => {
	const dir = repoDir();
	const settingsWrite = `${'a;'.repeat(48900)}echo '{}' > .claude/settings.json`;
	const jobs = [
		{ command: LONG },
		{ command: settingsWrite },
		{ command: `echo x >> ${PROJECTS}/s.jsonl` },
		{ command: `echo {} > ${CONFIG.split(path.sep).join('/')}/kit-owner.json` },
		{ command: 'ls -la' },
		{ command: 'git status' },
		// A word cache or dedupe that ignores the cd folder, or skips the last word, lets these through.
		{ command: `${'a;'.repeat(48000)}cd ${PROJECTS}; echo x > a` },
		{ command: `${'a|'.repeat(24000)}cat >> ${PROJECTS}/s.jsonl` },
		{ command: `${'a;'.repeat(24000)}cat >> ${PROJECTS}/s.jsonl <<'EOF'\nx\nEOF\n` },
		// A word read before a followed cd (&&) is read again in the new folder; a verdict kept from the first folder lets it by.
		// No filler before it: any earlier segment already holds the call, which hides a word cache that ignores the folder.
		{ command: `cat a; cd ${PROJECTS} && echo x > a` },
	];
	const runs = counted(jobs, dir);
	assert.equal(runs[0].decision, null, 'a long benign command is no hold');
	assert.equal(runs[1].decision, 'deny', 'a long command that writes the settings is held');
	assert.equal(runs[2].decision, 'deny', 'a transcript write is held');
	assert.equal(runs[3].decision, 'deny', 'a kit-owner.json write is held');
	assert.equal(runs[4].decision, null, 'a plain read runs');
	assert.equal(runs[5].decision, null, 'a plain git read runs');
	assert.equal(runs[6].decision, 'deny', 'a cd into the projects folder then a write is held after a long command');
	assert.equal(runs[7].decision, 'deny', 'a long pipe ending in a transcript append is held');
	assert.equal(runs[8].decision, 'deny', 'a long command ending in a here-doc transcript append is held');
		assert.equal(runs[9].decision, 'deny', 'a word read again after a followed cd is judged in the new folder');
	// The same per-character bound holds for both long runs: the fix keeps the verdict and loses the rereads. The short
	// cases are held to their verdicts only: a six-character command costs 584 calls of fixed set-up, which no
	// per-character bound can count.
	withinBound(runs[0], jobs[0].command, 'the long benign command');
	withinBound(runs[1], jobs[1].command, 'the long settings write');
	for (const i of [6, 7, 8]) withinBound(runs[i], jobs[i].command, `the long protected write ${i}`);
});

// why: guard proof: owner-proof stays within its work bound on a command split by pipe and here-doc (K379 S1)
test('bypass: the same command split across a pipe and a here-doc stays under half the limit too', () => {
	const dir = repoDir();
	const pipe = 'a|'.repeat(49000);
	const heredoc = `cat <<'EOF'\n${'a;\n'.repeat(32600)}EOF\n`;
	const split = `${'a|'.repeat(24000)}cat <<'EOF'\n${'a;'.repeat(25000)}\nEOF\n`;
	const commands = [pipe, heredoc, split];
	const runs = counted(commands.map((command) => ({ command })), dir);
	runs.forEach((run, i) => {
		assert.equal(run.decision, null, `form ${i} stays a plain command`);
		withinBound(run, commands[i], `form ${i}`);
	});
});

// why: guard proof: owner-proof holds, logged, a command past its work cap (K379 S3)
test('fail-closed: a command the guard cannot finish reading in time still holds the call, logged', () => {
	const dir = repoDir();
	const log = path.join(dir, '.git', 'kit-guard-open.log');
	const rows = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
	const command = 'a;'.repeat(2000);
	// Control: with no cap reached the same command runs and logs nothing.
	const [free] = counted([{ command }], dir);
	assert.equal(free.decision, null, 'the same command is no hold when the scan finishes');
	assert.equal(rows().length, 0, 'a finished scan logs nothing');
	// A tiny work cap (steps) stands in for a slow input: the scan cannot finish, so the call is held.
	const [held] = counted([{ command }], dir, { KIT_OWNER_PROOF_CAP: '50' });
	assert.equal(held.decision, 'deny', 'a scan past its cap holds the call');
	assert.match(held.reason, /could not finish reading/);
	const logged = rows();
	assert.equal(logged.length, 1, 'one row in kit-guard-open.log');
	assert.equal(logged[0].hook, 'owner-proof');
	assert.ok(typeof logged[0].cause === 'string' && logged[0].cause.length > 0, 'the row names the cause');
});
