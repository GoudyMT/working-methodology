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
const isRunner = (f) => f === 'scripts/test-run.mjs' || f.startsWith('.github/workflows/');
// Control characters out of anything printed; in a step-summary line, a subject sits in a code span with backticks,
// angle brackets and ampersands taken out, so no HTML comment or tag can hide the lines after it.
const clean = (s) => String(s).replace(/[\u0000-\u001f\u007f]/g, '');
const span = (s) => `\`${clean(s).replace(/[`<>&]/g, '')}\``;
const label = (r) => `${r.kind}: ${r.sha.slice(0, SHORT)} ${span(r.subject)}`;
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

// A slash starts a regex literal after an operator, an opening bracket, a comma or a keyword such as return, not after a
// value. regexEnd is the index of the closing slash on the same line, or -1 when the literal does not close there.
const REGEX_BEFORE = /(^|[(,=:[!&|?{};+*%<>~^\-]|\b(return|typeof|case|do|else|in|of|void|throw|yield|await|delete|new|instanceof))\s*$/;
function regexStart(before) { return REGEX_BEFORE.test(before); }
function regexEnd(l, k) {
	let cls = false;
	for (let m = k + 1; m < l.length; m++) {
		const c = l[m];
		if (c === "\\") { m++; continue; }
		if (cls) { if (c === "]") cls = false; continue; }
		if (c === "[") cls = true;
		else if (c === "/") return m;
	}
	return -1;
}
// The text from one {line, col} to another (to exclusive), lines joined with a newline.
function textBetween(lines, from, to) {
	if (from[0] === to[0]) return lines[from[0]].slice(from[1], to[1]);
	let out = lines[from[0]].slice(from[1]);
	for (let j = from[0] + 1; j < to[0]; j++) out += `\n${lines[j]}`;
	return `${out}\n${lines[to[0]].slice(0, to[1])}`;
}
// Where a test( call that opens at line i of a file closes: {line, col} of its closing bracket, the top-level commas
// {line, col} between its arguments, or null when it never closes, or when anything but a semicolon or a comment follows
// the close on that line. Strings, template literals (with their ${} parts), comments and regex literals are read, so
// one that opens in this call cannot carry the close into later lines.
function closeOf(lines, i) {
	let depth = 0;
	let mode = "n";
	const tmpl = [];
	const commas = [];
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
			if (ch === "/" && regexStart(l.slice(0, k)) && regexEnd(l, k) > k) { k = regexEnd(l, k); continue; }
			if (ch === "(" || ch === "{" || ch === "[") depth++;
			else if (ch === ",") { if (depth === 1) commas.push({ line: j, col: k }); }
			else if (ch === ")" || ch === "}" || ch === "]") {
				if (ch === "}" && tmpl.length && depth - 1 === tmpl[tmpl.length - 1]) { tmpl.pop(); depth--; mode = "t"; continue; }
				depth--;
				if (depth < 0) return null;
				if (depth === 0) return /^\s*;?\s*(\/\/.*)?$/.test(l.slice(k + 1)) ? { line: j, col: k, commas } : null;
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
		out.push({ start, at: i, end: close.line, header: lines[i].trim(), close: close.col, commas: close.commas });
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

// A fresh block's arguments are read as a whole: a string literal name, then an optional flat object literal, then a
// function literal. Anything else (a comma expression, a call, a bare name) runs code at load time, so it is no block.
const STR_LIT = /^(?:'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\$\n]|\\.|\$(?!\{))*`)$/;
const OBJ_LIT = /^\{[^{}]*\}$/;
const FN_LIT = /^(?:async\s+)?(?:function\b|(?:\([^()]*\)|[A-Za-z_$][\w$]*)\s*=>)/;
function freshShape(lines, b) {
	const from = [[b.at, 5], ...b.commas.map((c) => [c.line, c.col + 1])];
	const to = [...b.commas.map((c) => [c.line, c.col]), [b.end, b.close]];
	const args = to.map((t, n) => textBetween(lines, from[n], t).trim());
	if (args.length === 2) return STR_LIT.test(args[0]) && FN_LIT.test(args[1]);
	if (args.length === 3) return STR_LIT.test(args[0]) && OBJ_LIT.test(args[1]) && FN_LIT.test(args[2]);
	return false;
}

// Why a commit's change to one test path is not a pure addition, or null. parents is empty for a root commit.
function judgePath(c, parents, p) {
	const merge = parents.length > 1;
	const range = merge ? ['--cc', c] : parents.length ? [parents[0], c] : ['--root', c];
	const patch = git(['diff-tree', '-p', '-U0', '--no-renames', '--text', '--no-commit-id', '-r', ...range, '--', `:(top,literal)${p}`]);
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
	// A block inside another test( block's lines (an old test's body) is no fresh block, whatever its own lines look like.
	const all = blocks(lines);
	const fresh = all.filter((b) => !known.has(b.header) && Array.from({ length: b.end - b.at + 1 }, (_, d) => b.at + d + 1).every((n) => addedSet.has(n)) && freshShape(lines, b) && !all.some((o) => o !== b && o.at < b.at && b.end <= o.end));
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
			if (!stray.length) retests.push({ sha: c, subject, files, kind: 'retest' });
			continue;
		}
		// The test runner and the CI wiring decide which tests run, so a commit that edits them is listed for the merge yes.
		if (files.some(isRunner)) retests.push({ sha: c, subject, files, kind: 'runner' });
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
	const named = new Set(retests.filter((t) => t.kind === 'retest').flatMap((t) => t.files));
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
	if (summary && retests.length) fs.appendFileSync(summary, `${retests.map((r) => label(r)).join('\n')}\n`);
	for (const r of retests) console.log(label(r));
	if (findings.length) {
		for (const f of findings) console.log(`FAIL  ${clean(f)}`);
		console.log(`test-integrity: ${findings.length} finding(s). ${REMEDY}`);
		process.exitCode = 1;
	} else console.log('test-integrity: passed');
} catch (e) {
	console.error(`test-integrity: cannot run: ${e.message}`);
	process.exitCode = 2;
}
