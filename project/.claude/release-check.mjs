#!/usr/bin/env node
// The release-step check (K65, the owner's ask 2026-11-15). 1.34.0's tag shipped with no GitHub release notes until the
// owner asked: each step was a claim in a closeout, and nothing read the real state before the release was called done.
// This reads every fact, names every step that is missing at once, and exits 1 until all pass. It only reads: it moves,
// publishes or installs nothing. The closeout does not call a release done, or hand back, until it passes.
//
// Usage (from the project folder; the PR is the one whose merge is released):
//   node .claude/release-check.mjs <tag> --pr <n> [--copy <release copy folder>] [--installed <project folder>]
//   --copy        a release copy that must sit, clean, on the tag (the kit's own flow)
//   --installed   a project whose installed kit (.kit/kit-version.json) must be the tag's version
// Steps: the PR is merged; main CI passed on the merge commit; the tag holds the merge commit's files; the release
// notes are published (not a draft, not empty); the project's state check passes; then --copy and --installed.
// What it cannot see: whether the notes say true things (rule:release-notes has the claim audit for that).
// Exit 0 every step done, 1 a step missing, 2 a usage error.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const run = (cmd, args, cwd) => spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout: 60000 });
const json = (r) => { try { return r.status === 0 ? JSON.parse(r.stdout) : null; } catch { return null; } };
const one = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);

/**
 * Check one release, every step.
 *
 * Args:
 *     opts: { tag, pr, project, copy?, installed? }
 *     deps: { gh(args, cwd), state(project), log(line) } - the outside calls, so a test can stand in for GitHub
 *
 * Returns:
 *     { ok, missing: [plain lines] }
 */
export function releaseCheck({ tag, pr, project, copy, installed }, deps = {}) {
	const gh = deps.gh || ((args, cwd) => run('gh', args, cwd));
	const log = deps.log || ((l) => process.stdout.write(`${l}\n`));
	const state = deps.state || ((dir) => (fs.existsSync(path.join(dir, '.claude', 'state.mjs')) ? run(process.execPath, [path.join(dir, '.claude', 'state.mjs'), 'check'], dir) : null));
	const git = (dir, ...a) => run('git', ['-C', dir, '-c', 'core.fsmonitor=false', ...a], dir);
	// The tag and the PR go into git and gh arguments: a plain name and a whole number only, never an option.
	if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(String(tag)) || /\.\./.test(tag) || !/^\d{1,9}$/.test(String(pr))) {
		log('MISSING the tag must be a plain name (letters, digits, dots, dashes) and the PR a number.');
		return { ok: false, missing: ['a usable tag and PR number'] };
	}
	const steps = 5 + (copy ? 1 : 0) + (installed ? 1 : 0);
	const missing = [];
	let n = 0;
	const step = (title, why) => {
		n++;
		if (why) { missing.push(`${title}: ${why}`); log(`[${n}/${steps}] MISSING ${title}: ${why}`); } else log(`[${n}/${steps}] PASS ${title}`);
	};
	const tree = (dir, c) => git(dir, 'rev-parse', '--verify', '-q', `${c}^{tree}`).stdout.trim();

	const p = json(gh(['pr', 'view', String(pr), '--json', 'state,mergeCommit,baseRefName'], project));
	const merge = p && p.state === 'MERGED' && p.mergeCommit && p.mergeCommit.oid;
	step(`PR ${pr} merged`, !p ? `PR ${pr} could not be read from GitHub` : merge ? null : `PR ${pr} is not merged (${one(p.state)})`);

	let ci = 'no merge commit to read';
	if (merge) {
		const runs = json(gh(['run', 'list', '--commit', merge, '--json', 'name,status,conclusion,headBranch,event'], project));
		// Only runs on the base branch itself: a PR run on the same files is not main's CI.
		const mine = (runs || []).filter((r) => r.headBranch === p.baseRefName && r.event !== 'pull_request');
		if (!runs) ci = 'the runs could not be read from GitHub';
		else if (!mine.length) ci = `no CI run on ${one(p.baseRefName)} for ${merge.slice(0, 12)}`;
		else if (mine.some((r) => r.status !== 'completed')) ci = `still running: ${mine.filter((r) => r.status !== 'completed').map((r) => one(r.name)).join(', ')}`;
		else if (mine.some((r) => !['success', 'skipped', 'neutral'].includes(r.conclusion))) ci = `not green: ${mine.filter((r) => !['success', 'skipped', 'neutral'].includes(r.conclusion)).map((r) => `${one(r.name)} ${one(r.conclusion)}`).join(', ')}`;
		else ci = null;
	}
	step(`main CI green on the merge commit`, ci);

	let tagged = 'no merge commit to compare';
	// The tag as GitHub holds it, read without writing any ref here: a local tag of the same name proves nothing.
	const remoteTag = (dir) => {
		const out = git(dir, 'ls-remote', 'origin', `refs/tags/${tag}`, `refs/tags/${tag}^{}`).stdout.split(/\r?\n/).map((l) => l.split('\t'));
		const peeled = out.find(([, ref]) => ref === `refs/tags/${tag}^{}`);
		const direct = out.find(([, ref]) => ref === `refs/tags/${tag}`);
		return ((peeled || direct || [])[0] || '').trim();
	};
	const tagCommit = remoteTag(project);
	if (!tagCommit) tagged = `no tag ${tag} on GitHub`;
	else if (merge) {
		git(project, 'fetch', '-q', 'origin', merge, tagCommit);
		// The tag may sit on the squash commit or a commit with the same files: the files are what ships.
		tagged = tree(project, merge) && tree(project, tagCommit) === tree(project, merge) ? null : `tag ${tag} does not hold the merge commit's files (${tagCommit.slice(0, 12)} against ${merge.slice(0, 12)})`;
	}
	step(`tag ${tag} on the merge`, tagged);

	const rel = json(gh(['release', 'view', tag, '--json', 'tagName,isDraft,body'], project));
	step('release notes published', !rel ? `no published release notes for ${tag} (gh release view ${tag})` : rel.isDraft ? `the release notes for ${tag} are still a draft` : !String(rel.body || '').trim() ? `the release for ${tag} has no notes` : null);

	const st = state(project);
	step('state check', st && st.status !== 0 ? `the state check fails: ${one(st.stdout || st.stderr)}` : null);

	if (copy) {
		const head = git(copy, 'rev-parse', 'HEAD').stdout.trim();
		const at = remoteTag(copy);
		const dirty = git(copy, 'status', '--porcelain').stdout.trim();
		step(`release copy on ${tag}`, !at || head !== at ? `the release copy is not on ${tag} (HEAD ${head.slice(0, 12)})` : dirty ? 'the release copy has changes' : null);
	}
	if (installed) {
		let v = null;
		try { v = JSON.parse(fs.readFileSync(path.join(installed, '.kit', 'kit-version.json'), 'utf8')).version; } catch { /* named below */ }
		const want = tag.replace(/^v/, '');
		step(`installed kit ${want}`, v === want ? null : `the installed kit in ${installed} is ${one(v) || 'not stamped'}, not ${want}`);
	}
	log(missing.length ? `MISSING ${missing.length} step(s): the release is not done, and the closeout does not call it done.` : `RELEASE COMPLETE: every step of ${tag} is done.`);
	return { ok: missing.length === 0, missing };
}

function argsOf(argv) {
	const o = { tag: argv[0] };
	for (let i = 1; i < argv.length; i++) if (['--pr', '--copy', '--installed'].includes(argv[i])) o[argv[i].slice(2)] = argv[++i];
	return o;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
	const o = argsOf(process.argv.slice(2));
	if (!o.tag || !o.pr || !/^\d+$/.test(o.pr)) {
		process.stdout.write('usage: node .claude/release-check.mjs <tag> --pr <n> [--copy <release copy>] [--installed <project>]\n');
		process.exitCode = 2;
	} else {
		const r = releaseCheck({ tag: o.tag, pr: o.pr, project: process.cwd(), copy: o.copy && path.resolve(o.copy), installed: o.installed && path.resolve(o.installed) });
		process.exitCode = r.ok ? 0 : 1;
	}
}
