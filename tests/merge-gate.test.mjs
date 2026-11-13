// Tests for the merge gate (user/kit-tools/merge-gate.mjs): a real git repo with a bare origin, the kit's real
// audits, and a fake gh that answers from a state object and records every call.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import kitTemp from '../project/.claude/kit-temp.cjs';
import { check, arm, disarm, autofix, live, status, PROTECTED, toolPath } from '../user/kit-tools/merge-gate.mjs';

// Every temp folder a test makes lands under this one root, removed at exit: os.tmpdir() reads these on each call and children inherit them.
// kit-temp.cjs also removes it on a signal, and the next run sweeps it after a kill.
const tmpRoot = kitTemp.sessionRoot();
const { makeTemp } = kitTemp;

const KIT = path.resolve('.');
// The test's own git runs no hooks: the work repo's pre-push is the gate's hold, not a step of the test.
const sh = (cwd, ...a) => {
	const r = spawnSync('git', ['-c', 'core.hooksPath=/dev/null', ...a], { cwd, encoding: 'utf8' });
	if (r.status !== 0) throw new Error(`git ${a.join(' ')}: ${r.stderr}`);
	return r.stdout.trim();
};
const TITLE = 'feat: add a subtract function';
const BODY = '## Math: add a subtract function\n\nThe math module can now subtract.\n\n**Changes**\n- New `sub(a, b)` export.\n\n**Gates**\n- [x] The test passes.\n- [x] Full local gate green.\n- [x] Sweep by dimension: privacy, supply chain, legal, code security; no secrets or account information.\n\n**Notes** - none.\n';
const report = (branch, sha, extra = '') => `# Sweep: subtract\n\n- **Tier:** feature\n- **Date:** 2026-11-05\n- **Branch:** ${branch} at ${sha.slice(0, 7)}\n- **Covers:** ${sha}\n\n## Result\nPrivacy: clean. Supply chain: clean. Legal: clean. Security: clean. Gaps and scaling: clean.\nVersion goal alignment: YES\n${extra}`;

// approve.mjs's log: each line chained to the one before, in the repo's git folder.
const logSha = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);
function appendLog(work, entry) {
	const f = path.join(work, '.git', 'kit-sweep-approvals.jsonl');
	const lines = fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean) : [];
	fs.appendFileSync(f, JSON.stringify({ time: '2026-11-05T00:00:00.000Z', ...entry, prev: lines.length ? logSha(lines[lines.length - 1]) : '' }) + '\n');
}
function cleared(work, sha, decision = {}, outcome = {}) {
	const contract = path.join(work, 'reports/sweeps/c.json');
	appendLog(work, { kind: 'decision', contract, hash: 'c', tier: 'feature', agents: 1, decision: 'approved', head: sha, ...decision });
	if (outcome) appendLog(work, { kind: 'outcome', contract, tokens: 10, ...outcome });
}

function setup() {
	const root = makeTemp('merge-gate-');
	// Named as GitHub names it, so the gate's check that origin is the PR's repo reads it as o/r.
	const origin = path.join(root, 'github.com', 'o', 'r.git');
	const work = path.join(root, 'work');
	const config = path.join(root, 'config');
	sh(root, 'init', '-q', '--bare', '-b', 'main', origin);
	sh(root, 'clone', '-q', origin, work);
	sh(work, 'config', 'user.name', 't'); sh(work, 'config', 'user.email', 't@t');
	// The push hold the kit installs, outside the repo as install puts it.
	const hooks = path.join(root, 'kit-hooks');
	fs.mkdirSync(hooks);
	fs.copyFileSync(path.join(KIT, 'project/.githooks/pre-push'), path.join(hooks, 'pre-push'));
	sh(work, 'config', 'core.hooksPath', hooks);
	sh(work, 'checkout', '-q', '-b', 'main');
	fs.mkdirSync(path.join(work, '.claude'));
	for (const f of fs.readdirSync(path.join(KIT, 'project/.claude'))) {
		if (/\.(mjs|cjs|json)$/.test(f)) fs.copyFileSync(path.join(KIT, 'project/.claude', f), path.join(work, '.claude', f));
	}
	fs.writeFileSync(path.join(work, 'math.txt'), 'add\n');
	// The project's consent to the grant (adapter row A27).
	fs.mkdirSync(path.join(work, 'standards'));
	fs.writeFileSync(path.join(work, 'standards', 'project-adapter.md'), '| Row | Field | Rule | Value |\n|---|---|---|---|\n| A27 | Standing grants | Standing Grants | `merge through the merge gate; auto-fix push` |\n');
	sh(work, 'add', '-A'); sh(work, 'commit', '-qm', 'base'); sh(work, 'push', '-q', 'origin', 'main');
	sh(work, 'checkout', '-q', '-b', 'feat/subtract');
	fs.writeFileSync(path.join(work, 'math.txt'), 'add\nsub\n');
	sh(work, 'commit', '-qam', 'sub'); sh(work, 'push', '-q', 'origin', 'feat/subtract');
	const sha = sh(work, 'rev-parse', 'HEAD');
	fs.mkdirSync(path.join(work, 'reports', 'sweeps'), { recursive: true });
	fs.writeFileSync(path.join(work, 'reports', 'sweeps', 'sub.md'), report('feat/subtract', sha));
	cleared(work, sha);
	for (const s of ['pre-pr-sweep', 'release-notes']) {
		fs.mkdirSync(path.join(config, 'skills', s), { recursive: true });
		fs.copyFileSync(path.join(KIT, 'user/skills', s, 'audit.mjs'), path.join(config, 'skills', s, 'audit.mjs'));
	}
	const state = {
		pr: { number: 7, state: 'OPEN', isDraft: false, isCrossRepository: false, headRefName: 'feat/subtract', headRefOid: sha, baseRefName: 'main', title: TITLE, body: BODY, url: 'https://github.com/o/r/pull/7' },
		repo: { full_name: 'o/r', html_url: 'https://github.com/o/r', allow_auto_merge: true, delete_branch_on_merge: true },
		baseTip: null,
		protection: { contexts: ['kit-tests'], checks: [], strict: true },
		rules: [],
		release: { tagName: 'v1.2.0', body: 'Plans now sync between devices.\n' },
		mergeStatus: 0,
		armOnMerge: true,
		disarmHolds: true,
		armed: false,
		calls: [],
	};
	const run = (cmd, args, cwd, env) => {
		if (cmd !== 'gh') {
			const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', env: env ? { ...process.env, ...env } : process.env });
			return { status: r.status ?? 1, stdout: r.stdout || '', stderr: r.stderr || '' };
		}
		state.calls.push(args.join(' '));
		const ok = (o) => ({ status: 0, stdout: JSON.stringify(o), stderr: '' });
		const no = { status: 1, stdout: '', stderr: 'HTTP 404' };
		// Like the real gh, it answers only the fields asked for, so a field dropped from a list goes missing here too.
		if (args[0] === 'pr' && args[1] === 'view' && state.readBackFails && args.includes('autoMergeRequest,state')) return no;
		if (args[0] === 'pr' && args[1] === 'view') {
			const full = { state: 'OPEN', ...state.pr, autoMergeRequest: state.armed ? { mergeMethod: 'SQUASH' } : null };
			return ok(Object.fromEntries(args[args.indexOf('--json') + 1].split(',').filter((k) => k in full).map((k) => [k, full[k]])));
		}
		if (args[0] === 'api' && args[1] === 'repos/{owner}/{repo}') return state.repo ? ok(state.repo) : no;
		// The paths are matched whole, so a wrong name in them reads nothing, as on GitHub; a base with a slash in its
		// name is sent encoded.
		const b = encodeURIComponent(state.pr.baseRefName);
		if (args[0] === 'api' && args[1] === `repos/o/r/branches/${b}/protection/required_status_checks`) return state.protection ? ok(state.protection) : no;
		if (args[0] === 'api' && args[1] === `repos/o/r/rules/branches/${b}`) return ok(state.rules);
		if (args[0] === 'api' && args[1] === `repos/o/r/branches/${b}`) {
			return ok({ commit: { sha: state.baseTip ?? spawnSync('git', ['rev-parse', `refs/remotes/origin/${state.pr.baseRefName}`], { cwd, encoding: 'utf8' }).stdout.trim() } });
		}
		if (args[0] === 'pr' && args[1] === 'merge' && args.includes('--disable-auto')) { if (state.disarmHolds) state.armed = false; return { status: 0, stdout: '', stderr: '' }; }
		if (args[0] === 'pr' && args[1] === 'merge') { state.armed = state.mergeStatus === 0 && state.armOnMerge; return { status: state.mergeStatus, stdout: '', stderr: state.mergeStatus ? 'refused' : '' }; }
		if (args[0] === 'release') return ok(Object.fromEntries(args[args.indexOf('--json') + 1].split(',').filter((k) => k in state.release).map((k) => [k, state.release[k]])));
		return no;
	};
	// localOrigin: origin here is a local folder named as GitHub names the repo; only a test passes it.
	return { root, work, config, state, run, sha, opts: { pr: 7, cwd: work, config, run, localOrigin: true } };
}
const merges = (s) => s.state.calls.filter((c) => c.startsWith('pr merge'));
// A change made on the base and merged into the branch, with the branch's sweep moved to the new head.
function changeBase(s, change) {
	sh(s.work, 'checkout', '-q', 'main');
	change();
	sh(s.work, 'add', '-A'); sh(s.work, 'commit', '-qm', 'base change'); sh(s.work, 'push', '-q', 'origin', 'main');
	sh(s.work, 'checkout', '-q', 'feat/subtract'); sh(s.work, 'merge', '-q', 'main', '-m', 'in');
	s.state.pr.headRefOid = sh(s.work, 'rev-parse', 'HEAD');
	cleared(s.work, s.state.pr.headRefOid);
	rewrite(s, report('feat/subtract', s.state.pr.headRefOid));
}
const commitOnBranch = (s, file, text, clear = true) => {
	fs.mkdirSync(path.dirname(path.join(s.work, file)), { recursive: true });
	fs.writeFileSync(path.join(s.work, file), text);
	sh(s.work, 'add', '-A', '--', file); sh(s.work, 'commit', '-qm', `change ${file}`);
	s.state.pr.headRefOid = sh(s.work, 'rev-parse', 'HEAD');
	if (clear) cleared(s.work, s.state.pr.headRefOid);
};

// The 1.22.0 sweep (N1): the strict up-to-date check makes a branch take main after its sweep. What main brought is
// not the branch's change; an edit made inside the merge still is.
const mainMoves = (s) => {
	sh(s.work, 'checkout', '-q', 'main');
	fs.writeFileSync(path.join(s.work, 'other-pr.txt'), 'another PR\n');
	sh(s.work, 'add', 'other-pr.txt'); sh(s.work, 'commit', '-qm', 'another PR lands'); sh(s.work, 'push', '-q', 'origin', 'main');
	sh(s.work, 'checkout', '-q', 'feat/subtract');
};
// why: guards rule:standing-grants
test('merge gate: a branch brought up to date with main after its sweep still arms, unless the merge edits something', () => {
	const s = setup();
	mainMoves(s);
	sh(s.work, 'merge', '-q', 'main', '-m', 'take main');
	s.state.pr.headRefOid = sh(s.work, 'rev-parse', 'HEAD');
	const r = arm(s.opts);
	assert.equal(r.armed, true, r.faults.join('\n'));
	const t = setup();
	mainMoves(t);
	sh(t.work, 'merge', '-q', '--no-commit', 'main');
	fs.writeFileSync(path.join(t.work, 'other-pr.txt'), 'changed inside the merge\n');
	sh(t.work, 'add', 'other-pr.txt'); sh(t.work, 'commit', '-qm', 'take main');
	t.state.pr.headRefOid = sh(t.work, 'rev-parse', 'HEAD');
	const n = check(t.opts);
	assert.equal(n.go, false);
	assert.match(n.faults.join('\n'), /changed after the sweep covered .* other-pr\.txt/);
});
// why: guards rule:standing-grants
test('merge gate: a PR that passes every check is armed, pinned to the checked head, read back and logged', () => {
	const s = setup();
	const r = arm(s.opts);
	assert.equal(r.armed, true, r.faults.join('\n'));
	assert.deepEqual(merges(s), [`pr merge 7 --auto --squash --match-head-commit ${s.sha}`]);
	const log = fs.readFileSync(path.join(s.work, '.git', 'kit-merge-gate.log'), 'utf8');
	assert.match(log, new RegExp(`ARMED https://github.com/o/r/pull/7 ${s.sha} required=kit-tests`));
});

// The second pass on 1.25.1 (role 4): with V3 the hooks folder holds the kit's shims, which check the guards from outside
// and then exec the project's .githooks/pre-push. The hold is read through the shim, so the gate still arms.
// why: guards rule:standing-grants
test('merge gate: under the kit\'s hook shims the push hold is read in the hook the shim runs', () => {
	const s = setup();
	const own = path.join(s.root, 'own-hooks');
	fs.mkdirSync(own);
	fs.copyFileSync(path.join(KIT, 'project/.githooks/pre-push'), path.join(own, 'pre-push'));
	const target = `${own.split(path.sep).join('/')}/pre-push`.replace(/'/g, `'\\''`);
	const shim = (to) => ['#!/bin/sh', '# The kit\'s hook shim (V3): the guard files are checked from outside the project before the project\'s hook runs.', 'NODE_OPTIONS=; export NODE_OPTIONS', `exec '${to}' "$@"`, ''].join('\n');
	fs.writeFileSync(path.join(s.root, 'kit-hooks', 'pre-push'), shim(target));
	const r = arm(s.opts);
	assert.equal(r.armed, true, r.faults.join('\n'));
	const t = setup();
	fs.writeFileSync(path.join(t.root, 'own-hooks-pre-push'), '#!/bin/sh\nexit 0\n');
	fs.writeFileSync(path.join(t.root, 'kit-hooks', 'pre-push'), shim(`${t.root.split(path.sep).join('/')}/own-hooks-pre-push`));
	const n = arm(t.opts);
	assert.equal(n.armed, false);
	assert.ok(n.faults.some((f) => /no push hold: .*own-hooks-pre-push does not stop/.test(f)), n.faults.join('\n'));
});

// M30: the canned gh above can answer in shapes the real gh never gives. The field names are checked live below;
// this holds each canned answer's types, and the api answers' shapes, to what the real gh said (recorded by
// scripts/record-gh-contracts.mjs; re-record after a gh upgrade).
// why: guards rule:standing-grants
test('merge gate: the canned gh answers with the types and shapes the real gh gave for every read the gate makes', () => {
	const rec = JSON.parse(fs.readFileSync(path.join(KIT, 'tests/contracts/gh.json'), 'utf8'));
	const src = fs.readFileSync(path.join(KIT, 'user/kit-tools/merge-gate.mjs'), 'utf8');
	const fake = setup().state;
	const type = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);
	for (const list of new Set([...src.matchAll(/'--json', '([^']+)'/g)].map((m) => m[1]))) {
		const c = rec.calls.find((x) => x.args.includes(list));
		assert.ok(c, `no real answer recorded for --json ${list}: run scripts/record-gh-contracts.mjs`);
		assert.equal(c.status, 0, `real ${rec.version} refused --json ${list}: ${c.stderr}`);
		const canned = list.includes('tagName') ? fake.release : { state: 'OPEN', autoMergeRequest: null, statusCheckRollup: [], reviewDecision: '', labels: [], ...fake.pr };
		for (const k of list.split(',')) {
			if (k !== 'autoMergeRequest') assert.equal(type(canned[k]), type(c.json[k]), `${k} is a ${type(c.json[k])} in real gh`);
		}
	}
	const call = (end) => {
		const c = rec.calls.find((x) => x.args[0] === 'api' && x.args[1] === (end.startsWith('repos/') ? end : `repos/o/r${end}`));
		assert.ok(c, `no real answer recorded for api ${end}`);
		return c;
	};
	const api = (end) => {
		const c = call(end);
		assert.equal(c.status, 0, `real api ...${end}: ${c.stderr}`);
		return c.json;
	};
	const repo = api('repos/{owner}/{repo}');
	for (const k of Object.keys(fake.repo)) assert.equal(type(repo[k]), type(fake.repo[k]), `repo ${k} is a ${type(repo[k])} in real gh`);
	// A base held by a ruleset alone has no classic protection: GitHub answers 404, and the gate reads the rules.
	const prot = call('/branches/main/protection/required_status_checks');
	if (prot.status === 0) for (const k of Object.keys(fake.protection)) assert.equal(type(prot.json[k]), 'array', `protection ${k}`);
	else assert.match(prot.stderr, /HTTP 404/);
	const rules = api('/rules/branches/main');
	assert.equal(type(rules), 'array');
	const needed = rules.filter((r) => r.type === 'required_status_checks').flatMap((r) => r.parameters.required_status_checks);
	assert.ok(prot.status === 0 || needed.length, 'the real base names its required checks in protection or a ruleset');
	for (const c of needed) assert.equal(type(c.context), 'string');
	assert.match(api('/branches/main').commit.sha, /^[0-9a-f]{40}$/);
});

// why: guards rule:standing-grants
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
	['a failed repo read', (s) => { s.state.repo = null; }, /could not read the repository/],
	['a repo read that lands on another repo', (s) => { s.state.repo.html_url = 'https://github.com/x/y'; }, /not the repo of PR 7/],
	['a repo whose name starts the same as the PR repo', (s) => { s.state.pr.url = 'https://github.com/o/r2/pull/7'; }, /not the repo of PR 7/],
	['a repo read with no address', (s) => { delete s.state.repo.html_url; }, /not the repo of PR 7/],
	['a same-named repo on another host', (s) => { s.state.pr.url = 'https://ghe.example/o/r/pull/7'; }, /not the repo of PR 7/],
	['a repo name that is not owner/name', (s) => { s.state.repo.full_name = 'o/r?x=1#'; }, /not the repo of PR 7/],
	['settings this login cannot see', (s) => { delete s.state.repo.allow_auto_merge; delete s.state.repo.delete_branch_on_merge; }, /cannot read/],
	['a setting that is not true', (s) => { s.state.repo.allow_auto_merge = 'false'; }, /allow auto-merge/],
	['a branch delete setting that is not true', (s) => { s.state.repo.delete_branch_on_merge = 'false'; }, /delete branches on merge/],
	['a base moved locally with no fetch refspec', (s) => {
		commitOnBranch(s, '.github/x.yml', 'x\n');
		sh(s.work, 'config', '--unset-all', 'remote.origin.fetch');
		sh(s.work, 'update-ref', 'refs/remotes/origin/main', s.state.pr.headRefOid);
	}, /gate or rule paths/],
	['a tag named like the base, at the head', (s) => {
		commitOnBranch(s, '.github/x.yml', 'x\n');
		sh(s.work, 'tag', 'origin/main', s.state.pr.headRefOid);
	}, /gate or rule paths/],
	['a replace ref that hides the head', (s) => {
		const clean = s.sha;
		commitOnBranch(s, '.github/x.yml', 'x\n');
		sh(s.work, 'replace', s.state.pr.headRefOid, clean);
	}, /gate or rule paths/],
	['a grafts file', (s) => {
		fs.mkdirSync(path.join(s.work, '.git', 'info'), { recursive: true });
		fs.writeFileSync(path.join(s.work, '.git', 'info', 'grafts'), `${s.sha}\n`);
	}, /grafts/],
	['a failed read of the base tip', (s) => { s.state.baseTip = ''; }, /could not read the tip/],
	['an origin that is another repo', (s) => {
		const other = path.join(s.root, 'other.git');
		sh(s.root, 'clone', '-q', '--bare', path.join(s.root, 'github.com', 'o', 'r.git'), other);
		sh(s.work, 'push', '-q', other, 'HEAD:main');
		s.state.baseTip = sh(s.work, 'rev-parse', 'refs/remotes/origin/main');
		sh(s.work, 'remote', 'set-url', 'origin', other);
	}, /GitHub's base/],
	['auto-merge not allowed', (s) => { s.state.repo.allow_auto_merge = false; }, /allow auto-merge/],
	['no branch delete on merge', (s) => { s.state.repo.delete_branch_on_merge = false; }, /delete branches on merge/],
	['no required check', (s) => { s.state.protection = null; }, /requires no status check/],
	['a workflow change', (s) => commitOnBranch(s, '.github/workflows/ci.yml', 'x\n'), /gate or rule paths.*\.github\/workflows\/ci\.yml/],
	['a loaded rule change', (s) => commitOnBranch(s, 'AGENTS.md', 'x\n'), /gate or rule paths.*AGENTS\.md/],
	['no sweep report', (s) => fs.rmSync(path.join(s.work, 'reports'), { recursive: true }), /no sweep report/],
	['a report with no Covers line', (s) => fs.writeFileSync(path.join(s.work, 'reports/sweeps/sub.md'), report('feat/subtract', s.sha).replace(/- \*\*Covers:.*\n/, '')), /Covers/],
	['code changed after the sweep', (s) => commitOnBranch(s, 'math.txt', 'add\nsub\nmul\n'), /never reviewed: math\.txt/],
	['a sweep report that fails its audit', (s) => fs.writeFileSync(path.join(s.work, 'reports/sweeps/sub.md'), report('feat/subtract', s.sha, '\n| ID | Severity | Finding |\n|---|---|---|\n| S1 | high | leaks a token | DEFERRED |\n')), /fails its audit/],
	['a body that fails its audit', (s) => { s.state.pr.body = BODY.replace('- [x] The test', '- [ ] The test'); }, /live PR body fails/],
	// 1.22.0: the 1.21.0 and 1.21.1 carry-overs, each a way the gate could arm what it should not.
	['a read that leaves out the draft field', (s) => { delete s.state.pr.isDraft; }, /draft/],
	['a read that leaves out the fork field', (s) => { delete s.state.pr.isCrossRepository; }, /another repository/],
	['a check whose result went stale', (s) => { s.state.pr.statusCheckRollup = [{ name: 'kit-tests', status: 'COMPLETED', conclusion: 'STALE' }]; }, /checks are failing: kit-tests/],
	['a required-check answer of the wrong shape', (s) => { s.state.protection = { contexts: 'kit-tests', checks: null }; }, /could not read the required checks/],
	['a base that does not need the branch up to date', (s) => { s.state.protection.strict = false; }, /up to date/],
	['a link named like a gate folder', (s) => {
		const blob = sh(s.work, 'hash-object', '-w', 'math.txt');
		sh(s.work, 'update-index', '--add', '--cacheinfo', `120000,${blob},.githooks`);
		sh(s.work, 'commit', '-qm', 'link');
		s.state.pr.headRefOid = sh(s.work, 'rev-parse', 'HEAD');
		cleared(s.work, s.state.pr.headRefOid);
	}, /gate or rule paths.*\.githooks/],
	['an uncommitted change in the working copy', (s) => fs.writeFileSync(path.join(s.work, 'math.txt'), 'add\nsub\nlocal\n'), /uncommitted/],
	// The 1.22.0 sweep (G5): an index flag hides an edit from git status, and the audits would read the edited text.
	...['--assume-unchanged', '--skip-worktree'].map((flag) => [`a tracked file hidden by ${flag}`, (s) => { sh(s.work, 'update-index', flag, 'math.txt'); fs.writeFileSync(path.join(s.work, 'math.txt'), 'add\nsub\nhidden\n'); }, /hides math\.txt/]),
	['a clearing logged by a short hash', (s) => { freshLog(s); cleared(s.work, s.sha.slice(0, 7)); }, /never cleared/],
	['no push hold', (s) => sh(s.work, 'config', '--unset', 'core.hooksPath'), /no push hold: core\.hooksPath is not set/],
	// Handoff item 17: the owner's allow rule reaches every repo; each project consents in its own adapter.
	['a project whose adapter grants no merge', (s) => changeBase(s, () => fs.writeFileSync(path.join(s.work, 'standards', 'project-adapter.md'), '| A27 | Standing grants | Standing Grants | `none` |\n')), /A27 on the base grants no merge \(none\)/],
	['a base with no adapter', (s) => changeBase(s, () => sh(s.work, 'rm', '-q', 'standards/project-adapter.md')), /names no standing grant/],
	// The 1.22.0 sweep (G2): a row that names merge only to refuse it grants nothing.
	...['auto-fix push only; no merge', 'autofix: yes, merge: no', 'never merge', 'not yet (merge after v2)', 'merge: none'].map((v) => [`a grant row that refuses merge in words: ${v}`, (s) => changeBase(s, () => fs.writeFileSync(path.join(s.work, 'standards', 'project-adapter.md'), `| A27 | Standing grants | Standing Grants | \`${v}\` |\n`)), /A27 on the base grants no merge/]),
	// The 1.22.0 sweep (G1): once the base grants merge, a PR that rewrites the grant is the owner's to merge.
	['a PR that changes the grant row itself', (s) => {
		commitOnBranch(s, 'standards/project-adapter.md', '| A27 | Standing grants | Standing Grants | `merge through the merge gate; auto-fix push; release` |\n');
		rewrite(s, report('feat/subtract', s.state.pr.headRefOid));
	}, /gate or rule paths.*standards\/project-adapter\.md/],
	['a grant written on the branch only', (s) => {
		changeBase(s, () => fs.writeFileSync(path.join(s.work, 'standards', 'project-adapter.md'), '| A27 | Standing grants | Standing Grants | `none` |\n'));
		commitOnBranch(s, 'standards/project-adapter.md', '| A27 | Standing grants | Standing Grants | `merge gate` |\n');
		rewrite(s, report('feat/subtract', s.state.pr.headRefOid));
	}, /grants no merge/],
	['a pre-push hook that does not hold an armed head', (s) => fs.writeFileSync(path.join(s.root, 'kit-hooks', 'pre-push'), '#!/bin/sh\nexit 0\n'), /no push hold: .*pre-push does not stop/],
	['a check name that would write its own triage lines', (s) => { s.state.pr.statusCheckRollup = [{ name: 'ci\n# GO: all clear', status: 'COMPLETED', conclusion: 'FAILURE' }]; }, /checks are failing: ci # GO: all clear/],
	['a setting file excluded only in this clone', (s) => {
		fs.mkdirSync(path.join(s.work, '.kit'), { recursive: true });
		fs.writeFileSync(path.join(s.work, '.kit', 'pr-body.json'), '{"gates":[]}');
		fs.appendFileSync(path.join(s.work, '.git', 'info', 'exclude'), '.kit/\n');
	}, /pr-body\.json.*this clone/],
];
// S22-G6 (the 1.22.0 sweep): GIT_CONFIG_COUNT and GIT_CONFIG_PARAMETERS set config for every git this session runs,
// pushes included, and git names their origin "command line:", which the hold check skips as its own override.
// why: guards rule:standing-grants
test('merge gate: a hooks folder set through the environment is NO GO, as a push would use it', () => {
	for (const env of [
		{ GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.hooksPath', GIT_CONFIG_VALUE_0: '/nowhere' },
		{ GIT_CONFIG_PARAMETERS: "'core.hooksPath'='/nowhere'" },
	]) {
		const s = setup();
		const saved = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
		Object.assign(process.env, env);
		try {
			const r = arm(s.opts);
			assert.equal(r.armed, false, JSON.stringify(env));
			assert.ok(r.faults.some((f) => /no push hold: core\.hooksPath is set in this session's environment/.test(f)), r.faults.join('\n'));
		} finally {
			for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
		}
	}
});

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

// why: guards rule:standing-grants
test('merge gate: a report may name the branch on its Scope line, as the fix example does', () => {
	const s = setup();
	fs.writeFileSync(path.join(s.work, 'reports/sweeps/sub.md'), report('feat/subtract', s.sha).replace('**Branch:**', '**Scope:**'));
	assert.equal(check(s.opts).go, true);
	fs.writeFileSync(path.join(s.work, 'reports/sweeps/sub.md'), report('feat/other', s.sha));
	assert.ok(check(s.opts).faults.some((f) => /names the branch feat\/subtract/.test(f)));
});

// why: guards rule:standing-grants
test('merge gate: a ruleset alone counts as the required check', () => {
	const s = setup();
	s.state.protection = null;
	s.state.rules = [{ type: 'required_status_checks', parameters: { strict_required_status_checks_policy: true, required_status_checks: [{ context: 'kit-tests' }] } }];
	assert.equal(check(s.opts).go, true);
});

// why: guards rule:standing-grants
test('merge gate: only the release bump may follow the swept commit', () => {
	const s = setup();
	commitOnBranch(s, 'VERSION', '1.2.0\n');
	commitOnBranch(s, 'CHANGELOG.md', '# 1.2.0\n');
	const r = check(s.opts);
	assert.equal(r.go, true, r.faults.join('\n'));
});

// why: guards rule:standing-grants
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

// why: guards rule:standing-grants
test('merge gate: a branch cannot weaken the PR-body audit it is read by', () => {
	const s = setup();
	commitOnBranch(s, '.claude/pr-body-audit-lean.mjs', 'process.exit(0);\n');
	fs.writeFileSync(path.join(s.work, 'reports/sweeps/sub.md'), report('feat/subtract', s.state.pr.headRefOid));
	s.state.pr.body = BODY.replace('- [x] The test', '- [ ] The test');
	const r = check(s.opts);
	assert.ok(r.faults.some((f) => /live PR body fails/.test(f)), r.faults.join('\n'));
});

// why: guards rule:standing-grants
test('merge gate: a merge gh refuses, or one it does not show armed, is reported, not logged', () => {
	const s = setup();
	s.state.mergeStatus = 1;
	const r = arm(s.opts);
	assert.equal(r.armed, false);
	assert.match(r.faults[0], /did not arm/);
	assert.equal(fs.existsSync(path.join(s.work, '.git', 'kit-merge-gate.log')), false);
});

// why: guards rule:standing-grants
test('merge gate: the protected paths cover workflows, the installed kit, project settings, hooks and loaded rules', () => {
	for (const p of ['.github/workflows/ci.yml', '.claude/settings.json', '.kit/autonomy.json', '.githooks/pre-push', 'AGENTS.md', 'CLAUDE.md', 'CLAUDE.local.md']) {
		assert.ok(PROTECTED.some((re) => re.test(p)), p);
	}
	for (const p of ['src/app.js', 'docs/AGENTS.md', 'rules/core.md']) assert.ok(!PROTECTED.some((re) => re.test(p)), p);
});

// why: guards rule:standing-grants
test('live body audit (I21): a published PR body is read back and audited by the base branch audit', () => {
	const s = setup();
	assert.equal(live({ kind: 'pr', id: 7, cwd: s.work, config: s.config, run: s.run }).ok, true);
	s.state.pr.body = BODY + '\nWritten with Claude.\n';
	const r = live({ kind: 'pr', id: 7, cwd: s.work, config: s.config, run: s.run });
	assert.equal(r.ok, false);
});

// why: guards rule:standing-grants
test('live body audit (I21): a published release body is read back and audited', () => {
	const s = setup();
	assert.equal(live({ kind: 'release', id: 'v1.2.0', cwd: s.work, config: s.config, run: s.run }).ok, true);
	s.state.release.body = 'Built with Claude -- fast.\n';
	const r = live({ kind: 'release', id: 'v1.2.0', cwd: s.work, config: s.config, run: s.run });
	assert.equal(r.ok, false);
	assert.ok(r.faults.some((f) => /AI or tool reference/.test(f)), r.faults.join('\n'));
});

// A bare program name on Windows is looked up in the working folder before PATH, so a branch could ship its own (G1).
// why: guards rule:standing-grants
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
// why: guards rule:standing-grants
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
// why: guards rule:standing-grants
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
	const origin = path.join(s.root, 'github.com', 'o', 'r.git');
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
// why: guards rule:standing-grants
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
// why: guards rule:standing-grants
test('merge gate: a rename onto the release bump files after the sweep is not the release bump', () => {
	const s = setup();
	commitOnBranch(s, 'math2.txt', 'x\n');
	fs.writeFileSync(path.join(s.work, 'reports/sweeps/sub.md'), report('feat/subtract', s.state.pr.headRefOid));
	sh(s.work, 'mv', 'math2.txt', 'VERSION'); sh(s.work, 'commit', '-qm', 'bump');
	s.state.pr.headRefOid = sh(s.work, 'rev-parse', 'HEAD');
	assert.match(check(s.opts).faults.join('\n'), /never reviewed: math2\.txt/);
});
// The kit's own source holds the gate, audits and guards under other paths, and installs them to every project (G5).
// why: guards rule:standing-grants
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

// What the approval log must show for a report to count (G4): the sweep was cleared at the commit it covers, and ran.
const rewrite = (s, text) => fs.writeFileSync(path.join(s.work, 'reports/sweeps/sub.md'), text);
const freshLog = (s) => fs.rmSync(path.join(s.work, '.git', 'kit-sweep-approvals.jsonl'), { force: true });
const NO_GO = [
	['a report with no clearance in the log', (s) => freshLog(s), /never cleared/],
	['a sweep cleared but never run', (s) => { freshLog(s); cleared(s.work, s.sha, {}, null); }, /no reviewer outcome/],
	['a sweep closed as none ran', (s) => { freshLog(s); cleared(s.work, s.sha, {}, { noneRan: true }); }, /no reviewer outcome/],
	['a sweep cut short', (s) => { freshLog(s); cleared(s.work, s.sha, {}, null); appendLog(s.work, { kind: 'unread', contract: path.join(s.work, 'reports/sweeps/c.json') }); }, /no reviewer outcome/],
	['a log changed by hand', (s) => { const f = path.join(s.work, '.git', 'kit-sweep-approvals.jsonl'); fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('"tier":"feature"', '"tier":"triage"')); }, /changed by hand/],
	['a report that names a lower tier than was cleared', (s) => rewrite(s, report('feat/subtract', s.sha).replace('**Tier:** feature', '**Tier:** triage')), /tier/],
	['an owner acceptance typed in the report', (s) => rewrite(s, report('feat/subtract', s.sha, '\n- **S1 (high)** leak. ACCEPTED owner ships today anyway\n')), /the owner's/],
	['a retyped Covers line on code no sweep cleared', (s) => { commitOnBranch(s, 'math.txt', 'add\nsub\nmore\n', false); rewrite(s, report('feat/subtract', s.state.pr.headRefOid)); }, /never cleared/],
	['a report for a branch whose name holds this one', (s) => rewrite(s, report('feat/subtract-2', s.sha)), /no sweep report/],
	['a clean file beside a report with an open high', (s) => {
		rewrite(s, report('feat/subtract', s.sha, '\n| ID | Severity | Finding |\n|---|---|---|\n| S1 | high | leaks a token | OPEN |\n'));
		fs.writeFileSync(path.join(s.work, 'reports/sweeps/a-clean.md'), report('feat/subtract', s.sha));
	}, /fails its audit/],
	['a failing check on the PR', (s) => { s.state.pr.statusCheckRollup = [{ name: 'lint', status: 'COMPLETED', conclusion: 'FAILURE' }]; }, /failing: lint/],
	['a failed status on the PR', (s) => { s.state.pr.statusCheckRollup = [{ context: 'ci/x', state: 'ERROR' }]; }, /failing: ci\/x/],
	['a fetch that fails', (s) => sh(s.work, 'remote', 'set-url', 'origin', path.join(s.root, 'gone.git')), /could not fetch/],
	['an untracked audit setting', (s) => { fs.mkdirSync(path.join(s.work, '.kit')); fs.writeFileSync(path.join(s.work, '.kit/version-bump.json'), '{"shipped":[]}\n'); }, /not on the base/],
];
for (const [name, breakIt, want] of NO_GO) {
	test(`merge gate: ${name} is NO GO`, () => {
		const s = setup();
		breakIt(s);
		const r = check(s.opts);
		assert.equal(r.go, false, name);
		assert.ok(r.faults.some((f) => want.test(f)), r.faults.join('\n'));
	});
}
// why: guards rule:standing-grants
test('merge gate: an owner yes clears a sweep as an approval does, on the tier of the decision it answered', () => {
	const s = setup();
	freshLog(s);
	const c = path.join(s.work, 'reports/sweeps/c.json');
	appendLog(s.work, { kind: 'decision', contract: c, tier: 'feature', decision: 'owner', head: s.sha });
	appendLog(s.work, { kind: 'owner-yes', contract: c, head: s.sha });
	appendLog(s.work, { kind: 'outcome', contract: c, tokens: 10 });
	const r = check(s.opts);
	assert.equal(r.go, true, r.faults.join('\n'));
});
// why: guards rule:standing-grants
test('merge gate: a passing check, a skipped one or a pending required one does not stop it', () => {
	const s = setup();
	s.state.pr.statusCheckRollup = [{ name: 'a', status: 'COMPLETED', conclusion: 'SUCCESS' }, { name: 'kit-tests', status: 'IN_PROGRESS', conclusion: '' }, { name: 'c', status: 'COMPLETED', conclusion: 'SKIPPED' }, { context: 'd', state: 'SUCCESS' }];
	assert.equal(check(s.opts).go, true);
});
// why: guards rule:standing-grants
test('merge gate: the sweep folder comes from the cleared contract, as adapter A22 sets it', () => {
	const s = setup();
	fs.mkdirSync(path.join(s.work, 'docs/sweeps'), { recursive: true });
	fs.renameSync(path.join(s.work, 'reports/sweeps/sub.md'), path.join(s.work, 'docs/sweeps/sub.md'));
	freshLog(s);
	const contract = path.join(s.work, 'docs/sweeps/c.json');
	cleared(s.work, s.sha, { contract }, { contract });
	const r = check(s.opts);
	assert.equal(r.go, true, r.faults.join('\n'));
});
// 1.21.1 carry 1: kept out of git by this clone's own exclude file, a setting is anyone's to write; by the base's
// .gitignore it is the project's. (Install excludes .kit/ in info/exclude, so a project that wants its own audit
// settings tracks them, or lists them in .gitignore.)
// why: guards rule:standing-grants
test('merge gate: an audit setting ignored by the base\'s .gitignore is the project\'s own; by this clone\'s exclude it is not', () => {
	const s = setup();
	fs.mkdirSync(path.join(s.work, '.kit'));
	fs.writeFileSync(path.join(s.work, '.kit/version-bump.json'), '{"shipped":[]}\n');
	fs.appendFileSync(path.join(s.work, '.git/info/exclude'), '.kit/\n');
	assert.match(check(s.opts).faults.join('\n'), /version-bump\.json is kept out of git/);
	fs.writeFileSync(path.join(s.work, '.git/info/exclude'), '');
	sh(s.work, 'checkout', '-q', 'main');
	fs.writeFileSync(path.join(s.work, '.gitignore'), '.kit/\n');
	sh(s.work, 'add', '.gitignore'); sh(s.work, 'commit', '-qm', 'ignore .kit'); sh(s.work, 'push', '-q', 'origin', 'main');
	sh(s.work, 'checkout', '-q', 'feat/subtract'); sh(s.work, 'merge', '-q', 'main', '-m', 'in');
	s.state.pr.headRefOid = sh(s.work, 'rev-parse', 'HEAD');
	cleared(s.work, s.state.pr.headRefOid);
	rewrite(s, report('feat/subtract', s.state.pr.headRefOid));
	const r = check(s.opts);
	assert.equal(r.go, true, r.faults.join('\n'));
});
// A kit-local project keeps .claude/ out of git, so the audit comes from the installed user layer (G6).
function baseWithoutAudits(s) {
	sh(s.work, 'checkout', '-q', 'main');
	sh(s.work, 'rm', '-rq', '.claude'); sh(s.work, 'commit', '-qm', 'kit stays local'); sh(s.work, 'push', '-q', 'origin', 'main');
	sh(s.work, 'checkout', '-q', 'feat/subtract'); sh(s.work, 'merge', '-q', 'main', '-m', 'in');
	s.state.pr.headRefOid = sh(s.work, 'rev-parse', 'HEAD');
	cleared(s.work, s.state.pr.headRefOid);
	rewrite(s, report('feat/subtract', s.state.pr.headRefOid));
}
// why: guards rule:standing-grants
test('merge gate: with no audit on the base it reads the installed user layer, and never the project folder', () => {
	const s = setup();
	baseWithoutAudits(s);
	fs.mkdirSync(path.join(s.work, '.claude'), { recursive: true });
	fs.writeFileSync(path.join(s.work, '.claude/pr-body-audit-lean.mjs'), 'process.exit(0);\n');
	fs.appendFileSync(path.join(s.work, '.git/info/exclude'), '.claude/\n');
	assert.match(check(s.opts).faults.join('\n'), /no installed copy/);
	const audits = path.join(s.config, 'kit-tools', 'audits');
	fs.mkdirSync(audits, { recursive: true });
	for (const f of fs.readdirSync(path.join(KIT, 'user/kit-tools/audits'))) fs.copyFileSync(path.join(KIT, 'user/kit-tools/audits', f), path.join(audits, f));
	const r = check(s.opts);
	assert.equal(r.go, true, r.faults.join('\n'));
	s.state.pr.body = BODY.replace('- [x] The test', '- [ ] The test');
	assert.match(check(s.opts).faults.join('\n'), /live PR body fails/, 'the installed audit really ran');
	assert.equal(live({ kind: 'pr', id: 7, cwd: s.work, config: s.config, run: s.run }).ok, false);
});
// why: guards rule:standing-grants
test('merge gate: an audit copy that fails part way leaves no temp folder behind', () => {
	const s = setup();
	baseWithoutAudits(s);
	const audits = path.join(s.config, 'kit-tools', 'audits');
	fs.mkdirSync(audits, { recursive: true });
	for (const f of fs.readdirSync(path.join(KIT, 'user/kit-tools/audits'))) fs.copyFileSync(path.join(KIT, 'user/kit-tools/audits', f), path.join(audits, f));
	// A folder among the audits: copying it as a file throws after the temp folder exists.
	fs.mkdirSync(path.join(audits, 'zz-not-a-file'));
	const leftovers = () => fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('merge-gate-'));
	const before = leftovers().length;
	assert.throws(() => check(s.opts));
	assert.equal(leftovers().length, before, 'the half-filled copy was removed');
});
// why: guards rule:standing-grants
test('merge gate: the audit is read from the kit\'s own layout on the base', () => {
	const s = setup();
	sh(s.work, 'checkout', '-q', 'main');
	fs.mkdirSync(path.join(s.work, 'project'));
	sh(s.work, 'mv', '.claude', 'project/.claude'); sh(s.work, 'commit', '-qm', 'kit layout'); sh(s.work, 'push', '-q', 'origin', 'main');
	sh(s.work, 'checkout', '-q', 'feat/subtract'); sh(s.work, 'merge', '-q', 'main', '-m', 'in');
	s.state.pr.headRefOid = sh(s.work, 'rev-parse', 'HEAD');
	cleared(s.work, s.state.pr.headRefOid);
	rewrite(s, report('feat/subtract', s.state.pr.headRefOid));
	s.state.pr.body = BODY.replace('- [x] The test', '- [ ] The test');
	assert.match(check(s.opts).faults.join('\n'), /live PR body fails pr-body-audit-lean/);
});
// why: guards rule:standing-grants
test('merge gate: a squash-style title is read by the full audit, not the lean one', () => {
	const s = setup();
	s.state.pr.title = 'Add a subtract function';
	assert.match(check(s.opts).faults.join('\n'), /live PR body fails pr-body-audit\.mjs/);
});
// why: guards rule:standing-grants. The 1.28.0 sweep: CI counts the squash suffix at the PR number's length and the gate
// kept 8 for it, so a title CI passed (65 here: 70 with " (#7)") failed the gate and held the merge.
test('merge gate: the title is counted with its own PR number, as CI counts it', () => {
	const s = setup();
	const sub = 'add a subtract function that checks each input and names it';
	s.state.pr.title = `feat: ${sub}`;
	s.state.pr.body = BODY.replace('add a subtract function', sub);
	assert.doesNotMatch(check(s.opts).faults.join('\n'), /live PR body fails/);
});
// why: guards rule:standing-grants
test('merge gate: the base is fetched, so a stricter audit landed on the remote is the one that judges', () => {
	const s = setup();
	const other = path.join(s.root, 'other');
	sh(s.root, 'clone', '-q', path.join(s.root, 'github.com', 'o', 'r.git'), other);
	fs.writeFileSync(path.join(other, '.claude/pr-body-audit-lean.mjs'), 'console.log("FAIL stricter"); process.exit(1);\n');
	sh(other, 'add', '-A'); sh(other, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'stricter'); sh(other, 'push', '-q', 'origin', 'main');
	assert.match(check(s.opts).faults.join('\n'), /FAIL stricter/);
});
// why: guards rule:standing-grants
test('merge gate: a merge gh accepts but the PR does not show armed is not reported armed', () => {
	const s = setup();
	s.state.armOnMerge = false;
	const r = arm(s.opts);
	assert.equal(r.armed, false);
	assert.match(r.faults[0], /not shown on the PR/);
	assert.equal(fs.existsSync(path.join(s.work, '.git', 'kit-merge-gate.log')), false);
});
// why: guards rule:standing-grants
test('merge gate: the nearest report wins whatever its file name', () => {
	const s = setup();
	commitOnBranch(s, 'math.txt', 'add\nsub\nfixed\n');
	fs.writeFileSync(path.join(s.work, 'reports/sweeps/zz-resweep.md'), report('feat/subtract', s.state.pr.headRefOid));
	const r = check(s.opts);
	assert.equal(r.go, true, r.faults.join('\n'));
});
// why: guards rule:standing-grants
test('merge gate: a Covers commit off the branch does not count, even with the same tree', () => {
	const s = setup();
	sh(s.work, 'checkout', '-q', '--detach', 'HEAD~1');
	fs.writeFileSync(path.join(s.work, 'math.txt'), 'add\nsub\n');
	sh(s.work, 'commit', '-qam', 'same tree, off the branch');
	const off = sh(s.work, 'rev-parse', 'HEAD');
	sh(s.work, 'checkout', '-q', 'feat/subtract');
	cleared(s.work, off);
	rewrite(s, report('feat/subtract', off));
	assert.match(check(s.opts).faults.join('\n'), /Covers commit at or before the head/);
});
// Disarming is the one way to stop an armed PR, so it needs no prompt and works with the kill switch down (N2).
// why: guards rule:standing-grants
test('merge gate: disarm turns auto-merge off, reads it back and logs it, kill switch or not', () => {
	const s = setup();
	assert.equal(arm(s.opts).armed, true);
	fs.writeFileSync(path.join(s.config, 'autonomy-off'), '');
	const r = disarm(s.opts);
	assert.equal(r.disarmed, true, r.faults.join('\n'));
	assert.ok(s.state.calls.includes('pr merge 7 --disable-auto'));
	assert.match(fs.readFileSync(path.join(s.work, '.git', 'kit-merge-gate.log'), 'utf8'), /DISARMED 7/);
});
// why: guards rule:standing-grants
test('merge gate: a disarm that does not take is reported, not logged', () => {
	const s = setup();
	arm(s.opts);
	s.state.disarmHolds = false;
	const r = disarm(s.opts);
	assert.equal(r.disarmed, false);
	assert.match(r.faults[0], /still armed/);
	assert.doesNotMatch(fs.readFileSync(path.join(s.work, '.git', 'kit-merge-gate.log'), 'utf8'), /DISARMED/);
	assert.equal(disarm({ ...s.opts, pr: 'x' }).disarmed, false);
});
// why: guards rule:standing-grants
test('merge gate: the CLI exits 1 on NO GO and 2 on a bad call', () => {
	const cli = (...a) => spawnSync(process.execPath, [path.join(KIT, 'user/kit-tools/merge-gate.mjs'), ...a], { encoding: 'utf8' });
	assert.equal(cli('check', 'x').status, 1);
	assert.equal(cli('arm', 'x').status, 1);
	assert.equal(cli('disarm', 'x').status, 1);
	assert.equal(cli('nonsense').status, 2);
});
// N3: auto-fix's push is a grant inside bounds: the tool makes the push, so the grant is the one allow rule.
const fixCommit = (s) => {
	fs.writeFileSync(path.join(s.work, 'math.txt'), 'add\nsub\nfix\n');
	sh(s.work, 'commit', '-qam', 'fix');
	return sh(s.work, 'rev-parse', 'HEAD');
};
const originHead = (s) => sh(s.work, 'ls-remote', 'origin', 'refs/heads/feat/subtract').split(/\s/)[0];
// why: guards rule:standing-grants
test('merge gate: autofix disarms an armed PR, pushes the branch and logs the commit that went out', () => {
	const s = setup();
	assert.equal(arm(s.opts).armed, true);
	const fixed = fixCommit(s);
	const r = autofix(s.opts);
	assert.equal(r.pushed, true, r.faults.join('\n'));
	assert.equal(originHead(s), fixed);
	assert.ok(s.state.calls.includes('pr merge 7 --disable-auto'));
	const log = fs.readFileSync(path.join(s.work, '.git', 'kit-merge-gate.log'), 'utf8');
	assert.match(log, new RegExp(`DISARMED 7\\n.* AUTOFIX 7 ${fixed}\\n$`));
});
// Handoff item 16: a session can read at any time whether the kill switch is set and what is still armed.
// why: guards rule:standing-grants
test('merge gate: status reads the kill switch and each PR still armed, an unread arming included', () => {
	const s = setup();
	assert.deepEqual(status(s.opts), { killSwitch: false, armed: [] });
	assert.equal(arm(s.opts).armed, true);
	fs.writeFileSync(path.join(s.config, 'autonomy-off'), '');
	fs.appendFileSync(path.join(s.work, '.git', 'kit-merge-gate.log'), `t ARMED https://github.com/o/r/pull/8 ${'c'.repeat(40)} unread\n`);
	const r = status(s.opts);
	assert.equal(r.killSwitch, true);
	assert.deepEqual(r.armed.map((x) => [x.pr, x.unread]), [['7', false], ['8', true]]);
	assert.equal(disarm(s.opts).disarmed, true);
	assert.deepEqual(status(s.opts).armed.map((x) => x.pr), ['8']);
	const cli = spawnSync(process.execPath, [path.join(KIT, 'user/kit-tools/merge-gate.mjs'), 'status'], { cwd: s.work, encoding: 'utf8', env: { ...process.env, CLAUDE_CONFIG_DIR: s.config } });
	assert.match(cli.stdout, /Kill switch: SET/);
	assert.match(cli.stdout, /ARMED: PR 8 .*may be armed/);
	assert.doesNotMatch(cli.stdout, /PR 7/);
});
// 1.21.1 carry 8: a base named with a slash, and a PR address in another case, still pass.
// why: guards rule:standing-grants
test('merge gate: a base with a slash in its name and a PR address in mixed case arm as any other', () => {
	const s = setup();
	sh(s.work, 'push', '-q', 'origin', 'main:refs/heads/release/1.0');
	s.state.pr.baseRefName = 'release/1.0';
	s.state.pr.url = 'https://github.com/O/R/pull/7';
	const r = arm(s.opts);
	assert.equal(r.armed, true, r.faults.join('\n'));
	assert.ok(s.state.calls.includes('api repos/o/r/branches/release%2F1.0'), 'the base is read by its encoded name');
});
// 1.21.1 carry 2: gh may read the PR through another remote, while the push goes to origin.
// why: guards rule:standing-grants
test('merge gate: autofix pushes only when origin is the PR\'s repo', () => {
	const s = setup();
	fixCommit(s);
	const other = path.join(s.root, 'github.com', 'x', 'y.git');
	sh(s.root, 'clone', '-q', '--bare', path.join(s.root, 'github.com', 'o', 'r.git'), other);
	sh(s.work, 'remote', 'set-url', '--push', 'origin', other);
	const before = originHead(s);
	assert.match(autofix(s.opts).faults[0], /not the repo of PR 7/);
	assert.equal(originHead(s), before, 'nothing went out');
	assert.equal(sh(other, 'rev-parse', 'refs/heads/feat/subtract'), before, 'nor to the other repo');
});
// The 1.22.0 sweep (G3, G4): git pushes to every push URL, and a URL that only ends in the repo's path is another host.
// why: guards rule:standing-grants
test('merge gate: autofix pushes only to one push URL that is exactly the PR\'s host and repo', () => {
	const s = setup();
	fixCommit(s);
	const other = path.join(s.root, 'other.git');
	sh(s.root, 'init', '-q', '--bare', '-b', 'main', other);
	sh(s.work, 'remote', 'set-url', '--add', '--push', 'origin', path.join(s.root, 'github.com', 'o', 'r.git'));
	sh(s.work, 'remote', 'set-url', '--add', '--push', 'origin', other);
	assert.match(autofix(s.opts).faults[0], /2 push URLs/);
	assert.notEqual(sh(other, 'for-each-ref').trim().length > 0, true, 'nothing went to the second URL');
	// A bare github.com/o/r is a relative folder to git, not GitHub (a security review after the sweep).
	for (const url of ['https://evil.example/github.com/o/r', 'git@evil.example:github.com/o/r.git', 'https://github.com.evil.example/o/r', 'github.com/o/r', 'github.com/o/r.git', 'https://github.com/o/r?x', 'https://github.com/o/r#x']) {
		const t = setup();
		fixCommit(t);
		sh(t.work, 'remote', 'set-url', '--push', 'origin', url);
		assert.match(autofix(t.opts).faults[0], /not the repo of PR 7/, url);
	}
	// Outside the tests' own option, a local folder is never GitHub, however it is named.
	const u = setup();
	fixCommit(u);
	assert.match(autofix({ ...u.opts, localOrigin: false }).faults[0], /not the repo of PR 7/);
});
// Handoff item 7: a merge call that went through and a read-back that did not must not read as nothing armed.
// why: guards rule:standing-grants
test('merge gate: a merge that went through with no read-back is logged as armed and named as such', () => {
	const s = setup();
	s.state.readBackFails = true;
	const r = arm(s.opts);
	assert.equal(r.armed, false);
	assert.match(r.faults[0], /may be armed: run merge-gate\.mjs disarm 7/);
	assert.match(fs.readFileSync(path.join(s.work, '.git', 'kit-merge-gate.log'), 'utf8'), new RegExp(`ARMED https://github.com/o/r/pull/7 ${s.sha} unread`));
	assert.match(fs.readFileSync(path.join(s.work, '.git', 'kit-merge-gate-triage.md'), 'utf8'), /arming unconfirmed/);
});
// Handoff item 12.
// why: guards rule:standing-grants
test('merge gate: live stops on a program planted at the repo root, as check does', () => {
	const s = setup();
	fs.writeFileSync(path.join(s.work, 'git.exe'), '');
	const r = live({ kind: 'pr', id: 7, cwd: s.work, config: s.config, run: s.run });
	assert.equal(r.ok, false);
	assert.match(r.faults.join('\n'), /named like a tool/);
});
// Handoff item 14 and 1.21.1 carry 10: the version check diffs against the pinned base, not a short name.
// why: guards rule:standing-grants
test('merge gate: the PR-body audit runs with PR_BASE at the pinned base commit', () => {
	const s = setup();
	sh(s.work, 'checkout', '-q', 'main');
	fs.writeFileSync(path.join(s.work, '.claude', 'pr-body-audit-lean.mjs'), "console.log('FAIL PR_BASE=' + process.env.PR_BASE); process.exit(1);\n");
	sh(s.work, 'commit', '-qam', 'audit prints its base'); sh(s.work, 'push', '-q', 'origin', 'main');
	const tip = sh(s.work, 'rev-parse', 'HEAD');
	sh(s.work, 'checkout', '-q', 'feat/subtract'); sh(s.work, 'merge', '-q', 'main', '-m', 'in');
	s.state.pr.headRefOid = sh(s.work, 'rev-parse', 'HEAD');
	cleared(s.work, s.state.pr.headRefOid);
	rewrite(s, report('feat/subtract', s.state.pr.headRefOid));
	assert.match(check(s.opts).faults.join('\n'), new RegExp(`PR_BASE=${tip}`));
});
// why: guards rule:standing-grants
test('merge gate: autofix runs no branch hook on its push', () => {
	const s = setup();
	const hooks = path.join(s.work, 'hooks');
	fs.mkdirSync(hooks);
	fs.writeFileSync(path.join(hooks, 'pre-push'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
	sh(s.work, 'config', 'core.hooksPath', hooks);
	fixCommit(s);
	assert.equal(autofix(s.opts).pushed, true);
});
// why: guards rule:standing-grants
test('merge gate: autofix stops on the kill switch, nothing to push, another branch, a rewrite and a stop set outside', () => {
	const s = setup();
	const before = originHead(s);
	assert.match(autofix(s.opts).faults[0], /nothing to push/);
	const fixed = fixCommit(s);
	fs.writeFileSync(path.join(s.config, 'autonomy-off'), '');
	assert.match(autofix(s.opts).faults[0], /kill switch/);
	fs.rmSync(path.join(s.config, 'autonomy-off'));
	sh(s.work, 'checkout', '-q', '-b', 'feat/other');
	assert.match(autofix(s.opts).faults[0], /not on the PR's branch/);
	sh(s.work, 'checkout', '-q', 'feat/subtract');
	s.state.pr.headRefOid = 'a'.repeat(40);
	assert.match(autofix(s.opts).faults[0], /does not build on/);
	s.state.pr.headRefOid = before;
	fs.writeFileSync(path.join(s.work, '.git', 'kit-merge-gate.log'), `t ARMED https://github.com/o/r/pull/7 ${before} required=x\n`);
	assert.match(autofix(s.opts).faults[0], /someone stopped it/);
	assert.equal(originHead(s), before, 'nothing went out');
	assert.ok(fixed);
	assert.equal(autofix({ ...s.opts, pr: 'x' }).pushed, false);
});
// why: guards rule:standing-grants
test('merge gate: a disarm reads back rather than trusting gh, on a PR with nothing to turn off', () => {
	const s = setup();
	const run = (cmd, args, cwd) => (args[1] === 'merge' ? { status: 1, stdout: '', stderr: 'not enabled' } : s.opts.run(cmd, args, cwd));
	assert.equal(disarm({ ...s.opts, run }).disarmed, true);
});
// why: guards rule:standing-grants
test('merge gate: a stop on GitHub holds: changes requested, a hold label, and auto-merge turned off outside the gate', () => {
	const s = setup();
	s.state.pr.reviewDecision = 'CHANGES_REQUESTED';
	assert.match(check(s.opts).faults.join('\n'), /asks for changes/);
	delete s.state.pr.reviewDecision;
	s.state.pr.labels = [{ name: 'do-not-merge' }];
	assert.match(check(s.opts).faults.join('\n'), /hold label/);
	s.state.pr.labels = [];
	assert.equal(arm(s.opts).armed, true);
	s.state.armed = false;
	const again = arm(s.opts);
	assert.equal(again.armed, false);
	assert.match(again.faults.join('\n'), /someone stopped it/);
	s.state.armed = true;
	assert.equal(disarm(s.opts).disarmed, true);
	assert.equal(check(s.opts).go, true, 'a logged disarm is the gate\'s own, so the gate may run again');
});
// why: guards rule:standing-grants
test('merge gate: a running optional check stops arming, since it could fail after the merge', () => {
	const s = setup();
	s.state.pr.statusCheckRollup = [{ name: 'lint', status: 'IN_PROGRESS', conclusion: '' }];
	assert.match(check(s.opts).faults.join('\n'), /still running.*lint/);
	s.state.pr.statusCheckRollup = [{ context: 'lint', state: 'PENDING' }];
	assert.equal(check(s.opts).go, false);
});
// why: guards rule:standing-grants
test('merge gate: a high closes only by a real commit in the branch, in its own cell, in every report', () => {
	const s = setup();
	const f = path.join(s.work, 'reports/sweeps/sub.md');
	const base = fs.readFileSync(f, 'utf8');
	const withRow = (row) => fs.writeFileSync(f, base + `\n| ID | Severity | Finding | Disposition |\n|---|---|---|---|\n${row}\n`);
	withRow('| S1 | high | leaks a token | FIXED deadbee |');
	assert.match(check(s.opts).faults.join('\n'), /not closed by a commit/);
	withRow('| S1 | high | came back after FIXED 1234567 | OPEN |');
	assert.match(check(s.opts).faults.join('\n'), /not closed by a commit/);
	withRow(`| S1 | high | leaks a token | FIXED ${s.sha.slice(0, 7)} |`);
	assert.equal(check(s.opts).go, true, check(s.opts).faults.join('\n'));
	// The older report keeps the open high; a clean report at a nearer commit does not close it.
	withRow('| S1 | high | leaks a token | OPEN |');
	fs.writeFileSync(path.join(s.work, 'math.txt'), 'add\nsub\nmore\n');
	sh(s.work, 'commit', '-qam', 'more');
	const near = sh(s.work, 'rev-parse', 'HEAD');
	fs.writeFileSync(path.join(s.work, 'reports/sweeps/later.md'), report('feat/subtract', near));
	cleared(s.work, near);
	s.state.pr.headRefOid = near;
	assert.match(check(s.opts).faults.join('\n'), /sub\.md:[^\n]*finding is not closed/);
});
// why: guards rule:standing-grants
test('merge gate: a report that gives the version goal as NO stops it', () => {
	const s = setup();
	const f = path.join(s.work, 'reports/sweeps/sub.md');
	fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/(version.goal[^\n]*?)\bYES\b/i, '$1NO'));
	assert.match(check(s.opts).faults.join('\n'), /version goal as NO/);
});
// why: guards rule:standing-grants
test('merge gate: project/.claude is protected everywhere, so a branch cannot land an audit there', () => {
	assert.ok(PROTECTED.some((re) => re.test('project/.claude/pr-body-audit-lean.mjs')));
});
// why: guards rule:standing-grants
test('merge gate: a linked worktree logs where the pre-push hook reads, the common git folder', { windows: true }, () => {
	const s = setup();
	const tree = path.join(makeTemp('wt-'), 'linked');
	assert.equal(spawnSync('git', ['-C', s.work, 'worktree', 'add', '-q', '--detach', tree], { encoding: 'utf8' }).status, 0);
	assert.equal(disarm({ ...s.opts, cwd: tree }).disarmed, true);
	const log = fs.readFileSync(path.join(s.work, '.git', 'kit-merge-gate.log'), 'utf8');
	assert.match(log, /DISARMED 7\n$/);
});

// The fake gh above answers any field, so only the real gh can say a field exists: 1.21.0 shipped a gate that could
// never arm because `gh repo view` has no autoMergeAllowed. `gh <cmd> view --json` lists its fields with no login.
// why: guards rule:standing-grants
test('merge gate: every --json field it asks for exists in the real gh', (t) => {
	const source = fs.readFileSync(path.join(KIT, 'user/kit-tools/merge-gate.mjs'), 'utf8');
	const asked = [...source.matchAll(/'(pr|repo|release)', 'view',[^\n]*?'--json', '([^']+)'/g)].map((m) => ({ cmd: m[1], fields: m[2].split(',') }));
	assert.equal(asked.length, source.match(/'--json'/g).length, 'a --json call sits outside the scan: keep each on one line, with its field list written in the call');
	const found = spawnSync('gh', ['--version'], { encoding: 'utf8' });
	if (found.status !== 0) {
		assert.ok(!process.env.CI, 'CI must have gh for this test');
		return t.skip('gh is not on this machine');
	}
	for (const { cmd, fields } of asked) {
		const r = spawnSync('gh', [cmd, 'view', '--json'], { encoding: 'utf8' });
		const known = new Set(`${r.stdout}\n${r.stderr}`.split(/\r?\n/).map((l) => l.trim()).filter(Boolean));
		assert.ok(known.size > 5, `gh ${cmd} view --json listed no fields`);
		for (const f of fields) assert.ok(known.has(f), `gh ${cmd} view has no field ${f}`);
	}
});

// why: guards rule:standing-grants
test('merge gate: a base that does not match GitHub stops before any audit runs', () => {
	const s = setup();
	const ran = [];
	const run = (cmd, args, cwd) => { ran.push(cmd); return s.run(cmd, args, cwd); };
	assert.equal(check({ ...s.opts, run }).go, true);
	assert.ok(ran.includes(process.execPath), 'the control ran no audit, so this test proves nothing');
	ran.length = 0;
	s.state.baseTip = '0'.repeat(40);
	const r = check({ ...s.opts, run });
	assert.equal(r.go, false);
	assert.match(r.faults.join('\n'), /GitHub's base/);
	assert.ok(!ran.includes(process.execPath), 'an audit ran from a base GitHub does not hold');
});

// why: guards rule:standing-grants
test('merge gate: live pr holds to the base GitHub has', () => {
	const s = setup();
	assert.equal(live({ kind: 'pr', id: 7, cwd: s.work, config: s.config, run: s.run }).ok, true);
	s.state.baseTip = '0'.repeat(40);
	const r = live({ kind: 'pr', id: 7, cwd: s.work, config: s.config, run: s.run });
	assert.equal(r.ok, false);
	assert.match(r.faults.join('\n'), /GitHub's base/);
});
