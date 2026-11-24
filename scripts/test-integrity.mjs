#!/usr/bin/env node
// The test integrity check (K367, rule:test-integrity): CI's judge of every commit a PR carries, in place of the pre-push
// hold. Each commit in the range is read against its own parent, so a test the base lacks (the red commit's own) is held
// as soon as a later commit weakens it.
//   node scripts/test-integrity.mjs <base-sha> [--retests <file>]
// Run in the head checkout. Exit 0: pass. Exit 1: a finding. Exit 2: it could not run (no base, an unreadable base, a
// shallow clone, no git), said on stderr.
// A commit that touches a test path must only add: a new test file, or lines inside a test( block its parent lacks (and
// blank or // comment lines). A changed or deleted line, a deleted or renamed file, a changed binary file, or an added
// line in an old test is a finding. A commit whose subject starts with retest: is exempt for test paths only, must touch
// nothing else, and is listed (--retests as JSON [{sha, subject, files}], and one "retest: <short sha> <subject>" line
// in GITHUB_STEP_SUMMARY) for the owner's merge yes.
// Security: git is found by walking PATH for an absolute folder (never the project folder), each run starts from node's
// own folder, replace objects and every GIT_* variable are off, and a merge is read by its combined diff (--cc).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const TEST_DIRS = new Set(['test', 'tests', '__tests__', 'spec']);
// A test path as the pre-push scan and unit-lock count it: case-insensitive.
const isTest = (rel) => {
	const parts = rel.toLowerCase().split('/');
	return parts.slice(0, -1).some((d) => TEST_DIRS.has(d)) || /\.(test|spec)\./.test(parts[parts.length - 1]);
};
const RETEST = /^retest(\([^)]*\))?!?:/;
const SHORT = 7;
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
const REMEDY = 'If the change is meant: reword the commit to retest: (a retest: commit holds test files only), then force-push the feature branch after the owner\'s yes. CI lists every retest: commit for the owner\'s merge yes.';

class CannotRun extends Error {}

function findGit() {
	const here = path.resolve(process.cwd());
	const names = process.platform === 'win32' ? ['git.exe'] : ['git'];
	for (const dir of String(process.env.PATH || process.env.Path || '').split(path.delimiter)) {
		if (!dir || !path.isAbsolute(dir)) continue;
		const abs = path.resolve(dir);
		if (abs === here || abs.startsWith(here + path.sep)) continue;
		for (const n of names) {
			const f = path.join(abs, n);
			try { if (fs.statSync(f).isFile()) return f; } catch { /* not here */ }
		}
	}
	return null;
}

const ENV = {};
for (const [k, v] of Object.entries(process.env)) if (!/^GIT_/i.test(k)) ENV[k] = v;
Object.assign(ENV, { GIT_NO_REPLACE_OBJECTS: '1', GIT_OPTIONAL_LOCKS: '0', GIT_ATTR_SOURCE: EMPTY_TREE, NoDefaultCurrentDirectoryInExePath: '1' });
const NO_PROGRAMS = ['-c', 'core.fsmonitor=false', '-c', 'core.attributesFile=', '-c', 'core.quotePath=false', '-c', 'protocol.allow=never'];
let GIT = null;
const WORK = process.cwd();
// git on the head checkout: the folder is named with -C, the process starts in node's own folder.
function gitRaw(args, input) {
	return spawnSync(GIT, ['-C', WORK, ...NO_PROGRAMS, ...args], { cwd: path.dirname(process.execPath), env: ENV, encoding: 'utf8', maxBuffer: 1 << 30, windowsHide: true, timeout: 120000, input });
}
function git(args) {
	const r = gitRaw(args);
	if (r.error || r.status !== 0) throw new CannotRun(`git ${args[0]} failed: ${String((r.stderr || (r.error && r.error.message) || '')).trim().split('\n')[0]}`);
	return r.stdout;
}

// Where a test( call that opens at line i of a file closes: {line, col} of its closing bracket, or null when it never
// closes, or when anything but a semicolon or a comment follows the close on that line. Strings, template literals (with
// their ${} parts) and comments are read, so one that opens in this call cannot carry the close into later lines.
function closeOf(lines, i) {
	let depth = 0;
	let mode = "n";
	const tmpl = [];
	for (let j = i; j < lines.length; j++) {
		const l = lines[j];
		for (let k = 0; k < l.length; k++) {
			const ch = l[k];
			const nx = l[k + 1];
			if (mode === "b") { if (ch === "*" && nx === "/") { mode = "n"; k++; } continue; }
			if (mode === "t") {
				if (ch === "\\") k++;
				else if (ch === "`") mode = "n";
				else if (ch === "$" && nx === "{") { tmpl.push(depth); depth++; mode = "n"; k++; }
				continue;
			}
			if (ch === "/" && nx === "/") break;
			if (ch === "/" && nx === "*") { mode = "b"; k++; continue; }
			if (ch === "\"" || ch === "'") {
				for (k++; k < l.length && l[k] !== ch; k++) if (l[k] === "\\") k++;
				continue;
			}
			if (ch === "`") { mode = "t"; continue; }
			if (ch === "(" || ch === "{" || ch === "[") depth++;
			else if (ch === ")" || ch === "}" || ch === "]") {
				if (ch === "}" && tmpl.length && depth - 1 === tmpl[tmpl.length - 1]) { tmpl.pop(); depth--; mode = "t"; continue; }
				depth--;
				if (depth < 0) return null;
				if (depth === 0) return /^\s*;?\s*(\/\/.*)?$/.test(l.slice(k + 1)) ? { line: j, col: k } : null;
			}
		}
	}
	return null;
}
// The test( blocks of a file as line indexes: a call that opens in column 0 (with the // comment lines right above it),
// closed by closeOf. A call that is not complete on its own lines is no block.
function blocks(lines) {
	const out = [];
	for (let i = 0; i < lines.length; i++) {
		if (!/^test\(/.test(lines[i])) continue;
		const close = closeOf(lines, i);
		if (!close) continue;
		let start = i;
		while (start > 0 && /^\/\//.test(lines[start - 1])) start--;
		out.push({ start, at: i, end: close.line, header: lines[i].trim() });
	}
	return out;
}
// The tree entry of the path p at rev, as ls-tree prints it: '' when the path is absent. The path is read from the top of
// the repository and literally, so a name with ':' or a folder run from a subfolder is read like any other. Any failure of
// the lookup is no answer: the check cannot run (exit 2), and a failed read is never taken for an absent file.
function entry(rev, p) {
	const r = gitRaw(['ls-tree', '-z', '--full-tree', rev, '--', `:(top,literal)${p}`]);
	if (r.status !== 0) throw new CannotRun(`cannot read ${p} at ${rev.slice(0, SHORT)}: ${String(r.stderr || '').trim().split('\n')[0]}`);
	return r.stdout;
}
const holds = (rev, p) => entry(rev, p) !== '';
const text = (rev, p) => {
	const m = /^\d+ blob ([0-9a-f]+)\t/.exec(entry(rev, p));
	if (!m) return '';
	const r = gitRaw(['cat-file', 'blob', m[1]]);
	if (r.status !== 0) throw new CannotRun(`cannot read the blob of ${p} at ${rev.slice(0, SHORT)}`);
	return r.stdout;
};

// Why a commit's change to one test path is not a pure addition, or null. parents is empty for a root commit.
function judgePath(c, parents, p) {
	const merge = parents.length > 1;
	const range = merge ? ['--cc', c] : parents.length ? [parents[0], c] : ['--root', c];
	const patch = git(['diff-tree', '-p', '-U0', '--no-renames', '--no-commit-id', '-r', ...range, '--', `:(top,literal)${p}`]);
	if (!/^diff /m.test(patch)) return 'its change cannot be read';
	if (/^deleted file mode/m.test(patch)) return 'the test file is deleted or moved';
	if (/^new file mode/m.test(patch)) return null;
	if (/^(Binary files |GIT binary patch)/m.test(patch)) return 'a binary test file is changed';
	const mode = /^old mode (\d+)\r?\nnew mode (\d+)/m.exec(patch);
	if (mode && mode[1].slice(0, 2) !== mode[2].slice(0, 2)) return 'the file type is changed';
	const added = [];
	let cols = 1;
	let next = 0;
	let hunks = 0;
	for (const l of patch.split('\n')) {
		const h = /^(@{2,}) .*? \+(\d+)(?:,\d+)? @{2,}(?: |$)/.exec(l);
		if (h) { cols = h[1].length - 1; next = Number(h[2]); hunks++; continue; }
		if (l.startsWith('@@')) return 'a hunk header cannot be read';
		if (!hunks || l === '' || l[0] === '\\') continue;
		const mark = l.slice(0, cols);
		if (mark.includes('-')) return 'a line of the test is changed or removed';
		if (/^\++$/.test(mark)) added.push(next);
		next++;
	}
	if (!added.length) return null;
	const lines = text(c, p).split('\n');
	const known = new Set(parents.flatMap((q) => text(q, p).split('\n').map((x) => x.trim())));
	// A new block is a complete top-level test( call the parent lacks, and every line of it is an added line.
	const addedSet = new Set(added);
	const fresh = blocks(lines).filter((b) => !known.has(b.header) && Array.from({ length: b.end - b.at + 1 }, (_, d) => b.at + d + 1).every((n) => addedSet.has(n)));
	for (const n of added) {
		const line = lines[n - 1] === undefined ? '' : lines[n - 1];
		if (line.trim() === '' || /^\s*\/\//.test(line)) continue;
		if (!fresh.some((b) => n - 1 >= b.start && n - 1 <= b.end)) return `a line is added outside a complete new test( block (line ${n})`;
	}
	return null;
}

function run(base, retestsFile) {
	GIT = findGit();
	if (!GIT) throw new CannotRun('git was not found on PATH (only absolute PATH folders outside this checkout count)');
	if (git(['rev-parse', '--is-shallow-repository']).trim() !== 'false') throw new CannotRun('this clone is shallow, so the history a weakening could sit in may be cut off: fetch the full history (fetch-depth: 0)');
	const r = gitRaw(['rev-parse', '--verify', '--quiet', `${base}^{commit}`]);
	if (r.status !== 0 || !r.stdout.trim()) throw new CannotRun(`the base ${base} is not a commit here`);
	const baseSha = r.stdout.trim();
	const mb = gitRaw(['merge-base', baseSha, 'HEAD']);
	if (mb.status !== 0) throw new CannotRun(`no merge base between ${base} and HEAD`);
	const findings = [];
	const retests = [];
	for (const c of git(['rev-list', '--reverse', '--topo-order', 'HEAD', '--not', baseSha]).split('\n').filter(Boolean)) {
		const parents = git(['rev-list', '--parents', '-n', '1', c]).trim().split(' ').slice(1);
		const subject = git(['log', '-1', '--format=%s', c]).split('\n')[0];
		const range = parents.length > 1 ? ['--cc', c] : parents.length ? [parents[0], c] : ['--root', c];
		const files = git(['diff-tree', '-r', '-z', '--no-renames', '--name-only', '--no-commit-id', ...range]).split('\0').filter(Boolean).sort();
		const short = c.slice(0, SHORT);
		if (RETEST.test(subject)) {
			const stray = files.filter((f) => !isTest(f));
			for (const f of stray) findings.push(`${short} ${f}: a retest: commit may touch test files only`);
			if (!stray.length) retests.push({ sha: c, subject, files });
			continue;
		}
		const judged = new Set();
		for (const f of files.filter(isTest)) {
			const why = judgePath(c, parents, f);
			if (why) { judged.add(f); findings.push(`${short} ${f}: ${why}`); }
		}
		// A merge may not drop or weaken what its branch's own side did, but it brings the other side's edits. So a test
		// path is judged against an in-range parent only when that parent's side changed the path since the merge-base of
		// the parents. A merge whose copy matches neither side is already judged by the combined diff above.
		if (parents.length > 1) {
			const inRange = new Set(git(['rev-list', 'HEAD', '--not', baseSha]).split('\n').filter(Boolean));
			const mbase = gitRaw(['merge-base', '--octopus', ...parents]);
			if (mbase.status !== 0 && mbase.status !== 1) throw new CannotRun(`no merge base of the parents of ${short}`);
			const anc = mbase.status === 0 ? mbase.stdout.trim().split('\n')[0] : null;
			const touched = new Set();
			for (const q of parents) {
				for (const f of git(['diff-tree', '-r', '-z', '--no-renames', '--name-only', '--no-commit-id', q, c]).split('\0').filter(Boolean)) if (isTest(f)) touched.add(f);
			}
			for (const f of [...touched].sort()) {
				if (judged.has(f)) continue;
				const here = entry(c, f);
								const ancEntry = anc ? entry(anc, f) : '';
				for (const q of parents.filter((p) => inRange.has(p))) {
					if (entry(q, f) === here) continue;
					if (entry(q, f) === ancEntry) continue;
					if (!holds(q, f) && !holds(c, f)) continue;
					const why = judgePath(c, [q], f);
					if (why) findings.push(`${short} ${f}: ${why} (against parent ${q.slice(0, SHORT)})`);
				}
			}
		}
	}
	// The whole branch against its base: a test path the base holds and HEAD differs on must be named by a retest: commit
	// or be a permitted pure addition. This sees what no single commit's diff shows (a merge that takes its own side).
	const named = new Set(retests.flatMap((t) => t.files));
	const head = git(['rev-parse', 'HEAD']).trim();
	for (const f of git(['diff-tree', '-r', '-z', '--no-renames', '--name-only', baseSha, 'HEAD']).split('\0').filter(Boolean).sort()) {
		if (!isTest(f) || named.has(f) || !holds(baseSha, f)) continue;
		const why = judgePath('HEAD', [baseSha], f);
		if (why) findings.push(`${head.slice(0, SHORT)} ${f}: ${why} (the whole branch against the base)`);
	}
	return { findings, retests };
}

try {
	const args = process.argv.slice(2);
	const at = args.indexOf('--retests');
	const file = at >= 0 ? args[at + 1] : null;
	if (at >= 0 && !file) throw new CannotRun('--retests needs a file');
	const base = args.filter((a, i) => at < 0 || (i !== at && i !== at + 1))[0];
	if (!base) throw new CannotRun('usage: node scripts/test-integrity.mjs <base-sha> [--retests <file>]');
	const { findings, retests } = run(base, file);
	if (file) fs.writeFileSync(file, `${JSON.stringify(retests, null, 2)}\n`);
	const summary = process.env.GITHUB_STEP_SUMMARY;
	if (summary && retests.length) fs.appendFileSync(summary, `${retests.map((r) => `retest: ${r.sha.slice(0, SHORT)} ${r.subject}`).join('\n')}\n`);
	for (const r of retests) console.log(`retest: ${r.sha.slice(0, SHORT)} ${r.subject}`);
	if (findings.length) {
		for (const f of findings) console.log(`FAIL  ${f}`);
		console.log(`test-integrity: ${findings.length} finding(s). ${REMEDY}`);
		process.exitCode = 1;
	} else console.log('test-integrity: passed');
} catch (e) {
	console.error(`test-integrity: cannot run: ${e.message}`);
	process.exitCode = 2;
}
