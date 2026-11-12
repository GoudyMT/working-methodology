// The mutation check (E29): flips one condition at a time in the code the coverage map ties to tests, runs only
// those tests on a throwaway copy of HEAD, and names every flip that no test catches. A flip that survives is a line
// whose tests would pass whatever it did: a hollow test or a gap, for the lead to read (rule:test-value).
//   node scripts/mutation-check.mjs [files...]          the covered lines of these files (default: every covered file)
//   node scripts/mutation-check.mjs --base <ref> [...]  only the lines changed since <ref>
//   --also "<command>"  a check that also runs on each flip (a guard's proof); a non-zero exit catches it
//   --timeout <ms>      per flip (default 120000); a flip that hangs its tests counts as caught
//   --json <file>       also write every flip, the tests that reach it and the tests that caught it (T15 Part B)
//   --slice <i>/<n>     only every n-th flip from the i-th, so CI can split the run over n jobs
// Needs tests/.map.json made at HEAD (node scripts/test-run.mjs --map, on a clean tree). Exit 0 none survived,
// 1 some survived, 2 it could not run. The repo itself is never changed: every flip is made in the copy.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync, spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import kitTemp from '../project/.claude/kit-temp.cjs';

const { makeTemp, removeTemp } = kitTemp;
const git = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8' });
const posix = (p) => p.split(path.sep).join('/');

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
	const o = { files: [], base: null, also: [], timeout: 120000, json: null, slice: null };
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === '--base') o.base = argv[++i];
		else if (argv[i] === '--json') o.json = argv[++i];
		else if (argv[i] === '--slice') {
			const m = /^(\d+)\/(\d+)$/.exec(argv[++i] || '');
			o.slice = m && Number(m[1]) < Number(m[2]) ? [Number(m[1]), Number(m[2])] : 'bad';
		}
		else if (argv[i] === '--also') o.also.push(argv[++i]);
		else if (argv[i] === '--timeout') o.timeout = Number(argv[++i]) || o.timeout;
		else o.files.push(posix(argv[i]));
	}
	return o;
}

// The new-side line numbers each file changed since base: a flip outside them is not this change's.
function changedLines(root, base) {
	const out = {};
	let file = null;
	for (const l of git(root, 'diff', '-U0', `${base}...HEAD`).stdout.split('\n')) {
		if (l.startsWith('+++ ')) file = l === '+++ /dev/null' ? null : l.slice(6);
		const m = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(l);
		if (m && file) for (let k = 0; k < Number(m[2] ?? 1); k++) (out[file] ||= new Set()).add(Number(m[1]) + k);
	}
	return out;
}

function runTests(copy, keys, timeout, home) {
	return new Promise((resolve) => {
		const only = path.join(copy, '.mutation-only.json');
		fs.writeFileSync(only, JSON.stringify(keys));
		const files = [...new Set(keys.map((k) => k.slice(0, k.indexOf('::'))))].map((f) => path.join(copy, f));
		const { NODE_TEST_CONTEXT: _c, KIT_SHARD: _s, KIT_MAP_DIR: _m, KIT_MAP_TEST: _t, KIT_RUN_AT: _a, ...env } = process.env;
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
			const named = keys.filter((k) => red.has(k.slice(k.indexOf('::') + 2)));
			const caught = code !== 0 || fail > 0;
			resolve({ caught, ran: pass + fail, timedOut: code === null, caughtBy: caught ? (named.length ? named : keys) : [] });
		});
	});
}

export async function main(argv) {
	const o = parseArgs(argv);
	const top = git(process.cwd(), 'rev-parse', '--show-toplevel');
	if (top.status !== 0) { process.stderr.write('mutation-check: run it inside a git repo\n'); return 2; }
	const root = path.resolve(top.stdout.trim());
	const mapFile = path.join(root, 'tests', '.map.json');
	const make = 'make one with node scripts/test-run.mjs --map on a clean tree';
	if (!fs.existsSync(mapFile)) { process.stderr.write(`mutation-check: no coverage map (tests/.map.json): ${make}\n`); return 2; }
	const map = JSON.parse(fs.readFileSync(mapFile, 'utf8'));
	const head = git(root, 'rev-parse', 'HEAD').stdout.trim();
	// The map's line numbers are its commit's, so a flip is placed only on that commit's lines.
	if (map.sha !== head) { process.stderr.write(`mutation-check: the map is for ${String(map.sha).slice(0, 12)}, not HEAD ${head.slice(0, 12)}: ${make}\n`); return 2; }
	const scope = o.base ? changedLines(root, o.base) : null;
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
	const home = { KIT_CLAUDE_HOME: claudeDir, CLAUDE_CONFIG_DIR: claudeDir };
	let caught = 0;
	const survived = [];
	const record = [];
	if (o.slice === 'bad') { removeTemp(copy); removeTemp(claudeDir); process.stderr.write('mutation-check: --slice takes i/n with i below n\n'); return 2; }
	try {
		// Only lines that flip are counted, so the slices split the real work: slice i takes every n-th flip from i.
		const spots = [...byLine.values()].sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)
			.filter((s) => flip((fs.readFileSync(path.join(copy, s.file), 'utf8').split('\n')[s.line - 1]) ?? ''))
			.filter((s, k) => !o.slice || k % o.slice[1] === o.slice[0]);
		for (const s of spots) {
			const file = path.join(copy, s.file);
			const original = fs.readFileSync(file, 'utf8');
			const lines = original.split('\n');
			const f = flip(lines[s.line - 1] ?? '');
			if (!f) continue;
			lines[s.line - 1] = f.text;
			fs.writeFileSync(file, lines.join('\n'));
			try {
				let r = await runTests(copy, s.tests, o.timeout, home);
				for (const cmd of o.also) if (!r.caught) r = { caught: spawnSync(cmd, { cwd: copy, shell: true, encoding: 'utf8', timeout: o.timeout, env: { ...process.env, ...home } }).status !== 0, caughtBy: [] };
				record.push({ file: s.file, line: s.line, op: f.op, tests: s.tests, caughtBy: r.caughtBy || [], caught: r.caught });
				if (r.caught) { caught++; process.stdout.write(`caught ${s.file}:${s.line} ${f.op}${r.timedOut ? ' (timed out)' : ''}\n`); }
				else { survived.push(s); process.stdout.write(`SURVIVED ${s.file}:${s.line} ${f.op}: ${lines[s.line - 1].trim()} was ${original.split('\n')[s.line - 1].trim()} (tests: ${s.tests.join(', ')})\n`); }
			} finally {
				fs.writeFileSync(file, original);
			}
		}
	} finally {
		removeTemp(copy);
		removeTemp(claudeDir);
	}
	if (o.json) fs.writeFileSync(o.json, JSON.stringify({ sha: head, slice: o.slice, flips: record }, null, 1) + '\n');
	process.stdout.write(`mutation check: ${caught + survived.length} flips, ${caught} caught, ${survived.length} survived\n`);
	return survived.length ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
	process.exitCode = await main(process.argv.slice(2));
}
