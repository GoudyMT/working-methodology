// The guarded test runner: the way CI runs the suite, the only way to run it in the Cowork VM, and the way to run
// only the tests a change reaches.
//   node scripts/test-run.mjs [files...]            every test, in shards (no files: every tests/*.test.mjs)
//   node scripts/test-run.mjs --changed [files...]  only the tests that reach what changed since the map's commit
//   node scripts/test-run.mjs --map [files...]      every test, recording the coverage map (needs a clean tree)
//   --shards <n>                                     processes to split the tests over (default: CPUs, at most 8)
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

const { inodeUse, sweepStale, makeTemp, removeTemp } = kitTemp;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const TRACE = path.join(HERE, '..', 'tests', 'map-trace.cjs');
const MAP_FILE = path.join('tests', '.map.json');
const posix = (p) => p.split(path.sep).join('/');

const git = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8' });

function parseArgs(args) {
	const o = { shards: Math.min(8, os.availableParallelism()), map: false, changed: false, files: [] };
	for (let i = 0; i < args.length; i++) {
		if (args[i] === '--shards') o.shards = Math.max(1, Number(args[++i]) || 1);
		else if (args[i] === '--map') o.map = true;
		else if (args[i] === '--changed') o.changed = true;
		else o.files.push(path.resolve(args[i]));
	}
	return o;
}

// The lines a V8 coverage result ran, per file inside the repo. Ranges are painted outer to inner, so a function
// that never ran inside one that did reads as not run; a line counts when any character on it ran.
function ranLines(result, root, into) {
	for (const s of result || []) {
		let file = s.url;
		if (file.startsWith('file:')) file = fileURLToPath(file);
		if (!path.isAbsolute(file) || !/\.(mjs|cjs|js)$/.test(file)) continue;
		const rel = posix(path.relative(root, file));
		if (rel.startsWith('..') || rel.startsWith('tests/') || rel.includes('node_modules/')) continue;
		let text;
		try { text = fs.readFileSync(file, 'utf8'); } catch { continue; } // a file a test made and removed
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
		for (const f of fs.readdirSync(dir)) {
			const p = path.join(dir, f);
			if (f.endsWith('.json')) ranLines(JSON.parse(fs.readFileSync(p, 'utf8')).result, root, lines);
			else if (f.startsWith('reads-')) {
				for (const abs of fs.readFileSync(p, 'utf8').split('\n').filter(Boolean)) {
					const rel = posix(path.relative(root, abs));
					if (!rel.startsWith('..') && !path.isAbsolute(rel)) reads.add(rel);
				}
			}
		}
		tests[`${entry.file}::${entry.name}`] = { lines: Object.fromEntries(Object.entries(lines).map(([k, v]) => [k, [...v].sort((a, b) => a - b)])), reads: [...reads].sort() };
	}
	return { sha, made: new Date().toISOString(), tests };
}

// Each top-level test in a file, by the line its test( call starts on; a name built at run time is null.
function testRanges(text) {
	const starts = [];
	text.split('\n').forEach((l, i) => {
		const m = /^\s*test\(\s*(['"`])((?:\\.|(?!\1).)*)\1/.exec(l);
		if (/^\s*test\(/.test(l)) starts.push({ line: i + 1, name: m && !(m[1] === '`' && m[2].includes('${')) ? m[2].replace(/\\(.)/g, '$1') : null });
	});
	return starts.map((s, i) => ({ ...s, end: i + 1 < starts.length ? starts[i + 1].line - 1 : Infinity }));
}

// Changed lines per file since a commit: old-side lines (to match the map) and new-side lines (to match test files).
function changes(root, sha) {
	const out = {};
	const at = (f) => (out[f] ||= { old: new Set(), now: new Set(), whole: false });
	let file = null;
	for (const l of git(root, 'diff', '-U0', '--no-color', '--no-renames', sha, '--').stdout.split('\n')) {
		if (l.startsWith('--- ')) file = l === '--- /dev/null' ? null : l.slice(6);
		else if (l.startsWith('+++ ')) { if (l !== '+++ /dev/null') file = l.slice(6); at(file); }
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
	const testFiles = new Map(files.map((f) => [posix(path.relative(root, f)), f]));
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

function runOne(args, env) {
	const t0 = Date.now();
	return new Promise((resolve) => {
		// Run from inside a test, node:test's own context variable would make the child report in its binary protocol.
		const { NODE_TEST_CONTEXT, ...base } = process.env;
		const child = spawn(process.execPath, args, { env: { ...base, ...env } });
		let out = '';
		child.stdout.on('data', (d) => { out += d; });
		child.stderr.on('data', (d) => { out += d; });
		const pass = (sig) => () => child.kill(sig);
		const sigs = ['SIGINT', 'SIGTERM', 'SIGHUP'].map((s) => [s, pass(s)]);
		for (const [s, h] of sigs) process.on(s, h);
		child.on('close', (code, sig) => {
			for (const [s, h] of sigs) process.off(s, h);
			const num = (k) => Number((new RegExp(`^# ${k} (\\d+)`, 'm').exec(out) || [])[1] || 0);
			resolve({ status: code ?? 128 + (os.constants.signals[sig] || 0), out, pass: num('pass'), fail: num('fail'), s: (Date.now() - t0) / 1000 });
		});
	});
}

export async function main(argv) {
	const o = parseArgs(argv);
	const tmp = os.tmpdir();
	const use = inodeUse(tmp);
	if (use.level === 'refuse') {
		process.stderr.write(`test-run: ${use.text}: refuse to run above ${kitTemp.REFUSE_PCT}%. Clear old temp folders first.\n`);
		return 2;
	}
	if (use.level === 'warn') process.stderr.write(`test-run: warning, ${use.text}\n`);
	const top = git(process.cwd(), 'rev-parse', '--show-toplevel');
	const root = top.status === 0 ? path.resolve(top.stdout.trim()) : process.cwd();
	if (o.map) {
		const dirty = git(root, 'status', '--porcelain', '--untracked-files=no').stdout.trim();
		if (dirty) {
			process.stderr.write(`test-run: a map's line numbers must match its commit; commit or stash these first:\n${dirty}\n`);
			return 2;
		}
	}
	sweepStale(tmp);
	const before = new Set(fs.readdirSync(tmp));
	const testsDir = fs.existsSync(path.join(root, 'tests')) ? path.join(root, 'tests') : path.join(HERE, '..', 'tests');
	const files = o.files.length ? o.files : fs.readdirSync(testsDir).filter((f) => f.endsWith('.test.mjs')).map((f) => path.join(testsDir, f));
	const harnessed = files.filter((f) => fs.readFileSync(f, 'utf8').includes('harness.mjs'));
	const whole = files.filter((f) => !harnessed.includes(f));

	const work = makeTemp('kit-run-');
	const status = await (async () => {
		const env = { KIT_REPO: root };
		let shardFiles = harnessed;
		let shards = o.shards;
		if (o.changed) {
			const pick = select(root, harnessed);
			if (pick.why) process.stdout.write(`test-run: ${pick.why}; running every test.\n`);
			else {
				shardFiles = harnessed.filter((f) => pick.only.some((k) => k.startsWith(posix(path.relative(root, f)) + '::')));
				fs.writeFileSync(path.join(work, 'only.json'), JSON.stringify(pick.only));
				env.KIT_ONLY = path.join(work, 'only.json');
				shards = Math.max(1, Math.min(shards, pick.only.length));
				process.stdout.write(`test-run: ${pick.only.length} test(s) reach what changed since the map's commit.\n`);
			}
		}
		if (o.map) {
			env.KIT_MAP_DIR = path.join(work, 'map');
			fs.mkdirSync(env.KIT_MAP_DIR);
			env.NODE_OPTIONS = `${process.env.NODE_OPTIONS || ''} --require "${posix(TRACE)}"`.trim(); // NODE_OPTIONS reads a backslash as an escape
		}
		const t0 = Date.now();
		const jobs = [];
		if (shardFiles.length) {
			for (let i = 0; i < shards; i++) jobs.push(runOne(['--test', '--test-reporter=tap', '--test-concurrency=1', ...shardFiles], { ...env, KIT_SHARD: `${i}/${shards}` }));
		}
		if (whole.length) jobs.push(runOne(['--test', '--test-reporter=tap', ...whole], env));
		const results = await Promise.all(jobs);
		for (const r of results) if (r.status !== 0) process.stdout.write(r.out);
		const sum = (k) => results.reduce((n, r) => n + r[k], 0);
		const label = shardFiles.length ? `${shards} shards` : 'no shards';
		process.stdout.write(`test-run: ${label}, pass ${sum('pass')}, fail ${sum('fail')} in ${((Date.now() - t0) / 1000).toFixed(1)} s\n`);
		if (o.map) {
			const sha = git(root, 'rev-parse', 'HEAD').stdout.trim();
			const map = buildMap(env.KIT_MAP_DIR, root, sha);
			fs.writeFileSync(path.join(root, MAP_FILE), JSON.stringify(map));
			process.stdout.write(`test-run: map of ${Object.keys(map.tests).length} test(s) at ${sha.slice(0, 12)} in ${posix(MAP_FILE)}\n`);
		}
		return results.some((r) => r.status !== 0) ? 1 : 0;
	})().finally(() => removeTemp(work));

	sweepStale(tmp);
	const added = fs.readdirSync(tmp).filter((n) => !before.has(n));
	if (added.length) {
		process.stderr.write(`test-run: temp growth: ${added.length} in ${tmp}:\n${added.map((n) => `  ${n}`).join('\n')}\n`);
		return status || 1;
	}
	process.stdout.write(`test-run: temp growth: 0 in ${tmp}\n`);
	return status;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
	process.exitCode = await main(process.argv.slice(2));
}
