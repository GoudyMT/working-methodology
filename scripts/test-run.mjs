// The guarded test runner: the way CI runs the suite, the only way to run it in the Cowork VM, and the way to run
// only the tests a change reaches.
//   node scripts/test-run.mjs [files...]            every test, in shards (no files: every tests/*.test.mjs)
//   node scripts/test-run.mjs --changed [files...]  only the tests that reach what changed since the map's commit
//   node scripts/test-run.mjs --map [files...]      every test, recording the coverage map (needs a clean tree)
//   --always <file>    with --changed: this file's tests run whatever the change reaches (CI's security set), once
//   --pick             with --changed: print the tests it would run, one per line, and run none (a builder's pick)
//                      Over half the suite reached, --changed runs every test and says so.
//   --shards <n>                                     processes to split the tests over (default: CPUs, at most 8)
//   --slice <i>/<n>                                  run only slice i (from 0) of n: CI splits the suite over n jobs,
//                                                    each running its own shards; files outside the harness run in slice 0.
//                                                    It needs --shards, the same on every slice; it takes no --map
// Every run:
// 1. refuses to start above 80% of the temp disk's inodes used (exit 2), and warns above 50%;
// 2. sweeps the roots of finished or killed runs, before and after;
// 3. fails when the temp folder holds more entries after than before, and names them.
// A file that imports tests/harness.mjs is split over the shards; any other file runs whole, once.
// The full suite still runs in CI at every push: a changed run is for the owner's machine.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import kitTemp from '../project/.claude/kit-temp.cjs';

const { inodeUse, sweepStale, sessionRoot, makeTemp, removeTemp } = kitTemp;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const TRACE = path.join(HERE, '..', 'tests', 'map-trace.cjs');
const MAP_FILE = path.join('tests', '.map.json');
const posix = (p) => p.split(path.sep).join('/');
// A file by its folder's real name, as git names the repo: a short name (CI's RUNNER~1) or a junction otherwise
// reads as outside it. A file a test made and removed keeps the name it had.
const realNames = new Map();
const real = (p) => {
	if (!realNames.has(p)) { let r = p; try { r = fs.realpathSync.native(p); } catch { /* gone */ } realNames.set(p, r); }
	return realNames.get(p);
};

const git = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8' });

function parseArgs(args) {
	const o = { shards: Math.min(8, os.availableParallelism()), map: false, changed: false, files: [], slice: null, always: [], pick: false };
	for (let i = 0; i < args.length; i++) {
		if (args[i] === '--shards') { o.shards = Math.max(1, Number(args[++i]) || 1); o.shardsGiven = true; }
		else if (args[i] === '--always') o.always.push(path.resolve(args[++i] || ''));
		else if (args[i] === '--pick') o.pick = true;
		// The build 17 sweep: a list of test keys (as KIT_ONLY reads them) given by name, since the runner takes KIT_ONLY
		// out of its shards' environment.
		else if (args[i] === '--only') o.only = path.resolve(args[++i] || '');
		else if (args[i] === '--slice') {
			const m = /^(\d+)\/(\d+)$/.exec(args[++i] || '');
			// A slice out of range would run nothing and pass, so a bad one stops the run.
			o.slice = m && Number(m[1]) < Number(m[2]) ? [Number(m[1]), Number(m[2])] : 'bad';
		}
		else if (args[i] === '--map') o.map = true;
		else if (args[i] === '--changed') o.changed = true;
		else o.files.push(path.resolve(args[i]));
	}
	return o;
}

// K136: where install puts a kit code file, as the repo folder it came from: a project's .claude, and the Claude
// folder's kit-tools, kit-hooks and skills. The first reading that names a file the repo has wins (a Claude folder is
// itself a .claude folder, so its kit-tools are tried as project/.claude first, then as user/kit-tools).
const INSTALLED = [[/\/\.claude\/((?:[^/]+\/)*[^/]+)$/, 'project/.claude/'], [/\/(kit-tools\/(?:[^/]+\/)*[^/]+)$/, 'user/'], [/\/(kit-hooks\/[^/]+)$/, 'user/'], [/\/(skills\/(?:[^/]+\/)*[^/]+)$/, 'user/']];
function installedSource(file, root) {
	for (const [re, into] of INSTALLED) {
		const m = re.exec(file);
		if (!m) continue;
		const rel = into + m[1];
		if (fs.existsSync(path.join(root, rel))) return rel;
	}
	return null;
}

// The lines a V8 coverage result ran, per file inside the repo. Ranges are painted outer to inner, so a function
// that never ran inside one that did reads as not run; a line counts when any character on it ran.
function ranLines(result, root, into) {
	for (const s of result || []) {
		let file = s.url;
		if (file.startsWith('file:')) file = fileURLToPath(file);
		if (!path.isAbsolute(file) || !/\.(mjs|cjs|js)$/.test(file)) continue;
		let rel = posix(path.relative(root, real(file)));
		// K136 (build 18): a test that installs the kit runs the guards from the installed copies outside the repo, which
		// were dropped here. Such a copy counts as the repo file it came from when the repo has it (install copies these
		// byte for byte), and that file's text places the lines, since the copy is often gone by now.
		if (rel.startsWith('..')) rel = installedSource(posix(file), root);
		if (!rel || rel.startsWith('..') || rel.startsWith('tests/') || rel.includes('node_modules/')) continue;
		let text;
		try { text = fs.readFileSync(path.join(root, rel), 'utf8'); } catch { continue; } // a file a test made and removed
		const count = new Int32Array(text.length);
		const ranges = s.functions.flatMap((fn) => fn.ranges).sort((a, b) => (b.endOffset - b.startOffset) - (a.endOffset - a.startOffset));
		for (const r of ranges) count.fill(r.count, r.startOffset, Math.min(r.endOffset, text.length));
		const set = (into[rel] ||= new Set());
		let line = 1;
		for (let i = 0; i < text.length; i++) {
			if (text[i] === '\n') { line++; continue; }
			if (count[i] > 0) set.add(line);
		}
	}
}

function buildMap(mapDir, root, sha) {
	const tests = {};
	const list = fs.existsSync(path.join(mapDir, 'tests.jsonl')) ? fs.readFileSync(path.join(mapDir, 'tests.jsonl'), 'utf8').trim().split('\n') : [];
	for (const entry of list.filter(Boolean).map((l) => JSON.parse(l))) {
		const dir = path.join(mapDir, entry.id);
		const lines = {};
		const reads = new Set();
		let ms = null;
		for (const f of fs.readdirSync(dir)) {
			const p = path.join(dir, f);
			if (f === 'ms') { ms = Number(fs.readFileSync(p, 'utf8')) || 0; continue; }
			if (f.endsWith('.json')) ranLines(JSON.parse(fs.readFileSync(p, 'utf8')).result, root, lines);
			else if (f.startsWith('reads-')) {
				for (const abs of fs.readFileSync(p, 'utf8').split('\n').filter(Boolean)) {
					const rel = posix(path.relative(root, real(abs)));
					if (!rel.startsWith('..') && !path.isAbsolute(rel)) reads.add(rel);
				}
			}
		}
		tests[`${entry.file}::${entry.name}`] = { lines: Object.fromEntries(Object.entries(lines).map(([k, v]) => [k, [...v].sort((a, b) => a - b)])), reads: [...reads].sort(), ...(ms === null ? {} : { ms }) };
	}
	return { sha, made: new Date().toISOString(), tests };
}

// Each top-level test in a file, by the line its test( call starts on; a name built at run time is null.
function testRanges(text) {
	const starts = [];
	text.split('\n').forEach((l, i) => {
		// A name counts only as one whole literal before the next argument; `'a' + 'b'` or `test (` read as unknown, so the
		// whole file runs (the build 14 sweep: both kept an edited test from running).
		const m = /^\s*test\s*\(\s*(['"`])((?:\\.|(?!\1).)*)\1\s*[,)]/.exec(l);
		if (/^\s*test\s*\(/.test(l)) starts.push({ line: i + 1, name: m && !(m[1] === '`' && m[2].includes('${')) ? m[2].replace(/\\(.)/g, '$1') : null });
	});
	return starts.map((s, i) => ({ ...s, end: i + 1 < starts.length ? starts[i + 1].line - 1 : Infinity }));
}

// Changed lines per file since a commit: old-side lines (to match the map) and new-side lines (to match test files).
function changes(root, sha) {
	const out = {};
	const at = (f) => (out[f] ||= { old: new Set(), now: new Set(), whole: false });
	let file = null;
	// Text diffs whatever an attributes file says, and paths unquoted; git ends a path holding a space with a tab. Any
	// changed file the hunks did not place (binary, or a name git still quotes) runs every test that reaches it (the
	// build 14 sweep).
	const diff = git(root, '-c', 'core.quotePath=false', 'diff', '-U0', '--no-color', '--no-renames', '--text', '--no-ext-diff', '--no-textconv', sha, '--').stdout;
	for (const l of diff.split('\n')) {
		if (l.startsWith('--- ')) file = l === '--- /dev/null' ? null : l.slice(6).replace(/\t$/, '');
		else if (l.startsWith('+++ ')) { if (l !== '+++ /dev/null') file = l.slice(6).replace(/\t$/, ''); at(file); }
		else if (l.startsWith('@@') && file) {
			const [, a, b = '1', c, d = '1'] = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(l);
			const span = (start, n, set) => {
				if (+n === 0) { set.add(+start); set.add(+start + 1); } else for (let i = 0; i < +n; i++) set.add(+start + i);
			};
			span(a, b, at(file).old);
			span(c, d, at(file).now);
		}
	}
	for (const f of git(root, 'ls-files', '--others', '--exclude-standard').stdout.split('\n').filter(Boolean)) at(f).whole = true;
	for (const f of git(root, 'diff', '-z', '--name-only', '--no-renames', sha, '--').stdout.split('\0').filter(Boolean)) if (!out[f] || (!out[f].old.size && !out[f].now.size)) at(f).whole = true;
	return out;
}

/**
 * The tests a change reaches, by the coverage map.
 *
 * Returns:
 *     { only: ["<file>::<name>" or "<file>::*"], why } - why is set when every test must run instead
 */
function select(root, files) {
	const mapPath = path.join(root, MAP_FILE);
	if (!fs.existsSync(mapPath)) return { why: `no coverage map at ${posix(MAP_FILE)} (make one with --map)` };
	const map = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
	if (git(root, 'cat-file', '-e', `${map.sha}^{commit}`).status !== 0) return { why: `the map's commit ${String(map.sha).slice(0, 12)} is not in this repo (make a new one with --map)` };
	const testFiles = new Map(files.map((f) => [posix(path.relative(root, real(f))), f]));
	const only = new Set();
	const entries = Object.entries(map.tests);
	const reaches = (read, f) => { const r = read.replace(/\/$/, ''); return r === f || f.startsWith(r + '/'); };
	for (const [f, ch] of Object.entries(changes(root, map.sha))) {
		if (testFiles.has(f)) {
			const ranges = testRanges(fs.existsSync(testFiles.get(f)) ? fs.readFileSync(testFiles.get(f), 'utf8') : '');
			const hit = [...ch.now].map((n) => ranges.find((r) => n >= r.line && n <= r.end));
			if (ch.whole || hit.some((r) => !r || r.name === null)) only.add(`${f}::*`);
			else for (const r of hit) only.add(`${f}::${r.name}`);
			// A test the map has never seen is new: it runs.
			for (const r of ranges) if (r.name !== null && !map.tests[`${f}::${r.name}`]) only.add(`${f}::${r.name}`);
			// A test that reads test files as data (the pin check) runs too: 1.35.0's PR run skipped it and main went red.
			for (const [key, t] of entries) if (!key.startsWith(`${f}::`) && t.reads.some((r) => reaches(r, f))) only.add(key);
			continue;
		}
		let found = false;
		for (const [key, t] of entries) {
			const lines = t.lines[f];
			if ((lines && (ch.whole || lines.some((n) => ch.old.has(n)))) || t.reads.some((r) => reaches(r, f))) { only.add(key); found = true; }
		}
		// Code no test has ever reached: run each test file that names it.
		if (!found && /\.(mjs|cjs|js)$/.test(f) && !entries.some(([, t]) => t.lines[f])) {
			for (const [tf, abs] of testFiles) if (fs.readFileSync(abs, 'utf8').includes(path.posix.basename(f))) only.add(`${tf}::*`);
		}
	}
	return { only: [...only].sort() };
}

// A run killed at CI's cap prints nothing it buffered, so each shard says which test it is in every minute, and its
// result the moment it ends.
const BEAT_MS = Number(process.env.KIT_RUN_BEAT_MS) || 60000;

function runOne(args, env, label, atFile) {
	const t0 = Date.now();
	return new Promise((resolve) => {
		// Run from inside a test, node:test's own context variable would make the child report in its binary protocol.
		// A run inside a run (the runner's own tests) must not inherit the outer run's shard, selection or map.
		const { NODE_TEST_CONTEXT, KIT_SHARD, KIT_PACK, KIT_ONLY, KIT_MAP_DIR, KIT_MAP_TEST, KIT_MAP_OFF, KIT_RUN_AT, ...base } = process.env;
		const child = spawn(process.execPath, args, { env: { ...base, ...(env.KIT_MAP_DIR ? {} : { KIT_MAP_OFF: '1' }), ...env, KIT_RUN_AT: atFile } });
		let out = '';
		child.stdout.on('data', (d) => { out += d; });
		child.stderr.on('data', (d) => { out += d; });
		// The harness writes each test's name as it starts; node's own report names a test only once it ends, so a
		// file outside the harness shows the last one that finished.
		const where = () => {
			try { return `at '${fs.readFileSync(atFile, 'utf8')}'`; } catch { /* no harnessed test has started */ }
			const done = [...out.matchAll(/^(?:not )?ok \d+ - (.+)$/gm)].pop();
			return done ? `past '${done[1]}'` : 'at its start';
		};
		const beat = setInterval(() => {
			process.stdout.write(`test-run: ${label} ${where()} after ${Math.round((Date.now() - t0) / 1000)} s\n`);
		}, BEAT_MS);
		beat.unref();
		const pass = (sig) => () => child.kill(sig);
		const sigs = ['SIGINT', 'SIGTERM', 'SIGHUP'].map((s) => [s, pass(s)]);
		// Ahead of the run root's own handler, which exits: the tests hear the signal first and remove their roots.
		for (const [s, h] of sigs) process.prependListener(s, h);
		child.on('close', (code, sig) => {
			clearInterval(beat);
			for (const [s, h] of sigs) process.off(s, h);
			const num = (k) => Number((new RegExp(`^# ${k} (\\d+)`, 'm').exec(out) || [])[1] || 0);
			const s = (Date.now() - t0) / 1000;
			const skipped = num('skipped') ? `, skipped ${num('skipped')}` : '';
			process.stdout.write(`test-run: ${label} done, pass ${num('pass')}, fail ${num('fail')}${skipped} in ${s.toFixed(1)} s\n`);
			resolve({ status: code ?? 128 + (os.constants.signals[sig] || 0), out, pass: num('pass'), fail: num('fail'), skipped: num('skipped'), s });
		});
	});
}

export async function main(argv) {
	const o = parseArgs(argv);
	if (o.slice === 'bad') {
		process.stderr.write('test-run: --slice takes i/n with 0 <= i < n\n');
		return 2;
	}
	// Every slice must split the tests the same way, so the shard count is named, not read from each runner's CPUs.
	if (o.slice && !o.shardsGiven) {
		process.stderr.write('test-run: --slice needs --shards <n>, the same on every slice, or the slices split the tests differently\n');
		return 2;
	}
	if (o.slice && o.map) {
		process.stderr.write('test-run: a map is of the whole suite; --map with --slice would write one slice\'s map at HEAD\n');
		return 2;
	}
	const tmp = os.tmpdir();
	const use = inodeUse(tmp);
	if (use.level === 'refuse') {
		process.stderr.write(`test-run: ${use.text}: refuse to run above ${kitTemp.REFUSE_PCT}%. Clear old temp folders first.\n`);
		return 2;
	}
	if (use.level === 'warn') process.stderr.write(`test-run: warning, ${use.text}\n`);
	const top = git(process.cwd(), 'rev-parse', '--show-toplevel');
	const root = real(top.status === 0 ? path.resolve(top.stdout.trim()) : process.cwd());
	if (o.map) {
		const dirty = git(root, 'status', '--porcelain', '--untracked-files=no').stdout.trim();
		if (dirty) {
			process.stderr.write(`test-run: a map's line numbers must match its commit; commit or stash these first:\n${dirty}\n`);
			return 2;
		}
	}
	// The commit the map's line numbers belong to is the one the run starts on, whatever is committed meanwhile.
	const mapSha = o.map ? git(root, 'rev-parse', 'HEAD').stdout.trim() : '';
	// Every test process's temp folder lands in this run's own root, so another program's temp files cannot count
	// as growth, and a run killed outright is swept by the next one.
	const runRoot = sessionRoot();
	const testsDir = fs.existsSync(path.join(root, 'tests')) ? path.join(root, 'tests') : path.join(HERE, '..', 'tests');
	// A notice only: a full run on the owner's machine costs minutes and finds what CI finds (K59). A map needs every test.
	if (!o.changed && !o.map && !o.files.length && !process.env.CI) process.stdout.write('test-run: a full local run. CI runs the suite on every PR and push; for a change, use --changed.\n');
	// K108: a full run reads tests/ at the top and CI's slow lane reads tests/slow, so a test file anywhere else under
	// tests/ would run in no lane. Refuse the run and name it, rather than let its failures reach no one.
	if (!o.files.length) {
		const lost = [];
		// lane: 'top' (tests/ itself: the full run), 'slow' (tests/slow at any depth: CI's slow lane, find -type f), or
		// 'none'. A link is named wherever it sits: neither lane follows one (the build 15 sweep: tests/slow as a junction
		// left the slow lane empty, and its required check read the skip as a pass).
		const walk = (d, lane) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) {
			const p = path.join(d, e.name);
			const rel = path.relative(root, p).split(path.sep).join('/');
			if (e.isSymbolicLink()) lost.push(`${rel} (a link)`);
			else if (e.isDirectory()) { if (!(d === testsDir && e.name === 'node_modules')) walk(p, d === testsDir && e.name === 'slow' ? 'slow' : lane === 'slow' ? 'slow' : 'none'); }
			// Any test-shaped file no lane runs: one outside both lanes, or one with another extension or case.
			else if (e.isFile() && /\.test\.[cm]?[jt]s$/i.test(e.name) && !(lane !== 'none' && e.name.endsWith('.test.mjs'))) lost.push(rel);
		} };
		walk(testsDir, 'top');
		if (lost.length) {
			process.stderr.write(`test-run: these test files run in no lane (only *.test.mjs files in tests/ itself and under tests/slow run, and no lane follows a link); move them:\n${lost.map((f) => `  ${f}`).join('\n')}\n`);
			return 2;
		}
	}
	const files = o.files.length ? o.files : fs.readdirSync(testsDir).filter((f) => f.endsWith('.test.mjs')).map((f) => path.join(testsDir, f));
	const harnessed = files.filter((f) => fs.readFileSync(f, 'utf8').includes('harness.mjs'));
	const whole = files.filter((f) => !harnessed.includes(f));

	const work = makeTemp('kit-run-');
	const status = await (async () => {
		// Every test runs with a throwaway Claude folder: a test that loses its own (a mutant, a slip) lands there, never in
		// the owner's ~/.claude (the 1.24.0 build: a mutation run rewrote the owner's install record).
		const claudeDir = path.join(work, 'claude');
		fs.mkdirSync(claudeDir);
		const env = { KIT_REPO: root, KIT_CLAUDE_HOME: claudeDir, CLAUDE_CONFIG_DIR: claudeDir };
		let shardFiles = harnessed;
		let shards = o.shards;
		if (o.only) env.KIT_ONLY = o.only;
		if (o.changed) {
			const pick = select(root, harnessed);
			if (!pick.why) {
				// --always: files that run whatever the change reaches (CI's security set), added here so each test runs once.
				for (const f of o.always) pick.only.push(`${posix(path.relative(root, real(f)))}::*`);
				pick.only = [...new Set(pick.only)].sort();
				// Over half the suite, the selection costs more than it saves (PR 49: 556 of 921 took 235 s, the whole 209 s).
				const all = harnessed.map((f) => posix(path.relative(root, real(f))));
				const keys = new Set(Object.keys(JSON.parse(fs.readFileSync(path.join(root, MAP_FILE), 'utf8')).tests).filter((k) => all.includes(k.slice(0, k.indexOf('::')))));
				for (const k of pick.only) if (!k.endsWith('::*')) keys.add(k);
				const n = [...keys].filter((k) => pick.only.includes(k) || pick.only.includes(`${k.slice(0, k.indexOf('::'))}::*`)).length;
				if (n * 2 > keys.size && !o.pick) pick.why = `${n} of ${keys.size} tests reach what changed, over half`;
			}
			if (o.pick) {
				process.stdout.write(pick.why ? `test-run: ${pick.why}; every test\n` : `${pick.only.join('\n')}\n`);
				return 0;
			}
			if (pick.why) process.stdout.write(`test-run: ${pick.why}; running every test.\n`);
			else {
				shardFiles = harnessed.filter((f) => pick.only.some((k) => k.startsWith(posix(path.relative(root, real(f))) + '::')));
				fs.writeFileSync(path.join(work, 'only.json'), JSON.stringify(pick.only));
				env.KIT_ONLY = path.join(work, 'only.json');
				shards = Math.max(1, Math.min(shards, pick.only.length));
				process.stdout.write(`test-run: ${pick.only.length} test(s) reach what changed since the map's commit.\n`);
			}
		}
		if (o.map) {
			env.KIT_MAP_DIR = path.join(work, 'map');
			fs.mkdirSync(env.KIT_MAP_DIR);
			env.NODE_OPTIONS = `${process.env.NODE_OPTIONS || ''} --import ${pathToFileURL(TRACE).href}`.trim(); // a URL: --require would first read the package.json in the child's folder
		}
		// K123 (build 17): with a map that kept each test's time, the tests are packed over every shard,
		// longest first onto the least loaded, so the shards finish together; a test with no time goes round robin.
		const totalShards = shards * (o.slice ? o.slice[1] : 1);
		// The build 17 sweep: slices run on other machines, each with its own map (or none), so they split by name alone.
		if (!o.map && !o.slice && shardFiles.length && totalShards > 1 && fs.existsSync(path.join(root, MAP_FILE))) {
			let times = {};
			try { times = JSON.parse(fs.readFileSync(path.join(root, MAP_FILE), 'utf8')).tests || {}; } catch { /* no map to pack by */ }
			const files = new Set(shardFiles.map((f) => posix(path.relative(root, real(f)))));
			const only = env.KIT_ONLY ? JSON.parse(fs.readFileSync(env.KIT_ONLY, 'utf8')) : null;
			const runs = (k) => !only || only.includes(k) || only.includes(`${k.slice(0, k.indexOf('::'))}::*`);
			const timed = Object.entries(times).filter(([k, t]) => typeof t.ms === 'number' && files.has(k.slice(0, k.indexOf('::'))) && runs(k)).sort((a, b) => b[1].ms - a[1].ms || (a[0] < b[0] ? -1 : 1));
			if (timed.length) {
				const load = new Array(totalShards).fill(0);
				const pack = {};
				for (const [k, t] of timed) { const s = load.indexOf(Math.min(...load)); pack[k] = s; load[s] += t.ms; }
				fs.writeFileSync(path.join(work, 'pack.json'), JSON.stringify(pack));
				env.KIT_PACK = path.join(work, 'pack.json');
				process.stdout.write(`test-run: ${timed.length} test(s) packed by last run time over ${totalShards} shard(s)\n`);
			}
		}
		const t0 = Date.now();
		const jobs = [];
		// A slice runs its own shards of n x shards in all, so the slices together run each test once.
		const [slice, slices] = o.slice || [0, 1];
		const total = shards * slices;
		const name = o.slice ? `slice ${slice + 1}/${slices} ` : '';
		if (shardFiles.length) {
			for (let j = 0; j < shards; j++) {
				const k = slice * shards + j;
				jobs.push(runOne(['--test', '--test-reporter=tap', '--test-concurrency=1', ...shardFiles], { ...env, KIT_SHARD: `${k}/${total}` }, `${name}shard ${k + 1}/${total}`, path.join(work, `at-${j}.txt`)));
			}
		}
		if (whole.length && slice === 0) jobs.push(runOne(['--test', '--test-reporter=tap', ...whole], env, 'the unsharded files', path.join(work, 'at-whole.txt')));
		const results = await Promise.all(jobs);
		for (const r of results) if (r.status !== 0) process.stdout.write(r.out);
		const sum = (k) => results.reduce((n, r) => n + r[k], 0);
		const label = `${name}${shardFiles.length ? `${shards} shards` : 'no shards'}`;
		const skipped = sum('skipped') ? `, skipped ${sum('skipped')}` : '';
		process.stdout.write(`test-run: ${label}, pass ${sum('pass')}, fail ${sum('fail')}${skipped} in ${((Date.now() - t0) / 1000).toFixed(1)} s\n`);
		if (o.map) {
			const map = buildMap(env.KIT_MAP_DIR, root, mapSha);
			fs.writeFileSync(path.join(root, MAP_FILE), JSON.stringify(map));
			process.stdout.write(`test-run: map of ${Object.keys(map.tests).length} test(s) at ${mapSha.slice(0, 12)} in ${posix(MAP_FILE)}\n`);
		}
		return results.some((r) => r.status !== 0) ? 1 : 0;
	})().finally(() => removeTemp(work));

	sweepStale(runRoot);
	const added = fs.readdirSync(runRoot);
	if (added.length) {
		process.stderr.write(`test-run: temp growth: ${added.length} in ${runRoot}:\n${added.map((n) => `  ${n}`).join('\n')}\n`);
		return status || 1;
	}
	process.stdout.write(`test-run: temp growth: 0 in ${runRoot}\n`);
	return status;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
	process.exitCode = await main(process.argv.slice(2));
}
