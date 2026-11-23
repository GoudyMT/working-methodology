// The mutation check (E29): flips one condition at a time in the code the coverage map ties to tests, runs only
// those tests on a throwaway copy of HEAD, and names every flip that no test catches. A flip that survives is a line
// whose tests would pass whatever it did: a hollow test or a gap, for the lead to read (rule:test-value).
//   node scripts/mutation-check.mjs [files...]          the covered lines of these files (default: every covered file)
//   node scripts/mutation-check.mjs --base <ref> [...]  only the lines changed since <ref>
//   --also "<command>"  a check that also runs on each flip (a guard's proof); a non-zero exit catches it
//   --timeout <ms>      per flip (default 120000); a flip that hangs its tests counts as caught
//   --json <file>       also write every flip, the tests that reach it and the tests that caught it (T15 Part B)
//   --slice <i>/<n>     only every n-th flip from the i-th, so CI can split the run over n jobs
//   --report            with --base: flip only the production lines the range added, print "flips: <n>" and one
//                       "survivor:" line per flip no test catches, and exit 0 (the minimal-code job, report only)
//   --count             only say how many flips the run would make ("flips: <n>"), and run nothing (K41)
//   --until-caught      a test that caught one flip runs on no later flip, and the run ends once every test has caught
//                       one: for a check that asks only whether each test catches some flip (the test check's A2, K131)
//   --whole             a flip that survives its mapped tests runs once more against every test of their files: the map
//                       misses code reached through a child it never traced (K126)
//   --value             the value check (U21): the tests that catch nothing, a covering set, each reached test's seconds
//                       (its duration_ms) and dollars (kit.config.json ciRatePerMinute, else "not priced"), and the functions
//                       by approx complexity (1 + branches, over 10 first). Report only: exits 0 whatever it finds; a
//                       usage error (a refused or unknown flag) exits 2 with the reason on stderr.
// Needs tests/.map.json made at HEAD (node scripts/test-run.mjs --map, on a clean tree). Exit 0 none survived,
// 1 some survived, 2 it could not run. The repo itself is never changed: every flip is made in the copy.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import kitTemp from '../project/.claude/kit-temp.cjs';

const { makeTemp, removeTemp } = kitTemp;
const git = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8' });
const posix = (p) => p.split(path.sep).join('/');
// Report mode flips production lines only: a test file's lines are not the change's code to judge.
const isTest = (f) => /(^|\/)tests?\/|\.test\.[cm]?js$/.test(f);
// --slice i/n: report mode counts i from 1 to n; the other modes take i below n, from 0 (their tests pin that).
const sliceOk = (o) => (o.report ? o.slice[0] >= 1 && o.slice[0] <= o.slice[1] : o.slice[0] < o.slice[1]);

// One flip per line, the first that applies, in this fixed order, so a rerun flips the same thing.
const OPS = [
	[/===/, '!==', '=== to !=='], [/!==/, '===', '!== to ==='], [/ && /, ' || ', '&& to ||'], [/ \|\| /, ' && ', '|| to &&'],
	[/\btrue\b/, 'false', 'true to false'], [/\bfalse\b/, 'true', 'false to true'], [/ >= /, ' < ', '>= to <'],
	[/ <= /, ' > ', '<= to >'], [/ > (?!=)/, ' <= ', '> to <='], [/ < (?!=)/, ' >= ', '< to >='],
	[/\breturn (?!;)/, 'return void ', 'return x to return void x'],
];
function flip(line) {
	const t = line.trim();
	if (!t || t.startsWith('//') || t.startsWith('*') || t.startsWith('import ')) return null;
	for (const [re, to, op] of OPS) if (re.test(line)) return { op, text: line.replace(re, to) };
	return null;
}

function parseArgs(argv) {
	const o = { files: [], base: null, also: [], timeout: 120000, json: null, slice: null, count: false, untilCaught: false, whole: false, report: false, value: false };
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === '--base') o.base = argv[++i];
		else if (argv[i] === '--json') o.json = argv[++i];
		else if (argv[i] === '--slice') {
			const m = /^(\d+)\/(\d+)$/.exec(argv[++i] || '');
			o.slice = m ? [Number(m[1]), Number(m[2])] : 'bad';
		}
		else if (argv[i] === '--count') o.count = true;
		else if (argv[i] === '--until-caught') o.untilCaught = true;
		else if (argv[i] === '--whole') o.whole = true;
		else if (argv[i] === '--report') o.report = true;
		else if (argv[i] === '--value') o.value = true;
		else if (argv[i] === '--also') o.also.push(argv[++i]);
		else if (argv[i] === '--timeout') o.timeout = Number(argv[++i]) || o.timeout;
		else o.files.push(posix(argv[i]));
	}
	return o;
}

// The new-side line numbers each file changed since base: a flip outside them is not this change's.
// The base is resolved to a commit first, so a word that starts with a dash is never read as a git option, and a
// diff that fails stops the run: an empty scope from a typo would pass green having measured nothing (K41).
function changedLines(root, base) {
	const sha = git(root, 'rev-parse', '--verify', '--quiet', '--end-of-options', `${base}^{commit}`).stdout.trim();
	if (!/^[0-9a-f]{40,64}$/.test(sha)) return null;
	// A branch that deletes many megabytes of files can overflow the output buffer, which read as no commit. A deleted
	// file adds no line to flip, so deletions are left out, and the buffer has room for a large change.
	// Names are read plain (no quoting, the usual a/ and b/ prefixes, whatever the user's config says); a diff past
	// the buffer says so rather than reading as no commit.
	const diff = spawnSync('git', ['-c', 'core.quotePath=false', '-c', 'diff.noprefix=false', 'diff', '-U0', '--no-color', '--src-prefix=a/', '--dst-prefix=b/', '--diff-filter=d', `${sha}...HEAD`], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28 });
	if (diff.error && diff.error.code === 'ENOBUFS') return { overflow: true };
	if (diff.status !== 0) return null;
	const out = {};
	let file = null;
	for (const l of diff.stdout.split('\n')) {
		// git ends a name holding a space with a tab; a name git still quotes (a tab or newline in it) is not read.
		if (l.startsWith('+++ ')) file = l === '+++ /dev/null' || l[4] === '"' ? null : l.slice(6).replace(/\t$/, '');
		const m = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(l);
		if (m && file) for (let k = 0; k < Number(m[2] ?? 1); k++) (out[file] ||= new Set()).add(Number(m[1]) + k);
	}
	return out;
}

function runTests(copy, keys, timeout, home, timing) {
	return new Promise((resolve) => {
		const only = path.join(copy, '.mutation-only.json');
		fs.writeFileSync(only, JSON.stringify(keys));
		const files = [...new Set(keys.map((k) => k.slice(0, k.indexOf('::'))))].map((f) => path.join(copy, f));
		const { NODE_TEST_CONTEXT: _c, KIT_SHARD: _s, KIT_PACK: _p, KIT_MAP_DIR: _m, KIT_MAP_TEST: _t, KIT_RUN_AT: _a, ...env } = process.env;
		const child = spawn(process.execPath, ['--test', '--test-reporter=tap', '--test-concurrency=1', ...files], { cwd: copy, env: { ...env, ...home, KIT_ONLY: only, KIT_REPO: copy, KIT_MAP_OFF: '1' } });
		let out = '';
		child.stdout.on('data', (d) => { out += d; });
		const kill = setTimeout(() => child.kill('SIGKILL'), timeout);
		child.on('close', (code) => {
			clearTimeout(kill);
			const fail = Number((/^# fail (\d+)/m.exec(out) || [])[1] || 0);
			const pass = Number((/^# pass (\d+)/m.exec(out) || [])[1] || 0);
			// Which tests went red, by name (TAP's "not ok <n> - <name>", top level only); a run that died or timed out
			// cannot say, so every test it ran is named.
			const red = new Set([...out.matchAll(/^not ok \d+ - (.*?)(?: # .*)?$/gm)].map((m) => m[1]));
			// U21: each test's duration_ms in this run, summed into timing for the value check's seconds.
			const took = new Map([...out.matchAll(/^(?:not )?ok \d+ - (.*?)(?: # .*)?\n  ---\n  duration_ms: ([\d.]+)/gm)].map((m) => [m[1], Number(m[2])]));
			for (const k of keys) { const ms = took.get(k.slice(k.indexOf('::') + 2)); if (timing && ms !== undefined) timing.set(k, { sum: (timing.get(k)?.sum ?? 0) + ms, n: (timing.get(k)?.n ?? 0) + 1 }); }
			// A whole-file key (<file>::*, one file per run) names each test of that file that went red (the build 17 sweep).
			const named = keys.flatMap((k) => (k.endsWith('::*') ? [...red].map((n) => `${k.slice(0, -1)}${n}`) : red.has(k.slice(k.indexOf('::') + 2)) ? [k] : []));
			const caught = code !== 0 || fail > 0;
			resolve({ caught, ran: pass + fail, timedOut: code === null, caughtBy: caught ? (named.length ? named : keys) : [] });
		});
	});
}

// U21, the value check (--value): what the flips say about each test. Approx complexity is 1 plus a branch word, a
// short-circuit, ?? or a ternary ? in a top-level function's body (comment lines aside): an estimate, labelled approx.
const BRANCH = /\b(?:if|for|while|catch)\s*\(|\bcase\b|&&|\|\||\?\?|(?<![?.])\?(?![?.])/g;
function valueReport(root, map, record, timing) {
	const caughtBy = new Map();
	const reached = new Map();
	for (const f of record) {
		const id = `${f.file}:${f.line}`;
		for (const k of f.tests) reached.set(k, (reached.get(k) || 0) + 1);
		for (const k of f.caughtBy || []) (caughtBy.get(k) || caughtBy.set(k, new Set()).get(k)).add(id);
	}
	const keys = Object.keys(map.tests || {});
	const nothing = keys.filter((k) => reached.has(k) && !caughtBy.has(k));
	// Greedy covering set: the test that catches most of the caught flips still uncovered, until none is left.
	const todo = new Set([...caughtBy.values()].flatMap((s) => [...s]));
	const total = todo.size;
	const cover = [];
	while (todo.size) {
		let best = null;
		let gain = 0;
		for (const [k, ids] of caughtBy) { const g = [...ids].filter((x) => todo.has(x)).length; if (g > gain) { gain = g; best = k; } }
		cover.push(best);
		for (const x of caughtBy.get(best)) todo.delete(x);
	}
	let rate = null;
	try { const v = JSON.parse(fs.readFileSync(path.join(root, 'kit.config.json'), 'utf8')).ciRatePerMinute; if (typeof v === 'number') rate = v; } catch { /* unset: not priced */ }
	const fns = [];
	for (const file of [...new Set(keys.flatMap((k) => Object.keys(map.tests[k].lines || {})))]) {
		let lines;
		try { lines = fs.readFileSync(path.join(root, file), 'utf8').split('\n'); } catch { continue; }
		lines.forEach((l, i) => {
			const m = /^(?:export )?(?:async )?function (\w+)/.exec(l);
			if (!m) return;
			let end = i + 1;
			while (end < lines.length && !/^\}/.test(lines[end])) end++;
			const body = lines.slice(i, end + 1).filter((x) => !/^\s*\/\//.test(x)).join('\n');
			const n = keys.filter((k) => (map.tests[k].lines?.[file] || []).some((x) => x >= i + 1 && x <= end + 1)).length;
			if (n) fns.push({ name: m[1], file, c: 1 + (body.match(BRANCH) || []).length, n });
		});
	}
	fns.sort((a, b) => b.c - a.c);
	const out = [`Test value (report only): ${keys.length} tests, ${record.length} flips, ${keys.length - reached.size} reach no flip (not measured)`];
	out.push(`Tests that catch nothing: ${nothing.length}`, ...nothing.map((k) => `    ${k}`));
	out.push('Functions by approx complexity (1 + branches; over 10 first):', ...fns.map((f) => `    ${f.name}  ${f.file}  complexity ${f.c}${f.c > 10 ? ' (over 10)' : ''}  reached by ${f.n} test(s)`));
	out.push(rate === null ? 'Seconds and dollars per reached test (dollars: ciRatePerMinute in kit.config.json, unset: not priced):' : `Seconds and dollars per reached test (ciRatePerMinute ${rate}):`);
	for (const k of keys.filter((x) => reached.has(x))) {
		const t = timing.get(k);
		const sec = t ? t.sum / t.n / 1000 : null;
		const cost = rate === null ? 'not priced' : sec === null ? 'not timed' : `$${(sec / 60 * rate).toFixed(4)}`;
		out.push(`    ${k}  ${sec === null ? 'not timed' : `${sec.toFixed(3)} s`}  ${cost}`);
	}
	out.push(`Covering set (greedy, so near the smallest): ${cover.length} test(s) catch all ${total} caught flip(s): ${cover.join(', ') || 'none'}`);
	return out.join('\n') + '\n';
}

// U21: the usage error a --value run makes, as its reason, or null. --value measures every flip of the kit, so it takes
// none of the flags that narrow a run, and no flag it does not know.
const VALUE_REFUSED = ['--base', '--slice', '--report', '--count'];
const VALUE_FLAGS = ['--value', '--json', '--also', '--timeout', '--whole', '--until-caught'];
function valueUsage(argv) {
	if (!argv.includes('--value')) return null;
	const refused = argv.filter((a) => VALUE_REFUSED.includes(a));
	if (refused.length) return `mutation-check: --value measures every flip of the kit: it takes no ${refused.join(', ')}`;
	const unknown = argv.filter((a) => a.startsWith('--') && !VALUE_FLAGS.includes(a));
	return unknown.length ? `mutation-check: --value takes no ${unknown.join(', ')}: its flags are --json, --also, --timeout, --whole and --until-caught` : null;
}

export async function main(argv) {
	const o = parseArgs(argv);
	if (o.slice && (o.slice === 'bad' || !sliceOk(o))) { process.stderr.write(`mutation-check: --slice takes i/n${o.report ? ' with 1 <= i <= n' : ' with i below n'}\n`); return 2; }
	const usage = valueUsage(argv);
	if (usage) { process.stderr.write(`${usage}\n`); return 2; }
	const top = git(process.cwd(), 'rev-parse', '--show-toplevel');
	if (top.status !== 0) { process.stderr.write('mutation-check: run it inside a git repo\n'); return 2; }
	const root = path.resolve(top.stdout.trim());
	const mapFile = path.join(root, 'tests', '.map.json');
	const make = 'make one with node scripts/test-run.mjs --map on a clean tree';
	const head = git(root, 'rev-parse', 'HEAD').stdout.trim();
	// Report mode (the CI job) never fails: a run it cannot measure says so as flips: 0 and a note, and exits 0.
	const note = (why) => { process.stdout.write(`flips: 0\nnote: ${why}\n`); return 0; };
	if (o.report && !o.base) return note('--report needs --base <sha>');
	if (!fs.existsSync(mapFile)) { if (o.report) return note(`no test map for ${head}`); process.stderr.write(`mutation-check: no coverage map (tests/.map.json): ${make}\n`); return 2; }
	const map = JSON.parse(fs.readFileSync(mapFile, 'utf8'));
	// The map's line numbers are its commit's, so a flip is placed only on that commit's lines.
	if (map.sha !== head) { if (o.report) return note(`no test map for ${head}`); process.stderr.write(`mutation-check: the map is for ${String(map.sha).slice(0, 12)}, not HEAD ${head.slice(0, 12)}: ${make}\n`); return 2; }
	const scope = o.base ? changedLines(root, o.base) : null;
	if (o.base && (!scope || scope.overflow)) {
		const why = scope ? `the diff from "${o.base}" adds more than 256 MB of lines, past what it reads; measure fewer files by name` : `base "${o.base}" is not a commit this repo can diff against HEAD`;
		if (o.report) return note(why);
		process.stderr.write(`mutation-check: ${why}\n`);
		return 2;
	}
	const byLine = new Map();
	for (const [key, t] of Object.entries(map.tests || {})) {
		for (const [file, lines] of Object.entries(t.lines || {})) {
			if (o.files.length && !o.files.includes(file)) continue;
			for (const line of lines) {
				if (scope && !(scope[file] && scope[file].has(line))) continue;
				const k = `${file}:${line}`;
				if (!byLine.has(k)) byLine.set(k, { file, line, tests: [] });
				byLine.get(k).tests.push(key);
			}
		}
	}
	// A scratch clone, not a worktree: a worktree shares the repo's config, refs, hooks and .git, so broken code and
	// --also commands could reach them, and its cleanup prunes the repo's other worktrees (the 1.23.0 sweep). The
	// clone sits in this run's temp root, which the next run's temp sweep removes if this one is killed.
	kitTemp.sessionRoot();
	const copy = makeTemp('mutation-');
	const add = git(path.dirname(copy), 'clone', '--quiet', '--no-hardlinks', '--no-checkout', root, copy);
	const out = add.status === 0 ? git(copy, '-c', 'advice.detachedHead=false', 'checkout', '--quiet', head) : add;
	if (out.status !== 0) { removeTemp(copy); process.stderr.write(`mutation-check: could not make the copy: ${out.stderr}`); return 2; }
	// Every test and outside check runs with a throwaway Claude folder: a flip that drops a test's own one must land
	// there, never in the owner's ~/.claude (the 1.24.0 build: a mutation run rewrote the owner's install record).
	const claudeDir = makeTemp('claude-home-');
	// And a throwaway home folder: the build 14 audit found a flip in the kit's home lookup that skipped both Claude
	// settings and fell back to the owner's home. Git's identity comes along, so a test that commits still can.
	const userHome = makeTemp('user-home-');
	try { fs.copyFileSync(path.join(os.homedir(), '.gitconfig'), path.join(userHome, '.gitconfig')); } catch { /* none */ }
	const home = { KIT_CLAUDE_HOME: claudeDir, CLAUDE_CONFIG_DIR: claudeDir, HOME: userHome, USERPROFILE: userHome };
	let caught = 0;
	const survived = [];
	const record = [];
	const timing = new Map();
	try {
		// Only lines that flip are counted, so the slices split the real work: slice i takes every n-th flip from i.
		const every = [...byLine.values()].sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)
			.filter((s) => (!o.report || !isTest(s.file)) && flip((fs.readFileSync(path.join(copy, s.file), 'utf8').split('\n')[s.line - 1]) ?? ''));
		const spots = every.filter((s, k) => !o.slice || k % o.slice[1] === o.slice[0] - (o.report ? 1 : 0));
		if (o.count) { process.stdout.write(`flips: ${spots.length}\n`); return 0; }
		if (o.report) process.stdout.write(`flips: ${spots.length}\n`);
		// A scoped run with no flip measured nothing: said as that, never as a clean pass.
		if (o.base && spots.length === 0 && !o.report) {
			if (o.json) fs.writeFileSync(o.json, JSON.stringify({ sha: head, slice: o.slice, base: o.base, flips: [] }, null, 1) + '\n');
			process.stdout.write(every.length ? `mutation check: no flip in this slice (${every.length} in the whole run)\n` : `mutation check: nothing measured: no line changed since ${o.base} has a flip a test reaches\n`);
			return 0;
		}
		// K193: an outside check that fails on the clean copy would catch every flip (the delete proof's Windows-only
		// junction case on Linux), so each runs once with no flip made, and a failure there stops the run.
		for (const cmd of o.also) {
			const clean = spawnSync(cmd, { cwd: copy, shell: true, encoding: 'utf8', timeout: o.timeout, env: { ...process.env, ...home } });
			if (clean.status !== 0) {
				process.stderr.write(`mutation-check: --also "${cmd}" fails with no flip made (exit ${clean.status}), so it would catch every flip: fix it or leave it out\n`);
				return 2;
			}
		}
		const done = new Set();
		const everyTest = new Set(spots.flatMap((s) => s.tests));
		for (const s of spots) {
			// K131: with --until-caught, only the tests that have caught nothing yet run, and none left ends the run.
			const tests = o.untilCaught ? s.tests.filter((k) => !done.has(k)) : s.tests;
			if (o.untilCaught && [...everyTest].every((k) => done.has(k))) break;
			if (!tests.length) continue;
			const file = path.join(copy, s.file);
			const original = fs.readFileSync(file, 'utf8');
			const lines = original.split('\n');
			const f = flip(lines[s.line - 1] ?? '');
			if (!f) continue;
			lines[s.line - 1] = f.text;
			fs.writeFileSync(file, lines.join('\n'));
			try {
				let r = await runTests(copy, tests, o.timeout, home, timing);
				let byWhole = false;
				// The build 17 sweep: one file per run, so each red test is named; a run out of time catches nothing.
				if (!r.caught && o.whole) {
					for (const wf of new Set(tests.map((k) => k.slice(0, k.indexOf('::'))))) {
						const w = await runTests(copy, [`${wf}::*`], o.timeout, home, timing);
						if (w.timedOut) { r = { ...r, timedOut: true }; continue; }
						if (w.caught) { r = w; byWhole = true; break; }
					}
				}
				for (const cmd of o.also) if (!r.caught) r = { caught: spawnSync(cmd, { cwd: copy, shell: true, encoding: 'utf8', timeout: o.timeout, env: { ...process.env, ...home } }).status !== 0, caughtBy: [] };
				record.push({ file: s.file, line: s.line, op: f.op, tests, caughtBy: r.caughtBy || [], caught: r.caught, ...(r.timedOut && !r.caught ? { timedOut: true } : {}) });
				for (const k of r.caughtBy || []) done.add(k);
				if (r.caught) { caught++; if (!o.report) process.stdout.write(`caught ${s.file}:${s.line} ${f.op}${r.timedOut ? ' (timed out)' : ''}${byWhole ? ' (by the whole file)' : ''}\n`); }
				else { survived.push(s); process.stdout.write(o.report ? `survivor: ${s.file}:${s.line}: missing test or code the tests do not demand\n` : `SURVIVED ${s.file}:${s.line} ${f.op}: ${lines[s.line - 1].trim()} was ${original.split('\n')[s.line - 1].trim()} (tests: ${s.tests.join(', ')})\n`); }
			} finally {
				fs.writeFileSync(file, original);
			}
		}
	} finally {
		removeTemp(copy);
		removeTemp(claudeDir);
		removeTemp(userHome);
	}
	if (o.json) fs.writeFileSync(o.json, JSON.stringify({ sha: head, slice: o.slice, ...(o.base ? { base: o.base } : {}), flips: record }, null, 1) + '\n');
	if (!o.report) process.stdout.write(`mutation check: ${caught + survived.length} flips, ${caught} caught, ${survived.length} survived\n`);
	if (o.value) process.stdout.write(valueReport(root, map, record, timing));
	return survived.length && !o.report ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
	const argv = process.argv.slice(2);
	const code = await main(argv);
	// U21: the value check only reports, so it exits 0 whatever it finds or cannot run; a usage error is 2.
	process.exitCode = argv.includes('--value') ? (valueUsage(argv) ? 2 : 0) : code;
}
