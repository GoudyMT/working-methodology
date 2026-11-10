import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { SECRET_FILE, SECRET_VALUE } from './secret-patterns.mjs';

// The branch secret scan: every line the branch adds and every file it adds, against the same patterns the commit
// check uses. The pre-commit hook stops a slip on the owner's machine; a commit made anywhere else (the web, a cloud
// session) skips it, so CI runs this on each PR. A value is never printed: only its kind and file.
// Usage: node .claude/secret-shapes.mjs [<base>]   (base: the argument, else PR_BASE, else origin/main); exit 1 on a hit.
//        node .claude/secret-shapes.mjs --push <remote url>   (the pre-push hook: git's ref lines on stdin) - every
//          commit the push sends, one by one, since a key added and then removed still goes out. A new branch is read
//          against what the remote itself says it has (ls-remote), never the local remote-tracking refs, which a session
//          can write (the 1.25.0 sweep: a decoy refs/remotes ref hid a secret); a remote that cannot be read means all
//          of the branch's history is read.
const git = (...a) => execFileSync('git', ['-c', 'core.quotePath=false', ...a], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const ZERO = /^0+$/;
const SHA = /^[0-9a-f]{40,64}$/;

// The hits in one patch: added lines by file, and added file names.
function scan(patch, names, hits, where) {
	for (const f of names) if (SECRET_FILE.test(f)) hits.push(`secret file name: ${f}${where}`);
	let file = '';
	let added = 0;
	// Read by structure: inside a hunk, the lines its @@ header counts are content, whatever they start with; a file
	// header is read only between hunks (the 1.25.0 sweep: a removed "-- x" over an added "++ <key>" read as a header).
	let left = 0;
	for (const line of patch.split('\n')) {
		if (left > 0) {
			if (line.startsWith('\\')) continue;
			left--;
		} else {
			const hunk = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/.exec(line);
			if (hunk) left = Number(hunk[1] ?? 1) + Number(hunk[2] ?? 1);
			if (line.startsWith('+++ ')) file = line.replace(/^\+\+\+ (b\/)?/, '');
			continue;
		}
		if (line.startsWith('+')) {
			added++;
			for (const [name, re] of SECRET_VALUE) if (re.test(line)) hits.push(`${name} in ${file}${where}`);
		}
	}
	return added;
}

function report(hits, added) {
	console.log(`added lines scanned: ${added}`);
	const counts = new Map();
	for (const h of hits) counts.set(h, (counts.get(h) ?? 0) + 1);
	for (const [h, n] of counts) console.log(`  ${n} x ${h}`);
	console.log(hits.length === 0 ? 'NO SECRET SHAPES' : `${hits.length} secret-shaped hit(s): remove them, and rotate any real key`);
	process.exitCode = hits.length ? 1 : 0;
}

if (process.argv[2] === '--push') {
	const hits = [];
	let added = 0;
	const seen = new Set();
	// The commits the remote already has, as it says: each head and tag it lists that exists here.
	let known = null;
	const url = process.argv[3];
	if (url && !url.startsWith('-')) {
		try {
			known = git('ls-remote', '--end-of-options', url).split('\n').map((l) => l.split('\t')[0]).filter((s) => SHA.test(s))
				.filter((s) => { try { git('cat-file', '-e', `${s}^{commit}`); return true; } catch { return false; } });
		} catch { known = null; }
	}
	for (const line of fs.readFileSync(0, 'utf8').split('\n')) {
		const [, lsha, , rsha] = line.trim().split(/\s+/);
		if (!lsha || ZERO.test(lsha)) continue;
		// A sha git did not give in its own shape is refused, never passed to git as an option.
		if (!SHA.test(lsha) || (rsha && !SHA.test(rsha))) { console.log('secret scan: a ref line is not in git\'s shape'); process.exit(2); }
		const range = rsha && !ZERO.test(rsha) ? [`${rsha}..${lsha}`] : [lsha, ...(known && known.length ? ['--not', ...known] : [])];
		for (const c of git('rev-list', ...range).split('\n').filter(Boolean)) {
			if (seen.has(c)) continue;
			seen.add(c);
			// Each commit against its first parent (a merge too), or against nothing for a first commit.
			const patch = git('diff-tree', '-p', '-U0', '--no-color', '--root', '-m', '--first-parent', c);
			const names = git('diff-tree', '--no-commit-id', '--name-only', '-r', '--root', '-m', '--first-parent', '--diff-filter=ACR', c).split('\n').filter(Boolean);
			added += scan(patch, names, hits, ` (commit ${c.slice(0, 9)})`);
		}
	}
	report(hits, added);
} else {
	// The base reaches git only as a commit it resolved, so a value that reads as an option can never act as one.
	const given = process.argv[2] || process.env.PR_BASE || 'origin/main';
	let base = '';
	try { base = given.startsWith('-') ? '' : git('rev-parse', '--verify', '--end-of-options', `${given}^{commit}`).trim(); } catch { /* refused below */ }
	if (!/^[0-9a-f]{40,64}$/.test(base)) {
		console.log(`secret scan: base "${given}" is not a commit`);
		process.exit(2);
	}
	// Added, copied and renamed: a file renamed to a secret name adds no line, so only the name check sees it.
	const names = git('diff', '--name-only', '--diff-filter=ACR', `${base}...HEAD`).split('\n').filter(Boolean);
	const hits = [];
	report(hits, scan(git('diff', `${base}...HEAD`, '-U0', '--no-color'), names, hits, ''));
}
