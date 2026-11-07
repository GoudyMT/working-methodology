#!/usr/bin/env node
// The merge gate (rule:standing-grants; workbench M18, E12 option B). Arms GitHub auto-merge on one PR only when
// fixed checks pass, so a green PR merges itself and anything else stops with a triage report. It lives in the Claude
// config folder, outside every repo, so no branch can edit the gate that judges it. The owner's grant is one allow
// rule in their own settings for exactly this script; without it every merge still asks.
//
// Every check must pass, or nothing is armed:
//   1. the kill switch `autonomy-off` is absent from the Claude config folder
//   2. the PR is open, not a draft, and comes from a branch of this repo, and the working copy is at its head
//      (a repo read that is not the PR's repo on the PR's host stops the run, and so does a base that is not GitHub's)
//   3. the repo allows auto-merge and deletes a branch on merge (rule:first-push-gate)
//   4. the base branch requires at least one status check, and no check on the PR is failing now
//   5. the diff touches no gate, grant or loaded-rule path (PROTECTED, and the kit's own source paths in that repo)
//   6. a sweep report for the branch names a Covers commit at or before the head; only VERSION and CHANGELOG.md
//      changed after it; the approval log shows that commit cleared at the report's tier with reviewers run; the
//      report holds no owner acceptance; and the installed sweep audit passes it
//   7. the live PR body passes the PR-body audit of the base branch, else of the installed user layer (never the
//      project's own folder), with no audit setting the base does not hold
// A check stops only what is true when it runs: a check that fails later, or a kill switch set later, does not reach an
// armed PR. `disarm` does, and it needs no check.
// GO: `gh pr merge <n> --auto --squash --match-head-commit <sha>`, read back, and one line in kit-merge-gate.log in the common git folder.
// NO GO: <git dir>/kit-merge-gate-triage.md says what failed; exit 1.
//
// `live` reads a body as published and audits it (rule:release-notes, I21): a PR body with the base's PR-body audit,
// a release body with the installed release-notes audit.
//
// Usage (from the repo, on the PR's branch):
//   node merge-gate.mjs arm <pr>          check, then arm on GO
//   node merge-gate.mjs check <pr>        the same checks, never arms
//   node merge-gate.mjs disarm <pr>       turn auto-merge off on an armed PR
//   node merge-gate.mjs autofix <pr>      make one auto-fix push and log it, disarming first
//   node merge-gate.mjs live pr <n>       audit the live PR body
//   node merge-gate.mjs live release <tag>  audit the live release body
// Exit 0 = GO / clean; 1 = NO GO / faults; 2 = usage.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import kitTemp from './kit-temp.cjs';

// A change here is live the moment it merges, in this repo: workflows, the installed kit and its rules, the
// project's grant and gate settings, git hooks, and the loaded rule files.
// Case-blind: Windows folds case, so .GitHooks lands in the real folder.
// The folder's own name counts too: a link named .githooks lands git's hooks somewhere else.
export const PROTECTED = [/^\.github(\/|$)/i, /^\.kit(\/|$)/i, /^\.githooks(\/|$)/i, /^\.claude(\/|$)/i, /^project\/\.claude(\/|$)/i, /^(AGENTS|CLAUDE|CLAUDE\.local)\.md$/i];
// In the kit's own source the same things live here, and install carries them to every project: the owner's merge.
export const KIT_SOURCE_PROTECTED = [/^user\//i, /^project\//i, /^rules\//i, /^scripts\//i, /^tests\//i, /^kit\.config\.json$/i];
// git runs a repo's hooks on its own commands, and a branch can ship one under core.hooksPath. Replace refs and diff
// settings live in the repo too, and each can change what a commit or a diff reads as.
const NO_HOOKS = ['--no-replace-objects', '-c', 'core.hooksPath=/dev/null', '-c', 'diff.ignoreSubmodules=none', '-c', 'diff.relative=false'];
// What may change after the swept commit: the release bump.
export const AFTER_SWEEP = ['VERSION', 'CHANGELOG.md'];
const CONVENTIONAL = /^[a-z]+(\([^)]*\))?!?: /;
const SHA = /^[0-9a-f]{40}$/;
// STALE: GitHub marks a result it no longer counts; it is not a pass.
const BAD_CHECK = /^(FAILURE|ERROR|TIMED_OUT|CANCELLED|ACTION_REQUIRED|STARTUP_FAILURE|STALE)$/;
const HOLD_LABEL = /^(do[- ]not[- ]merge|hold|wip)$/i;

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

const REPO_NAME = /^[\w.-]+\/[\w.-]+$/;
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
	const git = (...a) => run('git', [...NO_HOOKS, ...a], cwd);
	const gh = (...a) => run('gh', a, cwd);
	if (!/^\d+$/.test(String(pr))) return { go: false, faults: ['the PR is a number'], facts };

	// The audits below are children that call git by bare name from this folder, so nothing may run while one sits here.
	const planted = fs.readdirSync(cwd).filter((f) => ROOT_TOOL.test(f));
	if (planted.length) return { go: false, faults: [`a program named like a tool sits at the repo root, and would run in place of it: ${planted.join(', ')}`], facts };

	// 1. Kill switch.
	if (fs.existsSync(path.join(config, 'autonomy-off'))) faults.push(`kill switch: ${path.join(config, 'autonomy-off')} exists; every merge asks the owner`);

	// 2. The PR itself.
	const p = json(gh('pr', 'view', String(pr), '--json', 'number,state,isDraft,isCrossRepository,headRefName,headRefOid,baseRefName,title,body,url,statusCheckRollup,reviewDecision,labels,autoMergeRequest'));
	if (!p) return { go: false, faults: [...faults, `gh could not read PR ${pr}`], facts };
	Object.assign(facts, { url: p.url, sha: p.headRefOid, base: p.baseRefName, head: p.headRefName });
	if (p.state !== 'OPEN') faults.push(`PR ${pr} is ${p.state}, not open`);
	// A field the read left out is not a no: only a plain false passes.
	if (p.isDraft !== false) faults.push(`PR ${pr} is a draft, or the read did not say`);
	if (p.isCrossRepository !== false) faults.push(`PR ${pr} comes from another repository, or the read did not say`);
	// A stop the owner set on GitHub is theirs: the gate must not undo it.
	if (p.reviewDecision === 'CHANGES_REQUESTED') faults.push(`a review on PR ${pr} asks for changes`);
	const held = (p.labels || []).map((l) => l.name).filter((n) => HOLD_LABEL.test(n || ''));
	if (held.length) faults.push(`PR ${pr} carries a hold label: ${held.join(', ')}`);
	if (!p.autoMergeRequest && stoppedOutside(cwd, run, pr)) faults.push(`PR ${pr} was armed and auto-merge is off with no disarm logged: someone stopped it, so this merge is the owner's`);
	if (!SHA.test(p.headRefOid || '')) return { go: false, faults: [...faults, 'the PR has no head commit'], facts };
	const local = git('rev-parse', 'HEAD').stdout.trim();
	if (local !== p.headRefOid) faults.push(`the working copy is at ${local.slice(0, 12) || 'nothing'}, not the PR's head ${p.headRefOid.slice(0, 12)}: check out the branch and pull`);
	// The audits read the working copy: an edit not in the head would be judged in its place.
	const dirty = git('status', '--porcelain', '--untracked-files=no');
	if (dirty.status !== 0 || dirty.stdout.trim()) faults.push(`the working copy has uncommitted changes the audits would read: ${dirty.stdout.trim().split('\n').map((l) => l.slice(3)).join(', ') || 'git status failed'}`);

	// 3. Repo settings.
	// `gh repo view` has no auto-merge field, so this reads the REST repo; {owner}/{repo} is gh's own placeholder for this repo.
	const repo = json(gh('api', 'repos/{owner}/{repo}'));
	if (!repo) return { go: false, faults: [...faults, 'gh could not read the repository'], facts };
	// `gh api` keeps to the default host while `gh pr view` follows the remote, so the read must prove it is this PR's repo.
	if (!isPrRepo(repo, p.url)) return { go: false, faults: [...faults, `the repo read (${JSON.stringify(repo.html_url)}) is not the repo of PR ${pr} (${p.url}), so no setting of it counts`], facts };
	// REST leaves both settings out for a login without push rights: that is not the same as off.
	if (repo.allow_auto_merge == null || repo.delete_branch_on_merge == null) faults.push(`this login cannot read the merge settings of ${repo.full_name}: it needs push rights there`);
	else if (repo.allow_auto_merge !== true || repo.delete_branch_on_merge !== true) {
		faults.push(`${repo.full_name} must allow auto-merge and delete branches on merge (the owner runs: gh api -X PATCH repos/${repo.full_name} -F allow_auto_merge=true -F delete_branch_on_merge=true)`);
	}

	// 4. A required check on the base: branch protection or a ruleset.
	const prot = json(gh('api', `repos/${repo.full_name}/branches/${encodeURIComponent(p.baseRefName)}/protection/required_status_checks`));
	const rules = json(gh('api', `repos/${repo.full_name}/rules/branches/${encodeURIComponent(p.baseRefName)}`));
	// Each answer is held to its shape: a string where a list belongs would read as one check per letter.
	const list = (v) => v == null || Array.isArray(v);
	const ruleSets = Array.isArray(rules) ? rules.filter((r) => r && r.type === 'required_status_checks') : [];
	const shaped = (!prot || (list(prot.contexts) && list(prot.checks))) && ruleSets.every((r) => list((r.parameters || {}).required_status_checks));
	if (!shaped) return { go: false, faults: [...faults, `gh could not read the required checks of ${p.baseRefName}: the answer is not the shape GitHub gives`], facts };
	const fromProt = prot ? [...(prot.contexts || []), ...(prot.checks || []).map((c) => c && c.context)] : [];
	const fromRules = ruleSets.flatMap((r) => ((r.parameters || {}).required_status_checks || []).map((c) => c && c.context));
	const required = [...new Set([...fromProt, ...fromRules].filter((c) => typeof c === 'string' && c))];
	facts.required = required;
	if (!required.length) faults.push(`${p.baseRefName} requires no status check, so auto-merge would merge at once: protect it first (rule:first-push-gate)`);
	// Unless the base needs the branch up to date, a PR checked against an old base merges onto a new one untested.
	const strict = (prot && prot.strict === true) || ruleSets.some((r) => (r.parameters || {}).strict_required_status_checks_policy === true);
	if (required.length && !strict) faults.push(`${p.baseRefName} does not require a branch to be up to date before it merges, so a PR could merge onto a base its checks never ran on: the owner turns on "require branches to be up to date" for its required checks`);
	// GitHub waits only for required checks, and merges at once past a failed optional one, so any failure stops it here.
	const failed = (p.statusCheckRollup || []).filter((c) => BAD_CHECK.test(c.conclusion || c.state || '')).map((c) => c.name || c.context);
	if (failed.length) faults.push(`checks are failing: ${failed.join(', ')}`);
	// A required check holds the merge; a running optional one does not, and could fail after it lands.
	const running = (p.statusCheckRollup || []).filter((c) => (c.status ? c.status !== 'COMPLETED' : /^(PENDING|EXPECTED)$/.test(c.state || '')))
		.map((c) => c.name || c.context).filter((n) => !required.includes(n));
	if (running.length) faults.push(`checks are still running and none requires them: ${running.join(', ')}; wait, then run the gate again`);

	// 5. The diff, from the merge base on the remote base branch.
	const pinned = pinBase({ git, gh, repo: repo.full_name, base: p.baseRefName, cwd });
	if (pinned.fault) return { go: false, faults: [...faults, pinned.fault], facts };
	const baseRef = pinned.tip;
	const mb = git('merge-base', baseRef, p.headRefOid);
	let files = [];
	if (mb.status !== 0) faults.push(`no merge base between ${baseRef} and the head`);
	else {
		files = changedFiles(git, mb.stdout.trim(), p.headRefOid);
		const kitSource = git('cat-file', '-e', `${baseRef}:user/kit-tools/merge-gate.mjs`).status === 0;
		const guarded = kitSource ? [...PROTECTED, ...KIT_SOURCE_PROTECTED] : PROTECTED;
		if (!files) faults.push(`git could not list what the PR changes against ${baseRef}`);
		else {
			const hit = files.filter((f) => guarded.some((re) => re.test(f)));
			if (hit.length) faults.push(`the diff touches gate or rule paths the owner merges by hand: ${hit.join(', ')}`);
		}
	}

	// 6. The sweep.
	faults.push(...sweepFaults({ cwd, config, branch: p.headRefName, head: p.headRefOid, git, run }));

	// 7. The live body, by the base branch's own audit.
	faults.push(...settingFaults({ cwd, baseRef, git }));
	faults.push(...bodyFaults({ cwd, config, body: p.body || '', title: p.title || '', baseRef, git, run }));

	return { go: faults.length === 0, faults, facts };
}

// Every path a diff touches, renames as both ends and each name raw, or null when git cannot say.
function changedFiles(git, from, to) {
	const r = git('diff', '--name-only', '-z', '--no-renames', from, to);
	return r.status === 0 ? r.stdout.split('\0').filter(Boolean) : null;
}

// approve.mjs's log, the record a report cannot write for itself: every clearing, each line chained to the one
// before, with its tier and whether reviewers really ran under it.
function approvals(git) {
	const dir = git('rev-parse', '--path-format=absolute', '--git-common-dir').stdout.trim();
	const file = path.join(dir, 'kit-sweep-approvals.jsonl');
	const lines = dir && fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean) : [];
	const hash = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);
	const log = [];
	for (const [i, l] of lines.entries()) {
		let e = null;
		try { e = JSON.parse(l); } catch { /* checked below */ }
		if (!e || e.prev !== (i ? hash(lines[i - 1]) : '')) return { broken: i + 1, clearings: [] };
		log.push(e);
	}
	const clearings = log.flatMap((e, i) => {
		if (!e.head || typeof e.contract !== 'string' || !(e.kind === 'owner-yes' || (e.kind === 'decision' && e.decision === 'approved'))) return [];
		const later = log.slice(i + 1).filter((x) => x.contract === e.contract);
		const closing = later.find((x) => x.kind === 'outcome' || x.kind === 'unread');
		const tier = e.tier ?? log.slice(0, i).reverse().find((x) => x.kind === 'decision' && x.contract === e.contract)?.tier;
		return [{ head: e.head, contract: e.contract, tier, ran: closing?.kind === 'outcome' && !closing.noneRan }];
	});
	return { clearings };
}

// A report is typed, so a high counts as fixed only when its own cell says FIXED and each commit named is in the branch.
function openHighs(r, head, git) {
	const faults = [];
	for (const line of r.text.split('\n')) {
		const cells = line.split('|').map((c) => c.trim());
		const row = cells.slice(1, -1).some((c) => /^(high|critical)$/i.test(c));
		const bullet = /\*\*[^*]*\((high|critical)\)\*\*/i.test(line);
		if (!row && !bullet) continue;
		const said = row ? cells[cells.length - 2] : (line.match(/FIXED [^|]*$/) || [''])[0];
		const shas = said.match(/\b(?=[0-9a-f]*\d)[0-9a-f]{7,40}\b/g) || [];
		const real = (s) => { const sha = git('rev-parse', '-q', '--verify', `${s}^{commit}`).stdout.trim(); return sha && git('merge-base', '--is-ancestor', sha, head).status === 0; };
		if (!/^FIXED\b/.test(said) || !shas.length || !shas.every(real)) faults.push(`${r.f}: a high or critical finding is not closed by a commit in this branch: ${line.trim().slice(0, 100)}`);
	}
	return faults;
}

function sweepFaults({ cwd, config, branch, head, git, run }) {
	const audit = path.join(config, 'skills', 'pre-pr-sweep', 'audit.mjs');
	if (!fs.existsSync(audit)) return [`no sweep audit at ${audit}: install the kit's user layer`];
	const { broken, clearings } = approvals(git);
	if (broken) return [`the approval log was changed by hand at line ${broken}: this merge is the owner's`];
	// The sweep folder is the project's (adapter A22), so the log's contracts name it.
	const dirs = [...new Set([path.join(cwd, 'reports', 'sweeps'), ...clearings.map((c) => path.dirname(c.contract))])];
	const onBranch = new RegExp(`(^|[\\s\`(])${branch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[\\s\`,;:)])`);
	const named = dirs.flatMap((dir) => (fs.existsSync(dir) ? fs.readdirSync(dir) : []).filter((f) => f.endsWith('.md')).map((f) => {
		const text = fs.readFileSync(path.join(dir, f), 'utf8');
		const covers = (text.match(/\*\*Covers:\*\*\s*`?([0-9a-f]{7,40})\b/) || [])[1];
		const tier = (text.match(/\*\*Tier:\*\*\s*([a-z ]+)/i) || [])[1];
		return { f, file: path.join(dir, f), text, covers, tier: tier?.trim().toLowerCase(), named: text.split('\n').slice(0, 20).some((l) => onBranch.test(l)) };
	})).filter((r) => r.named);
	if (!named.length) return [`no sweep report names the branch ${branch}, in ${dirs.join(' or ')}`];
	// The nearest covered commit at or before the head is the one that counts, and every report on it must pass, so a
	// clean file cannot stand in front of one with an open finding.
	const covered = named.flatMap((r) => {
		if (!r.covers) return [];
		const sha = git('rev-parse', '-q', '--verify', `${r.covers}^{commit}`).stdout.trim();
		if (!sha || git('merge-base', '--is-ancestor', sha, head).status !== 0) return [];
		return [{ ...r, sha, ahead: Number(git('rev-list', '--count', `${sha}..${head}`).stdout.trim()) }];
	});
	if (!covered.length) return [`no sweep report for ${branch} names a Covers commit at or before the head (a line "**Covers:** <sha>")`];
	const nearest = Math.min(...covered.map((r) => r.ahead));
	const reports = covered.filter((r) => r.ahead === nearest);
	const best = reports[0];
	// Every report on this branch, not only the nearest: a later clean one does not close an earlier high.
	const faults = covered.flatMap((r) => openHighs(r, head, git));
	// A report is typed by the session, so what it claims is held to the log.
	// The whole commit, never a short prefix: seven hex digits are few enough to match a commit made to match.
	const clearing = clearings.filter((c) => c.head === best.sha).pop();
	if (!clearing) faults.push(`the sweep at ${best.sha.slice(0, 12)} was never cleared: no approval in the log names that commit`);
	else if (!clearing.ran) faults.push(`the sweep at ${best.sha.slice(0, 12)} has no reviewer outcome in the log: none ran, or it was cut short`);
	for (const r of reports) {
		if (clearing && r.tier !== clearing.tier) faults.push(`${r.f} names tier ${r.tier || 'none'}; the sweep was cleared as ${clearing.tier}`);
		if (/ACCEPTED owner/.test(r.text)) faults.push(`${r.f} carries an owner acceptance: a session can type one, so this merge is the owner's`);
		if (r.text.split('\n').some((l) => /align|version goal|version-goal/i.test(l) && /\bNO\b/.test(l) && !/\bYES\b/.test(l))) faults.push(`${r.f} gives the version goal as NO`);
	}
	const changed = changedFiles(git, best.sha, head);
	if (!changed) faults.push('git could not list what changed after the sweep');
	const after = (changed || []).filter((f) => !AFTER_SWEEP.includes(f));
	if (after.length) faults.push(`changed after the sweep covered ${best.sha.slice(0, 12)} and never reviewed: ${after.join(', ')}`);
	for (const r of reports) {
		const a = run(process.execPath, [audit, r.file], cwd);
		if (a.status !== 0) faults.push(`sweep report ${r.f} fails its audit: ${a.stdout.trim().split('\n').join('; ')}`);
	}
	return faults;
}

// The PR-body audit and the files it imports, copied to a temp folder: from the base tree (.claude/, or project/.claude/
// in the kit's own source), else from the installed user layer. A kit-local project keeps .claude/ out of git, and
// its folder on disk is the session's to edit, so it is never read.
function baseAudit(git, baseRef, name, config) {
	for (const dir of ['.claude', 'project/.claude']) {
		if (git('cat-file', '-e', `${baseRef}:${dir}/${name}`).status !== 0) continue;
		return copied((tmp) => {
			for (const f of git('ls-tree', '--name-only', `${baseRef}:${dir}`).stdout.split('\n').filter((n) => /\.(mjs|cjs|json)$/.test(n))) {
				fs.writeFileSync(path.join(tmp, f), git('show', `${baseRef}:${dir}/${f}`).stdout);
			}
		}, name);
	}
	const installed = path.join(config, 'kit-tools', 'audits');
	if (!fs.existsSync(path.join(installed, name))) return null;
	return copied((tmp) => {
		for (const f of fs.readdirSync(installed)) fs.copyFileSync(path.join(installed, f), path.join(tmp, f));
	}, name);
}

// A copy that fails part way removes its folder before the error goes on; the caller removes it after a good one.
function copied(fill, name) {
	const tmp = kitTemp.makeTemp('merge-gate-');
	try {
		fill(tmp);
	} catch (e) {
		kitTemp.removeTemp(tmp);
		throw e;
	}
	return { tmp, script: path.join(tmp, name) };
}

// The audits read these from the working copy, so a file the base does not hold could turn a check off. One kept out
// of git on purpose (ignored or excluded) is the project's own, as its kit is.
const AUDIT_SETTINGS = ['.kit/version-bump.json', '.kit/pr-body.json'];
function settingFaults({ cwd, baseRef, git }) {
	return AUDIT_SETTINGS.flatMap((f) => {
		const disk = path.join(cwd, f);
		if (!fs.existsSync(disk)) return [];
		const base = git('show', `${baseRef}:${f}`);
		if (base.status === 0) return base.stdout.replace(/\r\n/g, '\n') === fs.readFileSync(disk, 'utf8').replace(/\r\n/g, '\n') ? [] : [`${f} differs from ${baseRef}: the audit would read a setting not on the base`];
		// Ignored by a rule the base holds (.gitignore) is the project's choice; by this clone's own exclude file it is
		// a session's, and any session can write it.
		const why = git('check-ignore', '-v', f);
		if (why.status !== 0) return [`${f} is not on the base: the audit would read a setting not on the base`];
		return /(^|[\\/])info[\\/]exclude:/i.test(why.stdout) ? [`${f} is kept out of git only in this clone (info/exclude): the audit would read a setting the base does not hold`] : [];
	});
}

// `gh api` keeps to the default host while `gh pr view` follows the remote, so a repo read must prove it is the PR's.
const isPrRepo = (repo, url) => String(url || '').toLowerCase().startsWith(`${String(repo.html_url || '').toLowerCase()}/pull/`) && REPO_NAME.test(String(repo.full_name || ''));

/**
 * Fetch a base branch and hold it to the tip GitHub reports, so what is judged is GitHub's base whatever the checkout's
 * remotes, refs and grafts say. Later reads use the sha: a short name can resolve to a tag or branch made here.
 *
 * Returns:
 *     { tip } or { fault }
 */
function pinBase({ git, gh, repo, base, cwd }) {
	const grafts = path.resolve(cwd, git('rev-parse', '--git-path', 'info/grafts').stdout.trim() || '.git/info/grafts');
	if (fs.existsSync(grafts)) return { fault: `${grafts} rewrites history for git, so no diff here can be trusted: remove it` };
	const tracking = `refs/remotes/origin/${base}`;
	if (git('fetch', '--quiet', 'origin', `+refs/heads/${base}:${tracking}`).status !== 0) return { fault: `could not fetch ${base} from origin, so the base would be stale` };
	const tip = (json(gh('api', `repos/${repo}/branches/${encodeURIComponent(base)}`)) || {}).commit?.sha;
	if (!tip) return { fault: `gh could not read the tip of ${base}, so nothing can be judged against it` };
	const local = git('rev-parse', '--verify', '--quiet', tracking).stdout.trim();
	if (tip !== local) return { fault: `origin/${base} is at ${local.slice(0, 12) || 'nothing'}, and GitHub's base is at ${tip.slice(0, 12)}: run the gate again in case it just moved, else check that origin is this repo` };
	return { tip };
}

function bodyFaults({ cwd, config, body, title, baseRef, git, run }) {
	const name = CONVENTIONAL.test(title) ? 'pr-body-audit-lean.mjs' : 'pr-body-audit.mjs';
	const found = baseAudit(git, baseRef, name, config);
	if (!found) return [`${baseRef} has no ${name}, and no installed copy in ${path.join(config, 'kit-tools', 'audits')}: install the kit's user layer`];
	try {
		const file = path.join(found.tmp, 'pr-body.md');
		fs.writeFileSync(file, body);
		const r = run(process.execPath, [found.script, file, title], cwd);
		return r.status === 0 ? [] : [`the live PR body fails ${name}: ${(r.stdout + r.stderr).trim().split('\n').filter((l) => /FAIL|fault|must|no /i.test(l)).slice(0, 8).join('; ') || 'see the audit'}`];
	} finally {
		kitTemp.removeTemp(found.tmp);
	}
}

/**
 * Audit a published body as it reads live (I21).
 *
 * Returns:
 *     { ok, faults }
 */
export function live({ kind, id, cwd, config = configDir(), run = realRun }) {
	const git = (...a) => run('git', [...NO_HOOKS, ...a], cwd);
	const gh = (...a) => run('gh', a, cwd);
	if (kind === 'pr') {
		const p = json(gh('pr', 'view', String(id), '--json', 'title,body,baseRefName,url'));
		if (!p) return { ok: false, faults: [`gh could not read PR ${id}`] };
		const repo = json(gh('api', 'repos/{owner}/{repo}'));
		if (!repo || !isPrRepo(repo, p.url)) return { ok: false, faults: [`the repo read is not the repo of PR ${id} (${p.url})`] };
		const pinned = pinBase({ git, gh, repo: repo.full_name, base: p.baseRefName, cwd });
		if (pinned.fault) return { ok: false, faults: [pinned.fault] };
		const faults = bodyFaults({ cwd, config, body: p.body || '', title: p.title || '', baseRef: pinned.tip, git, run });
		return { ok: !faults.length, faults };
	}
	if (kind === 'release') {
		const r = json(gh('release', 'view', String(id), '--json', 'body,tagName'));
		if (!r) return { ok: false, faults: [`gh could not read release ${id}`] };
		const audit = path.join(config, 'skills', 'release-notes', 'audit.mjs');
		if (!fs.existsSync(audit)) return { ok: false, faults: [`no release-notes audit at ${audit}`] };
		const tmp = kitTemp.makeTemp('merge-gate-');
		try {
			const file = path.join(tmp, 'release.md');
			fs.writeFileSync(file, r.body || '');
			const a = run(process.execPath, [audit, file, String(r.tagName).replace(/^v/, '')], cwd);
			return a.status === 0 ? { ok: true, faults: [] } : { ok: false, faults: a.stdout.trim().split('\n') };
		} finally {
			kitTemp.removeTemp(tmp);
		}
	}
	return { ok: false, faults: ['live takes pr <n> or release <tag>'] };
}

// One log per repo, in the common git folder, where the pre-push hook reads it from any worktree.
// Armed in the log, with no disarm after it: read beside a host showing auto-merge off, it means someone else stopped it.
function stoppedOutside(cwd, run, pr) {
	let armed = false;
	let text = '';
	try { text = fs.readFileSync(gateLog(cwd, run), 'utf8'); } catch { return false; }
	for (const line of text.split('\n')) {
		const [, kind, what] = line.split(' ');
		if (kind === 'ARMED' && String(what).endsWith(`/${pr}`)) armed = true;
		if (kind === 'DISARMED' && what === String(pr)) armed = false;
	}
	return armed;
}

const gateLog = (cwd, run) => path.join(path.resolve(cwd, run('git', [...NO_HOOKS, 'rev-parse', '--path-format=absolute', '--git-common-dir'], cwd).stdout.trim() || '.git'), 'kit-merge-gate.log');

/**
 * Check, and on GO arm auto-merge pinned to the checked head, read it back and log it.
 *
 * Returns:
 *     { armed, faults, facts }
 */
export function arm({ pr, cwd, config = configDir(), run = realRun, now = () => new Date().toISOString() }) {
	const res = check({ pr, cwd, config, run });
	const gitDir = path.resolve(cwd, run('git', [...NO_HOOKS, 'rev-parse', '--git-dir'], cwd).stdout.trim() || '.git');
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
	fs.appendFileSync(gateLog(cwd, run), `${now()} ARMED ${res.facts.url} ${res.facts.sha} required=${res.facts.required.join(',')}\n`);
	if (fs.existsSync(triage)) fs.rmSync(triage);
	return { armed: true, faults: [], facts: res.facts };
}

/**
 * Turn auto-merge off on one PR, read it back and log it. Stopping is always allowed, kill switch or not: it is the
 * only way to stop a PR already armed, and the kill switch stops the next arming, not this one.
 *
 * Returns:
 *     { disarmed, faults }
 */
export function disarm({ pr, cwd, run = realRun, now = () => new Date().toISOString() }) {
	if (!/^\d+$/.test(String(pr))) return { disarmed: false, faults: ['the PR is a number'] };
	const m = run('gh', ['pr', 'merge', String(pr), '--disable-auto'], cwd);
	const back = json(run('gh', ['pr', 'view', String(pr), '--json', 'autoMergeRequest,state'], cwd));
	// The read-back decides: gh may exit non-zero on a PR with nothing to turn off.
	if (!back || back.autoMergeRequest) return { disarmed: false, faults: [`PR ${pr} is still armed: ${(m.stderr || m.stdout).trim() || 'auto-merge still shows on the PR'}`] };
	fs.appendFileSync(gateLog(cwd, run), `${now()} DISARMED ${pr}\n`);
	return { disarmed: true, faults: [] };
}

/**
 * One auto-fix push, inside the owner's grant: the kill switch stops it, an armed PR is disarmed first, it only moves
 * the PR's own branch forward, and the commit that went out is logged. Git runs with no hooks: the pre-push hook asks
 * for the owner's go, this grant is that go, and a branch must not ship code that runs inside it.
 *
 * Returns:
 *     { pushed, sha, faults }
 */
export function autofix({ pr, cwd, config = configDir(), run = realRun, now = () => new Date().toISOString() }) {
	const no = (...faults) => ({ pushed: false, faults });
	const git = (...a) => run('git', [...NO_HOOKS, ...a], cwd);
	if (!/^\d+$/.test(String(pr))) return no('the PR is a number');
	const planted = fs.readdirSync(cwd).filter((f) => ROOT_TOOL.test(f));
	if (planted.length) return no(`a program named like a tool sits at the repo root, and would run in place of it: ${planted.join(', ')}`);
	if (fs.existsSync(path.join(config, 'autonomy-off'))) return no(`kill switch: ${path.join(config, 'autonomy-off')} exists; this push asks the owner`);
	const p = json(run('gh', ['pr', 'view', String(pr), '--json', 'state,isCrossRepository,headRefName,headRefOid,autoMergeRequest'], cwd));
	if (!p || p.state !== 'OPEN' || p.isCrossRepository) return no(`PR ${pr} is not an open PR from this repo`);
	if (git('symbolic-ref', '--short', 'HEAD').stdout.trim() !== p.headRefName) return no(`the working copy is not on the PR's branch ${p.headRefName}`);
	const local = git('rev-parse', 'HEAD').stdout.trim();
	if (local === p.headRefOid) return no('nothing to push: the working copy is at the PR\'s head');
	if (git('merge-base', '--is-ancestor', p.headRefOid, local).status !== 0) return no('the working copy does not build on the PR\'s head: pull first; a rewrite is the owner\'s');
	if (!p.autoMergeRequest && stoppedOutside(cwd, run, pr)) return no(`PR ${pr} was armed and auto-merge is off with no disarm logged: someone stopped it, so this push is the owner's`);
	if (p.autoMergeRequest) {
		const d = disarm({ pr, cwd, run, now });
		if (!d.disarmed) return no(...d.faults);
	}
	const out = git('push', 'origin', `${local}:refs/heads/${p.headRefName}`);
	if (out.status !== 0) return no(`the push failed: ${(out.stderr || out.stdout).trim().slice(0, 200)}`);
	fs.appendFileSync(gateLog(cwd, run), `${now()} AUTOFIX ${pr} ${local}\n`);
	return { pushed: true, sha: local, faults: [] };
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
	} else if (cmd === 'disarm' && a) {
		const r = disarm({ pr: a, cwd });
		console.log(r.disarmed ? `DISARMED: PR ${a} will not merge on its own` : r.faults.join('\n'));
		process.exit(r.disarmed ? 0 : 1);
	} else if (cmd === 'autofix' && a) {
		const r = autofix({ pr: a, cwd });
		console.log(r.pushed ? `PUSHED: ${r.sha} to PR ${a}; logged. Run the gate again to arm it.` : r.faults.join('\n'));
		process.exit(r.pushed ? 0 : 1);
	} else if (cmd === 'live' && a && b) {
		const r = live({ kind: a, id: b, cwd });
		console.log(r.ok ? `Live ${a} body: clean` : r.faults.join('\n'));
		process.exit(r.ok ? 0 : 1);
	} else {
		console.log('Usage: node merge-gate.mjs arm <pr> | check <pr> | disarm <pr> | autofix <pr> | live pr <n> | live release <tag>');
		process.exit(2);
	}
}
