import { execFileSync } from 'node:child_process';
import { SECRET_FILE, SECRET_VALUE } from './secret-patterns.mjs';

// The branch secret scan: every line the branch adds and every file it adds, against the same patterns the commit
// check uses. The pre-commit hook stops a slip on the owner's machine; a commit made anywhere else (the web, a cloud
// session) skips it, so CI runs this on each PR. A value is never printed: only its kind and file.
// Usage: node .claude/secret-shapes.mjs [<base>]   (base: the argument, else PR_BASE, else origin/main); exit 1 on a hit.
const base = process.argv[2] || process.env.PR_BASE || 'origin/main';
const git = (...a) => execFileSync('git', ['-c', 'core.quotePath=false', ...a], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const diff = git('diff', `${base}...HEAD`, '-U0', '--no-color');
const hits = [];
for (const f of git('diff', '--name-only', '--diff-filter=A', `${base}...HEAD`).split('\n').filter(Boolean)) {
	if (SECRET_FILE.test(f)) hits.push(`secret file name: ${f}`);
}
let file = '';
let added = 0;
for (const line of diff.split('\n')) {
	if (line.startsWith('+++ ')) file = line.replace(/^\+\+\+ (b\/)?/, '');
	else if (line.startsWith('+')) {
		added++;
		for (const [name, re] of SECRET_VALUE) if (re.test(line)) hits.push(`${name} in ${file}`);
	}
}
console.log(`added lines scanned: ${added}`);
const counts = new Map();
for (const h of hits) counts.set(h, (counts.get(h) ?? 0) + 1);
for (const [h, n] of counts) console.log(`  ${n} x ${h}`);
console.log(hits.length === 0 ? 'NO SECRET SHAPES' : `${hits.length} secret-shaped hit(s): remove them, and rotate any real key`);
process.exitCode = hits.length ? 1 : 0;
