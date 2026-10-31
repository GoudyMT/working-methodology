// The first push gate (rule:first-push-gate). Before the first push to a remote, this proves the foundation: every
// file the owner wants in the repo is tracked, and nothing that must stay local (the kit, the owner's never-list,
// a secret) is in ANY commit - a file deleted later still sits in history, and the remote would keep it.
// On a pass it records the commit it checked; the git pre-push hook lets only that commit go out first.
//
// With --staged (the pre-commit hook, every commit from any tool) it checks only what is staged, so a slip is
// stopped where it happens.
//
// Usage: node .claude/first-push-check.mjs [--staged]
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const git = (...a) => spawnSync('git', ['-C', PROJECT, '-c', 'core.quotePath=false', ...a], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
// The commit being checked may be in an agent worktree: git runs the hook at that worktree's top, so its index is
// read there. The settings (.kit/) stay in the main checkout, where this script lives.
const gitHere = (...a) => spawnSync('git', ['-C', process.cwd(), '-c', 'core.quotePath=false', ...a], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
// Secret-shaped file names and values. A value is never printed: only its kind, file and commit.
const SECRET_FILE = /(^|\/)(\.env(\.(?!example$|sample$|template$)[^/]+)?|\.dev\.vars|id_rsa|id_ed25519|credentials\.json)$|\.(pem|key|p12|pfx)$|(^|\/)secrets\//i;
const SECRET_VALUE = [
	['anthropic key', /sk-ant-[A-Za-z0-9_-]{20,}/],
	['openai-style key', /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{32,}/],
	['stripe-style key', /\b[rs]k_(?:live|test)_[A-Za-z0-9]{16,}/],
	['github token', /\bgh[pousr]_[A-Za-z0-9]{30,}/],
	['aws access key', /\bAKIA[0-9A-Z]{16}\b/],
	['private key block', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
	['assigned secret', /(api[_-]?key|secret|token|password|bearer)["']?\s*[:=]\s*["'][^"'\s]{16,}["']/i],
];

// A glob from tracking.json, relative to the project folder: ** crosses folders, * and ? stay inside one. Like a
// .gitignore line, a name also covers everything under it, so "school", "school/" and "school/**" agree.
function globRe(glob, prefix) {
	const body = (prefix + glob.trim().replace(/\/+$/, '')).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*\/?/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]').replace(/\u0000/g, '.*');
	return new RegExp(`^${body}(?:/.*)?$`);
}

// Secret-shaped values in the added lines of a patch, by kind, file and commit; the value itself is never kept.
function secretValues(patch) {
	const values = new Map();
	let commit = 'staged', file = '';
	for (const line of patch.split('\n')) {
		if (line.startsWith('@@') && !line.startsWith('@@ ')) commit = line.slice(2);
		else if (line.startsWith('+++ b/')) file = line.slice(6);
		else if (line.startsWith('+') && !line.startsWith('+++')) {
			for (const [kind, re] of SECRET_VALUE) if (re.test(line)) values.set(`${kind}|${file}|${commit}`, { kind, file, commit });
		}
	}
	return [...values.values()];
}

function main(staged) {
	const top = git('rev-parse', '--show-toplevel');
	if (top.status !== 0) { console.log('FAIL  not a git repository'); return 1; }
	const prefix = git('rev-parse', '--show-prefix').stdout.trim();
	const common = path.resolve(PROJECT, git('rev-parse', '--git-common-dir').stdout.trim());
	const head = git('rev-parse', '--verify', '-q', 'HEAD').stdout.trim();
	if (!head && !staged) { console.log('FAIL  no commit yet'); return 1; }

	const tracking = path.join(PROJECT, '.kit', 'tracking.json');
	const cfg = { kit: 'local', track: [], never: [], ...(existsSync(tracking) ? JSON.parse(readFileSync(tracking, 'utf8')) : {}) };
	const track = cfg.track.map((g) => globRe(g, prefix));
	const never = cfg.never.map((g) => globRe(g, prefix));
	const stamp = path.join(PROJECT, '.kit', 'kit-version.json');
	const stampData = existsSync(stamp) ? JSON.parse(readFileSync(stamp, 'utf8')) : {};
	const kitFiles = new Set(Object.keys(stampData.files || {}).filter((k) => !k.startsWith('memory/')).map((k) => prefix + k));
	// The kit's own CLAUDE.md and CLAUDE.local.md never go public, whatever track says (the owner, 2026-10-31).
	const hostOwned = stampData.hostOwned || [];
	const isPrivate = (p) => p === `${prefix}CLAUDE.local.md` || (p === `${prefix}CLAUDE.md` && kitFiles.has(p) && !hostOwned.includes('CLAUDE.md'));

	// The kit's files, plus its own folders the stamp does not list (the stamp itself names the owner's paths).
	const kitOnly = (p) => (kitFiles.has(p) || p.startsWith(`${prefix}.kit/`) || p.startsWith(`${prefix}.claude/worktrees/`)) && !track.some((r) => r.test(p));
	if (staged) {
		const added = gitHere('diff', '--cached', '--no-renames', '--name-only', '--diff-filter=A').stdout.split('\n').filter(Boolean);
		const bad = [
			...added.filter(isPrivate).map((p) => `${p}: the kit's CLAUDE.md never goes public, even listed in track`),
			...added.filter((p) => kitOnly(p) && !isPrivate(p)).map((p) => `${p}: a kit file; to show it, list it in track in .kit/tracking.json first`),
			...added.filter((p) => never.some((r) => r.test(p))).map((p) => `${p}: on the never list`),
			...added.filter((p) => SECRET_FILE.test(p)).map((p) => `${p}: a secret-shaped file`),
			...secretValues(gitHere('diff', '--cached', '--no-color', '-U0').stdout).map((v) => `${v.kind} in ${v.file}`),
		];
		if (!bad.length) { console.log('Commit check: PASS (kit files, never list, secrets)'); return 0; }
		console.error('Commit blocked (rule:kit-stays-local). Unstage each with git rm --cached -q <path> (the file stays on disk):');
		for (const b of bad) console.error(`    ${b}`);
		return 1;
	}

	// Every path any commit added, with the first commit that added it, in one pass. -m shows a merge's changes
	// against each parent, so a file added while resolving a merge is seen too; -z keeps odd names whole. Only what
	// a push can carry is read (branches, tags, remotes): a stash never leaves the machine.
	const REFS = ['--branches', '--tags', '--remotes'];
	const seen = new Map();
	let commit = '';
	for (const t of git('log', ...REFS, '--reverse', '-m', '--no-renames', '--name-only', '--diff-filter=A', '-z', '--format=%x01%h').stdout.split('\0')) {
		const p = t.replace(/^\n+/, '');
		if (p.startsWith('\u0001')) commit = p.slice(1);
		else if (p && !seen.has(p)) seen.set(p, commit);
	}
	const list = (...a) => git(...a).stdout.split('\0').filter(Boolean);
	const inTree = list('ls-tree', '-r', '-z', '--full-tree', '--name-only', 'HEAD');
	const loose = list('ls-files', '-z', '--others', '--exclude-standard', '--full-name');
	const reviewed = (cfg.reviewedSecrets || []).map((g) => globRe(g, prefix));

	const checks = [];
	const check = (name, bad) => checks.push({ name, bad });
	check('no kit file in any commit (unless listed in track)', [...seen].filter(([p]) => kitOnly(p)).map(([p, c]) => `${p} (in ${c})`));
	check("the kit's CLAUDE.md in no commit, ever", [...seen].filter(([p]) => isPrivate(p)).map(([p, c]) => `${p} (in ${c})`));
	check('no never-list path in any commit', [...seen].filter(([p]) => never.some((r) => r.test(p))).map(([p, c]) => `${p} (in ${c})`));
	check('no secret-shaped file in any commit', [...seen].filter(([p]) => SECRET_FILE.test(p)).map(([p, c]) => `${p} (in ${c})`));
	// -m shows each merge's changes too. A hit the owner has looked at and judged safe is listed in reviewedSecrets.
	check('no secret-shaped value in any commit', secretValues(git('log', ...REFS, '-m', '-p', '--no-color', '-U0', '--pretty=format:@@%h').stdout)
		.filter((v) => !reviewed.some((r) => r.test(v.file))).map((v) => `${v.kind} in ${v.file} (${v.commit}); if you checked it and it is safe, list the file in reviewedSecrets`));
	// A never-listed file that sits in the folder unignored is one `git add -A` away from a commit.
	check('every never-list path in the folder is ignored', loose.filter((p) => never.some((r) => r.test(p))).map((p) => `${p}: run the kit install again, which adds the never list to the exclude block`));
	check('every file in track is tracked', cfg.track.length ? [
		...cfg.track.filter((g, i) => !inTree.some((p) => track[i].test(p))).map((g) => `${g} matches no tracked file`),
		// A file named outright in track (not a folder or a pattern) that git ignores is a wanted file left out. Files
		// ignored inside a tracked folder (build output, a .env) are meant to stay out.
		...cfg.track.filter((g) => !/[*?]/.test(g) && !g.endsWith('/') && !inTree.includes(prefix + g) && git('check-ignore', '-q', '--', g).status === 0)
			.map((g) => `${g}: wanted (in track) but ignored; if it is meant to be in the repo, add it with git add -f`),
	] : ['track is empty: list every file or folder you want in the repo in .kit/tracking.json']);
	const exclude = path.join(common, 'info', 'exclude');
	const hasBlock = existsSync(exclude) && /^# kit:begin/m.test(readFileSync(exclude, 'utf8'));
	check('the kit exclude block is in place', cfg.kit === 'tracked' || hasBlock ? [] : ['.git/info/exclude has no kit block: run the kit install again']);

	console.log('='.repeat(60));
	console.log('FIRST PUSH CHECK');
	console.log('='.repeat(60));
	for (const c of checks) {
		console.log(`${c.bad.length ? 'FAIL' : 'PASS'}  ${c.name}`);
		for (const b of c.bad) console.log(`    ${b}`);
	}
	if (loose.length) {
		console.log('DECIDE  untracked and not ignored (track it, ignore it, or delete it before you push):');
		for (const p of loose) console.log(`    ${p}`);
	}
	console.log(`Tracked files in ${head.slice(0, 7)}: ${inTree.length}. Review the list with: git ls-files`);
	if (checks.some((c) => c.bad.length)) {
		console.log('First push NOT cleared. A path in history needs the history rewritten (or a fresh repo) before the first push.');
		return 1;
	}
	writeFileSync(path.join(common, 'kit-first-push-ok'), head + '\n');
	console.log(`First push cleared for ${head.slice(0, 7)}. A new commit needs this check again.`);
	return 0;
}

process.exitCode = main(process.argv.includes('--staged'));
