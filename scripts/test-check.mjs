#!/usr/bin/env node
// The test check (T15 Part A, the owner 2026-11-10): holds each test a change adds or edits to the kit's bar for a new
// test (rule:test-value): it fails first, it earns its place, it sits in the right lane, and it is owed at all.
//   node scripts/test-check.mjs <base> [--strict] [--slice i/n] [--budget <seconds>] [--record <build record>]
//   A1 fails first      the change's test files run against the base commit's code: a new test must fail there, on an
//                       assertion. A changed test that passes there adds no catch, and is named.
//   A2 earns its place  the test carries "// why: guards <rule or the owner's decision>", or catches a flip in the
//                       lines the change made (the mutation check, with a map of only these tests).
//   A3 right lane       a test that needs another machine, a real service, a browser or a live model sits in tests/slow.
//   A4 owed             a change of prose, wiring or removals only, that adds a test, is named.
//   A5 fix ledger       with --record <build record>: each test the record's sweep.fixes names gets its A1 verdict; a
//                       fix whose test does not fail first, or is not added or changed here, is named (K105).
//   A6 names its use    the test carries one why line: guards rule:<id>, guards the owner's <decision>, or catches
//                       <the real failure> in six words or more (tests/test-format.test.mjs holds every test to it).
//   A new test in a file the base lacks fails first when that file cannot load there; a loop that makes tests is one
//   unit, run by its file.
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

// The top-level tests of a file's text: name, its comment lines and body. A top-level loop that makes tests is one
// unit, named by the first test( inside it as written (`name ${n}`), and listed in .loops (K105: the loop-made tests
// of PR 49 were never read).
const NAMED = /\btest\((['"`])((?:\\.|(?!\1).)*)\1/;
const LOOP = /^(for\s*\(|\[[^\n]*\]\.forEach\(|Object\.(entries|keys|values)\([^\n]*\)\.forEach\()/;

// A test's tags: the comment lines above it, never a line inside its body (the build 14 PR: a sample tag in a string
// was read as the test's own).
const headOf = (body) => {
	const lines = String(body).split('\n');
	const end = lines.findIndex((l) => !/^\s*\/\//.test(l));
	return lines.slice(0, end < 0 ? lines.length : end).join('\n');
};

/**
 * A6: what is wrong with a test's why line, or null when it has one of the kit's shapes (rule:test-value; the owner,
 * 2026-11-17: "we have the standard, now we just need to enforce it").
 *
 * Args:
 *     body: the test's text with the comment lines above it
 *     known: the rule ids of the rule index, or null to leave a rule's existence to A2
 *
 * Returns:
 *     null, or the fault in words
 */
export function whyFault(body, known = null) {
	const why = (/^\s*\/\/ why: (.*)$/m.exec(headOf(body)) || [])[1];
	if (why === undefined) return 'no why line: name the real use or failure it guards (// why: guards rule:<id>, or catches <the failure>)';
	if (/^guards\b/.test(why)) {
		const rules = [...why.matchAll(/\brule:([a-z0-9-]+)/g)].map((m) => m[1]);
		const unknown = known ? rules.filter((r) => !known.has(r)) : [];
		if (unknown.length) return `its why line names rule:${unknown.join(', rule:')}, which is not in the rule index`;
		return rules.length || /\bthe owner/.test(why) ? null : 'its why line says guards but names no rule (rule:<id>) and not the owner';
	}
	if (/^catches\b/.test(why)) return why.trim().split(/\s+/).length >= 6 ? null : 'its why line is too short to name the failure it catches (6 words or more)';
	return 'its why line starts with neither guards nor catches';
}

export function tests(text) {
	const lines = String(text).split('\n');
	const starts = [];
	lines.forEach((l, i) => {
		const m = /^test\((['"`])((?:\\.|(?!\1).)*)\1/.exec(l);
		if (m) { starts.push([i, m[2].replace(/\\(.)/g, '$1'), false]); return; }
		if (!LOOP.test(l)) return;
		// The loop's own lines: up to the next line at the margin that is not a closing bracket.
		for (let j = i; j < lines.length && (j === i || !/^[^\s}\])]/.test(lines[j])); j++) {
			const n = NAMED.exec(lines[j]);
			if (n) { starts.push([i, n[2], true]); break; }
		}
	});
	const comment = (l) => /^\s*\/\//.test(l);
	const out = new Map();
	out.loops = new Set(starts.filter((s) => s[2]).map((s) => s[1]));
	starts.forEach(([i, name], k) => {
		let head = i;
		while (head > 0 && comment(lines[head - 1])) head--;
		let end = k + 1 < starts.length ? starts[k + 1][0] : lines.length;
		while (end - 1 > i && comment(lines[end - 1])) end--;
		out.set(name, lines.slice(head, end).join('\n').trimEnd());
	});
	return out;
}

// Run some tests of some files in a folder, one file at a time, so every result is keyed by its own file ("<file>::
// <name>"): the build 14 sweep found a passing test that took a red result of the same name from another file. Returns
// the keys that went red (true on an assertion), .seen (every key with a result) and, when a file ran past the time
// left or never started, .cut (the keys that have a result). A file that could not load is keyed "file:<file>".
function run(dir, keys, env, left) {
	const red = new Map();
	red.seen = new Set();
	let cut = false;
	const { NODE_TEST_CONTEXT: _c, KIT_SHARD: _s, KIT_MAP_DIR: _m, KIT_MAP_TEST: _t, KIT_RUN_AT: _a, ...base } = process.env;
	// TAP writes a Windows path with each backslash doubled.
	const slash = (s) => s.replace(/\\\\/g, '\\').replace(/\\/g, '/');
	for (const f of [...new Set(keys.map((k) => k.slice(0, k.indexOf('::'))))]) {
		// One read of the time left: a second could land on 0, which spawnSync reads as no limit (the K95 sweep).
		const ms = Math.min(600000, left());
		if (ms <= 0) { cut = true; continue; }
		const only = path.join(dir, '.test-check-only.json');
		fs.writeFileSync(only, JSON.stringify(keys.filter((k) => k.startsWith(`${f}::`))));
		const abs = path.join(dir, f);
		const r = spawnSync(process.execPath, ['--test', '--test-reporter=tap', '--test-concurrency=1', abs], { cwd: dir, encoding: 'utf8', timeout: ms, killSignal: 'SIGKILL', maxBuffer: 64 * 1024 * 1024, env: { ...base, ...env, KIT_ONLY: only, KIT_REPO: dir, KIT_MAP_OFF: '1' } });
		const out = String(r.stdout || '');
		// Stopped early (the budget, or output past the buffer): the tests with a result keep it, the rest are named as
		// not checked (the K95 sweep: every test was named so, and the finished ones' findings were lost).
		if (r.error) cut = true;
		const isFile = (name) => slash(name) === slash(abs);
		for (const m of out.matchAll(/^(?:not ok|ok) \d+ - (.*?)(?: # .*)?$/gm)) if (!isFile(m[1])) red.seen.add(`${f}::${m[1]}`);
		// Each top-level "not ok <n> - <name>" with its YAML block up to the next result line.
		for (const m of out.matchAll(/^not ok \d+ - (.*?)(?: # .*)?\n([\s\S]*?)(?=^(?:ok|not ok) \d+ - |^1\.\.|(?![\s\S]))/gm)) {
			// A file that could not load (an import the base lacks), or ended non-zero, fails as a whole under its own path.
			if (isFile(m[1])) red.set(`file:${f}`, false);
			else red.set(`${f}::${m[1]}`, /ERR_ASSERTION|AssertionError/.test(m[2]));
		}
	}
	if (cut) red.cut = new Set(red.seen);
	return red;
}

export function check(root, base, { strict = false, slice = null, budget = null, record = null } = {}) {
	// K95 (build 12): a step that would run past the budget is not started or is stopped, and its tests are named.
	const deadline = budget === null ? Infinity : Date.now() + budget;
	const left = () => Math.max(0, deadline - Date.now());
	const say = (s) => process.stderr.write(`test check: ${s}\n`);
	const findings = [];
	const note = (key, rule, text) => findings.push({ key, rule, text });
	const baseSha = git(root, 'rev-parse', '--verify', '--end-of-options', `${base}^{commit}`).stdout.trim();
	if (!/^[0-9a-f]{40,64}$/.test(baseSha)) return { code: 2, text: `test check: base "${base}" is not a commit` };
	const changed = git(root, 'diff', '--name-status', '--no-renames', `${baseSha}...HEAD`).stdout.split('\n').filter(Boolean).map((l) => l.split('\t'));
	const testFiles = changed.filter(([s, f]) => s !== 'D' && TEST_FILE.test(f)).map(([, f]) => f);
	let newOrChanged = [];
	// A test whose only change is its comment lines (a why line added) adds no catch to prove: it gets A6 only (the
	// build 14 PR: 38 retagged tests were held to fail first again).
	const retagged = [];
	const codeOf = (b) => b.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
	for (const f of testFiles) {
		const now = tests(fs.readFileSync(path.join(root, f), 'utf8'));
		const onBase = git(root, 'cat-file', '-e', `${baseSha}:${f}`).status === 0;
		const was = tests(onBase ? git(root, 'show', `${baseSha}:${f}`).stdout : '');
		for (const [name, body] of now) {
			if (was.get(name) === body) continue;
			if (was.has(name) && codeOf(was.get(name)) === codeOf(body)) { retagged.push({ key: `${f}::${name}`, body }); continue; }
			// A loop's tests are named at run time: its pattern, the written name with each ${...} read as any text.
			const loop = now.loops.has(name) ? new RegExp(`^${name.split(/\$\{[^}]*\}/).map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*?')}$`) : null;
			newOrChanged.push({ key: `${f}::${name}`, file: f, name, body, isNew: !was.has(name), newFile: !onBase, loop });
		}
	}
	// The keys a run gave this test: its own, or each name its loop made in its own file, less the names a plain test of
	// that file has (the build 14 sweep: a loop's pattern took another test's red result).
	const plainNames = new Map(testFiles.map((f) => [f, new Set([...tests(fs.readFileSync(path.join(root, f), 'utf8')).keys()])]));
	const namesOf = (t, seen) => (t.loop
		? [...seen].filter((k) => k.startsWith(`${t.file}::`) && t.loop.test(k.slice(t.file.length + 2)) && !plainNames.get(t.file).has(k.slice(t.file.length + 2)))
		: [t.key].filter((k) => seen.has(k)));
	// A slice (i/n) takes every n-th changed test, in key order, so a PR that changes many tests is checked on several
	// machines at once instead of timing out on one (K13, the 1.27.0 build: 616 changed tests ran past 15 minutes).
	const allKeys = new Set(newOrChanged.map((t) => t.key));
	if (slice) newOrChanged = newOrChanged.sort((a, b) => (a.key < b.key ? -1 : 1)).filter((_, k) => k % slice.n === slice.i);
	// A4: a change with no code in it, that still adds a test.
	const code = changed.filter(([s, f]) => s !== 'D' && !TEST_FILE.test(f) && /\.(c?js|mjs|sh)$|^project\/\.githooks\//.test(f));
	if (!code.length) for (const t of newOrChanged.filter((x) => x.isNew)) note(t.key, 'A4', 'a test added by a change of prose, wiring or removals only: is it owed?');
	// A3: the right lane, by what the test needs.
	for (const t of newOrChanged) if (LARGE.test(t.body) && !t.file.startsWith('tests/slow/')) note(t.key, 'A3', 'needs another machine, a real service, a browser or a model: it belongs in tests/slow');
	if (newOrChanged.length) {
		// A1: the change's test files on the base commit's code.
		say(`A1: ${newOrChanged.length} test(s) on the base commit, ${budget === null ? 'no time budget' : `${Math.round(left() / 1000)} s of the budget left`}`);
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
			// A loop is run by its whole file: the harness takes exact names, and a loop's names exist only at run time.
			const keys = [...new Set(newOrChanged.map((t) => (t.loop ? `${t.file}::*` : t.key)))];
			const red = run(copy, keys, { KIT_CLAUDE_HOME: home, CLAUDE_CONFIG_DIR: home }, left);
			for (const t of newOrChanged) {
				const names = namesOf(t, red.seen);
				const reds = names.filter((n) => red.has(n));
				// A loop named only by placeholders would match every test of its file.
				if (t.loop && !t.name.replace(/\$\{[^}]*\}/g, '').trim()) note(t.key, 'A1', 'not checked: a loop named only by placeholders');
				else if (red.cut && !names.length) note(t.key, 'A1', 'not checked: the time budget ran out');
				// K105: a new test in a file the base does not have, with no result of its own because that file cannot load
				// there, fails first; the fix ledger still names it (a fix's test should load on the code it fixes). A file the
				// base has that cannot load proves nothing about the test (N12: still named).
				else if (!names.length && red.has(`file:${t.file}`)) { if (t.newFile) t.loadOnly = true; else note(t.key, 'A1', 'fails on the base commit, but not on an assertion (its file could not load there)'); }
				else if (!reds.length) note(t.key, 'A1', t.isNew ? 'passes on the base commit: it does not fail first' : 'changed, and passes on the base commit: it adds no catch');
				else if (!reds.some((n) => red.get(n))) note(t.key, 'A1', 'fails on the base commit, but not on an assertion (a crash or a missing file)');
			}
		} finally {
			removeTemp(copy);
			removeTemp(home);
		}
		// A2: a reason tag, or a flip it catches in the lines the change made. A tag counts only when the rule it names is
		// in the rule index, or it names the owner (K12, the 1.27.0 sweep: any "why: guards" text passed, so a tag naming
		// no real rule kept a test in the never-cut group); a tag naming no known rule is named, and read as no tag.
		let index = '';
		try { index = fs.readFileSync(path.join(root, 'project', 'standards', 'INDEX.md'), 'utf8'); } catch { /* none: no rule counts */ }
		const ids = (text) => new Set([...text.matchAll(/^\| ([a-z0-9-]+) \|/gm)].map((m) => m[1]));
		const known = ids(index);
		// The index read is the change's own copy, so a change could add a row and tag a test with it (K36). Such a rule
		// counts, and is named so the owner reads the new rule beside the test it keeps.
		const before = ids(git(root, 'show', `${baseSha}:project/standards/INDEX.md`).stdout || '');
		const tagged = (t) => {
			const head = headOf(t.body);
			const rules = [...head.matchAll(/\/\/ why: guards\b.*?\brule:([a-z0-9-]+)/g)].map((m) => m[1]);
			const unknown = rules.filter((r) => !known.has(r));
			if (unknown.length) note(t.key, 'A2', `names rule:${unknown.join(', rule:')}, which is not in the rule index`);
			const added = rules.filter((r) => known.has(r) && !before.has(r));
			if (added.length) note(t.key, 'A2', `names rule:${added.join(', rule:')}, a rule this change itself adds to the rule index`);
			return (rules.length > 0 && unknown.length === 0) || /\/\/ why: guards\b[^\n]*\bthe owner/.test(head);
		};
		const untagged = newOrChanged.filter((t) => !tagged(t));
		if (untagged.length) {
			say(`A2: ${untagged.length} untagged test(s) measured against the flips of this change, ${budget === null ? 'no time budget' : `${Math.round(left() / 1000)} s of the budget left`}`);
			const step = (args) => { const ms = left(); return ms > 0 ? spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', killSignal: 'SIGKILL', maxBuffer: 64 * 1024 * 1024, ...(budget === null ? {} : { timeout: ms }) }) : { status: null, error: { code: 'ETIMEDOUT' } }; };
			const mapped = step([path.join(HERE, 'test-run.mjs'), '--map', '--shards', '1', ...new Set(untagged.map((t) => t.file))]);
			const flipsFile = path.join(makeTemp('test-check-flips-'), 'flips.json');
			const m = mapped.status === 0 ? step([path.join(HERE, 'mutation-check.mjs'), '--base', baseSha, '--json', flipsFile, '--timeout', '60000']) : mapped;
			const outOfTime = (m.error && m.error.code === 'ETIMEDOUT') || (mapped.error && mapped.error.code === 'ETIMEDOUT');
			const flips = !outOfTime && fs.existsSync(flipsFile) ? JSON.parse(fs.readFileSync(flipsFile, 'utf8')).flips : null;
			for (const t of untagged) {
				if (outOfTime) note(t.key, 'A2', 'not measured: the time budget ran out');
				else if (!flips) note(t.key, 'A2', `not measured (${String(m.stderr || m.stdout).trim().split('\n').pop() || 'the mutation check could not run'})`);
				else if (!flips.some((f) => (f.caughtBy || []).some((k) => k === t.key || (t.loop && k.startsWith(`${t.file}::`) && t.loop.test(k.slice(t.file.length + 2)))))) note(t.key, 'A2', 'catches no flip in the lines this change made, and names no rule it guards (// why: guards <rule>)');
			}
		}
	}
	// A6: each new or changed test names what it guards in a why line of the kit's shape; A2 names an unknown rule.
	// A comment-only change is checked once, by the first slice.
	for (const t of [...newOrChanged, ...(!slice || slice.i === 0 ? retagged : [])]) {
		const fault = whyFault(t.body);
		if (fault) note(t.key, 'A6', fault);
	}
	// A5 (K105): each test the fix ledger names gets its A1 verdict, and the PR's fix line may claim only that. A fix
	// whose test does not fail first, or is not one this change adds or changes, is a finding. With slices, the slice
	// holding the test states its verdict, and the first slice names a test no slice holds.
	const ledger = [];
	if (record) {
		const mine = new Map(newOrChanged.map((t) => [t.key, t]));
		for (const f of record) {
			const head = `${f.id} (${f.severity})`;
			if (f.test === 'no test: no real input') { if (!slice || slice.i === 0) ledger.push(`    ${head} no test: no real input`); continue; }
			if (!allKeys.has(f.test)) {
				if (!slice || slice.i === 0) { ledger.push(`    ${head} ${f.test}: not added or changed here`); note(f.id, 'A5', 'the test it names is not one this change adds or changes'); }
				continue;
			}
			if (!mine.has(f.test)) continue;
			// A fix's test runs against the code it fixes, so a test that is red there only because its file cannot load
			// proves nothing about the fix (the build 14 sweep: a file made unloadable on purpose read "fails first").
			const a1 = findings.find((x) => x.rule === 'A1' && x.key === f.test);
			const why = a1 ? a1.text : mine.get(f.test).loadOnly ? 'fails on the base commit only because its file cannot load there' : null;
			ledger.push(`    ${head} ${f.test}: ${why || 'fails first'}`);
			if (why) note(f.id, 'A5', `the test it names ${why}`);
		}
	}
	const lines = [`Test check: ${newOrChanged.length} new or changed test(s) since ${baseSha.slice(0, 9)}, ${findings.length} finding(s)`];
	for (const f of findings) lines.push(`    ${f.rule} ${f.key}: ${f.text}`);
	if (record && ledger.length) lines.push(`Fix ledger: ${record.length} fix(es)`, ...ledger);
	return { code: strict && findings.length ? 1 : 0, text: lines.join('\n'), findings };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
	const args = process.argv.slice(2);
	const base = args.find((a, k) => !a.startsWith('--') && !['--slice', '--budget', '--record'].includes(args[k - 1]));
	if (!base) { process.stderr.write('usage: node scripts/test-check.mjs <base> [--strict]\n'); process.exitCode = 2; }
	else {
		const top = git(process.cwd(), 'rev-parse', '--show-toplevel').stdout.trim();
		const at = args.indexOf('--slice');
		const m = at >= 0 ? /^(\d+)\/(\d+)$/.exec(args[at + 1] || '') : null;
		const slice = m && Number(m[1]) < Number(m[2]) ? { i: Number(m[1]), n: Number(m[2]) } : null;
		const bt = args.indexOf('--budget');
		const secs = bt >= 0 && /^\d+$/.test(args[bt + 1] || '') ? Number(args[bt + 1]) : null;
		// --record <build record>: the fix ledger whose tests get a verdict (K105).
		const rt = args.indexOf('--record');
		let record = null;
		let bad = null;
		if (rt >= 0) {
			try { record = JSON.parse(fs.readFileSync(args[rt + 1] || '', 'utf8')).sweep.fixes; } catch { /* named below */ }
			if (!Array.isArray(record)) bad = `test check: cannot read the fix ledger (sweep.fixes) in "${args[rt + 1] || ''}"`;
		}
		const r = at >= 0 && !slice ? { code: 2, text: 'test check: --slice takes i/n, with i under n' }
			: bt >= 0 && secs === null ? { code: 2, text: 'test check: --budget takes whole seconds' }
				: bad ? { code: 2, text: bad }
					: check(path.resolve(top || '.'), base, { strict: args.includes('--strict'), slice, budget: secs === null ? null : secs * 1000, record });
		process.stdout.write(r.text + '\n');
		process.exitCode = r.code;
	}
}
