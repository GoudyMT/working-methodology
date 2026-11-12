#!/usr/bin/env node
// The test check (T15 Part A, the owner 2026-11-10): holds each test a change adds or edits to the kit's bar for a new
// test (rule:test-value): it fails first, it earns its place, it sits in the right lane, and it is owed at all.
//   node scripts/test-check.mjs <base> [--strict]
//   A1 fails first      the change's test files run against the base commit's code: a new test must fail there, on an
//                       assertion. A changed test that passes there adds no catch, and is named.
//   A2 earns its place  the test carries "// why: guards <rule or the owner's decision>", or catches a flip in the
//                       lines the change made (the mutation check, with a map of only these tests).
//   A3 right lane       a test that needs another machine, a real service, a browser or a live model sits in tests/slow.
//   A4 owed             a change of prose, wiring or removals only, that adds a test, is named.
// It reports, and exits 0, until the owner makes it required (--strict: exit 1 on any finding). Exit 2: it could not run.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import kitTemp from '../project/.claude/kit-temp.cjs';

const { makeTemp, removeTemp } = kitTemp;
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const git = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const TEST_FILE = /^tests\/.*\.test\.mjs$/;
// What a large test needs (rule:test-lanes): another host, a browser, a live model.
// A URL only counts where a call reaches it: a test of a pattern names hosts in strings it never visits.
const LARGE = /\b(fetch|https?\.(get|request)|goto)\(\s*['"`]https?:\/\/(?!127\.0\.0\.1|localhost|\[::1\])[a-z0-9.-]+\.[a-z]{2,}|\b(playwright|puppeteer|chromium\.launch)\b|ANTHROPIC_API_KEY|\bclaude(\.exe)?['"]?\s*,\s*\[\s*['"]-p['"]/i;

// The top-level tests of a file's text: name, its comment lines and body.
function tests(text) {
	const lines = String(text).split('\n');
	const starts = [];
	lines.forEach((l, i) => { const m = /^test\((['"`])((?:\\.|(?!\1).)*)\1/.exec(l); if (m) starts.push([i, m[2].replace(/\\(.)/g, '$1')]); });
	const comment = (l) => /^\s*\/\//.test(l);
	const out = new Map();
	starts.forEach(([i, name], k) => {
		let head = i;
		while (head > 0 && comment(lines[head - 1])) head--;
		let end = k + 1 < starts.length ? starts[k + 1][0] : lines.length;
		while (end - 1 > i && comment(lines[end - 1])) end--;
		out.set(name, lines.slice(head, end).join('\n').trimEnd());
	});
	return out;
}

// Run some tests of some files in a folder; the names that went red on an assertion, and those that went red otherwise.
function run(dir, keys, env = {}) {
	const only = path.join(dir, '.test-check-only.json');
	fs.writeFileSync(only, JSON.stringify(keys));
	const files = [...new Set(keys.map((k) => k.slice(0, k.indexOf('::'))))].map((f) => path.join(dir, f));
	const { NODE_TEST_CONTEXT: _c, KIT_SHARD: _s, KIT_MAP_DIR: _m, KIT_MAP_TEST: _t, KIT_RUN_AT: _a, ...base } = process.env;
	const r = spawnSync(process.execPath, ['--test', '--test-reporter=tap', '--test-concurrency=1', ...files], { cwd: dir, encoding: 'utf8', timeout: 600000, env: { ...base, ...env, KIT_ONLY: only, KIT_REPO: dir, KIT_MAP_OFF: '1' } });
	const out = String(r.stdout || '');
	const red = new Map();
	// Each top-level "not ok <n> - <name>" with its YAML block up to the next result line.
	for (const m of out.matchAll(/^not ok \d+ - (.*?)(?: # .*)?\n([\s\S]*?)(?=^(?:ok|not ok) \d+ - |^1\.\.|(?![\s\S]))/gm)) red.set(m[1], /ERR_ASSERTION|AssertionError/.test(m[2]));
	// A file that could not load (an import the base lacks) fails as a whole, under its own path: each of its tests
	// went red, and not on an assertion.
	// TAP writes a Windows path with each backslash doubled.
	const slash = (s) => s.replace(/\\\\/g, '\\').replace(/\\/g, '/');
	const failedFiles = new Set([...red.keys()].map(slash));
	for (const f of files) if (failedFiles.has(slash(f))) red.set(`file:${path.relative(dir, f).replace(/\\/g, '/')}`, false);
	return red;
}

export function check(root, base, { strict = false, slice = null } = {}) {
	const findings = [];
	const note = (key, rule, text) => findings.push({ key, rule, text });
	const baseSha = git(root, 'rev-parse', '--verify', '--end-of-options', `${base}^{commit}`).stdout.trim();
	if (!/^[0-9a-f]{40,64}$/.test(baseSha)) return { code: 2, text: `test check: base "${base}" is not a commit` };
	const changed = git(root, 'diff', '--name-status', '--no-renames', `${baseSha}...HEAD`).stdout.split('\n').filter(Boolean).map((l) => l.split('\t'));
	const testFiles = changed.filter(([s, f]) => s !== 'D' && TEST_FILE.test(f)).map(([, f]) => f);
	let newOrChanged = [];
	for (const f of testFiles) {
		const now = tests(fs.readFileSync(path.join(root, f), 'utf8'));
		const was = tests(git(root, 'show', `${baseSha}:${f}`).stdout || '');
		for (const [name, body] of now) {
			if (was.get(name) === body) continue;
			newOrChanged.push({ key: `${f}::${name}`, file: f, name, body, isNew: !was.has(name) });
		}
	}
	// A slice (i/n) takes every n-th changed test, in key order, so a PR that changes many tests is checked on several
	// machines at once instead of timing out on one (K13, the 1.27.0 build: 616 changed tests ran past 15 minutes).
	if (slice) newOrChanged = newOrChanged.sort((a, b) => (a.key < b.key ? -1 : 1)).filter((_, k) => k % slice.n === slice.i);
	// A4: a change with no code in it, that still adds a test.
	const code = changed.filter(([s, f]) => s !== 'D' && !TEST_FILE.test(f) && /\.(c?js|mjs|sh)$|^project\/\.githooks\//.test(f));
	if (!code.length) for (const t of newOrChanged.filter((x) => x.isNew)) note(t.key, 'A4', 'a test added by a change of prose, wiring or removals only: is it owed?');
	// A3: the right lane, by what the test needs.
	for (const t of newOrChanged) if (LARGE.test(t.body) && !t.file.startsWith('tests/slow/')) note(t.key, 'A3', 'needs another machine, a real service, a browser or a model: it belongs in tests/slow');
	if (newOrChanged.length) {
		// A1: the change's test files on the base commit's code.
		kitTemp.sessionRoot();
		const copy = makeTemp('test-check-');
		const home = makeTemp('test-check-home-');
		try {
			const c = git(path.dirname(copy), 'clone', '--quiet', '--no-hardlinks', '--no-checkout', root, copy);
			const co = c.status === 0 ? git(copy, '-c', 'advice.detachedHead=false', 'checkout', '--quiet', baseSha) : c;
			if (co.status !== 0) return { code: 2, text: `test check: could not make the base copy: ${co.stderr}` };
			for (const f of new Set([...testFiles, 'tests/harness.mjs'])) {
				fs.mkdirSync(path.dirname(path.join(copy, f)), { recursive: true });
				fs.copyFileSync(path.join(root, f), path.join(copy, f));
			}
			const red = run(copy, newOrChanged.map((t) => t.key), { KIT_CLAUDE_HOME: home, CLAUDE_CONFIG_DIR: home });
			for (const t of newOrChanged) {
				if (!red.has(t.name) && red.has(`file:${t.file}`)) note(t.key, 'A1', 'fails on the base commit, but not on an assertion (its file could not load there)');
				else if (!red.has(t.name)) note(t.key, 'A1', t.isNew ? 'passes on the base commit: it does not fail first' : 'changed, and passes on the base commit: it adds no catch');
				else if (!red.get(t.name)) note(t.key, 'A1', 'fails on the base commit, but not on an assertion (a crash or a missing file)');
			}
		} finally {
			removeTemp(copy);
			removeTemp(home);
		}
		// A2: a reason tag, or a flip it catches in the lines the change made.
		const untagged = newOrChanged.filter((t) => !/\/\/ why: guards\b/.test(t.body));
		if (untagged.length) {
			const mapped = spawnSync(process.execPath, [path.join(HERE, 'test-run.mjs'), '--map', '--shards', '1', ...new Set(untagged.map((t) => t.file))], { cwd: root, encoding: 'utf8' });
			const flipsFile = path.join(makeTemp('test-check-flips-'), 'flips.json');
			const m = mapped.status === 0 ? spawnSync(process.execPath, [path.join(HERE, 'mutation-check.mjs'), '--base', baseSha, '--json', flipsFile, '--timeout', '60000'], { cwd: root, encoding: 'utf8' }) : mapped;
			const flips = fs.existsSync(flipsFile) ? JSON.parse(fs.readFileSync(flipsFile, 'utf8')).flips : null;
			for (const t of untagged) {
				if (!flips) note(t.key, 'A2', `not measured (${String(m.stderr || m.stdout).trim().split('\n').pop() || 'the mutation check could not run'})`);
				else if (!flips.some((f) => (f.caughtBy || []).includes(t.key))) note(t.key, 'A2', 'catches no flip in the lines this change made, and names no rule it guards (// why: guards <rule>)');
			}
		}
	}
	const lines = [`Test check: ${newOrChanged.length} new or changed test(s) since ${baseSha.slice(0, 9)}, ${findings.length} finding(s)`];
	for (const f of findings) lines.push(`    ${f.rule} ${f.key}: ${f.text}`);
	return { code: strict && findings.length ? 1 : 0, text: lines.join('\n'), findings };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
	const args = process.argv.slice(2);
	const base = args.find((a, k) => !a.startsWith('--') && args[k - 1] !== '--slice');
	if (!base) { process.stderr.write('usage: node scripts/test-check.mjs <base> [--strict]\n'); process.exitCode = 2; }
	else {
		const top = git(process.cwd(), 'rev-parse', '--show-toplevel').stdout.trim();
		const at = args.indexOf('--slice');
		const m = at >= 0 ? /^(\d+)\/(\d+)$/.exec(args[at + 1] || '') : null;
		const slice = m && Number(m[1]) < Number(m[2]) ? { i: Number(m[1]), n: Number(m[2]) } : null;
		const r = at >= 0 && !slice ? { code: 2, text: 'test check: --slice takes i/n, with i under n' } : check(path.resolve(top || '.'), base, { strict: args.includes('--strict'), slice });
		process.stdout.write(r.text + '\n');
		process.exitCode = r.code;
	}
}
