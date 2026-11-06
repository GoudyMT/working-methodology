// Tests for the merge gate (user/kit-tools/merge-gate.mjs): a real git repo with a bare origin, the kit's real
// audits, and a fake gh that answers from a state object and records every call.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { check, arm, live, PROTECTED, toolPath } from '../user/kit-tools/merge-gate.mjs';

// Every temp folder a test makes lands under this one root, removed at exit: os.tmpdir() reads these on each call and children inherit them.
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-tests-'));
process.env.TMPDIR = process.env.TEMP = process.env.TMP = tmpRoot;
process.on('exit', () => { try { fs.rmSync(tmpRoot, { recursive: true, force: true, maxRetries: 3 }); } catch {} });

const KIT = path.resolve('.');
const sh = (cwd, ...a) => {
	const r = spawnSync('git', a, { cwd, encoding: 'utf8' });
	if (r.status !== 0) throw new Error(`git ${a.join(' ')}: ${r.stderr}`);
	return r.stdout.trim();
};
const TITLE = 'feat: add a subtract function';
const BODY = '## Math: add a subtract function\n\nThe math module can now subtract.\n\n**Changes**\n- New `sub(a, b)` export.\n\n**Gates**\n- [x] The test passes.\n- [x] Full local gate green.\n- [x] Sweep by dimension: privacy, supply chain, legal, code security; no secrets or account information.\n\n**Notes** - none.\n';
const report = (branch, sha, extra = '') => `# Sweep: subtract\n\n- **Tier:** feature\n- **Date:** 2026-11-05\n- **Branch:** ${branch} at ${sha.slice(0, 7)}\n- **Covers:** ${sha}\n\n## Result\nPrivacy: clean. Supply chain: clean. Legal: clean. Security: clean. Gaps and scaling: clean.\nVersion goal alignment: YES\n${extra}`;

function setup() {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'merge-gate-'));
	const origin = path.join(root, 'origin.git');
	const work = path.join(root, 'work');
	const config = path.join(root, 'config');
	sh(root, 'init', '-q', '--bare', '-b', 'main', origin);
	sh(root, 'clone', '-q', origin, work);
	sh(work, 'config', 'user.name', 't'); sh(work, 'config', 'user.email', 't@t');
	sh(work, 'checkout', '-q', '-b', 'main');
	fs.mkdirSync(path.join(work, '.claude'));
	for (const f of fs.readdirSync(path.join(KIT, 'project/.claude'))) {
		if (/\.(mjs|cjs|json)$/.test(f)) fs.copyFileSync(path.join(KIT, 'project/.claude', f), path.join(work, '.claude', f));
	}
	fs.writeFileSync(path.join(work, 'math.txt'), 'add\n');
	sh(work, 'add', '-A'); sh(work, 'commit', '-qm', 'base'); sh(work, 'push', '-q', 'origin', 'main');
	sh(work, 'checkout', '-q', '-b', 'feat/subtract');
	fs.writeFileSync(path.join(work, 'math.txt'), 'add\nsub\n');
	sh(work, 'commit', '-qam', 'sub'); sh(work, 'push', '-q', 'origin', 'feat/subtract');
	const sha = sh(work, 'rev-parse', 'HEAD');
	fs.mkdirSync(path.join(work, 'reports', 'sweeps'), { recursive: true });
	fs.writeFileSync(path.join(work, 'reports', 'sweeps', 'sub.md'), report('feat/subtract', sha));
	for (const s of ['pre-pr-sweep', 'release-notes']) {
		fs.mkdirSync(path.join(config, 'skills', s), { recursive: true });
		fs.copyFileSync(path.join(KIT, 'user/skills', s, 'audit.mjs'), path.join(config, 'skills', s, 'audit.mjs'));
	}
	const state = {
		pr: { number: 7, state: 'OPEN', isDraft: false, isCrossRepository: false, headRefName: 'feat/subtract', headRefOid: sha, baseRefName: 'main', title: TITLE, body: BODY, url: 'https://github.com/o/r/pull/7' },
		repo: { nameWithOwner: 'o/r', autoMergeAllowed: true, deleteBranchOnMerge: true },
		protection: { contexts: ['kit-tests'], checks: [] },
		rules: [],
		release: { tagName: 'v1.2.0', body: 'Plans now sync between devices.\n' },
		mergeStatus: 0,
		armed: false,
		calls: [],
	};
	const run = (cmd, args, cwd) => {
		if (cmd !== 'gh') {
			const r = spawnSync(cmd, args, { cwd, encoding: 'utf8' });
			return { status: r.status ?? 1, stdout: r.stdout || '', stderr: r.stderr || '' };
		}
		state.calls.push(args.join(' '));
		const ok = (o) => ({ status: 0, stdout: JSON.stringify(o), stderr: '' });
		const no = { status: 1, stdout: '', stderr: 'HTTP 404' };
		if (args[0] === 'pr' && args[1] === 'view') return args.includes('autoMergeRequest,state')
			? ok({ state: 'OPEN', autoMergeRequest: state.armed ? { mergeMethod: 'SQUASH' } : null }) : ok(state.pr);
		if (args[0] === 'repo') return ok(state.repo);
		if (args[0] === 'api' && args[1].endsWith('/required_status_checks')) return state.protection ? ok(state.protection) : no;
		if (args[0] === 'api' && args[1].includes('/rules/branches/')) return ok(state.rules);
		if (args[0] === 'pr' && args[1] === 'merge') { state.armed = state.mergeStatus === 0; return { status: state.mergeStatus, stdout: '', stderr: state.mergeStatus ? 'refused' : '' }; }
		if (args[0] === 'release') return ok(state.release);
		return no;
	};
	return { root, work, config, state, run, sha, opts: { pr: 7, cwd: work, config, run } };
}
const merges = (s) => s.state.calls.filter((c) => c.startsWith('pr merge'));
const commitOnBranch = (s, file, text) => {
	fs.mkdirSync(path.dirname(path.join(s.work, file)), { recursive: true });
	fs.writeFileSync(path.join(s.work, file), text);
	sh(s.work, 'add', '-A', '--', file); sh(s.work, 'commit', '-qm', `change ${file}`);
	s.state.pr.headRefOid = sh(s.work, 'rev-parse', 'HEAD');
};

test('merge gate: a PR that passes every check is armed, pinned to the checked head, read back and logged', () => {
	const s = setup();
	const r = arm(s.opts);
	assert.equal(r.armed, true, r.faults.join('\n'));
	assert.deepEqual(merges(s), [`pr merge 7 --auto --squash --match-head-commit ${s.sha}`]);
	const log = fs.readFileSync(path.join(s.work, '.git', 'kit-merge-gate.log'), 'utf8');
	assert.match(log, new RegExp(`ARMED https://github.com/o/r/pull/7 ${s.sha} required=kit-tests`));
});

test('merge gate: check never arms, even on GO', () => {
	const s = setup();
	assert.equal(check(s.opts).go, true);
	assert.equal(merges(s).length, 0);
});

// Each case breaks one condition; the gate must say which and arm nothing.
const CASES = [
	['the kill switch', (s) => fs.writeFileSync(path.join(s.config, 'autonomy-off'), ''), /kill switch/],
	['a closed PR', (s) => { s.state.pr.state = 'CLOSED'; }, /not open/],
	['a draft', (s) => { s.state.pr.isDraft = true; }, /draft/],
	['a fork', (s) => { s.state.pr.isCrossRepository = true; }, /another repository/],
	['a working copy off the head', (s) => { s.state.pr.headRefOid = sh(s.work, 'rev-parse', 'HEAD~1'); }, /not the PR's head/],
	['auto-merge not allowed', (s) => { s.state.repo.autoMergeAllowed = false; }, /allow auto-merge/],
	['no branch delete on merge', (s) => { s.state.repo.deleteBranchOnMerge = false; }, /delete branches on merge/],
	['no required check', (s) => { s.state.protection = null; }, /requires no status check/],
	['a workflow change', (s) => commitOnBranch(s, '.github/workflows/ci.yml', 'x\n'), /gate or rule paths.*\.github\/workflows\/ci\.yml/],
	['a loaded rule change', (s) => commitOnBranch(s, 'AGENTS.md', 'x\n'), /gate or rule paths.*AGENTS\.md/],
	['no sweep report', (s) => fs.rmSync(path.join(s.work, 'reports'), { recursive: true }), /no sweep report/],
	['a report with no Covers line', (s) => fs.writeFileSync(path.join(s.work, 'reports/sweeps/sub.md'), report('feat/subtract', s.sha).replace(/- \*\*Covers:.*\n/, '')), /Covers/],
	['code changed after the sweep', (s) => commitOnBranch(s, 'math.txt', 'add\nsub\nmul\n'), /never reviewed: math\.txt/],
	['a sweep report that fails its audit', (s) => fs.writeFileSync(path.join(s.work, 'reports/sweeps/sub.md'), report('feat/subtract', s.sha, '\n| ID | Severity | Finding |\n|---|---|---|\n| S1 | high | leaks a token | DEFERRED |\n')), /fails its audit/],
	['a body that fails its audit', (s) => { s.state.pr.body = BODY.replace('- [x] The test', '- [ ] The test'); }, /live PR body fails/],
];
for (const [name, breakIt, want] of CASES) {
	test(`merge gate: ${name} is NO GO, with a triage report, and nothing is armed`, () => {
		const s = setup();
		breakIt(s);
		const r = arm(s.opts);
		assert.equal(r.armed, false);
		assert.ok(r.faults.some((f) => want.test(f)), r.faults.join('\n'));
		assert.equal(merges(s).length, 0);
		assert.match(fs.readFileSync(path.join(s.work, '.git', 'kit-merge-gate-triage.md'), 'utf8'), /NO GO for PR 7/);
	});
}

test('merge gate: a report may name the branch on its Scope line, as the fix example does', () => {
	const s = setup();
	fs.writeFileSync(path.join(s.work, 'reports/sweeps/sub.md'), report('feat/subtract', s.sha).replace('**Branch:**', '**Scope:**'));
	assert.equal(check(s.opts).go, true);
	fs.writeFileSync(path.join(s.work, 'reports/sweeps/sub.md'), report('feat/other', s.sha));
	assert.ok(check(s.opts).faults.some((f) => /names the branch feat\/subtract/.test(f)));
});

test('merge gate: a ruleset alone counts as the required check', () => {
	const s = setup();
	s.state.protection = null;
	s.state.rules = [{ type: 'required_status_checks', parameters: { required_status_checks: [{ context: 'kit-tests' }] } }];
	assert.equal(check(s.opts).go, true);
});

test('merge gate: only the release bump may follow the swept commit', () => {
	const s = setup();
	commitOnBranch(s, 'VERSION', '1.2.0\n');
	commitOnBranch(s, 'CHANGELOG.md', '# 1.2.0\n');
	const r = check(s.opts);
	assert.equal(r.go, true, r.faults.join('\n'));
});

test('merge gate: the nearest covered commit counts, so a later re-sweep report clears earlier fixes', () => {
	const s = setup();
	const first = s.sha;
	commitOnBranch(s, 'math.txt', 'add\nsub\nfixed\n');
	assert.equal(check(s.opts).go, false);
	fs.writeFileSync(path.join(s.work, 'reports/sweeps/sub-resweep.md'), report('feat/subtract', s.state.pr.headRefOid));
	const r = check(s.opts);
	assert.equal(r.go, true, r.faults.join('\n'));
	assert.notEqual(first, s.state.pr.headRefOid);
});

test('merge gate: a branch cannot weaken the PR-body audit it is read by', () => {
	const s = setup();
	commitOnBranch(s, '.claude/pr-body-audit-lean.mjs', 'process.exit(0);\n');
	fs.writeFileSync(path.join(s.work, 'reports/sweeps/sub.md'), report('feat/subtract', s.state.pr.headRefOid));
	s.state.pr.body = BODY.replace('- [x] The test', '- [ ] The test');
	const r = check(s.opts);
	assert.ok(r.faults.some((f) => /live PR body fails/.test(f)), r.faults.join('\n'));
});

test('merge gate: a merge gh refuses, or one it does not show armed, is reported, not logged', () => {
	const s = setup();
	s.state.mergeStatus = 1;
	const r = arm(s.opts);
	assert.equal(r.armed, false);
	assert.match(r.faults[0], /did not arm/);
	assert.equal(fs.existsSync(path.join(s.work, '.git', 'kit-merge-gate.log')), false);
});

test('merge gate: the protected paths cover workflows, the installed kit, project settings, hooks and loaded rules', () => {
	for (const p of ['.github/workflows/ci.yml', '.claude/settings.json', '.kit/autonomy.json', '.githooks/pre-push', 'AGENTS.md', 'CLAUDE.md', 'CLAUDE.local.md']) {
		assert.ok(PROTECTED.some((re) => re.test(p)), p);
	}
	for (const p of ['src/app.js', 'docs/AGENTS.md', 'rules/core.md']) assert.ok(!PROTECTED.some((re) => re.test(p)), p);
});

test('live body audit (I21): a published PR body is read back and audited by the base branch audit', () => {
	const s = setup();
	assert.equal(live({ kind: 'pr', id: 7, cwd: s.work, config: s.config, run: s.run }).ok, true);
	s.state.pr.body = BODY + '\nWritten with Claude.\n';
	const r = live({ kind: 'pr', id: 7, cwd: s.work, config: s.config, run: s.run });
	assert.equal(r.ok, false);
});

test('live body audit (I21): a published release body is read back and audited', () => {
	const s = setup();
	assert.equal(live({ kind: 'release', id: 'v1.2.0', cwd: s.work, config: s.config, run: s.run }).ok, true);
	s.state.release.body = 'Built with Claude -- fast.\n';
	const r = live({ kind: 'release', id: 'v1.2.0', cwd: s.work, config: s.config, run: s.run });
	assert.equal(r.ok, false);
	assert.ok(r.faults.some((f) => /AI or tool reference/.test(f)), r.faults.join('\n'));
});

// A bare program name on Windows is looked up in the working folder before PATH, so a branch could ship its own (G1).
test('merge gate: git and gh are found on PATH, never in the repo folder', () => {
	const s = setup();
	const name = process.platform === 'win32' ? 'gh.exe' : 'gh';
	const bin = path.join(s.root, 'bin');
	fs.mkdirSync(bin);
	fs.writeFileSync(path.join(bin, name), '');
	fs.chmodSync(path.join(bin, name), 0o755);
	fs.writeFileSync(path.join(s.work, name), '');
	fs.chmodSync(path.join(s.work, name), 0o755);
	assert.equal(toolPath('gh', s.work, { PATH: [s.work, '.', '', bin].join(path.delimiter) }), path.join(bin, name));
	assert.equal(toolPath('gh', s.work, { PATH: [s.work, '.'].join(path.delimiter) }), null);
});
test('merge gate: a program named like git, gh or node at the repo root stops the gate before it runs anything there', () => {
	for (const name of ['git.exe', 'GH.EXE', 'gh.cmd', 'git.com', 'node.exe', 'git.bat']) {
		const s = setup();
		fs.writeFileSync(path.join(s.work, name), '');
		const r = check(s.opts);
		assert.equal(r.go, false, name);
		assert.match(r.faults.join('\n'), /a program named like a tool/, name);
		assert.equal(s.state.calls.length, 0, `${name}: no gh call`);
	}
});

// A hook on the branch would run inside the gate's own fetch, and could move the base the gate reads (G2).
test('merge gate: no hook from the branch runs inside the gate', () => {
	const s = setup();
	const marker = path.join(s.root, 'hook-ran');
	// It only leaves a mark: a hook that moves a ref fires itself again, without end.
	const hook = `#!/bin/sh\necho ran > "${marker.split(path.sep).join('/')}"\n`;
	fs.mkdirSync(path.join(s.work, '.githooks'), { recursive: true });
	fs.writeFileSync(path.join(s.work, '.githooks', 'reference-transaction'), hook);
	fs.chmodSync(path.join(s.work, '.githooks', 'reference-transaction'), 0o755);
	sh(s.work, 'add', '-A', '--', '.githooks'); sh(s.work, 'commit', '-qm', 'hook');
	s.state.pr.headRefOid = sh(s.work, 'rev-parse', 'HEAD');
	sh(s.work, 'config', 'core.hooksPath', '.githooks');
	const base = spawnSync('git', ['-c', 'core.hooksPath=/dev/null', 'rev-parse', 'origin/main'], { cwd: s.work, encoding: 'utf8' }).stdout.trim();
	fs.rmSync(marker, { force: true });
	const origin = path.join(s.root, 'origin.git');
	const other = path.join(s.root, 'other');
	spawnSync('git', ['-c', 'core.hooksPath=/dev/null', 'clone', '-q', origin, other], { encoding: 'utf8' });
	spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'moved'], { cwd: other, encoding: 'utf8' });
	spawnSync('git', ['push', '-q', 'origin', 'main'], { cwd: other, encoding: 'utf8' });
	const moved = sh(other, 'rev-parse', 'HEAD');
	const r = check(s.opts);
	assert.equal(fs.existsSync(marker), false, 'the hook did not run');
	assert.equal(spawnSync('git', ['-c', 'core.hooksPath=/dev/null', 'rev-parse', 'origin/main'], { cwd: s.work, encoding: 'utf8' }).stdout.trim(), moved);
	assert.notEqual(moved, base);
	assert.equal(r.go, false);
	assert.match(r.faults.join('\n'), /\.githooks\/reference-transaction/);
});

// git prints a rename's new name only and quotes an unusual one, and Windows folds case, so a plain read misses all three (G3).
const moveOnBranch = (s, from, to) => {
	fs.mkdirSync(path.dirname(path.join(s.work, to)), { recursive: true });
	sh(s.work, 'mv', from, to); sh(s.work, 'commit', '-qm', `move ${from}`);
	s.state.pr.headRefOid = sh(s.work, 'rev-parse', 'HEAD');
	fs.writeFileSync(path.join(s.work, 'reports/sweeps/sub.md'), report('feat/subtract', s.state.pr.headRefOid));
};
test('merge gate: a protected path moved out, quoted by git or spelled in another case is still protected', () => {
	const accent = String.fromCharCode(0xe9);
	for (const file of [`.github/workflows/caf${accent}.yml`, `.claude/rules/${accent}.md`, '.GitHooks/post-checkout', '.GitHub/workflows/x.yml', '.CLAUDE/new.json', '.KIT/x.json']) {
		const s = setup();
		commitOnBranch(s, file, 'x\n');
		fs.writeFileSync(path.join(s.work, 'reports/sweeps/sub.md'), report('feat/subtract', s.state.pr.headRefOid));
		const r = check(s.opts);
		assert.match(r.faults.join('\n'), /gate or rule paths/, file);
	}
	const s = setup();
	sh(s.work, 'checkout', '-q', 'main');
	fs.mkdirSync(path.join(s.work, '.githooks'));
	fs.writeFileSync(path.join(s.work, '.githooks', 'pre-push'), 'x\n');
	sh(s.work, 'add', '-A', '--', '.githooks'); sh(s.work, 'commit', '-qm', 'hook'); sh(s.work, 'push', '-q', 'origin', 'main');
	sh(s.work, 'checkout', '-q', 'feat/subtract'); sh(s.work, 'merge', '-q', 'main', '-m', 'in');
	moveOnBranch(s, '.githooks/pre-push', 'moved/pre-push');
	const r = check(s.opts);
	assert.match(r.faults.join('\n'), /gate or rule paths[^\n]*\.githooks\/pre-push/);
});
test('merge gate: a rename onto the release bump files after the sweep is not the release bump', () => {
	const s = setup();
	commitOnBranch(s, 'math2.txt', 'x\n');
	fs.writeFileSync(path.join(s.work, 'reports/sweeps/sub.md'), report('feat/subtract', s.state.pr.headRefOid));
	sh(s.work, 'mv', 'math2.txt', 'VERSION'); sh(s.work, 'commit', '-qm', 'bump');
	s.state.pr.headRefOid = sh(s.work, 'rev-parse', 'HEAD');
	assert.match(check(s.opts).faults.join('\n'), /never reviewed: math2\.txt/);
});
// The kit's own source holds the gate, audits and guards under other paths, and installs them to every project (G5).
test('merge gate: in the kit source a change to what the gate rests on is the owner\'s merge', () => {
	for (const file of ['user/kit-tools/merge-gate.mjs', 'user/skills/pre-pr-sweep/audit.mjs', 'project/.claude/guard-outward.cjs', 'project/AGENTS.md', 'rules/core.md', 'scripts/kit.mjs', 'tests/kit.test.mjs', 'kit.config.json']) {
		const s = setup();
		sh(s.work, 'checkout', '-q', 'main');
		fs.mkdirSync(path.join(s.work, 'user/kit-tools'), { recursive: true });
		fs.writeFileSync(path.join(s.work, 'user/kit-tools/merge-gate.mjs'), 'x\n');
		sh(s.work, 'add', '-A', '--', 'user'); sh(s.work, 'commit', '-qm', 'kit'); sh(s.work, 'push', '-q', 'origin', 'main');
		sh(s.work, 'checkout', '-q', 'feat/subtract'); sh(s.work, 'merge', '-q', 'main', '-m', 'in');
		commitOnBranch(s, file, 'y\n');
		fs.writeFileSync(path.join(s.work, 'reports/sweeps/sub.md'), report('feat/subtract', s.state.pr.headRefOid));
		assert.match(check(s.opts).faults.join('\n'), /gate or rule paths/, file);
	}
	const s = setup();
	commitOnBranch(s, 'rules/core.md', 'y\n');
	fs.writeFileSync(path.join(s.work, 'reports/sweeps/sub.md'), report('feat/subtract', s.state.pr.headRefOid));
	assert.doesNotMatch(check(s.opts).faults.join('\n'), /gate or rule paths/, 'a project\'s own rules folder is not the kit\'s');
});
