#!/usr/bin/env node
// The release-step check (K65, the owner's ask 2026-11-15). 1.34.0's tag shipped with no GitHub release notes until the
// owner asked: each step was a claim in a closeout, and nothing read the real state before the release was called done.
// This reads every fact, names every step that is missing at once, and exits 1 until all pass. The release-notes skill
// runs it after publishing, and the closeout before it calls a release done.
//
// Usage (from the project folder; the PR is the one whose merge is released):
//   node .claude/release-check.mjs <tag> --pr <n> [--repo <owner/name>] [--copy <release copy>] [--installed <project>]
//                                  [--result <RESULT.md>] [--plugin <plugin build>]
//   --plugin      a plugin build (kit.mjs build plugin) whose kit-build.json must record the tag and its commit (K179)
//   --result      a verify's result file, whose "Re-run: <what>: recorded <n>, re-run <n>" line must match (J1)
//   --repo        the GitHub repo; by default the one the project's origin remote names
//   --copy        a release copy whose HEAD must be the tag's commit (the kit's own flow)
//   --installed   a project whose installed kit (.kit/kit-version.json) must be the tag's version; its state check is
//                 the one run (the kit folder has none of its own)
// Steps: the PR is merged; every push run of main's CI passed on the merge commit; the tag holds the merge commit's
// files; the release notes are published and pass the release-notes audit; the state check passes; then --copy and
// --installed. Every fact comes from GitHub's API or a git read that runs no program (no fetch, no status): it writes
// nothing in the project. gh and git start from Node's own folder, so a gh.exe or git.exe planted in the project is
// not the one found first on Windows.
// What it cannot see: whether the notes say true things (rule:release-notes has the claim audit), whether the release
// copy has local changes (release-verify.mjs checks that when it moves the copy), and the user layer's install
// (release-verify.mjs runs install and status).
// Exit 0 every step done, 1 a step missing, 2 a usage error.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const kitTemp = createRequire(import.meta.url)('./kit-temp.cjs');

const GREEN = ['success'];
const BESIDE = path.dirname(process.execPath);
const run = (cmd, args) => spawnSync(cmd, args, { cwd: BESIDE, encoding: 'utf8', timeout: 60000 });
const json = (r) => { try { return r.status === 0 ? JSON.parse(r.stdout) : null; } catch { return null; } };
// One line of plain text for the output: no control character or line break of any kind.
const one = (s) => String(s ?? '').replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
// A repo's own config must not run a program (core.fsmonitor, a protocol helper).
const git = (dir, ...a) => run('git', ['--no-optional-locks', '-C', dir, '-c', 'core.fsmonitor=false', '-c', 'protocol.allow=never', ...a]);
// install fills this in, as for the other project scripts, so a caller cannot move the user layer with an env var.
const INSTALLED_HOME = "{{CLAUDE_HOME}}";
const claudeHome = () => (INSTALLED_HOME.startsWith('{' + '{') ? process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude') : INSTALLED_HOME);

/** owner/name from a GitHub remote URL (https or ssh), or null. */
export function repoOf(url) {
	const m = String(url || '').trim().match(/^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([A-Za-z0-9-]+\/[A-Za-z0-9._-]+?)(?:\.git)?\/?$/);
	return m ? m[1] : null;
}

/** The release-notes skill's audit, run on the live body; the faults, or null when the audit is not installed. */
function auditNotes(body, version) {
	const audit = path.join(claudeHome(), 'skills', 'release-notes', 'audit.mjs');
	if (!fs.existsSync(audit)) return null;
	// The kit's one temp helper: the folder is made new and removed after, even when the audit throws.
	return kitTemp.withTemp('kit-notes-', (dir) => {
		const f = path.join(dir, 'notes.md');
		fs.writeFileSync(f, body);
		const r = spawnSync(process.execPath, [audit, f, version], { cwd: dir, encoding: 'utf8', timeout: 60000 });
		return r.status === 0 ? [] : String(r.stdout || r.stderr).split(/\r?\n/).filter((l) => /^line \d+:/.test(l));
	});
}

/** The release notes a build record writes, by the kit's own script beside it, or null. */
function notesOf(root, ver, scriptRoot = root) {
	const script = path.join(scriptRoot, 'scripts', 'build-record.mjs');
	if (!fs.existsSync(script)) return null;
	const r = spawnSync(process.execPath, [script, 'notes', path.join(root, 'docs', 'builds', `${ver}.json`)], { cwd: root, encoding: 'utf8', timeout: 60000, env: { ...process.env, KIT_RECORD_ROOT: root } });
	return r.status === 0 ? r.stdout : null;
}

/**
 * Adds one line for a complete release check to <project>/.git/kit-release-checks.jsonl, the fixed place the done mark
 * reads (state.mjs), with no git call; a project with no .git folder there (a worktree) gets none.
 */
function recordComplete(dir, tag) {
	try {
		if (!fs.lstatSync(path.join(dir, '.git')).isDirectory()) return;
		fs.appendFileSync(path.join(dir, '.git', 'kit-release-checks.jsonl'), `${JSON.stringify({ at: new Date().toISOString(), tag: String(tag), version: String(tag).replace(/^v/, '') })}\n`);
	} catch { /* the done mark asks for it, and names it */ }
}

/**
 * Check one release, every step.
 *
 * Args:
 *     opts: { tag, pr, project, repo?, copy?, installed? }
 *     deps: { gh(args), git(dir, ...args), state(dir), audit(body, version), log(line) } - the outside calls
 *
 * Returns:
 *     { ok, missing: [plain lines] }
 */
export function releaseCheck({ tag, pr, project, repo, copy, installed, result, plugin }, deps = {}) {
	const gh = deps.gh || ((args) => run('gh', args));
	const g = deps.git || git;
	const log = deps.log || ((l) => process.stdout.write(`${l}\n`));
	const audit = deps.audit || auditNotes;
	// The build 23b sweep: a plugin built again from the release copy, into a folder of its own.
	const buildPlugin = deps.buildPlugin || ((dir, out) => spawnSync(process.execPath, [path.join(dir, 'scripts', 'kit.mjs'), 'build', 'plugin', '--out', out], { cwd: dir, encoding: 'utf8', timeout: 120000 }));
	const state = deps.state || ((dir) => (fs.existsSync(path.join(dir, '.claude', 'state.mjs')) ? spawnSync(process.execPath, [path.join(dir, '.claude', 'state.mjs'), 'check'], { cwd: dir, encoding: 'utf8', timeout: 60000 }) : null));
	// The tag and the PR go into git and gh arguments: a plain name and a whole number only, never an option.
	if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(String(tag)) || /\.\./.test(tag) || !/^\d{1,9}$/.test(String(pr))) {
		log('MISSING the tag must be a plain name (letters, digits, dots, dashes) and the PR a number.');
		return { ok: false, missing: ['a usable tag and PR number'] };
	}
	const slug = repo || repoOf(g(project, 'remote', 'get-url', 'origin').stdout);
	if (!slug || !/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(slug)) {
		log('MISSING the GitHub repo: the origin remote names no GitHub repo; pass --repo <owner/name>.');
		return { ok: false, missing: ['the GitHub repo'] };
	}
	// Build 20: where the release's build record is (the kit's own flow), its title and notes are compared with the live
	// release; a project with no record is not asked.
	const ver = String(tag).replace(/^v/, '');
	const recRoot = [copy, project].find((d) => d && fs.existsSync(path.join(d, 'docs', 'builds', `${ver}.json`)));
	const steps = 5 + (copy ? 1 : 0) + (installed ? 1 : 0) + (result ? 1 : 0) + (recRoot ? 1 : 0) + (plugin ? 1 : 0) + (plugin && copy ? 1 : 0);
	const missing = [];
	let n = 0;
	const step = (title, why) => {
		n++;
		if (why) { missing.push(`${title}: ${one(why)}`); log(`[${n}/${steps}] MISSING ${title}: ${one(why)}`); } else log(`[${n}/${steps}] PASS ${title}`);
	};
	// A commit's sha and tree as GitHub holds it; a tag name resolves to its commit (an annotated tag is peeled).
	const commitOf = (ref) => {
		const c = json(gh(['api', `repos/${slug}/commits/${ref}`]));
		return c && c.sha && c.commit && c.commit.tree ? { sha: c.sha, tree: c.commit.tree.sha } : null;
	};

	const p = json(gh(['pr', 'view', String(pr), '-R', slug, '--json', 'state,mergeCommit,baseRefName']));
	const merge = p && p.state === 'MERGED' && p.mergeCommit && p.mergeCommit.oid;
	step(`PR ${pr} merged`, !p ? `PR ${pr} could not be read from GitHub` : merge ? null : `PR ${pr} is not merged (${p.state})`);

	let ci = 'no merge commit to read';
	if (merge) {
		const runs = json(gh(['run', 'list', '-R', slug, '--commit', merge, '--json', 'name,status,conclusion,headBranch,event']));
		// Main's own CI is the runs a push to the base branch started; a run started by hand or on a schedule is another
		// workflow, and a PR run is the branch's.
		const mine = (runs || []).filter((r) => r.headBranch === p.baseRefName && r.event === 'push');
		const notGreen = mine.filter((r) => r.status === 'completed' && !GREEN.includes(r.conclusion));
		if (!runs) ci = 'the runs could not be read from GitHub';
		else if (!mine.length) ci = `no push run on ${p.baseRefName} for ${merge.slice(0, 12)}`;
		else if (mine.some((r) => r.status !== 'completed')) ci = `still running: ${mine.filter((r) => r.status !== 'completed').map((r) => one(r.name)).join(', ')}`;
		else if (notGreen.length) ci = `not green: ${notGreen.map((r) => `${one(r.name)} ${one(r.conclusion)}`).join(', ')}`;
		else ci = null;
	}
	step('main CI green on the merge commit', ci);

	let tagged = 'no merge commit to compare';
	const atTag = commitOf(`refs/tags/${tag}`);
	if (!atTag) tagged = `no tag ${tag} on GitHub`;
	else if (merge) {
		const m = commitOf(merge);
		// The tag may sit on the squash commit or a commit with the same files: the files are what ships.
		tagged = m && m.tree === atTag.tree ? null : `tag ${tag} does not hold the merge commit's files (${atTag.sha.slice(0, 12)} against ${merge.slice(0, 12)})`;
	}
	step(`tag ${tag} on the merge`, tagged);

	const rel = json(gh(['release', 'view', tag, '-R', slug, '--json', 'tagName,name,isDraft,body']));
	let notes = null;
	if (!rel) notes = `no published release notes for ${tag} (gh release view ${tag})`;
	else if (rel.isDraft) notes = `the release notes for ${tag} are still a draft`;
	else if (!String(rel.body || '').trim()) notes = `the release for ${tag} has no notes`;
	else {
		const faults = audit(String(rel.body), tag.replace(/^v/, ''));
		if (faults === null) notes = 'the release-notes audit is not installed (install user), so the live notes were not audited';
		else if (faults.length) notes = `the live notes fail the release-notes audit: ${faults.slice(0, 3).join('; ')}`;
	}
	step('release notes published and audited', notes);
	if (recRoot) {
		// The release copy's script writes the notes whenever there is a copy: the project's may be a branch's (the build 20 sweep).
		const scriptRoot = copy && fs.existsSync(path.join(copy, 'scripts', 'build-record.mjs')) ? copy : recRoot;
		const want = (deps.notes || notesOf)(recRoot, ver, scriptRoot);
		const title = `Methodology Kit v${ver}`;
		const norm = (t) => String(t || '').replace(/\r\n/g, '\n').split('\n').map((l) => l.trimEnd()).join('\n').trim();
		step('release title and notes from the build record', !rel ? 'no release to compare'
			: want === null ? `the build record's notes could not be written (node scripts/build-record.mjs notes docs/builds/${ver}.json)`
				: rel.name !== title ? `the release title is "${one(rel.name)}", not "${title}"`
					: norm(rel.body) !== norm(want) ? `the live notes are not the ones the build record writes: publish what node scripts/build-record.mjs release docs/builds/${ver}.json writes` : null);
	}

	const where = installed || project;
	const st = state(where);
	step('state check', !st ? `no state check ran: ${where} has no .claude/state.mjs` : st.status !== 0 ? `the state check fails: ${st.stdout || st.stderr}` : null);

	let copyOnTag = false;
	if (copy) {
		const head = g(copy, 'rev-parse', '--verify', '-q', 'HEAD').stdout.trim();
		copyOnTag = Boolean(atTag && head === atTag.sha && !g(copy, 'status', '--porcelain').stdout.trim());
		step(`release copy on ${tag}`, !atTag ? `no tag ${tag} on GitHub to compare` : head !== atTag.sha ? `the release copy is not on ${tag} (HEAD ${head.slice(0, 12) || 'unreadable'})` : null);
	}
	if (installed) {
		let v = null;
		try { v = JSON.parse(fs.readFileSync(path.join(installed, '.kit', 'kit-version.json'), 'utf8')).version; } catch { /* named below */ }
		const want = tag.replace(/^v/, '');
		step(`installed kit ${want}`, v === want ? null : `the installed kit in ${installed} is ${v ? one(v) : 'not stamped'}, not ${want}`);
	}
	// K179 (build 23b): the published plugin is pinned to the tag, so the build it holds must record the tag's own commit.
	if (plugin) {
		let rec = null;
		try { rec = JSON.parse(fs.readFileSync(path.join(plugin, 'kit-build.json'), 'utf8')); } catch { /* named below */ }
		step(`plugin build pinned to ${tag}`, !rec ? `${plugin} has no readable kit-build.json (node scripts/kit.mjs build plugin writes it)`
			: rec.tag !== tag ? `the plugin build records ${one(rec.tag)}, not ${tag}`
				: !atTag ? `no tag ${tag} on GitHub to compare`
					: rec.commit !== atTag.sha ? `the plugin build records commit ${one(rec.commit).slice(0, 12)}, not ${tag}'s ${atTag.sha.slice(0, 12)}: rebuild it from the release copy` : null);
		// The build 23b sweep: the record is two fields; the files are held to a build of the release copy, manifest for
		// manifest (the manifest hashes every file a hook loads).
		// The commit security review: the copy's own build script runs only when the copy is the tag, with nothing changed.
		if (copy && !copyOnTag) step('plugin files match a build of the release copy', 'the release copy is not the clean tag, so it was not built');
		else if (copy) {
			const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kit-rc-plugin-')), 'kit');
			let why = null;
			try {
				const r = buildPlugin(copy, out);
				const read = (d) => JSON.parse(fs.readFileSync(path.join(d, 'guard-manifest.json'), 'utf8')).files || {};
				if (!r || r.status !== 0) why = `the release copy did not build (${one(r && (r.stderr || r.stdout) || 'no answer')})`;
				else {
					const want = read(out), got = read(plugin);
					const diff = [...new Set([...Object.keys(want), ...Object.keys(got)])].filter((k) => want[k] !== got[k]).sort();
					if (diff.length) why = `${diff.length} file(s) differ (${diff.slice(0, 5).join(', ')}): rebuild the plugin from the release copy`;
				}
			} catch (e) { why = `the manifests could not be read (${one(e.message)})`; } finally { fs.rmSync(path.dirname(out), { recursive: true, force: true }); }
			step('plugin files match a build of the release copy', why);
		}
	}
	// J1 (build 11): one number the result file recorded is run again before the item moves; a re-run that differs
	// stops it. The line: "Re-run: <what>: recorded <n>, re-run <n>".
	if (result) {
		let text = null;
		try { text = fs.readFileSync(result, 'utf8'); } catch { /* named below */ }
		const m = text && text.match(/Re-run:\**\s*(.+?):\s*recorded\s+([\d,.]+),\s*re-run\s+([\d,.]+)/i);
		const num = (s) => Number(String(s).replace(/,/g, ''));
		step('re-run of a recorded number', text === null ? `${result} cannot be read`
			: !m ? `${result} has no "Re-run:" line (Re-run: <what>: recorded <n>, re-run <n>)`
				: num(m[2]) !== num(m[3]) ? `${one(m[1])} recorded ${m[2]}, but the re-run gave ${m[3]}: the item does not move` : null);
	}
	log(missing.length ? `MISSING ${missing.length} step(s): the release is not done, and the closeout does not call it done.` : `RELEASE COMPLETE: every step of ${tag} is done.`);
	// The build 20 sweep: a text file anyone can write is no proof, so a complete check is also written to a log in the
	// project's git folder, which no tool writes (owner-proof.cjs), and a row is marked done only with it.
	if (!missing.length) (deps.record || recordComplete)(installed || project, tag);
	return { ok: missing.length === 0, missing };
}

/** The arguments, or a reason they are not usable: a flag with no value, or one the check does not know, is refused. */
export function argsOf(argv) {
	const o = { tag: argv[0] };
	const FLAGS = ['--pr', '--repo', '--copy', '--installed', '--result', '--plugin'];
	for (let i = 1; i < argv.length; i++) {
		if (!FLAGS.includes(argv[i])) return { why: `unknown argument ${one(argv[i])}` };
		const v = argv[i + 1];
		if (v === undefined || v.startsWith('--')) return { why: `${argv[i]} needs a value` };
		o[argv[i].slice(2)] = v;
		i++;
	}
	if (!o.tag || o.tag.startsWith('--') || !o.pr) return { why: 'a tag and --pr are needed' };
	return o;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
	const o = argsOf(process.argv.slice(2));
	if (o.why) {
		process.stdout.write(`${o.why}\nusage: node .claude/release-check.mjs <tag> --pr <n> [--repo <owner/name>] [--copy <release copy>] [--installed <project>] [--result <RESULT.md>] [--plugin <plugin build>]\n`);
		process.exitCode = 2;
	} else {
		const r = releaseCheck({ tag: o.tag, pr: o.pr, repo: o.repo, project: process.cwd(), copy: o.copy && path.resolve(o.copy), installed: o.installed && path.resolve(o.installed), result: o.result && path.resolve(o.result), plugin: o.plugin && path.resolve(o.plugin) });
		process.exitCode = r.ok ? 0 : 1;
	}
}
