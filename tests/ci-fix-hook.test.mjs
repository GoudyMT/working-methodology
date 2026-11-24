// K399 U22 (patch 1.51.4): user/kit-hooks/ci-fix.cjs holds rules (a) to (d) on a red CI run, the Bash write forms, the
// after-sweep fence on the lead, gh unreachable (CI unknown, logged) and fail-closed. Each test calls the hook's check in a
// child process from a temp repo whose .git holds kit-ci-state.json, docs/builds/<VERSION>.cifix.jsonl and the sweep record
// kit-sweep-approvals.jsonl. A ticketed tester is one whose session holds a ticket row that the real agent-model.cjs wrote
// (kit-agent-model.log). gh is a fake on PATH (a copy of node under the gh name, whose preload records the call and fails as
// unreachable), as tests/release-check-buffer.test.mjs does; no network. The fail-closed test runs the real hook through
// guard.cjs's dispatch, as tests/guard-hook-error.test.mjs does.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import kitTemp from '../project/.claude/kit-temp.cjs';

kitTemp.sessionRoot();
const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOOK = path.join(KIT, 'user', 'kit-hooks', 'ci-fix.cjs');
const HOOK_DIR = path.join(KIT, 'user', 'kit-hooks');
const AGENT_MODEL = path.join(HOOK_DIR, 'agent-model.cjs');
const GUARD_SRC = path.join(KIT, 'project', '.claude');
const VERSION = '1.51.4';
const CONTRACT = 'sweep-contract.json';
const RUN = 200;
const SIX = 'repair the parser so the edge passes';
const GUARDS = ['guard.cjs', 'owner-proof.cjs', 'task-gate.cjs', 'guard-outward.cjs', 'guard-delete.cjs', 'guard-read.cjs', 'owner-yes.cjs'];
const HELPERS = ['hold-mode.cjs', 'hook-error.cjs', 'holds.json', 'safe-spawn.cjs', 'prices.cjs'];
const ITEM_A = { n: 1, key: 'unit-tests (0)::fails thing', shape: 'test', job: 'unit-tests (0)', step: 'Run tests', file: 'tests/foo.test.mjs', line: 12, name: 'fails thing', message: 'expected 2 got 3', kind: 'diagnose' };
const ITEM_B = { n: 2, key: 'windows-tests::fast-cap', shape: 'gate', job: 'windows-tests', step: 'Run tests', file: 'scripts/test-run.mjs', line: 1, name: 'fast-cap', message: 'over the cap: 42940 ms (cap 30000 ms)', kind: 'diagnose' };
const FOO_OLD = "test('old', { timeout: 1000 }, () => {});\n";
// The agent folder agent-model.cjs reads for each role's model (as tests/sweep-lock.test.mjs writes it).
const CONFIG = (() => {
	const config = kitTemp.makeTemp('ci-fix-hook-config-');
	fs.mkdirSync(path.join(config, 'agents'), { recursive: true });
	for (const [name, model] of Object.entries({ checker: 'opus', tester: 'sonnet', writer: 'sonnet', builder: 'haiku', reviewer: 'sonnet', 'general-purpose': 'sonnet' })) fs.writeFileSync(path.join(config, 'agents', `${name}.md`), `---\nname: ${name}\nmodel: ${model}\n---\nrole\n`);
	return config;
})();

function isolatedEnv(extra = {}) {
	const home = kitTemp.makeTemp('ci-fix-hook-home-');
	const config = path.join(home, '.claude');
	return { ...process.env, HOME: home, USERPROFILE: home, CLAUDE_CONFIG_DIR: config, KIT_CLAUDE_HOME: config, GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@example.com', ...extra };
}
function git(cwd, args) {
	const r = spawnSync('git', args, { cwd, env: isolatedEnv(), encoding: 'utf8' });
	assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
	return r.stdout.trim();
}
const common = (root) => git(root, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
const write = (root, rel, text) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); };
const readRows = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const logRows = (root) => readRows(path.join(common(root), 'kit-guard-open.log')).filter((r) => r.hook === 'ci-fix');
const cifixLine = (item, files, extra = {}) => ({ run: RUN, key: item.key, cause: 'code', fix: SIX, files, attempt: 1, ...extra });
const writeCifix = (root, lines) => write(root, `docs/builds/${VERSION}.cifix.jsonl`, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');

// A repo on main with the kit's files committed. state: 'red' (the pushed head's red run, items A and B), 'none' (no state),
// 'dir' (kit-ci-state.json is a folder, so the hook cannot read it). sweep: the branch's sweep is recorded (U20's record).
// ticket: the closeout file lists finding F1 (high) in the working tree, and the tester list file is in place.
function mkRepo({ state = 'red', items = [ITEM_A, ITEM_B], cifix = [], sweep = false, ticket = false } = {}) {
	const root = kitTemp.makeTemp('ci-fix-hook-');
	git(root, ['init', '-q', '-b', 'main']);
	git(root, ['remote', 'add', 'origin', 'https://github.com/o/r.git']);
	write(root, 'VERSION', `${VERSION}\n`);
	write(root, 'src/a.mjs', '// a\n');
	write(root, 'src/b.mjs', '// b\n');
	write(root, 'tests/foo.test.mjs', FOO_OLD);
	write(root, 'scripts/test-run.mjs', 'const FAST_CAP_MS = 30000;\nconst RETRIES = 3;\n');
	write(root, 'scripts/test-check.mjs', 'const SCORE_FLOOR = 8;\n');
	write(root, `docs/builds/${VERSION}.json`, `${JSON.stringify({ version: VERSION })}\n`);
	write(root, 'docs/CHANGELOG.md', '# changes\n');
	git(root, ['add', '-A']);
	git(root, ['commit', '-q', '-m', 'base']);
	const head = git(root, ['rev-parse', 'HEAD']);
	const dir = common(root);
	if (sweep) {
		const contract = { kind: 'decision', contract: CONTRACT, branch: 'main', head, time: new Date().toISOString() };
		const outcome = { kind: 'outcome', contract: CONTRACT, findings: 2, real: 2, duplicates: 0, tokens: 100, budget: 1000 };
		fs.writeFileSync(path.join(dir, 'kit-sweep-approvals.jsonl'), `${JSON.stringify(contract)}\n${JSON.stringify(outcome)}\n`);
	}
	if (ticket) {
		write(root, `docs/builds/${VERSION}.closeout.json`, `${JSON.stringify({ version: VERSION, head, findings: [{ id: 'F1', severity: 'high', security: false, owner: false }], tickets: ['F1'] })}\n`);
		fs.writeFileSync(path.join(dir, 'kit-unit-files.txt'), 'tests/ci-fix-hook.test.mjs\n');
	}
	if (state === 'red') fs.writeFileSync(path.join(dir, 'kit-ci-state.json'), JSON.stringify({ sha: head, run: RUN, verdict: 'red', settled: true, failed: items, at: new Date().toISOString() }));
	if (state === 'dir') fs.mkdirSync(path.join(dir, 'kit-ci-state.json'));
	if (cifix.length) writeCifix(root, cifix);
	return root;
}

// The real agent-model.cjs writes the ticket row for an allowed ticketed tester spawn in this session (session_id matches).
function ticketRow(root, session) {
	const script = "const m = require(process.env.KIT_TEST_AM); const out = m.check({ tool_name: 'Agent', tool_input: { subagent_type: 'tester', prompt: 'Role: tester\\nTicket: F1\\nWrite the tests for the finding.' }, cwd: process.env.KIT_TEST_CWD, session_id: process.env.KIT_TEST_SESSION }); process.stdout.write(JSON.stringify(out === undefined ? null : out));";
	const r = spawnSync(process.execPath, ['-e', script], { cwd: root, encoding: 'utf8', env: isolatedEnv({ KIT_TEST_AM: AGENT_MODEL, KIT_TEST_CWD: root, KIT_TEST_SESSION: session, CLAUDE_CONFIG_DIR: CONFIG, KIT_CLAUDE_HOME: CONFIG }) });
	assert.equal(r.status, 0, `agent-model.cjs ran: ${r.stderr}`);
	assert.equal(r.stdout, 'null', 'the ticketed tester spawn is allowed by the sweep lock');
	const rows = readRows(path.join(common(root), 'kit-agent-model.log'));
	assert.ok(rows.some((x) => x.session === session && x.ticket === 'F1' && x.reason === undefined), 'the allowed ticket spawn wrote its row');
}

// The hook's check, run in a child process on one tool call. extra is merged into the input (agent_id, agent_type and session_id
// for a subagent call; none for the lead). Returns the decision object, or null when the call goes through.
function check(root, tool_name, tool_input, env = {}, extra = {}) {
	assert.ok(fs.existsSync(HOOK), 'ci-fix.cjs is missing: the U22 hook is not built yet');
	const script = "const m = require(process.env.KIT_TEST_HOOK); const i = JSON.parse(require('fs').readFileSync(0, 'utf8')); const out = m.check(i); process.stdout.write(JSON.stringify(out === undefined ? null : out));";
	const r = spawnSync(process.execPath, ['-e', script], { input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name, tool_input, cwd: root, ...extra }), cwd: root, encoding: 'utf8', env: isolatedEnv({ KIT_TEST_HOOK: HOOK, ...env }) });
	assert.equal(r.status, 0, `ci-fix.cjs check ran: ${r.stderr}`);
	return JSON.parse(r.stdout);
}
const deny = (d) => !!d && !!d.hookSpecificOutput && d.hookSpecificOutput.permissionDecision === 'deny';
const why = (d) => (d && d.hookSpecificOutput && d.hookSpecificOutput.permissionDecisionReason) || '';
// An Edit of one file with fixed old and new text; the file path is absolute, as the tool gives it.
const editOf = (root, file, oldText = 'x', newText = 'y') => ['Edit', { file_path: `${root}/${file}`, old_string: oldText, new_string: newText }];
const SUBAGENT = { agent_id: 'builder-1' };

// One fake gh folder for the file: a copy of node under the gh name (a hard link when the disk allows) and a preload that runs
// only under that name. It appends each call's argv to CI_FIX_GH_CALLS and exits 1 as unreachable; every other node child is
// untouched. Put first on PATH for the hook's child only.
const GH_PRELOAD = `const path = require('node:path');
const fs = require('node:fs');
if (/^gh(\\.exe)?$/i.test(path.basename(process.execPath))) {
	const a = [path.basename(process.argv[1]), ...process.argv.slice(2)];
	fs.appendFileSync(process.env.CI_FIX_GH_CALLS, JSON.stringify(a) + '\\n');
	// red-jobs / red-rollup: the head's run is red and its jobs read fine; the failed job is a unit job (red-jobs) or only the
	// rollup job (red-rollup, which the digest drops, so it yields no items)
	if (process.env.CI_FIX_GH_MODE === 'red-jobs' || process.env.CI_FIX_GH_MODE === 'red-rollup') {
		const name = process.env.CI_FIX_GH_MODE === 'red-rollup' ? 'kit-tests' : 'unit-tests (0)';
		if (a[0] === 'run' && a[1] === 'list') { process.stdout.write(JSON.stringify([{ databaseId: 200, name: 'CI', status: 'completed', conclusion: 'failure', url: 'https://example.test/run/200' }])); process.exit(0); }
		if (a[0] === 'run' && a[1] === 'view' && a[a.indexOf('--json') + 1] === 'jobs') { process.stdout.write(JSON.stringify({ jobs: [{ id: 1, databaseId: 1, name, status: 'completed', conclusion: 'failure', steps: [] }] })); process.exit(0); }
		if (a[0] === 'run' && a[1] === 'view') process.exit(0);
	}
	// red-slow: the head's run is red, and its log read outlasts the hook's time budget
	if (process.env.CI_FIX_GH_MODE === 'red-slow') {
		if (a[0] === 'run' && a[1] === 'list') { process.stdout.write(JSON.stringify([{ databaseId: 200, name: 'CI', status: 'completed', conclusion: 'failure', url: 'https://example.test/run/200' }])); process.exit(0); }
		if (a[0] === 'run' && a.includes('--log-failed')) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 15000); process.exit(0); }
	}
	process.stderr.write('could not reach api.github.com\\n');
	process.exit(1);
}
`;
let GH_DIR = null;
function fakeGhEnv(callsFile, mode = '') {
	if (!GH_DIR) {
		const dir = kitTemp.makeTemp('ci-fix-hook-gh-');
		const exe = path.join(dir, process.platform === 'win32' ? 'gh.exe' : 'gh');
		try { fs.linkSync(process.execPath, exe); } catch { fs.copyFileSync(process.execPath, exe); }
		fs.writeFileSync(path.join(dir, 'gh-pre.cjs'), GH_PRELOAD);
		process.on('exit', () => kitTemp.removeTemp(dir));
		GH_DIR = dir;
	}
	const pre = path.join(GH_DIR, 'gh-pre.cjs').split(path.sep).join('/');
	return { PATH: GH_DIR + path.delimiter + (process.env.PATH || ''), NODE_OPTIONS: `--require ${pre}`, CI_FIX_GH_CALLS: callsFile, CI_FIX_GH_MODE: mode };
}

// The guard.cjs dispatch in a clean Claude folder with the real ci-fix hook, as the fail-closed test sets it up.
// extra: {relative path under the Claude folder: text}, written over the defaults (a stub digest, for one case).
function guardHome(extra = {}) {
	const dir = kitTemp.makeTemp('ci-fix-hook-guard-');
	for (const f of GUARDS) fs.copyFileSync(path.join(GUARD_SRC, f), path.join(dir, f));
	const cfg = kitTemp.makeTemp('ci-fix-hook-cfg-');
	const kit = path.join(cfg, 'kit-hooks');
	fs.mkdirSync(kit);
	for (const f of HELPERS) fs.copyFileSync(path.join(HOOK_DIR, f), path.join(kit, f));
	assert.ok(fs.existsSync(HOOK), 'ci-fix.cjs is missing: the U22 hook is not built yet');
	fs.copyFileSync(HOOK, path.join(kit, 'ci-fix.cjs'));
	// the digest the hook loads from kit-tools, beside kit-hooks: the real one unless a case stubs it
	fs.mkdirSync(path.join(cfg, 'kit-tools'));
	fs.copyFileSync(path.join(KIT, 'user', 'kit-tools', 'ci-digest.mjs'), path.join(cfg, 'kit-tools', 'ci-digest.mjs'));
	// owner-yes.cjs beside it, as install lays it out: the hook builds its owner-yes hold reason with its askText
	fs.copyFileSync(path.join(KIT, 'user', 'kit-tools', 'owner-yes.cjs'), path.join(cfg, 'kit-tools', 'owner-yes.cjs'));
	for (const [rel, text] of Object.entries(extra)) { fs.mkdirSync(path.dirname(path.join(cfg, rel)), { recursive: true }); fs.writeFileSync(path.join(cfg, rel), text); }
	const files = {};
	for (const f of fs.readdirSync(kit)) files[`kit-hooks/${f}`] = crypto.createHash('sha256').update(fs.readFileSync(path.join(kit, f))).digest('hex');
	fs.writeFileSync(path.join(cfg, 'kit-install.json'), JSON.stringify({ files }));
	return { dir, cfg };
}
// extra is merged into the call's input (transcript_path, session_id); env into the guard's environment (PATH for the fake gh).
function guardCall(home, root, tool_name, tool_input, extra = {}, env = {}) {
	const r = spawnSync(process.execPath, [path.join(home.dir, 'guard.cjs')], { input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name, tool_input, cwd: root, ...extra }), encoding: 'utf8', env: isolatedEnv({ CLAUDE_CONFIG_DIR: home.cfg, KIT_CLAUDE_HOME: home.cfg, ...env }) });
	assert.equal(r.status, 0, r.stderr);
	return r.stdout ? JSON.parse(r.stdout) : {};
}
// An answered pop-up as Claude Code writes it when the owner taps Yes on a question quoting `act` in one code span.
function writeYesTranscript(file, act) {
	const question = `May I run \`${act}\`?`;
	const askId = 'toolu_ask_owner';
	const questions = [{ question, header: 'Owner yes', multiSelect: false, options: [{ label: 'Yes', description: '' }, { label: 'No', description: '' }] }];
	const at = new Date().toISOString();
	const lines = [
		{ type: 'assistant', isSidechain: false, timestamp: at, message: { content: [{ type: 'tool_use', id: askId, name: 'AskUserQuestion', input: { questions } }] } },
		{ type: 'user', isSidechain: false, timestamp: at, permissionDecision: { decision: 'accept', source: 'user_temporary' }, toolUseResult: { questions, answers: { [question]: 'Yes' } }, message: { content: [{ type: 'tool_result', tool_use_id: askId, content: 'answered' }] } },
	];
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
}

// why: catches an edit refused while a failing item has no diagnosis, then only a diagnosed file taken; a Write or MultiEdit is an edit too; a state for another commit reads as no red run (K399 S1)
test('an edit is refused while a failing item has no diagnosis, and once all are diagnosed only a named file is taken', () => {
	const root = mkRepo();
	const first = check(root, ...editOf(root, 'src/a.mjs'));
	assert.ok(deny(first), 'an undiagnosed red item refuses the edit');
	assert.match(why(first), /ci-fix\.mjs list/, 'the refusal prints ci-fix.mjs list');
	// a Write and a MultiEdit to the same file are refused the same way
	const write1 = check(root, 'Write', { file_path: `${root}/src/a.mjs`, content: 'x\n' });
	assert.ok(deny(write1), 'a Write is refused with an undiagnosed item');
	assert.match(why(write1), /ci-fix\.mjs list/);
	const multi = check(root, 'MultiEdit', { file_path: `${root}/src/a.mjs`, edits: [{ old_string: 'x', new_string: 'y' }] });
	assert.ok(deny(multi), 'a MultiEdit is refused with an undiagnosed item');
	assert.match(why(multi), /ci-fix\.mjs list/);
	writeCifix(root, [cifixLine(ITEM_A, ['src/a.mjs'])]);
	assert.ok(deny(check(root, ...editOf(root, 'src/a.mjs'))), 'item B still has no diagnosis: refused');
	writeCifix(root, [cifixLine(ITEM_A, ['src/a.mjs']), cifixLine(ITEM_B, ['src/a.mjs'])]);
	assert.ok(!deny(check(root, ...editOf(root, 'src/a.mjs'))), 'the file the diagnoses name is taken');
	assert.ok(deny(check(root, ...editOf(root, 'src/b.mjs'))), 'a file no diagnosis names is refused');
	// a state for another commit than HEAD is no red run of this head: the same undiagnosed edit passes with no list refusal
	const other = mkRepo();
	const stateFile = path.join(common(other), 'kit-ci-state.json');
	fs.writeFileSync(stateFile, JSON.stringify({ ...JSON.parse(fs.readFileSync(stateFile, 'utf8')), sha: 'b'.repeat(40) }));
	const stale = check(other, ...editOf(other, 'src/a.mjs'));
	assert.ok(!deny(stale), `a state for another commit does not refuse: ${why(stale)}`);
	assert.doesNotMatch(why(stale), /ci-fix\.mjs list/);
	// the fence keys on the pushed head (the upstream ref), not local HEAD: a local commit on top leaves the red run in force
	const pushed = mkRepo();
	const pushedSha = git(pushed, ['rev-parse', 'HEAD']);
	git(pushed, ['update-ref', 'refs/remotes/origin/main', pushedSha]);
	git(pushed, ['commit', '-q', '--allow-empty', '-m', 'local']);
	assert.ok(deny(check(pushed, ...editOf(pushed, 'src/a.mjs'))), 'a local commit does not clear the red run on the pushed head');
});

// why: catches a sweep-recorded branch refusing a new test( or // planted: tag from a subagent, a hand edit of the build record, and a test( from a tester with no ticket row; a ticketed tester goes through (K399 S2)
test('with a sweep recorded, an edit adding a test( or // planted: tag is refused and a hand edit to the build record is refused', () => {
	const root = mkRepo({ state: 'none', sweep: true, ticket: true });
	ticketRow(root, 'sess-t');
	const builder = { agent_id: 'builder-1', agent_type: 'builder', session_id: 'sess-x' };
	const unticketed = { agent_id: 'tester-2', agent_type: 'tester', session_id: 'sess-x' };
	const ticketed = { agent_id: 'tester-1', agent_type: 'tester', session_id: 'sess-t' };
	const addTest = editOf(root, 'tests/foo.test.mjs', FOO_OLD, `${FOO_OLD}test('new one', () => {});\n`);
	const addTag = editOf(root, 'tests/foo.test.mjs', FOO_OLD, `${FOO_OLD}// planted: a tag\n`);
	const record = editOf(root, `docs/builds/${VERSION}.json`, '"1.51.4"', '"1.51.5"');
	const subTest = check(root, ...addTest, {}, builder);
	assert.ok(deny(subTest), 'a subagent with no ticket adding a test( is refused');
	assert.match(why(subTest), /closeout\.mjs defer/, 'the refusal prints closeout.mjs defer');
	assert.ok(deny(check(root, ...addTag, {}, builder)), 'a subagent adding a // planted: tag is refused');
	assert.ok(deny(check(root, ...record, {}, builder)), 'a subagent hand-editing the build record is refused');
	// a ticketed tester (its session holds the ticket row) adding a test( goes through
	assert.ok(!deny(check(root, ...addTest, {}, ticketed)), 'a ticketed tester adding a test( passes');
	// the same edit from a tester whose session holds no ticket row is refused
	assert.ok(deny(check(root, ...addTest, {}, unticketed)), 'an unticketed tester adding a test( is refused');
	// a session row that ticket no tester: ticket none, a role other than tester, or a time before the recorded sweep
	const rowsFile = path.join(common(root), 'kit-agent-model.log');
	const rowFor = (session, extra) => fs.appendFileSync(rowsFile, `${JSON.stringify({ at: new Date().toISOString(), hook: 'agent-model', mode: 'enforce', session, ...extra })}\n`);
	rowFor('sess-none', { type: 'tester', role: 'tester', unit: null, ticket: 'none' });
	rowFor('sess-role', { type: 'builder', role: 'builder', unit: null, ticket: 'F1' });
	rowFor('sess-old', { type: 'tester', role: 'tester', unit: null, ticket: 'F1', at: '2000-01-01T00:00:00.000Z' });
	for (const session of ['sess-none', 'sess-role', 'sess-old']) {
		assert.ok(deny(check(root, ...addTest, {}, { agent_id: 'tester-3', agent_type: 'tester', session_id: session })), `a tester whose session row is ${session} is not ticketed`);
	}
	// the build's cifix record is written only by ci-fix.mjs: an edit or a Bash append is refused for every caller, the lead too
	const cifix = `docs/builds/${VERSION}.cifix.jsonl`;
	assert.ok(deny(check(root, ...editOf(root, cifix, '', '{}\n'))), 'a lead edit to the cifix record is refused');
	assert.ok(deny(check(root, ...editOf(root, cifix, '', '{}\n'), {}, builder)), 'a subagent edit to the cifix record is refused');
	assert.ok(deny(check(root, 'Bash', { command: `echo {} >> ${cifix}` })), 'a lead Bash append to the cifix record is refused');
	// control: tests only go down, and an edit adding no tag goes through for a subagent
	assert.ok(!deny(check(root, ...editOf(root, 'tests/foo.test.mjs', FOO_OLD, ''), {}, builder)), 'removing a test is allowed');
	assert.ok(!deny(check(root, ...editOf(root, 'src/a.mjs'), {}, builder)), 'an edit adding no tag is allowed');
});

// why: catches a gate-file number raised on a cap line or lowered on a floor line held for the owner, with the other numbers free (K399 S3)
test('a cap raised, a floor lowered or a timeout raised in a gate file is held for the owner; the loosening-free edits go through', () => {
	const root = mkRepo({ state: 'none' });
	const cap = check(root, ...editOf(root, 'scripts/test-run.mjs', 'FAST_CAP_MS = 30000', 'FAST_CAP_MS = 60000'));
	assert.ok(deny(cap), 'a cap raised is held');
	assert.match(why(cap), /the owner/, 'the hold names the owner');
	const floor = check(root, ...editOf(root, 'scripts/test-check.mjs', 'SCORE_FLOOR = 8', 'SCORE_FLOOR = 5'));
	assert.ok(deny(floor), 'a floor lowered is held');
	assert.match(why(floor), /the owner/);
	const timeout = check(root, ...editOf(root, 'tests/foo.test.mjs', '{ timeout: 1000 }', '{ timeout: 5000 }'));
	assert.ok(deny(timeout), 'a timeout: number raised in a test file is held');
	// a replace_all edit raises the cap on every match; a MultiEdit entry with replace_all does the same
	const all = check(root, 'Edit', { file_path: `${root}/scripts/test-run.mjs`, old_string: 'FAST_CAP_MS = 30000', new_string: 'FAST_CAP_MS = 60000', replace_all: true });
	assert.ok(deny(all), 'a replace_all edit raising a cap is held');
	const multi = check(root, 'MultiEdit', { file_path: `${root}/scripts/test-run.mjs`, edits: [{ old_string: 'FAST_CAP_MS = 30000', new_string: 'FAST_CAP_MS = 60000', replace_all: true }] });
	assert.ok(deny(multi), 'a MultiEdit entry with replace_all raising a cap is held');
	// a cap line or a floor line removed is held; a new timeout-minutes: cap line added is held; a Write that creates a gate file is held
	assert.ok(deny(check(root, ...editOf(root, 'scripts/test-run.mjs', 'FAST_CAP_MS = 30000\n', ''))), 'a cap line removed from a gate file is held');
	// the whole cap line with its newline, matched exactly, is removed: the removal rule itself holds it
	assert.ok(deny(check(root, ...editOf(root, 'scripts/test-run.mjs', 'const FAST_CAP_MS = 30000;\n', ''))), 'a whole cap line with its newline removed is held');
	assert.ok(deny(check(root, ...editOf(root, 'scripts/test-check.mjs', 'SCORE_FLOOR = 8\n', ''))), 'a floor line removed from a gate file is held');
	write(root, '.github/workflows/ci.yml', 'name: ci\n');
	assert.ok(deny(check(root, ...editOf(root, '.github/workflows/ci.yml', 'name: ci', 'name: ci\n    timeout-minutes: 30'))), 'a new timeout-minutes: cap line added to a workflow is held');
	assert.ok(deny(check(root, 'Write', { file_path: `${root}/.github/workflows/new.yml`, content: 'jobs:\n  t:\n    timeout-minutes: 30\n' })), 'a Write that creates a new gate file is held');
	// control: a cap lowered, a floor raised and a retry count raised (neither cap nor floor) go through
	assert.ok(!deny(check(root, ...editOf(root, 'scripts/test-run.mjs', 'FAST_CAP_MS = 30000', 'FAST_CAP_MS = 20000'))), 'a cap lowered is allowed');
	assert.ok(!deny(check(root, ...editOf(root, 'scripts/test-check.mjs', 'SCORE_FLOOR = 8', 'SCORE_FLOOR = 9'))), 'a floor raised is allowed');
	assert.ok(!deny(check(root, ...editOf(root, 'scripts/test-run.mjs', 'RETRIES = 3', 'RETRIES = 5'))), 'a retry count raised is allowed');
	// a line with two numbers where only the capped one rises is held: the cap is the second number
	write(root, 'scripts/test-run.mjs', 'const FAST_CAP_MS = 2 * 30000;\n');
	assert.ok(deny(check(root, ...editOf(root, 'scripts/test-run.mjs', 'FAST_CAP_MS = 2 * 30000', 'FAST_CAP_MS = 2 * 60000'))), 'a two-number cap line with the capped number raised is held');
	// a decimal cap that rises is held
	write(root, 'scripts/test-run.mjs', 'const RATIO_CAP = 1.3;\n');
	assert.ok(deny(check(root, ...editOf(root, 'scripts/test-run.mjs', 'RATIO_CAP = 1.3;', 'RATIO_CAP = 1.5;'))), 'a decimal cap that rises is held');
	// Math.min( reads as a cap: raised is held, lowered is taken
	write(root, 'scripts/test-check.mjs', 'const t = Math.min(600000, left());\n');
	assert.ok(deny(check(root, ...editOf(root, 'scripts/test-check.mjs', 'Math.min(600000', 'Math.min(900000'))), 'a Math.min cap raised is held');
	assert.ok(!deny(check(root, ...editOf(root, 'scripts/test-check.mjs', 'Math.min(600000', 'Math.min(300000'))), 'a Math.min cap lowered is taken');
	// a line holding both Math.max( and Math.min( is held on any number change, in either direction
	write(root, 'scripts/test-check.mjs', 'const t = Math.max(1000, Math.min(600000, left()));\n');
	assert.ok(deny(check(root, ...editOf(root, 'scripts/test-check.mjs', 'Math.min(600000', 'Math.min(900000'))), 'a mixed max and min line with its cap raised is held');
	assert.ok(deny(check(root, ...editOf(root, 'scripts/test-check.mjs', 'Math.min(600000', 'Math.min(300000'))), 'a mixed max and min line with its cap lowered is held too');
	// a held gate edit is the owner-yes hold through guard.cjs; once the owner's accepted pop-up quotes that change's code, the same edit goes through
	write(root, 'scripts/test-run.mjs', 'const FAST_CAP_MS = 30000;\n');
	const home = guardHome();
	const capIn = { file_path: `${root}/scripts/test-run.mjs`, old_string: 'FAST_CAP_MS = 30000', new_string: 'FAST_CAP_MS = 60000' };
	const held = guardCall(home, root, 'Edit', capIn);
	assert.ok(deny(held), 'the cap raise is held through guard.cjs');
	assert.ok(why(held).startsWith("Owner's yes needed: "), `the hold is the owner-yes hold: ${why(held)}`);
	const transcript = path.join(home.cfg, 'projects', 'C--proj', '5f1c2d3e-4a5b-4c6d-8e7f-900112233445.jsonl');
	writeYesTranscript(transcript, `Edit ${capIn.file_path}: ${capIn.old_string} => ${capIn.new_string}`);
	const yes = guardCall(home, root, 'Edit', capIn, { transcript_path: transcript, session_id: '5f1c2d3e-4a5b-4c6d-8e7f-900112233445' });
	assert.ok(!deny(yes), `the same edit goes through on the owner's accepted pop-up: ${why(yes)}`);
	// the accepted pop-up lifts only rule (c): the same gate edit under a red run with an undiagnosed item, or by the lead after a
	// sweep with no diagnosis, stays held
	const redRoot = mkRepo({ state: 'red' });
	write(redRoot, 'scripts/test-run.mjs', 'const FAST_CAP_MS = 30000;\n');
	const redIn = { file_path: `${redRoot}/scripts/test-run.mjs`, old_string: 'FAST_CAP_MS = 30000', new_string: 'FAST_CAP_MS = 60000' };
	const redT = path.join(home.cfg, 'projects', 'red', '6a2d3e4f-5b6c-4d7e-9f80-a11223344556.jsonl');
	writeYesTranscript(redT, `Edit ${redIn.file_path}: ${redIn.old_string} => ${redIn.new_string}`);
	assert.ok(deny(guardCall(home, redRoot, 'Edit', redIn, { transcript_path: redT, session_id: '6a2d3e4f-5b6c-4d7e-9f80-a11223344556' })), 'the gate edit stays held under a red run with an undiagnosed item');
	const swRoot = mkRepo({ state: 'none', sweep: true });
	write(swRoot, 'scripts/test-run.mjs', 'const FAST_CAP_MS = 30000;\n');
	const swIn = { file_path: `${swRoot}/scripts/test-run.mjs`, old_string: 'FAST_CAP_MS = 30000', new_string: 'FAST_CAP_MS = 60000' };
	const swT = path.join(home.cfg, 'projects', 'sweep', '7b3e4f50-6c7d-4e8f-8091-b22334455667.jsonl');
	writeYesTranscript(swT, `Edit ${swIn.file_path}: ${swIn.old_string} => ${swIn.new_string}`);
	assert.ok(deny(guardCall(home, swRoot, 'Edit', swIn, { transcript_path: swT, session_id: '7b3e4f50-6c7d-4e8f-8091-b22334455667' })), 'the gate edit by the lead after a sweep with no diagnosis stays held');
});

// why: catches a decoy test line with the old timeout pairing first so a raised timeout line gets through unheld
test('an edit that keeps the old timeout line and adds a second line with a higher timeout is held for the owner', () => {
	const root = mkRepo({ state: 'none' });
	const base = "test('slow', { timeout: 1000 }, async () => {";
	write(root, 'tests/x.test.mjs', `${base}\n});\n`);
	const decoy = check(root, ...editOf(root, 'tests/x.test.mjs', base, `${base}\n});\ntest('slow', { timeout: 60000 }, async () => {`));
	assert.ok(deny(decoy), 'a raised timeout line behind a decoy of the old line is held');
	assert.ok(why(decoy).startsWith("Owner's yes needed: "), `the hold is the owner-yes hold: ${why(decoy)}`);
	// control: the plain raise of the one line is held the same way
	assert.ok(deny(check(root, ...editOf(root, 'tests/x.test.mjs', '{ timeout: 1000 }', '{ timeout: 60000 }'))), 'the plain raise is held');
});

// why: catches a second red on an item held for the owner, its owner-ask logged, while another diagnosed item's file is still taken (K399 S4)
test('an edit to the files of an item red a second time is refused and logged as an owner-ask; the other item carries on', () => {
	// ITEM_A was diagnosed in run 100 and is red again in run 200; ITEM_B is diagnosed in run 200 and names src/b.mjs
	const root = mkRepo({ cifix: [cifixLine(ITEM_A, ['src/a.mjs'], { run: 100 }), cifixLine(ITEM_B, ['src/b.mjs'])] });
	const second = check(root, ...editOf(root, 'src/a.mjs'));
	assert.ok(deny(second), 'the second red on ITEM_A refuses its file');
	assert.match(why(second), /the owner/, 'the refusal stops and asks the owner');
	assert.ok(logRows(root).some((r) => String(r.cause || '').includes(ITEM_A.name)), `the owner-ask is logged: ${JSON.stringify(logRows(root))}`);
	// control: ITEM_A has left the count (it is the owner's now), so the other item's named file carries on
	assert.ok(!deny(check(root, ...editOf(root, 'src/b.mjs'))), 'ITEM_B carries on');
});

// why: catches a Bash write form to a red tracked file refused as an edit is, while reads and writes to an untracked file or to a named file go through (K399 S5)
test('Bash write forms (sed -i, > and >>, tee, git apply, git checkout --, node -e writeFile) get the same refusal as an edit', () => {
	const root = mkRepo();
	const writes = ['sed -i "s/a/b/" src/a.mjs', 'echo x > src/a.mjs', 'echo x >> src/a.mjs', 'echo x | tee src/a.mjs', 'git apply fix.patch', 'git checkout -- src/a.mjs', 'node -e "require(\'fs\').writeFileSync(\'src/a.mjs\',\'x\')"'];
	for (const command of writes) {
		const d = check(root, 'Bash', { command });
		assert.ok(deny(d), `${command} is refused under the red run`);
		assert.match(why(d), /ci-fix\.mjs list/, command);
	}
	// PowerShell write forms to the red file get the same refusal as Bash
	for (const command of ['Set-Content src/a.mjs -Value x', 'Out-File -FilePath src/a.mjs', '"x" > src/a.mjs']) {
		const d = check(root, 'PowerShell', { command });
		assert.ok(deny(d), `PowerShell ${command} is refused under the red run`);
		assert.match(why(d), /ci-fix\.mjs list/, command);
	}
	// a glob target, a relative target after a folder change, PowerShell copy, move and .NET file calls, and git apply with an
	// unreadable patch are refused under the red run
	for (const [tool, command] of [['Bash', 'echo x > src/*.mjs'], ['Bash', 'cd src && echo x > a.mjs'], ['Bash', 'git apply missing.patch'], ['PowerShell', 'Copy-Item x.txt -Destination src/a.mjs'], ['PowerShell', 'Move-Item src/a.mjs b.mjs'], ['PowerShell', "[IO.File]::Copy('x.txt','src/a.mjs')"], ['PowerShell', "[IO.File]::Replace('x.txt','src/a.mjs','bak.txt')"], ['Bash', 'cd src & echo x > a.mjs'], ['Bash', 'cd /c/Users/x && echo x > a.mjs'], ['Bash', 'pushd src; popd; echo x > a.mjs'], ['PowerShell', "[IO.File]::WriteAllText('src/a.mjs'"], ['PowerShell', 'Copy-Item -Path x.txt src/a.mjs'], ['PowerShell', 'Rename-Item src/a.mjs -NewName b.mjs'], ['PowerShell', 'Set-Content -Path x.txt, src/a.mjs -Value 1']]) {
		assert.ok(deny(check(root, tool, { command })), `${tool} ${command} is refused under the red run`);
	}
	// a PowerShell comma list names each target: src/a.mjs in it is refused under the red run
	assert.ok(deny(check(root, 'PowerShell', { command: 'Set-Content a.mjs,src/a.mjs -Value 1' })), 'a PowerShell comma list naming src/a.mjs is refused under the red run');
	// an unresolvable target is an unknown write to the call's repo: taken in a clear repo, and outside any repo; refused under a red run
	const clear = mkRepo({ state: 'none' });
	assert.ok(!deny(check(clear, 'Bash', { command: 'echo x > "$OUT"' })), 'an unresolvable target in a clear repo goes through');
	assert.ok(!deny(check(clear, 'PowerShell', { command: 'git status 2>$null' })), 'a PowerShell 2>$null with no write target goes through');
	const outside = kitTemp.makeTemp('ci-fix-hook-outside-');
	assert.ok(!deny(check(outside, 'Bash', { command: 'echo x > "$OUT"' })), 'an unresolvable write outside any repo goes through');
	assert.ok(deny(check(root, 'Bash', { command: 'echo x > "$OUT"' })), 'the same unclear write under a red run is refused');
	// an unclear write whose text names a gate file or a cifix record is held even in a clear repo
	assert.ok(deny(check(clear, 'Bash', { command: 'echo x > "$G"/scripts/test-run.mjs' })), 'an unclear write naming a gate file is held in a clear repo');
	assert.ok(deny(check(clear, 'Bash', { command: 'cp x "$D"/docs/builds/1.51.4.cifix.jsonl' })), 'an unclear write naming the cifix record is held in a clear repo');
	// an interpreter call carrying a write inside its argument is a write under a held state
	for (const command of ['bash -c "echo x > src/a.mjs"', 'pwsh -Command "Set-Content src/a.mjs 1"', "sh -c 'printf x > src/a.mjs'", 'echo $(echo x > src/a.mjs)']) {
		assert.ok(deny(check(root, 'Bash', { command })), `${command} is refused under the red run`);
	}
	// controls: reads go through, and so does a write to an untracked file
	for (const command of ['cat src/a.mjs', 'git status', 'node -e "console.log(1)"', 'echo x > out.log']) assert.ok(!deny(check(root, 'Bash', { command })), `${command} goes through on the red run`);
	// control: once the diagnoses name src/a.mjs, the same write to it is taken
	const named = mkRepo({ cifix: [cifixLine(ITEM_A, ['src/a.mjs']), cifixLine(ITEM_B, ['src/a.mjs'])] });
	assert.ok(!deny(check(named, 'Bash', { command: 'echo x > src/a.mjs' })), 'a write to a file the diagnoses name is taken');
});

// why: catches the lead's source or test edit taken after a sweep only when a diagnosis names it, and refused with no red run at all (K399 S6)
test('after the sweep the lead\'s source or test edit is refused unless a diagnosis names the file', () => {
	// a red run with a diagnosis naming src/a.mjs, and a pin diagnosis naming tests/foo.test.mjs
	const root = mkRepo({ sweep: true, cifix: [cifixLine(ITEM_A, ['src/a.mjs']), cifixLine(ITEM_B, ['tests/foo.test.mjs'], { cause: 'pin' })] });
	assert.ok(!deny(check(root, ...editOf(root, 'src/a.mjs'))), 'the file a diagnosis names is taken');
	assert.ok(!deny(check(root, ...editOf(root, 'tests/foo.test.mjs'))), 'the test file a pin diagnosis names is taken');
	// control: the lead's free write, the changelog, goes through
	assert.ok(!deny(check(root, ...editOf(root, 'docs/CHANGELOG.md'))), 'the changelog is a free write');
	// the diagnose command, and a commit whose message holds an arrow, are not writes the lead is refused after the sweep
	assert.ok(!deny(check(root, 'Bash', { command: 'node user/kit-tools/ci-fix.mjs diagnose 1 --cause code --fix "x -> y" --files src/a.mjs' })), 'the diagnose command goes through after the sweep');
	assert.ok(!deny(check(root, 'Bash', { command: 'git commit -m "a -> b"' })), 'a git commit with an arrow in its message goes through after the sweep');
	// after a sweep the lead's free writes are the PR body, the changelog and script-made records; another docs/ file is refused
	assert.ok(deny(check(root, ...editOf(root, 'docs/NOTES.md'))), 'a lead edit to another docs/ file after the sweep is refused');
	// a recorded sweep with no red run: no diagnosis can name the file, so the lead's source edit is refused
	const quiet = mkRepo({ state: 'none', sweep: true });
	assert.ok(deny(check(quiet, ...editOf(quiet, 'src/a.mjs'))), 'the lead\'s source edit is refused after a sweep with no red run');
});

// why: catches gh unreachable reading as CI unknown and letting the edit through with one log line, not a crash (K399 S7)
test('gh unreachable reads as CI unknown: the edit goes through, one log line, and every gh call names -R o/r', () => {
	const root = mkRepo({ state: 'none' });
	const calls = path.join(kitTemp.makeTemp('ci-fix-hook-calls-'), 'calls.jsonl');
	const out = check(root, ...editOf(root, 'src/a.mjs'), fakeGhEnv(calls));
	assert.ok(!deny(out), `gh unreachable lets the edit through: ${why(out)}`);
	const made = fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
	assert.ok(made.length >= 1, 'the hook asked gh for the run');
	for (const args of made) assert.equal(args[args.indexOf('-R') + 1], 'o/r', `gh call without -R o/r: ${args.join(' ')}`);
	assert.equal(logRows(root).length, 1, 'one log line for the unknown CI');
	// a red head whose log read outlasts the time budget: the next call, inside the 60 s throttle, is refused as red, not let through
	const slow = mkRepo({ state: 'none' });
	const slowCalls = path.join(kitTemp.makeTemp('ci-fix-hook-slow-'), 'calls.jsonl');
	check(slow, ...editOf(slow, 'src/a.mjs'), fakeGhEnv(slowCalls, 'red-slow'));
	const again = check(slow, ...editOf(slow, 'src/a.mjs'), fakeGhEnv(slowCalls, 'red-slow'));
	assert.ok(deny(again), `a red head with timed-out logs is refused inside the throttle: ${why(again)}`);
	assert.doesNotMatch(why(again), /unknown/i, 'it is refused as red, never read as unknown');
});

// why: catches a hook error on the red-run hook blocking with "hook error: lead review" and logged, under holds.json enforce tier high (K399 S7)
test('fail-closed: a hook error blocks with "hook error: lead review", logged, with ci-fix enforce at tier high in holds.json', () => {
	const holds = JSON.parse(fs.readFileSync(path.join(HOOK_DIR, 'holds.json'), 'utf8')).holds;
	const entry = holds.find((h) => h.id === 'ci-fix');
	assert.ok(entry, 'holds.json names ci-fix');
	assert.equal(entry.mode, 'enforce');
	assert.equal(entry.tier, 'high');
	// the real hook through guard.cjs's dispatch; a state folder makes the hook's read throw
	const root = mkRepo({ state: 'dir' });
	const dir = kitTemp.makeTemp('ci-fix-hook-guard-');
	for (const f of GUARDS) fs.copyFileSync(path.join(GUARD_SRC, f), path.join(dir, f));
	const cfg = kitTemp.makeTemp('ci-fix-hook-cfg-');
	const kit = path.join(cfg, 'kit-hooks');
	fs.mkdirSync(kit);
	for (const f of HELPERS) fs.copyFileSync(path.join(HOOK_DIR, f), path.join(kit, f));
	assert.ok(fs.existsSync(HOOK), 'ci-fix.cjs is missing: the U22 hook is not built yet');
	fs.copyFileSync(HOOK, path.join(kit, 'ci-fix.cjs'));
	const files = {};
	for (const f of fs.readdirSync(kit)) files[`kit-hooks/${f}`] = crypto.createHash('sha256').update(fs.readFileSync(path.join(kit, f))).digest('hex');
	fs.writeFileSync(path.join(cfg, 'kit-install.json'), JSON.stringify({ files }));
	const r = spawnSync(process.execPath, [path.join(dir, 'guard.cjs')], { input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: `${root}/src/a.mjs`, old_string: 'x', new_string: 'y' }, cwd: root }), encoding: 'utf8', env: isolatedEnv({ CLAUDE_CONFIG_DIR: cfg, KIT_CLAUDE_HOME: cfg }) });
	assert.equal(r.status, 0, r.stderr);
	const out = r.stdout ? JSON.parse(r.stdout) : {};
	assert.ok(deny(out), `a broken hook blocks the edit: ${JSON.stringify(out)}`);
	assert.match(why(out), /hook error: lead review: ci-fix/);
	const rows = readRows(path.join(common(root), 'kit-guard-open.log')).filter((x) => x.kind === 'hook-error');
	assert.equal(rows.length, 1, 'one hook-error row');
	assert.equal(rows[0].id, 'ci-fix');
	assert.equal(rows[0].tier, 'high');
	// one PowerShell Set-Content to a red file goes through the same guard dispatch and is refused as an edit is
	const red = mkRepo({ state: 'red' });
	const ps = spawnSync(process.execPath, [path.join(dir, 'guard.cjs')], { input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'PowerShell', tool_input: { command: 'Set-Content src/a.mjs -Value x' }, cwd: red }), encoding: 'utf8', env: isolatedEnv({ CLAUDE_CONFIG_DIR: cfg, KIT_CLAUDE_HOME: cfg }) });
	assert.equal(ps.status, 0, ps.stderr);
	const psOut = ps.stdout ? JSON.parse(ps.stdout) : {};
	assert.ok(deny(psOut), `a PowerShell write to a red file is refused through guard.cjs: ${JSON.stringify(psOut)}`);
	assert.match(why(psOut), /ci-fix\.mjs list/, 'the refusal is the ci-fix refusal');
	// F13: a Node that cannot load the digest (ERR_REQUIRE_ESM) leaves a red head provisional: the next edit is held, not let through, not a crash
	const esm = guardHome({ 'kit-tools/ci-digest.mjs': "throw Object.assign(new Error('require() of an ES module'), { code: 'ERR_REQUIRE_ESM' });\n" });
	const esmRoot = mkRepo({ state: 'none' });
	const esmCalls = path.join(kitTemp.makeTemp('ci-fix-hook-esm-'), 'calls.jsonl');
	const esmEdit = guardCall(esm, esmRoot, 'Edit', { file_path: `${esmRoot}/src/a.mjs`, old_string: 'x', new_string: 'y' }, {}, fakeGhEnv(esmCalls, 'red-jobs'));
	assert.ok(deny(esmEdit), `a red head whose digest cannot load is held: ${JSON.stringify(esmEdit)}`);
	assert.doesNotMatch(why(esmEdit), /hook error/, 'the load failure is held as provisional, not a crash');
	const esmState = path.join(common(esmRoot), 'kit-ci-state.json');
	const es = fs.existsSync(esmState) ? JSON.parse(fs.readFileSync(esmState, 'utf8')) : null;
	assert.ok(es && es.provisional === true && es.settled === false, `the red head stays provisional and unsettled: ${JSON.stringify(es)}`);
	// the hook's own red fill with zero digested items (only the rollup job failed) keeps the state provisional and holds the edit
	const zero = guardHome();
	const zeroRoot = mkRepo({ state: 'none' });
	const zeroCalls = path.join(kitTemp.makeTemp('ci-fix-hook-zero-'), 'calls.jsonl');
	const zeroEdit = guardCall(zero, zeroRoot, 'Edit', { file_path: `${zeroRoot}/src/a.mjs`, old_string: 'x', new_string: 'y' }, {}, fakeGhEnv(zeroCalls, 'red-rollup'));
	assert.ok(deny(zeroEdit), `a red head that digests to no items is held: ${JSON.stringify(zeroEdit)}`);
	const zeroState = path.join(common(zeroRoot), 'kit-ci-state.json');
	const zs = fs.existsSync(zeroState) ? JSON.parse(fs.readFileSync(zeroState, 'utf8')) : null;
	assert.ok(zs && zs.provisional === true && zs.settled === false, `the zero-item red head stays provisional and unsettled: ${JSON.stringify(zs)}`);
});

// why: catches a bypass spelling of a red-run file (./ path, backslash, another case) taken where the plain path is refused (K399 S1)
test('bypass: a ./ path, a backslash path or another case is held the same as the plain path', () => {
	const root = mkRepo({ cifix: [cifixLine(ITEM_A, ['src/a.mjs']), cifixLine(ITEM_B, ['src/a.mjs'])] });
	// src/a.mjs is named by both diagnoses; src/b.mjs is named by none
	assert.ok(!deny(check(root, ...editOf(root, 'src/a.mjs'))), 'the plain named path is taken');
	assert.ok(!deny(check(root, 'Edit', { file_path: `${root}/./src/a.mjs`, old_string: 'x', new_string: 'y' })), 'a ./ spelling of the named path is taken');
	assert.ok(deny(check(root, ...editOf(root, 'src/b.mjs'))), 'the plain unnamed path is refused');
	// a relative file_path from a subfolder cwd (cwd = <repo>/src) names the same file as the plain path
	const fromSrc = (file_path) => check(root, 'Edit', { file_path, old_string: 'x', new_string: 'y' }, {}, { cwd: `${root}/src` });
	assert.ok(!deny(fromSrc('a.mjs')), 'a.mjs from src is the named src/a.mjs and is taken');
	assert.ok(deny(fromSrc('b.mjs')), 'b.mjs from src is src/b.mjs and is refused');
	// a Bash write whose target sits in another repo is judged by that repo: a red state there refuses it; an unresolvable target is refused
	const elsewhere = mkRepo({ state: 'red' });
	assert.ok(deny(check(root, 'Bash', { command: `echo x > ${elsewhere}/src/a.mjs` })), 'a write into another red repo is refused by that repo');
	assert.ok(deny(check(root, 'Bash', { command: 'echo x > "$KIT_NO_SUCH_DIR/a.mjs"' })), 'a write to an unresolvable target is refused');
	assert.ok(!deny(check(root, 'Bash', { command: 'echo x > out.log' })), 'an untracked write in the call repo goes through');
	for (const file_path of [`${root}/./src/b.mjs`, `${root}\\src\\b.mjs`, `${root}/SRC/B.MJS`, `${root}/src/../src/b.mjs`]) {
		assert.ok(deny(check(root, 'Edit', { file_path, old_string: 'x', new_string: 'y' })), `${file_path} is held the same as the plain path`);
	}
});

// why: catches the same refused edit giving a different refusal on the second call, so a retry reads as a new verdict (K399 S1)
test('repeat: the same refused edit twice gives the same refusal', () => {
	const root = mkRepo();
	const one = check(root, ...editOf(root, 'src/a.mjs'));
	const two = check(root, ...editOf(root, 'src/a.mjs'));
	assert.ok(deny(one) && deny(two), 'both calls are refused');
	assert.equal(why(two), why(one), 'the refusal text is the same');
	assert.deepEqual(two, one, 'the whole decision is the same');
});

// why: catches a test file's timeout: line rewritten or removed with its test kept, so the hook lets a loosened limit through
test('the hook holds a rewritten timeout: line and a removed one whose test stays, and allows a removed one that goes with its test', () => {
	const root = mkRepo({ state: 'none' });
	const two = "test('a', { timeout: 1000 }, () => {});\ntest('b', () => {});\n";
	write(root, 'tests/foo.test.mjs', two);
	for (const next of ['{ timeout: 1e4 }', '{ timeout: 1000 * 60 }']) {
		assert.ok(deny(check(root, ...editOf(root, 'tests/foo.test.mjs', '{ timeout: 1000 }', next))), `a timeout: line rewritten as ${next} is held`);
	}
	assert.ok(deny(check(root, ...editOf(root, 'tests/foo.test.mjs', "{ timeout: 1000 }, () => {});\ntest('b'", "() => {});\ntest('b'"))), 'a timeout: line removed with its test kept is held');
	// control: the test goes with its timeout: line, so the count of test( calls drops and the removal is allowed
	assert.ok(!deny(check(root, ...editOf(root, 'tests/foo.test.mjs', "test('a', { timeout: 1000 }, () => {});\n", ''))), 'a timeout: line removed with its test is allowed');
});

// why: catches the hook letting two lost timeout: lines through when only one test is deleted
test('the hook holds two removed timeout: lines when only one test is deleted, and allows one removed with its test', () => {
	const root = mkRepo({ state: 'none' });
	const three = "test('a', { timeout: 1000 }, () => {});\ntest('b', { timeout: 2000 }, () => {});\ntest('c', () => {});\n";
	write(root, 'tests/foo.test.mjs', three);
	assert.ok(!deny(check(root, ...editOf(root, 'tests/foo.test.mjs', "test('a', { timeout: 1000 }, () => {});\n", ''))), 'control: one timeout: line removed with its test is allowed');
	assert.ok(deny(check(root, ...editOf(root, 'tests/foo.test.mjs', "test('a', { timeout: 1000 }, () => {});\ntest('b', { timeout: 2000 }, () => {});\n", "test('b', () => {});\n"))), 'two timeout: lines gone with one test deleted are held');
});

// why: catches a timeout: line lost from a kept test passing because another test was deleted, so the count alone decides
test('the hook allows a lost timeout: line only when the test that held it is gone from the new text', () => {
	const root = mkRepo({ state: 'none' });
	const three = "test('a', { timeout: 1000 }, () => {});\ntest('b', { timeout: 2000 }, () => {});\ntest('c', () => {});\n";
	write(root, 'tests/foo.test.mjs', three);
	// A loses its timeout and stays; C is deleted: the count dropped by one and one line was lost, but the line was A's
	const swap = check(root, ...editOf(root, 'tests/foo.test.mjs', three, "test('a', () => {});\ntest('b', { timeout: 2000 }, () => {});\n"));
	assert.ok(deny(swap), 'a timeout: line lost from a kept test is held although another test was deleted');
	// control: A deleted together with its timeout: line passes
	assert.ok(!deny(check(root, ...editOf(root, 'tests/foo.test.mjs', "test('a', { timeout: 1000 }, () => {});\n", ''))), 'control: a test deleted with its own timeout: line is allowed');
});

// why: catches a timeout: rewrite passing because the same edit deletes another test, so the rewrite branch is never reached
test('the hook holds a timeout: rewrite even when the same edit deletes another test', () => {
	const root = mkRepo({ state: 'none' });
	const three = "test('a', { timeout: 1000 }, () => {});\ntest('b', () => {});\ntest('c', () => {});\n";
	write(root, 'tests/foo.test.mjs', three);
	assert.ok(deny(check(root, ...editOf(root, 'tests/foo.test.mjs', "test('a', { timeout: 1000 }, () => {});\ntest('b', () => {});\n", "test('a', { timeout: 1e4 }, () => {});\n"))), 'a rewritten timeout: line is held although a test was deleted');
});

// why: catches a lost timeout: line allowed by the name check alone when the test is renamed, skipped or the line sat outside a test
test('the hook holds a lost timeout: line when its test is renamed or skipped or the line sat outside any test, and allows a deleted test', () => {
	const root = mkRepo({ state: 'none' });
	const base = "test('a', { timeout: 1000 }, () => {});\ntest('b', { timeout: 2000 }, () => {});\ntest('c', () => {});\n";
	write(root, 'tests/foo.test.mjs', base);
	const aLine = "test('a', { timeout: 1000 }, () => {});\n";
	assert.ok(!deny(check(root, ...editOf(root, 'tests/foo.test.mjs', aLine, ''))), 'control: test a deleted with its timeout: line is allowed');
	assert.ok(deny(check(root, ...editOf(root, 'tests/foo.test.mjs', aLine, "test('a2', () => {});\n"))), 'a renamed test with its timeout: line removed, nothing deleted, is held');
	assert.ok(deny(check(root, ...editOf(root, 'tests/foo.test.mjs', aLine, "test.skip('a', () => {});\n"))), 'a test changed to test.skip with its timeout: line removed is held');
	const outside = "test('a', () => {});\nconst POLL = { timeout: 3000 };\ntest('b', () => {});\n";
	write(root, 'tests/foo.test.mjs', outside);
	assert.ok(deny(check(root, ...editOf(root, 'tests/foo.test.mjs', 'const POLL = { timeout: 3000 };\n', ''))), 'a timeout: line after a test\'s close removed, its test kept, is held');
	assert.ok(deny(check(root, ...editOf(root, 'tests/foo.test.mjs', "test('a', () => {});\nconst POLL = { timeout: 3000 };\n", ''))), 'a timeout: line outside any test is held even when the test above it is deleted');
});

// why: catches a rename with its timeout: line dropped passing when the same edit deletes an unrelated test, so count alone clears it
test('the hook holds a renamed test whose timeout: line is removed in the same edit that deletes an unrelated test', () => {
	const root = mkRepo({ state: 'none' });
	write(root, 'tests/foo.test.mjs', "test('a', { timeout: 1000 }, () => {});\ntest('b', () => {});\ntest('c', () => {});\n");
	const renamed = "test('a', { timeout: 1000 }, () => {});\ntest('b', () => {});\n";
	assert.ok(!deny(check(root, ...editOf(root, 'tests/foo.test.mjs', renamed, "test('b', () => {});\n"))), 'control: a deleted with its timeout: line and unrelated b kept is allowed');
	assert.ok(deny(check(root, ...editOf(root, 'tests/foo.test.mjs', renamed, "test('a2', () => {});\n"))), 'a renamed to a2 with its timeout: line removed while b is deleted (drop 1, lost 1) is held');
});

// why: catches a lost timeout: line allowed when its test is renamed to a name another test already has, so no new name shows
test('the hook holds a timeout: line lost when its test is renamed to the name of another test, where only the count of tests can hold it', () => {
	const root = mkRepo({ state: 'none' });
	write(root, 'tests/foo.test.mjs', "test('a', { timeout: 1000 }, () => {});\ntest('b', () => {});\ntest('c', () => {});\n");
	assert.ok(deny(check(root, ...editOf(root, 'tests/foo.test.mjs', "test('a', { timeout: 1000 }, () => {});\n", "test('c', () => {});\n"))), 'a renamed to the existing name c with its timeout: line removed (drop 0, lost 1) is held');
});

// why: catches a test kept under another spelling (todo, space before the dot, name on the next line) losing its timeout: line
test('the hook holds a lost timeout: line when its test name still appears as test.todo, test .skip or a name on the next line', () => {
	const root = mkRepo({ state: 'none' });
	write(root, 'tests/foo.test.mjs', "test('a', { timeout: 1000 }, () => {});\ntest('b', () => {});\n");
	const aLine = "test('a', { timeout: 1000 }, () => {});\n";
	const forms = { 'test.todo': "test.todo('a', () => {});\n", 'test .skip': "test .skip('a', () => {});\n", 'a name on the next line': "test.skip(\n  'a', () => {});\n" };
	for (const [what, next] of Object.entries(forms)) {
		assert.ok(deny(check(root, ...editOf(root, 'tests/foo.test.mjs', aLine, next))), `a kept as ${what} with its timeout: line removed is held`);
	}
});

// why: catches a kept test whose name holds an escaped quote losing its timeout: line because the name search misses it
test('the hook holds a lost timeout: line when its kept test has an escaped quote in its name', () => {
	const root = mkRepo({ state: 'none' });
	const withTimeout = "test('the owner\\'s yes', { timeout: 1000 }, () => {});\n";
	write(root, 'tests/foo.test.mjs', `${withTimeout}test('b', () => {});\n`);
	// an unrelated test b is deleted in the same edit, so the count bound (drop 1, lost 1) is met and only the name check is left
	assert.ok(deny(check(root, ...editOf(root, 'tests/foo.test.mjs', `${withTimeout}test('b', () => {});\n`, "test('the owner\\'s yes', () => {});\n"))), 'a test named with an escaped quote, kept, with its timeout: line removed while b is deleted is held');
});

// why: catches the owner-yes hold for a gate edit naming no way to ask, so a session cannot learn the quote form or the hand-back
test('the (c) owner-yes hold for a gate edit says how to ask: the quote form for the lead and the hand-back note for a subagent', () => {
	const root = mkRepo({ state: 'none' });
	write(root, 'scripts/test-run.mjs', 'const FAST_CAP_MS = 30000;\n');
	const [tool, input] = editOf(root, 'scripts/test-run.mjs', 'FAST_CAP_MS = 30000', 'FAST_CAP_MS = 60000');
	const lead = why(check(root, tool, input));
	assert.ok(lead.startsWith("Owner's yes needed: "), `the hold is the owner-yes hold: ${lead}`);
	assert.ok(lead.includes('Edit <file>: <old text> => <new text>'), `the lead's hold gives the quote form: ${lead}`);
	assert.match(lead, /AskUserQuestion/, 'the lead is told to ask with the pop-up');
	const sub = why(check(root, tool, input, {}, SUBAGENT));
	assert.match(sub, /subagent cannot get/i, `a subagent's hold is the hand-back note: ${sub}`);
});

// why: catches an interpreter call writing an untracked file passing a red run once its unclear entry is removed
test('an interpreter call carrying a write is held as an unclear write under a red run and allowed in a clear repo', () => {
	const root = mkRepo();
	const clear = mkRepo({ state: 'none' });
	for (const command of ['bash -c "echo x > out.log"', "sh -c 'echo x > out.log'", 'pwsh -Command "Set-Content out.log 1"', 'echo $(echo x > out.log)']) {
		const d = check(root, 'Bash', { command });
		assert.ok(deny(d), `${command} is held under the red run`);
		assert.match(why(d), /interpreter call or substitution/i, `${command}: the hold names the interpreter call`);
		assert.ok(!deny(check(clear, 'Bash', { command })), `${command} goes through in a clear repo`);
	}
	// control: the same write with no interpreter is an untracked write and goes through
	assert.ok(!deny(check(root, 'Bash', { command: 'echo x > out.log' })), 'a plain untracked write goes through');
});
