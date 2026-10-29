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
// Secret-shaped file names and values. A value is never printed: only its kind, file and commit.
const SECRET_FILE = /(^|\/)(\.env(\.(?!example$|sample$|template$)[^/]+)?|\.dev\.vars|id_rsa|id_ed25519|credentials\.json)$|\.(pem|key|p12|pfx)$|(^|\/)secrets\//i;
const SECRET_VALUE = [
	['anthropic key', /sk-ant-[A-Za-z0-9_-]{20,}/],
	['openai-style key', /\bsk-[A-Za-z0-9]{32,}/],
	['github token', /\bgh[pousr]_[A-Za-z0-9]{30,}/],
	['aws access key', /\bAKIA[0-9A-Z]{16}\b/],
	['private key block', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
	['assigned secret', /(api[_-]?key|secret|token|password|bearer)["']?\s*[:=]\s*["'][^"'\s]{16,}["']/i],
];

// A glob from tracking.json, relative to the project folder: ** crosses folders, * and ? stay inside one.
function globRe(glob, prefix) {
	const body = (prefix + glob).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*\/?/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]').replace(/\u0000/g, '.*');
	return new RegExp(`^${body}$`);
}

// Secret-shaped values in the added lines of a patch, by kind, file and commit; the value itself is never kept.
function secretValues(patch) {
	const values = [];
	let commit = 'staged', file = '';
	for (const line of patch.split('\n')) {
		if (line.startsWith('@@') && !line.startsWith('@@ ')) commit = line.slice(2);
		else if (line.startsWith('+++ b/')) file = line.slice(6);
		else if (line.startsWith('+') && !line.startsWith('+++')) {
			for (const [kind, re] of SECRET_VALUE) if (re.test(line)) values.push(`${kind} in ${file} (${commit})`);
		}
	}
	return [...new Set(values)];
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
	const kitFiles = new Set(existsSync(stamp) ? Object.keys(JSON.parse(readFileSync(stamp, 'utf8')).files || {}).filter((k) => !k.startsWith('memory/')).map((k) => prefix + k) : []);

	const kitOnly = (p) => kitFiles.has(p) && !track.some((r) => r.test(p));
	if (staged) {
		const added = git('diff', '--cached', '--no-renames', '--name-only', '--diff-filter=A').stdout.split('\n').filter(Boolean);
		const bad = [
			...added.filter(kitOnly).map((p) => `${p}: a kit file; to show it, list it in track in .kit/tracking.json first`),
			...added.filter((p) => never.some((r) => r.test(p))).map((p) => `${p}: on the never list`),
			...added.filter((p) => SECRET_FILE.test(p)).map((p) => `${p}: a secret-shaped file`),
			...secretValues(git('diff', '--cached', '--no-color', '-U0').stdout),
		];
		if (!bad.length) return 0;
		console.error('Commit blocked (rule:kit-stays-local). Unstage each with git restore --staged <path>:');
		for (const b of bad) console.error(`    ${b}`);
		return 1;
	}

	// Every path in every commit, with the first commit that added it.
	const seen = new Map();
	let commit = '';
	for (const line of git('log', '--all', '--reverse', '--no-renames', '--name-only', '--diff-filter=A', '--pretty=format:@@%h').stdout.split('\n')) {
		if (line.startsWith('@@')) commit = line.slice(2);
		else if (line && !seen.has(line)) seen.set(line, commit);
	}
	const inTree = git('ls-tree', '-r', '--full-tree', '--name-only', 'HEAD').stdout.split('\n').filter(Boolean);
	const loose = git('ls-files', '--others', '--exclude-standard', '--full-name').stdout.split('\n').filter(Boolean);

	const checks = [];
	const check = (name, bad) => checks.push({ name, bad });
	check('no kit file in any commit (unless listed in track)', [...seen].filter(([p]) => kitOnly(p)).map(([p, c]) => `${p} (added in ${c})`));
	check('no never-list path in any commit', [...seen].filter(([p]) => never.some((r) => r.test(p))).map(([p, c]) => `${p} (added in ${c})`));
	check('no secret-shaped file in any commit', [...seen].filter(([p]) => SECRET_FILE.test(p)).map(([p, c]) => `${p} (added in ${c})`));
	check('no secret-shaped value in any commit', secretValues(git('log', '--all', '-p', '--no-color', '-U0', '--pretty=format:@@%h').stdout));
	// A never-listed file that sits in the folder unignored is one `git add -A` away from a commit.
	check('every never-list path in the folder is ignored', loose.filter((p) => never.some((r) => r.test(p))).map((p) => `${p}: add it to .gitignore`));
	check('every file in track is tracked', cfg.track.filter((g, i) => !inTree.some((p) => track[i].test(p))).map((g) => `${g} matches no tracked file`));
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
