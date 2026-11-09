// The release verify (E10, the owner 2026-11-03): flow step 6 as one plain script with fixed checks, no agent in it.
// It moves the release copy to a new tag, runs install user and install project from it, and reads status, stopping
// at the first check that fails. It runs on the owner's PC only: a cloud thread has no release copy, no ~/.claude and
// no workbench (E24).
//   node scripts/release-verify.mjs <tag> --pr <n> --copy <release copy folder> --project <project folder>
// Exit 0 verified, 1 a check failed (the step and why are printed).
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const STEPS = 7;
const run = (cmd, args, cwd) => spawnSync(cmd, args, { cwd, encoding: 'utf8' });

/**
 * Verify one release, step by step.
 *
 * Args:
 *     opts: { tag, pr, copy, project }
 *     deps: { env, gh(args), node(args, cwd), log(line) } - the outside calls, so a test can stand in for GitHub
 *
 * Returns:
 *     { ok: true } or { ok: false, step, why }
 */
export function verify({ tag, pr, copy, project }, deps = {}) {
	const { env = process.env, log = (l) => process.stdout.write(`${l}\n`) } = deps;
	const gh = deps.gh || ((args) => run('gh', args, copy));
	const node = deps.node || ((args, cwd) => run(process.execPath, args, cwd));
	const git = (...a) => run('git', ['-C', copy, ...a]);
	let step = 0;
	const at = (title) => { step++; log(`[${step}/${STEPS}] ${title}...`); };
	const stop = (why) => { log(`    STOP: ${why}`); return { ok: false, step, why }; };

	at('On the owner\'s PC, not a cloud session');
	if (env.CLAUDE_CODE_REMOTE === 'true') return stop('this is a cloud session: the verify runs on the owner\'s PC only, where the release copy and ~/.claude are');

	at('The release copy is a clean checkout');
	if (git('rev-parse', '--git-dir').status !== 0) return stop(`${copy} is not a git checkout`);
	const dirty = git('status', '--porcelain').stdout.trim();
	if (dirty) return stop(`the release copy is not clean:\n${dirty}`);

	at(`The tag ${tag} exists on GitHub`);
	git('fetch', '-q', '--tags', 'origin');
	const tagged = git('rev-parse', '--verify', '-q', `refs/tags/${tag}^{commit}`);
	if (tagged.status !== 0) return stop(`no tag ${tag} on GitHub or in the copy`);
	const commit = tagged.stdout.trim();

	at(`The tag is the merge of PR ${pr}`);
	const view = gh(['pr', 'view', String(pr), '--json', 'state,mergeCommit']);
	let pull = null;
	try { pull = JSON.parse(view.stdout); } catch { /* checked below */ }
	if (view.status !== 0 || !pull) return stop(`could not read PR ${pr} from GitHub`);
	if (pull.state !== 'MERGED' || !pull.mergeCommit || !pull.mergeCommit.oid) return stop(`PR ${pr} is not merged (${pull.state})`);
	git('fetch', '-q', 'origin', pull.mergeCommit.oid);
	// The tag may sit on the squash commit or a commit with the same files: the tree is what is installed.
	const tree = (c) => git('rev-parse', '--verify', '-q', `${c}^{tree}`).stdout.trim();
	if (!tree(pull.mergeCommit.oid) || tree(commit) !== tree(pull.mergeCommit.oid)) return stop(`the tree of ${tag} (${tree(commit).slice(0, 12)}) is not the merge commit's (${pull.mergeCommit.oid.slice(0, 12)})`);

	at(`The release copy moves to ${tag}`);
	const moved = git('checkout', '-q', '--detach', `refs/tags/${tag}`);
	if (moved.status !== 0 || git('rev-parse', 'HEAD').stdout.trim() !== commit || git('status', '--porcelain').stdout.trim()) return stop(`the release copy did not land cleanly on ${tag}: ${moved.stderr || 'HEAD or files differ'}`);

	at('Install user and install project from the release copy');
	const kit = path.join(copy, 'scripts', 'kit.mjs');
	for (const args of [['install', 'user'], ['install', 'project', project]]) {
		const r = node([kit, ...args], copy);
		if (r.status !== 0) return stop(`${args.slice(0, 2).join(' ')} failed:\n${r.stdout || ''}${r.stderr || ''}`);
	}

	at('Status reads current, from the release');
	const st = node([kit, 'status', project], project);
	if (st.status !== 0) return stop(`${String(st.stdout || st.stderr).trim()}`);
	log(`    Verified: ${tag} is installed in ~/.claude and ${project}, and status reads current.`);
	return { ok: true };
}

function argsOf(argv) {
	const o = { tag: argv[0] };
	for (let i = 1; i < argv.length; i++) if (['--pr', '--copy', '--project'].includes(argv[i])) o[argv[i].slice(2)] = argv[++i];
	return o;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
	const o = argsOf(process.argv.slice(2));
	if (!o.tag || !o.pr || !o.copy || !o.project) {
		process.stderr.write('usage: node scripts/release-verify.mjs <tag> --pr <n> --copy <release copy> --project <project>\n');
		process.exitCode = 1;
	} else process.exitCode = verify({ tag: o.tag, pr: o.pr, copy: path.resolve(o.copy), project: path.resolve(o.project) }).ok ? 0 : 1;
}
