#!/usr/bin/env node
// The merge gate (rule:standing-grants; workbench M18, E12 option B). Arms GitHub auto-merge on one PR only when
// fixed checks pass, so a green PR merges itself and anything else stops with a triage report. It lives in the Claude
// config folder, outside every repo, so no branch can edit the gate that judges it. The owner's grant is one allow
// rule in their own settings for exactly this script; without it every merge still asks.
//
// Every check must pass, or nothing is armed:
//   1. the kill switch `autonomy-off` is absent from the Claude config folder
//   2. the PR is open, not a draft, and comes from a branch of this repo, and the working copy is at its head
//   3. the repo allows auto-merge and deletes a branch on merge (rule:first-push-gate)
//   4. the base branch requires at least one status check, so GitHub merges only on green
//   5. the diff touches no gate, grant or loaded-rule path (PROTECTED): those changes stay the owner's
//   6. a sweep report for the branch names a Covers commit at or before the head; only VERSION and CHANGELOG.md
//      changed after it; and the installed sweep audit passes it
//   7. the live PR body passes the base branch's own PR-body audit (a branch cannot weaken the audit it is read by)
// GO: `gh pr merge <n> --auto --squash --match-head-commit <sha>`, read back, and one line in <git dir>/kit-merge-gate.log.
// NO GO: <git dir>/kit-merge-gate-triage.md says what failed; exit 1.
//
// `live` reads a body as published and audits it (rule:release-notes, I21): a PR body with the base's PR-body audit,
// a release body with the installed release-notes audit.
//
// Usage (from the repo, on the PR's branch):
//   node merge-gate.mjs arm <pr>          check, then arm on GO
//   node merge-gate.mjs check <pr>        the same checks, never arms
//   node merge-gate.mjs live pr <n>       audit the live PR body
//   node merge-gate.mjs live release <tag>  audit the live release body
// Exit 0 = GO / clean; 1 = NO GO / faults; 2 = usage.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// A change here is live the moment it merges, in this repo: workflows, the installed kit and its rules, the
// project's grant and gate settings, git hooks, and the loaded rule files.
export const PROTECTED = [/^\.github\//, /^\.kit\//, /^\.githooks\//, /^\.claude\//, /^(AGENTS|CLAUDE|CLAUDE\.local)\.md$/i];
// What may change after the swept commit: the release bump.
export const AFTER_SWEEP = ['VERSION', 'CHANGELOG.md'];
const CONVENTIONAL = /^[a-z]+(\([^)]*\))?!?: /;
const SHA = /^[0-9a-f]{40}$/;

// Programs Windows would start from the working folder, ahead of PATH, when a child calls them by bare name.
const ROOT_TOOL = /^(git|gh|node)\.(exe|com|bat|cmd)$/i;

/**
 * Where a program lives on PATH, never in or under the repo: on Windows a bare name is looked up in the working
 * folder first, so a branch could otherwise ship the gh or git that judges it.
 *
 * Args:
 *     name: the program's name, no extension
 *     cwd: the repo folder
 *     env: the environment holding PATH
 *
 * Returns:
 *     the full path, or null when PATH holds none outside the repo
 */
export function toolPath(name, cwd, env = process.env) {
	const repo = path.resolve(cwd);
	const names = process.platform === 'win32' ? [`${name}.exe`, `${name}.com`] : [name];
	for (const dir of String(env.PATH ?? env.Path ?? '').split(path.delimiter)) {
		if (!path.isAbsolute(dir)) continue;
		const rel = path.relative(repo, dir);
		if (!rel || (!rel.startsWith('..') && !path.isAbsolute(rel))) continue;
		for (const n of names) if (fs.existsSync(path.join(dir, n))) return path.join(dir, n);
	}
	return null;
}

const realRun = (cmd, args, cwd) => {
	const exe = cmd === 'git' || cmd === 'gh' ? toolPath(cmd, cwd) : cmd;
	if (!exe) return { status: 127, stdout: '', stderr: `${cmd} is not on PATH outside this repo` };
	const r = spawnSync(exe, args, { cwd, encoding: 'utf8', shell: false, windowsHide: true });
	return { status: r.status ?? 1, stdout: r.stdout || '', stderr: r.stderr || '' };
};

export const configDir = (env = process.env) => env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');

const json = (r) => { try { return r.status === 0 ? JSON.parse(r.stdout) : null; } catch { return null; } };

/**
 * Run every check for one PR.
 *
 * Args:
 *     pr: the PR number
 *     cwd: the repo folder
 *     config: the Claude config folder
 *     run: (cmd, args, cwd) => { status, stdout, stderr }; gh and git go through it
 *
 * Returns:
 *     { go, faults: [...], facts: { url, sha, base, head } }
 */
export function check({ pr, cwd, config = configDir(), run = realRun }) {
	const faults = [];
	const facts = {};
	const git = (...a) => run('git', a, cwd);
	const gh = (...a) => run('gh', a, cwd);
	if (!/^\d+$/.test(String(pr))) return { go: false, faults: ['the PR is a number'], facts };

	// The audits below are children that call git by bare name from this folder, so nothing may run while one sits here.
	const planted = fs.readdirSync(cwd).filter((f) => ROOT_TOOL.test(f));
	if (planted.length) return { go: false, faults: [`a program named like a tool sits at the repo root, and would run in place of it: ${planted.join(', ')}`], facts };

	// 1. Kill switch.
	if (fs.existsSync(path.join(config, 'autonomy-off'))) faults.push(`kill switch: ${path.join(config, 'autonomy-off')} exists; every merge asks the owner`);

	// 2. The PR itself.
	const p = json(gh('pr', 'view', String(pr), '--json', 'number,state,isDraft,isCrossRepository,headRefName,headRefOid,baseRefName,title,body,url'));
	if (!p) return { go: false, faults: [...faults, `gh could not read PR ${pr}`], facts };
	Object.assign(facts, { url: p.url, sha: p.headRefOid, base: p.baseRefName, head: p.headRefName });
	if (p.state !== 'OPEN') faults.push(`PR ${pr} is ${p.state}, not open`);
	if (p.isDraft) faults.push(`PR ${pr} is a draft`);
	if (p.isCrossRepository) faults.push(`PR ${pr} comes from another repository`);
	if (!SHA.test(p.headRefOid || '')) return { go: false, faults: [...faults, 'the PR has no head commit'], facts };
	const local = git('rev-parse', 'HEAD').stdout.trim();
	if (local !== p.headRefOid) faults.push(`the working copy is at ${local.slice(0, 12) || 'nothing'}, not the PR's head ${p.headRefOid.slice(0, 12)}: check out the branch and pull`);

	// 3. Repo settings.
	const repo = json(gh('repo', 'view', '--json', 'nameWithOwner,autoMergeAllowed,deleteBranchOnMerge'));
	if (!repo) return { go: false, faults: [...faults, 'gh could not read the repository'], facts };
	if (!repo.autoMergeAllowed || !repo.deleteBranchOnMerge) {
		faults.push(`${repo.nameWithOwner} must allow auto-merge and delete branches on merge (the owner runs: gh api -X PATCH repos/${repo.nameWithOwner} -F allow_auto_merge=true -F delete_branch_on_merge=true)`);
	}

	// 4. A required check on the base: branch protection or a ruleset.
	const prot = json(gh('api', `repos/${repo.nameWithOwner}/branches/${encodeURIComponent(p.baseRefName)}/protection/required_status_checks`));
	const rules = json(gh('api', `repos/${repo.nameWithOwner}/rules/branches/${encodeURIComponent(p.baseRefName)}`));
	const fromProt = prot ? [...(prot.contexts || []), ...(prot.checks || []).map((c) => c.context)] : [];
	const fromRules = Array.isArray(rules) ? rules.filter((r) => r.type === 'required_status_checks')
		.flatMap((r) => ((r.parameters || {}).required_status_checks || []).map((c) => c.context)) : [];
	const required = [...new Set([...fromProt, ...fromRules].filter(Boolean))];
	facts.required = required;
	if (!required.length) faults.push(`${p.baseRefName} requires no status check, so auto-merge would merge at once: protect it first (rule:first-push-gate)`);

	// 5. The diff, from the merge base on the remote base branch.
	git('fetch', '--quiet', 'origin', p.baseRefName);
	const baseRef = `origin/${p.baseRefName}`;
	const mb = git('merge-base', baseRef, p.headRefOid);
	let files = [];
	if (mb.status !== 0) faults.push(`no merge base between ${baseRef} and the head`);
	else {
		files = git('diff', '--name-only', mb.stdout.trim(), p.headRefOid).stdout.split('\n').map((s) => s.trim()).filter(Boolean);
		const hit = files.filter((f) => PROTECTED.some((re) => re.test(f)));
		if (hit.length) faults.push(`the diff touches gate or rule paths the owner merges by hand: ${hit.join(', ')}`);
	}

	// 6. The sweep.
	faults.push(...sweepFaults({ cwd, config, branch: p.headRefName, head: p.headRefOid, git, run }));

	// 7. The live body, by the base branch's own audit.
	faults.push(...bodyFaults({ cwd, body: p.body || '', title: p.title || '', baseRef, git, run }));

	return { go: faults.length === 0, faults, facts };
}

function sweepFaults({ cwd, config, branch, head, git, run }) {
	const dir = path.join(cwd, 'reports', 'sweeps');
	const audit = path.join(config, 'skills', 'pre-pr-sweep', 'audit.mjs');
	if (!fs.existsSync(audit)) return [`no sweep audit at ${audit}: install the kit's user layer`];
	const named = (fs.existsSync(dir) ? fs.readdirSync(dir) : []).filter((f) => f.endsWith('.md')).map((f) => {
		const text = fs.readFileSync(path.join(dir, f), 'utf8');
		const onBranch = text.split('\n').slice(0, 20).some((l) => l.includes(branch));
		const covers = (text.match(/\*\*Covers:\*\*\s*`?([0-9a-f]{7,40})\b/) || [])[1];
		return { f, onBranch, covers };
	}).filter((r) => r.onBranch);
	if (!named.length) return [`no sweep report in reports/sweeps names the branch ${branch}`];
	// The nearest covered commit at or before the head is the one that counts.
	let best = null;
	for (const r of named) {
		if (!r.covers) continue;
		const sha = git('rev-parse', '-q', '--verify', `${r.covers}^{commit}`).stdout.trim();
		if (!sha || git('merge-base', '--is-ancestor', sha, head).status !== 0) continue;
		const ahead = Number(git('rev-list', '--count', `${sha}..${head}`).stdout.trim());
		if (!best || ahead < best.ahead) best = { ...r, sha, ahead };
	}
	if (!best) return [`no sweep report for ${branch} names a Covers commit at or before the head (a line "**Covers:** <sha>")`];
	const faults = [];
	const after = git('diff', '--name-only', best.sha, head).stdout.split('\n').map((s) => s.trim()).filter(Boolean)
		.filter((f) => !AFTER_SWEEP.includes(f));
	if (after.length) faults.push(`changed after the sweep covered ${best.sha.slice(0, 12)} and never reviewed: ${after.join(', ')}`);
	const a = run(process.execPath, [audit, path.join(dir, best.f)], cwd);
	if (a.status !== 0) faults.push(`sweep report ${best.f} fails its audit: ${a.stdout.trim().split('\n').join('; ')}`);
	return faults;
}

// The base branch's PR-body audit and the files it imports, copied out of the base tree. The installed copy
// (.claude/) wins; the kit's own source keeps them under project/.claude/.
function baseAudit(git, baseRef, name) {
	for (const dir of ['.claude', 'project/.claude']) {
		if (git('cat-file', '-e', `${baseRef}:${dir}/${name}`).status !== 0) continue;
		const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'merge-gate-'));
		for (const f of git('ls-tree', '--name-only', `${baseRef}:${dir}`).stdout.split('\n').filter((n) => /\.(mjs|cjs|json)$/.test(n))) {
			fs.writeFileSync(path.join(tmp, f), git('show', `${baseRef}:${dir}/${f}`).stdout);
		}
		return { tmp, script: path.join(tmp, name) };
	}
	return null;
}

function bodyFaults({ cwd, body, title, baseRef, git, run }) {
	const name = CONVENTIONAL.test(title) ? 'pr-body-audit-lean.mjs' : 'pr-body-audit.mjs';
	const found = baseAudit(git, baseRef, name);
	if (!found) return [`${baseRef} has no ${name}`];
	try {
		const file = path.join(found.tmp, 'pr-body.md');
		fs.writeFileSync(file, body);
		const r = run(process.execPath, [found.script, file, title], cwd);
		return r.status === 0 ? [] : [`the live PR body fails ${name}: ${(r.stdout + r.stderr).trim().split('\n').filter((l) => /FAIL|fault|must|no /i.test(l)).slice(0, 8).join('; ') || 'see the audit'}`];
	} finally {
		fs.rmSync(found.tmp, { recursive: true, force: true });
	}
}

/**
 * Audit a published body as it reads live (I21).
 *
 * Returns:
 *     { ok, faults }
 */
export function live({ kind, id, cwd, config = configDir(), run = realRun }) {
	const git = (...a) => run('git', a, cwd);
	const gh = (...a) => run('gh', a, cwd);
	if (kind === 'pr') {
		const p = json(gh('pr', 'view', String(id), '--json', 'title,body,baseRefName'));
		if (!p) return { ok: false, faults: [`gh could not read PR ${id}`] };
		git('fetch', '--quiet', 'origin', p.baseRefName);
		const faults = bodyFaults({ cwd, body: p.body || '', title: p.title || '', baseRef: `origin/${p.baseRefName}`, git, run });
		return { ok: !faults.length, faults };
	}
	if (kind === 'release') {
		const r = json(gh('release', 'view', String(id), '--json', 'body,tagName'));
		if (!r) return { ok: false, faults: [`gh could not read release ${id}`] };
		const audit = path.join(config, 'skills', 'release-notes', 'audit.mjs');
		if (!fs.existsSync(audit)) return { ok: false, faults: [`no release-notes audit at ${audit}`] };
		const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'merge-gate-'));
		try {
			const file = path.join(tmp, 'release.md');
			fs.writeFileSync(file, r.body || '');
			const a = run(process.execPath, [audit, file, String(r.tagName).replace(/^v/, '')], cwd);
			return a.status === 0 ? { ok: true, faults: [] } : { ok: false, faults: a.stdout.trim().split('\n') };
		} finally {
			fs.rmSync(tmp, { recursive: true, force: true });
		}
	}
	return { ok: false, faults: ['live takes pr <n> or release <tag>'] };
}

/**
 * Check, and on GO arm auto-merge pinned to the checked head, read it back and log it.
 *
 * Returns:
 *     { armed, faults, facts }
 */
export function arm({ pr, cwd, config = configDir(), run = realRun, now = () => new Date().toISOString() }) {
	const res = check({ pr, cwd, config, run });
	const gitDir = path.resolve(cwd, run('git', ['rev-parse', '--git-dir'], cwd).stdout.trim() || '.git');
	const triage = path.join(gitDir, 'kit-merge-gate-triage.md');
	if (!res.go) {
		fs.writeFileSync(triage, [`# Merge gate: NO GO for PR ${pr} (${now()})`, '', ...res.faults.map((f) => `- ${f}`), '',
			'Nothing was armed. Fix what is the thread\'s to fix and run the gate again; anything else is the owner\'s merge.', ''].join('\n'));
		return { armed: false, faults: res.faults, facts: res.facts };
	}
	const m = run('gh', ['pr', 'merge', String(pr), '--auto', '--squash', '--match-head-commit', res.facts.sha], cwd);
	const back = json(run('gh', ['pr', 'view', String(pr), '--json', 'autoMergeRequest,state'], cwd));
	const armed = m.status === 0 && !!back && (back.state === 'MERGED' || !!back.autoMergeRequest);
	if (!armed) {
		const faults = [`gh pr merge did not arm: ${(m.stderr || m.stdout).trim() || 'auto-merge not shown on the PR'}`];
		fs.writeFileSync(triage, `# Merge gate: arming failed for PR ${pr} (${now()})\n\n- ${faults[0]}\n`);
		return { armed: false, faults, facts: res.facts };
	}
	fs.appendFileSync(path.join(gitDir, 'kit-merge-gate.log'), `${now()} ARMED ${res.facts.url} ${res.facts.sha} required=${res.facts.required.join(',')}\n`);
	if (fs.existsSync(triage)) fs.rmSync(triage);
	return { armed: true, faults: [], facts: res.facts };
}

// Paths compared after links, so the gate runs when called through a junction.
const realOf = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
if (process.argv[1] && realOf(process.argv[1]) === realOf(fileURLToPath(import.meta.url))) {
	const [cmd, a, b] = process.argv.slice(2);
	const cwd = process.cwd();
	if (cmd === 'check' && a) {
		const r = check({ pr: a, cwd });
		console.log(r.go ? `GO: PR ${a} passes every check` : `NO GO:\n${r.faults.map((f) => `- ${f}`).join('\n')}`);
		process.exit(r.go ? 0 : 1);
	} else if (cmd === 'arm' && a) {
		const r = arm({ pr: a, cwd });
		console.log(r.armed ? `ARMED: ${r.facts.url} merges on green at ${r.facts.sha}` : `NO GO (nothing armed):\n${r.faults.map((f) => `- ${f}`).join('\n')}`);
		process.exit(r.armed ? 0 : 1);
	} else if (cmd === 'live' && a && b) {
		const r = live({ kind: a, id: b, cwd });
		console.log(r.ok ? `Live ${a} body: clean` : r.faults.join('\n'));
		process.exit(r.ok ? 0 : 1);
	} else {
		console.log('Usage: node merge-gate.mjs arm <pr> | check <pr> | live pr <n> | live release <tag>');
		process.exit(2);
	}
}
