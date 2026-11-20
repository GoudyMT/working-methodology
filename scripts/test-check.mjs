#!/usr/bin/env node
// The test check (T15 Part A, the owner 2026-11-10): holds each test a change adds or edits to the kit's bar for a new
// test (rule:test-value): it fails first, it earns its place, it sits in the right lane, and it is owed at all.
//   node scripts/test-check.mjs <base> [--strict] [--slice i/n] [--budget <seconds>] [--record <build record>]
//   A1 fails first      the change's test files run against the base commit's code: a new test must fail there, on an
//                       assertion. A changed test that passes there adds no catch, and is named. Two pass on the base
//                       by design and are proven on the new code (build 16): a test tagged "// planted: {"file", "was",
//                       "to"}" fails on each bug it names, planted there; a changed test (or one tagged "// renamed
//                       from: <old name>") whose old version fails there was edited because the code changed, and is
//                       listed for the owner as trimmed or adapted. A5 measures a fix test whose file the base lacks on
//                       the commit before its fix. Off Windows, a test marked { windows: true } and a planted bug
//                       tagged "os": "win32" are left to the Windows job, whose part (--windows) measures only those.
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
// CI runs it with --strict (K24): exit 1 on any finding but a test the time budget left unmeasured, which is named
// only. Without --strict it reports and exits 0. Exit 2: it could not run.
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

/**
 * Whether a test's new version only loses lines of its old one (its name aside): each code line it keeps is an old
 * line, in the old order, and at least one is gone. A line edited in place is not a loss.
 *
 * Args:
 *     oldBody: the test's text on the base
 *     newBody: its text now
 *
 * Returns:
 *     true when the new version is the old one less some lines
 */
export function removedOnly(oldBody, newBody) {
	const lines = (b) => b.split('\n').filter((l) => !/^\s*\/\//.test(l)).map((l) => l.trim().replace(NAMED, 'test(""')).filter(Boolean);
	const [was, now] = [lines(oldBody), lines(newBody)];
	let i = 0;
	for (const l of now) { while (i < was.length && was[i] !== l) i++; if (i === was.length) return false; i++; }
	return now.length < was.length;
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
	out.twice = new Set();
	starts.forEach(([i, name, loop], k) => {
		let head = i;
		while (head > 0 && comment(lines[head - 1])) head--;
		let end = k + 1 < starts.length ? starts[k + 1][0] : lines.length;
		// A plain test ends at its own closing line at the margin, so top-level code after it is not part of it (PR 51:
		// a test inserted after one read the old one as changed). A loop keeps the reach above.
		if (!loop) { const close = lines.slice(i + 1, end).findIndex((l) => /^\}\)/.test(l)); if (close >= 0) end = i + 1 + close + 1; }
		while (end - 1 > i && comment(lines[end - 1])) end--;
		// The build 17 sweep: a second test of the same name is named, never read over in silence.
		if (out.has(name)) out.twice.add(name);
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
	red.why = new Map();
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
		// TAP writes a backslash or # in a test's name with a backslash before it (PR 52: "cd\" read as never run).
		const plain = (name) => name.replace(/\\([\\#])/g, '$1');
		for (const m of out.matchAll(/^(?:not ok|ok) \d+ - (.*?)(?: # .*)?$/gm)) if (!isFile(m[1])) red.seen.add(`${f}::${plain(m[1])}`);
		// Each top-level "not ok <n> - <name>" with its YAML block up to the next result line.
		for (const m of out.matchAll(/^not ok \d+ - (.*?)(?: # .*)?\n([\s\S]*?)(?=^(?:ok|not ok) \d+ - |^1\.\.|(?![\s\S]))/gm)) {
			// A file that could not load (an import the base lacks), or ended non-zero, fails as a whole under its own path;
			// K148 keeps the module it could not find, so the check names that cause once.
			if (isFile(m[1])) {
				red.set(`file:${f}`, false);
				// Node writes the load error as comment lines before the file's result, not inside its block.
				const miss = `${out}\n${r.stderr || ''}`.match(/Cannot find (?:module|package) '([^']+)'/);
				if (miss) red.why.set(f, slash(miss[1]).replace(`${slash(dir)}/`, ''));
			}
			else red.set(`${f}::${plain(m[1])}`, /ERR_ASSERTION|AssertionError/.test(m[2]));
		}
	}
	if (cut) red.cut = new Set(red.seen);
	return red;
}

export function check(root, base, { strict = false, slice = null, budget = null, record = null, windowsPart = false } = {}) {
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
	// A copy of the repo at a commit, with this change's test files and the harness laid over it.
	const checkoutAt = (dir, sha) => {
		const c = git(path.dirname(dir), 'clone', '--quiet', '--no-hardlinks', '--no-checkout', root, dir);
		const co = c.status === 0 ? git(dir, '-c', 'advice.detachedHead=false', 'checkout', '--quiet', sha === 'HEAD' ? git(root, 'rev-parse', 'HEAD').stdout.trim() : sha) : c;
		if (co.status === 0) {
			for (const f of new Set([...testFiles, 'tests/harness.mjs'])) {
				fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
				fs.copyFileSync(path.join(root, f), path.join(dir, f));
			}
		}
		return co;
	};
	const proven = [];
	let newOrChanged = [];
	// A test whose only change is its comment lines (a why line added) adds no catch to prove: it gets A6 only (the
	// build 14 PR: 38 retagged tests were held to fail first again).
	const retagged = [];
	const codeOf = (b) => b.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
	// T10 (build 17): a test moved word for word out of another test file (a file split) is no new test. It counts as
	// moved only when that file held it on the base and holds it no more; a copy left in both is new.
	const moved = [];
	let baseTests = null;
	// The build 17 sweep: and only when every line of its new file outside the tests (imports, helpers, stand-ins) is a
	// line of the old one, so a copy whose file makes it run differently is checked as new.
	const outside = (text, found) => { let t = String(text); for (const b of found.values()) t = t.replace(b, ''); return new Set(t.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('//'))); };
	const baseText = new Map();
	const movedFrom = (f, name, body) => {
		if (!baseTests) {
			baseTests = new Map();
			const listed = git(root, 'ls-tree', '-r', '--name-only', baseSha, '--', 'tests').stdout.split('\n').filter((x) => TEST_FILE.test(x));
			for (const g of listed) { const t = git(root, 'show', `${baseSha}:${g}`).stdout; baseText.set(g, t); baseTests.set(g, tests(t)); }
		}
		const text = fs.readFileSync(path.join(root, f), 'utf8');
		const mine = outside(text, tests(text));
		for (const [g, was] of baseTests) {
			if (g === f || was.get(name) !== body) continue;
			const theirs = outside(baseText.get(g), was);
			if ([...mine].some((l) => !theirs.has(l))) continue;
			let now = '';
			try { now = fs.readFileSync(path.join(root, g), 'utf8'); } catch { /* the file is gone */ }
			if (!tests(now).has(name)) return g;
		}
		return null;
	};
	for (const f of testFiles) {
		const now = tests(fs.readFileSync(path.join(root, f), 'utf8'));
		const onBase = git(root, 'cat-file', '-e', `${baseSha}:${f}`).status === 0;
		const was = tests(onBase ? git(root, 'show', `${baseSha}:${f}`).stdout : '');
		for (const name of now.twice) note(`${f}::${name}`, 'A1', 'two tests in this file share the name: the check reads only the last, so give each its own');
		if (/^\s*(describe|suite|it)\(/m.test(fs.readFileSync(path.join(root, f), 'utf8'))) note(f, 'A1', 'a describe, suite or it block: the check reads only test() at the margin, so the tests inside go unchecked');
		for (const [name, body] of now) {
			if (was.get(name) === body) continue;
			if (!was.has(name)) { const g = movedFrom(f, name, body); if (g) { moved.push(`    moved ${f}::${name}: from ${g}`); continue; } }
			if (was.has(name) && codeOf(was.get(name)) === codeOf(body)) { retagged.push({ key: `${f}::${name}`, body }); continue; }
			// A loop's tests are named at run time: its pattern, the written name with each ${...} read as any text.
			const loop = now.loops.has(name) ? new RegExp(`^${name.split(/\$\{[^}]*\}/).map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*?')}$`) : null;
			// The version this test replaces: its own on the base, or the one it names as renamed from (gone from the file now).
			const from = (/^\s*\/\/ renamed from: (.+?)\s*$/m.exec(headOf(body)) || [])[1];
			const old = was.has(name) ? { name, body: was.get(name) } : from && was.has(from) && !now.has(from) ? { name: from, body: was.get(from) } : null;
			// A new name over the same code is no new test (PR 52): its why line is all there is to check.
			const untitled = (b) => codeOf(b).replace(NAMED, 'test(""');
			if (old && untitled(old.body) === untitled(body)) { retagged.push({ key: `${f}::${name}`, body }); continue; }
			newOrChanged.push({ key: `${f}::${name}`, file: f, name, body, isNew: !was.has(name), newFile: !onBase, loop, old });
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
	// The owner, 2026-11-18: what only Windows can show is measured on Windows. A test marked { windows: true } is
	// skipped elsewhere, and a planted bug tagged "os": "win32" shows only there. Off Windows each is left to the Windows
	// job and named; that job's part (--windows) measures them and nothing else.
	const plantsOf = (t) => [...headOf(t.body).matchAll(/^\s*\/\/ planted: (.*)$/gm)].map((m) => {
		try { const p = JSON.parse(m[1]); if (p && [p.file, p.was, p.to].every((x) => typeof x === 'string' && x)) return p; } catch { /* named below */ }
		return null;
	});
	const onWindows = process.platform === 'win32';
	const windowsOnly = (t) => /^test\((['"`])(?:\\.|(?!\1).)*\1,\s*\{[^}\n]*\bwindows:\s*true\b/m.test(t.body);
	const forWindows = (t) => windowsOnly(t) || plantsOf(t).some((p) => p && p.os === 'win32');
	const leftToWindows = [];
	if (windowsPart) newOrChanged = newOrChanged.filter(forWindows);
	else if (!onWindows) {
		for (const t of newOrChanged.filter(windowsOnly)) leftToWindows.push(`    left to the Windows job ${t.key}: it runs only on Windows`);
		newOrChanged = newOrChanged.filter((t) => !windowsOnly(t));
	}
	if (!windowsPart) {
		// A4: a change with no code in it, that still adds a test.
		const code = changed.filter(([s, f]) => s !== 'D' && !TEST_FILE.test(f) && /\.(c?js|mjs|sh)$|^project\/\.githooks\//.test(f));
		if (!code.length) for (const t of newOrChanged.filter((x) => x.isNew)) note(t.key, 'A4', 'a test added by a change of prose, wiring or removals only: is it owed?');
		// A3: the right lane, by what the test needs.
		for (const t of newOrChanged) if (LARGE.test(t.body) && !t.file.startsWith('tests/slow/')) note(t.key, 'A3', 'needs another machine, a real service, a browser or a model: it belongs in tests/slow');
	}
	if (newOrChanged.length) {
		// A1: the change's test files on the base commit's code.
		say(`A1: ${newOrChanged.length} test(s) on the base commit, ${budget === null ? 'no time budget' : `${Math.round(left() / 1000)} s of the budget left`}`);
		kitTemp.sessionRoot();
		const copy = makeTemp('test-check-');
		const home = makeTemp('test-check-home-');
		const pending = [];
		try {
			const co = checkoutAt(copy, baseSha);
			if (co.status !== 0) return { code: 2, text: `test check: could not make the base copy: ${co.stderr}` };
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
				// K148: a file the base has that cannot load there is one cause, named once by its file, not a failed test each.
				else if (!names.length && red.has(`file:${t.file}`)) {
					if (t.newFile) t.loadOnly = true;
					else if (!findings.some((x) => x.key === t.file && x.rule === 'A1')) {
						const who = /(^|\/)main$/.test(base) ? 'main' : 'the base';
						const need = red.why.get(t.file);
						note(t.file, 'A1', `${who} cannot load this: ${need ? `it lacks ${need}` : 'the file ended before its tests ran'}. Its tests are not measured there (the file could not load); land what it needs on main first, as its own small PR`);
					}
				}
				else if (!reds.length) pending.push(t);
				else if (!reds.some((n) => red.get(n))) note(t.key, 'A1', 'fails on the base commit, but not on an assertion (a crash or a missing file)');
			}
		} finally {
			removeTemp(copy);
			removeTemp(home);
		}
		// Build 16 (the owner, 2026-11-18): two tests pass on the base by design, each proven on the new code instead.
		// A planted-bug test guards code that was already right: it fails on each bug it names, planted in the new code.
		// A changed (or renamed) test whose old version fails on the new code was edited because the code changed. The
		// check cannot tell a forced edit from a weakened one, so each is listed for the owner: trimmed (only lines lost,
		// no looser than deleting the test, which the check never sees) or adapted.
		const provable = pending.filter((t) => !t.loop && (plantsOf(t).length || t.old));
		const fail = (t, why) => note(t.key, 'A1', `${t.isNew ? 'passes on the base commit' : 'changed, and passes on the base commit'}${why}`);
		for (const t of pending.filter((x) => !provable.includes(x))) note(t.key, 'A1', t.isNew ? 'passes on the base commit: it does not fail first' : 'changed, and passes on the base commit: it adds no catch');
		if (provable.length) {
			const at = makeTemp('test-check-head-');
			const home2 = makeTemp('test-check-home-');
			const env = { KIT_CLAUDE_HOME: home2, CLAUDE_CONFIG_DIR: home2 };
			try {
				const co = checkoutAt(at, 'HEAD');
				for (const t of provable) {
					if (co.status !== 0) { fail(t, ': its proof on the new code could not run'); continue; }
					const all = plantsOf(t);
					// Off Windows a planted bug tagged for Windows is left to the Windows job; the rest are measured here.
					const plants = onWindows ? all : all.filter((p) => !p || p.os !== 'win32');
					if (all.length > plants.length) leftToWindows.push(`    left to the Windows job ${t.key}: ${all.length - plants.length} planted bug(s) show only on Windows`);
					if (all.length && !plants.length) { t.proof = 'left to the Windows job'; continue; }
					if (plants.length) {
						let why = null;
						for (const p of plants) {
							if (!p) { why = ', and a planted tag is not JSON naming its file, was and to'; break; }
							const src = path.join(at, p.file);
							const text = fs.existsSync(src) ? fs.readFileSync(src, 'utf8') : '';
							if (text.split(p.was).length !== 2) { why = `, and its planted text is not found once in ${p.file}`; break; }
							fs.writeFileSync(src, text.replace(p.was, () => p.to));
							const red = run(at, [t.key], env, left);
							fs.writeFileSync(src, text);
							if (red.cut && !red.seen.has(t.key)) { why = ': not checked: the time budget ran out'; break; }
							if (!red.seen.has(t.key)) { why = `, and it did not run with its planted bug in ${p.file}`; break; }
							if (red.get(t.key) !== true) { why = `, and passes with its planted bug in ${p.file} (${JSON.stringify(p.was.slice(0, 60))})`; break; }
						}
						if (why) fail(t, why);
						else proven.push(`    planted ${t.key}: fails on each of its ${plants.length} planted bug(s)`), t.proof = 'fails on its planted bug(s)';
						continue;
					}
					// The old test in its own file, with the helpers it had, on the new code.
					const file = path.join(at, t.file);
					const text = fs.readFileSync(file, 'utf8');
					fs.writeFileSync(file, git(root, 'show', `${baseSha}:${t.file}`).stdout);
					const key = `${t.file}::${t.old.name}`;
					const red = run(at, [key], env, left);
					fs.writeFileSync(file, text);
					if (red.cut && !red.seen.has(key)) fail(t, ': not checked: the time budget ran out');
					else if (!red.seen.has(key)) fail(t, ': it adds no catch, and its old version does not run on the new code');
					else if (!red.has(key)) fail(t, ': it adds no catch, and its old version passes on the new code');
					else if (red.get(key) !== true) fail(t, ': it adds no catch, and its old version fails on the new code only by a crash');
					else if (removedOnly(t.old.body, t.body)) proven.push(`    trimmed ${t.key}: only loses lines, and its old version fails on the new code`), t.proof = 'only loses lines the new code forced';
					else proven.push(`    adapted ${t.key}: edited, and its old version fails on the new code`), t.proof = 'an edit the new code forced';
				}
			} finally {
				removeTemp(at);
				removeTemp(home2);
			}
		}
	}
	// A5 runs before the A2 flip run, the slow step, so a time budget spent on flips still leaves the ledger its proof.
	// A5 (K105): each test the fix ledger names gets its A1 verdict, and the PR's fix line may claim only that. A fix
	// whose test does not fail first, or is not one this change adds or changes, is a finding. With slices, the slice
	// holding the test states its verdict, and the first slice names a test no slice holds.
	const ledger = [];
	if (record) {
		const mine = new Map(newOrChanged.map((t) => [t.key, t]));
		for (const f of record) {
			if (windowsPart && !mine.has(f.test)) continue;
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
			const t = mine.get(f.test);
			let why = a1 ? a1.text : t.loadOnly ? 'fails on the base commit only because its file cannot load there' : null;
			let ok = t.proof || 'fails first';
			// Build 16: a test whose file is new on the branch is measured on the commit before its fix, where it loads.
			const fixSha = !a1 && t.loadOnly && f.commit ? git(root, 'rev-parse', '--verify', '--quiet', '--end-of-options', `${f.commit}^{commit}`).stdout.trim() : '';
			const before = fixSha ? git(root, 'rev-parse', '--verify', '--quiet', `${fixSha}^`).stdout.trim() : '';
			if (before) {
				const at = makeTemp('test-check-fix-');
				const home3 = makeTemp('test-check-home-');
				try {
					const co = checkoutAt(at, before);
					// A fix often adds the function its test imports, and a missing named import stops the whole file
					// loading. Read each local module whole there, so a test that calls what the fix added fails on that
					// call (not an assertion: still named), and the rest run on the code before the fix.
					if (co.status === 0) {
						const tf = path.join(at, f.test.slice(0, f.test.indexOf('::')));
						let k = 0;
						fs.writeFileSync(tf, fs.readFileSync(tf, 'utf8').replace(/^import \{([^}]*)\} from (['"])(\.{1,2}\/[^'"]+)\2;$/gm, (_, names, q, from) => { k++; return `import * as fixBefore${k} from ${q}${from}${q};\nconst {${names.replace(/\bas\b/g, ':')}} = fixBefore${k};`; }));
					}
					const red = co.status === 0 ? run(at, [f.test], { KIT_CLAUDE_HOME: home3, CLAUDE_CONFIG_DIR: home3 }, left) : null;
					const on = `${fixSha.slice(0, 9)}^`;
					if (!red || red.has(`file:${f.test.slice(0, f.test.indexOf('::'))}`) && !red.seen.has(f.test)) why = `cannot load on ${on}, the commit before its fix, either`;
					else if (red.cut && !red.seen.has(f.test)) why = 'not checked on the commit before its fix: the time budget ran out';
					else if (!red.has(f.test)) why = `passes on ${on}, the commit before its fix`;
					else if (red.get(f.test) !== true) why = `fails on ${on}, but not on an assertion (a crash or a missing file)`;
					else { why = null; ok = `fails first on ${on}`; }
				} finally {
					removeTemp(at);
					removeTemp(home3);
				}
			}
			ledger.push(`    ${head} ${f.test}: ${why || ok}`);
			if (why) note(f.id, 'A5', `the test it names ${why}`);
		}
	}
	{
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
		// K131 (build 17): A2 asks only whether each untagged test catches some flip, so the map is made of those tests
		// alone and each stops running once it has caught one (--until-caught): the same verdict per test, without the
		// whole file's tests on every flip (PR 52: part 0 spent 11 of its 11.5 minutes here). A2 is then sliced by test, as
		// A1 is, since no slice maps a whole file.
		const a2Pool = windowsPart ? [] : newOrChanged;
		const untagged = a2Pool.filter((t) => !tagged(t));
		if (untagged.length) {
			kitTemp.sessionRoot();
			say(`A2: ${untagged.length} untagged test(s) in ${[...new Set(untagged.map((x) => x.file))].join(', ')} measured against the flips of this change, ${budget === null ? 'no time budget' : `${Math.round(left() / 1000)} s of the budget left`}`);
			// A loop's names are made at run time, so its whole file is mapped (KIT_ONLY reads <file>::* for that).
			const onlyFile = path.join(makeTemp('test-check-only-'), 'only.json');
			fs.writeFileSync(onlyFile, JSON.stringify([...new Set(untagged.map((t) => (t.loop ? `${t.file}::*` : t.key)))]));
			const step = (args) => { const ms = left(); return ms > 0 ? spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', killSignal: 'SIGKILL', maxBuffer: 64 * 1024 * 1024, env: process.env, ...(budget === null ? {} : { timeout: ms }) }) : { status: null, error: { code: 'ETIMEDOUT' } }; };
			// The build 17 sweep: the map made here covers these tests alone, so the tree's own map is put back after, for the
			// packed and --changed runs that read it.
			const mapPath = path.join(root, 'tests', '.map.json');
			let keptMap = null;
			try { keptMap = fs.readFileSync(mapPath); } catch { /* none to keep */ }
			const flipsFile = path.join(makeTemp('test-check-flips-'), 'flips.json');
			let mapped, m;
			try {
				mapped = step([path.join(HERE, 'test-run.mjs'), '--map', '--shards', '1', '--only', onlyFile, ...new Set(untagged.map((t) => t.file))]);
				m = mapped.status === 0 ? step([path.join(HERE, 'mutation-check.mjs'), '--base', baseSha, '--json', flipsFile, '--timeout', '60000', '--until-caught']) : mapped;
			} finally {
				if (keptMap) fs.writeFileSync(mapPath, keptMap); else fs.rmSync(mapPath, { force: true });
			}
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
	for (const t of windowsPart ? [] : [...newOrChanged, ...(!slice || slice.i === 0 ? retagged : [])]) {
		const fault = whyFault(t.body);
		if (fault) note(t.key, 'A6', fault);
	}
	const lines = [`Test check: ${newOrChanged.length} new or changed test(s) since ${baseSha.slice(0, 9)}, ${findings.length} finding(s)`];
	for (const f of findings) lines.push(`    ${f.rule} ${f.key}: ${f.text}`);
	if (proven.length) lines.push(`Proven on the new code instead of the base: ${proven.length}`, ...proven);
	// Named by count only past 20: a file split moves hundreds.
	if (moved.length) lines.push(`Moved unchanged from another file: ${moved.length}`, ...(moved.length <= 20 ? moved : []));
	if (leftToWindows.length) lines.push(`Left to the Windows job (its test check part runs them): ${leftToWindows.length}`, ...leftToWindows);
	if (record && ledger.length) lines.push(`Fix ledger: ${record.length} fix(es)`, ...ledger);
	// K24 (the owner, 2026-11-17): strict fails on a real finding; a test the time budget left unmeasured is named only.
	const real = findings.filter((f) => !/the time budget ran out$/.test(f.text));
	return { code: strict && real.length ? 1 : 0, text: lines.join('\n'), findings };
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
					: args.includes('--windows') && process.platform !== 'win32' ? { code: 2, text: 'test check: --windows measures what only Windows shows, so it runs on Windows' }
							: check(path.resolve(top || '.'), base, { strict: args.includes('--strict'), slice, budget: secs === null ? null : secs * 1000, record, windowsPart: args.includes('--windows') });
		process.stdout.write(r.text + '\n');
		process.exitCode = r.code;
	}
}
