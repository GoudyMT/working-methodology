#!/usr/bin/env node
// The count gate (U20) and the reader and git helpers unit-check.mjs shares with it. The first test: commit in a range
// adds as many tests to the unit's test files as the locked row's Tests cell has lines. kit.config.json's countCommand
// counts instead: run in the repo root on the red commit's copy of each file, which is written to a temp folder under
// the file's own name.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import safeSpawn from './audits/safe-spawn.cjs';
import kitTemp from './kit-temp.cjs';
import { unitGate } from './plan-check.mjs';

const TEST_DIRS = new Set(['test', 'tests', '__tests__', 'spec']);
// A test( or it( call in code (group 1: the char before it; t.test( is no test).
const TEST_CALL = /(^|[^\w.$])(test|it)\(/gm;
const NAME = /\s*(['"`])((?:\\.|(?!\1).)*)\1/y;
// Strings, templates and comments, blanked before the search.
const MASK = /\/\/[^\n]*|\/\*[\s\S]*?\*\/|`(?:\\[\s\S]|[^`\\])*`|'(?:\\[\s\S]|[^'\\\n])*'|"(?:\\[\s\S]|[^"\\\n])*"/g;
export const BLANK = /^\s*(\/\/|$)/;

// A test file: in a test, tests, __tests__ or spec folder, or named *.test.* or *.spec.*.
export const isTestFile = (rel) => {
	const parts = rel.split('/');
	return parts.slice(0, -1).some((d) => TEST_DIRS.has(d)) || /\.(test|spec)\./.test(parts[parts.length - 1]);
};

export const gitRun = (repo, args, opts = {}) => safeSpawn.gitRead(repo, args, { encoding: 'utf8', maxBuffer: 1 << 28, ...opts });
export function gitOut(repo, args) {
	const r = gitRun(repo, args);
	if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${String(r.stderr).trim()}`);
	return r.stdout;
}
export const gitShow = (repo, rev, file) => {
	const r = gitRun(repo, ['show', `${rev}:${file}`]);
	return r.status === 0 ? r.stdout : null;
};

// The line where the test( call at lines[at], column col, closes.
function closeOf(lines, at, col) {
	let depth = 0;
	let quote = null;
	for (let k = at; k < lines.length; k++) {
		const s = lines[k];
		if (quote && quote !== '`') quote = null;
		for (let c = k === at ? col : 0; c < s.length; c++) {
			const ch = s[c];
			if (quote) {
				if (ch === '\\') c++;
				else if (ch === quote) quote = null;
			} else if (ch === '/' && s[c + 1] === '/') break;
			else if (ch === '"' || ch === "'" || ch === '`') quote = ch;
			else if (ch === '(') depth++;
			else if (ch === ')' && --depth === 0) return k;
		}
	}
	return lines.length - 1;
}

// A file's tests in order; each runs from the comment or blank lines above it to its last line.
export function testsIn(text) {
	const src = String(text);
	const lines = src.split('\n');
	const masked = src.replace(MASK, (m) => m.replace(/[^\n]/g, ' '));
	const out = [];
	for (const m of masked.matchAll(TEST_CALL)) {
		const at = m.index + m[1].length;
		NAME.lastIndex = at + m[2].length + 1;
		const n = NAME.exec(src);
		if (n) out.push({ name: n[2].replace(/\\(.)/g, '$1'), start: src.slice(0, at).split('\n').length - 1, col: at - (src.lastIndexOf('\n', at) + 1) });
	}
	let prev = -1;
	for (const t of out) {
		t.end = closeOf(lines, t.start, t.col);
		t.head = t.start;
		while (t.head - 1 > prev && BLANK.test(lines[t.head - 1])) t.head--;
		prev = t.end;
	}
	return out;
}

export function commitOf(repo, hash) {
	const subject = gitOut(repo, ['log', '-1', '--format=%s', hash]).trim();
	const files = gitOut(repo, ['diff-tree', '--no-commit-id', '--name-only', '-r', '--root', hash]).split('\n').filter(Boolean);
	const tests = files.filter(isTestFile);
	const cls = tests.length === 0 ? 'source' : tests.length === files.length ? 'test' : 'mixed';
	const type = (/^([a-z]+)(\([^)]*\))?!?:/.exec(subject) || [])[1] || '';
	const p = gitRun(repo, ['rev-parse', '--verify', '-q', `${hash}^`]);
	return { hash, short: gitOut(repo, ['rev-parse', '--short', hash]).trim(), subject, tests, cls, type, parent: p.status === 0 ? p.stdout.trim() : undefined };
}

// The count a countCommand prints for the red commit's copy of one file, written to a temp folder under its own name.
function commandCount(repo, cmd, rev, f) {
	const dir = kitTemp.makeTemp('count-gate-');
	try {
		const tmp = path.join(dir, path.basename(f));
		fs.writeFileSync(tmp, gitShow(repo, rev, f) || '');
		const r = spawnSync(`${cmd} "${tmp}"`, { cwd: repo, shell: true, encoding: 'utf8' });
		if (!/^\s*\d+\s*$/.test(r.stdout)) throw new Error(`countCommand printed no integer for ${f}`);
		return Number(r.stdout);
	} finally {
		kitTemp.removeTemp(dir);
	}
}

// Count gate: the first test: commit adds as many tests to the unit's test files as the Tests cell has lines.
export function countGate(repo, hashes, plan, id) {
	const gate = unitGate(plan, id);
	if (gate.changed) return [`${id}: the locked row changed since --lock`];
	const red = hashes.map((h) => commitOf(repo, h)).find((c) => c.type === 'test');
	if (!red) return [`${id}: no test: commit in the range, so no red commit to count`];
	const cfgFile = path.join(repo, 'kit.config.json');
	const cmd = fs.existsSync(cfgFile) ? JSON.parse(fs.readFileSync(cfgFile, 'utf8')).countCommand : undefined;
	const files = gate.files.filter(isTestFile);
	const counts = files.map((f) => {
		if (cmd !== undefined) return commandCount(repo, cmd, red.hash, f);
		const was = new Set(testsIn(gitShow(repo, red.parent, f) || '').map((t) => t.name));
		return testsIn(gitShow(repo, red.hash, f) || '').filter((t) => !was.has(t.name)).length;
	});
	const total = counts.reduce((a, b) => a + b, 0);
	if (total === gate.lines) return [];
	return [`${red.short} ${red.subject}: ${files.map((f, i) => `${f}: ${counts[i]}`).join(', ')} (${total} tests), but the locked row's Tests cell has ${gate.lines} lines`];
}
