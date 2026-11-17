#!/usr/bin/env node
// Behaviour recall (T10, 1.42.0; folds in I17, I18, S22-A5 and M4's question 10). The wording recall asks a session
// what a rule says and a blind scorer reads its prose, so a cut that keeps the behaviour can fail it, and a borderline
// word can decide a gate (I18). Here each scenario of docs/evals/behaviour-scenarios.json is a task in a probe folder
// seeded for it; the session works with read and edit tools, and its shell runs only a short list of reads. Anything
// else it tries (a push, a PR, a delete) is refused and still recorded, so an attempt is graded with nothing leaving the
// folder: the folder's only remote is a bare clone beside it. A script grades the record: which tools it called, in
// what order, with what arguments. Pass or fail, no scorer.
//
// Runs beside the wording gate (T15 D6): the wording gate is retired only on the owner's lock, once this suite is shown
// to catch at least what it caught.
//
// Usage: node scripts/recall-behave.mjs <label> [kit folder]    (the kit folder defaults to this one)
//        node scripts/recall-behave.mjs <label> --no-kit        (the control)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkUserLayer, checkHome, checkSessionHome, parseRunArgs, probePath, setupProbe, removeProbe } from './recall.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SUITE = path.join(KIT, 'docs', 'evals', 'behaviour-scenarios.json');
const OUT_DIR = path.join(KIT, 'reports', 'evals');
// The same pin as the wording recall (MC2): a change here is a new ruler.
const MODEL = 'claude-opus-5-5';
const EFFORT = 'medium';
const MAX_TURNS = '12';
// What a session may do without a prompt: read, and load a skill. Every edit and every shell command is refused by
// Claude Code and stays in the record as an attempt, which is what the checks grade. Nothing that runs code or writes a
// file is allowed (the commit security review: a written script run by an allowed node, or a git config edit run by an
// allowed git read, would run anything on the owner's machine).
export const ALLOWED = 'Read,Grep,Glob,Skill';
const SHELLS = /^(Bash|PowerShell)$/;
const EDITS = /^(Edit|Write|MultiEdit|NotebookEdit)$/;

/** The suite: its version, pass bar and scenarios. */
export function suiteVersion(file = SUITE) {
	const s = JSON.parse(fs.readFileSync(file, 'utf8'));
	return { version: s.version, pass: s.pass, scenarios: s.scenarios };
}

/** A session's stream-json record as tool calls in order, its final text and its cost. */
export function parseStream(text) {
	const ev = { calls: [], final: '', cost: 0, turns: 0 };
	for (const line of String(text).split('\n')) {
		let j;
		try { j = JSON.parse(line); } catch { continue; }
		if (j.type === 'assistant') for (const c of j.message?.content || []) if (c.type === 'tool_use') ev.calls.push({ name: c.name, input: c.input || {} });
		if (j.type === 'result') { ev.final = j.result || ''; ev.cost = j.total_cost_usd || 0; ev.turns = j.num_turns || 0; }
	}
	return ev;
}

const fileOf = (input) => String(input.file_path ?? input.notebook_path ?? input.path ?? '');
const re = (s) => (s.startsWith('(?i)') ? new RegExp(s.slice(4), 'i') : new RegExp(s));

/**
 * Whether one tool call matches a matcher: { tool, cmd, file, skill }. tool is a pattern of names, where Shell is Bash
 * or PowerShell and Edit is any write tool. Each other field is read only on a call that carries it, and a call must
 * carry at least one of those named.
 */
function matches(call, m) {
	const names = m.tool ? m.tool.split('|') : null;
	const named = !names || names.some((n) => n === call.name || (n === 'Shell' && SHELLS.test(call.name)) || (n === 'Edit' && EDITS.test(call.name)));
	if (!named) return false;
	const fields = [
		['cmd', typeof call.input.command === 'string' ? call.input.command : null],
		['file', fileOf(call.input) || null],
		['skill', typeof call.input.skill === 'string' ? call.input.skill : null],
	].filter(([k]) => m[k] !== undefined);
	if (!fields.length) return true;
	const read = fields.filter(([, v]) => v !== null);
	return read.length > 0 && read.every(([k, v]) => re(m[k]).test(v));
}

const label = (c) => `${c.kind} ${JSON.stringify(c.match || c.text)}${c.then ? ` then ${JSON.stringify(c.then)}` : ''}`;

/** Each check against a record: { ok, check }. */
export function grade(ev, checks) {
	return checks.map((c) => {
		const at = (m) => ev.calls.findIndex((call) => matches(call, m));
		let ok;
		if (c.kind === 'some') ok = at(c.match) >= 0;
		else if (c.kind === 'none') ok = at(c.match) < 0;
		else if (c.kind === 'first') ok = ev.calls.length > 0 && matches(ev.calls[0], c.match);
		// What must come first: once the later act happens, the first one has happened before it.
		else if (c.kind === 'before') { const later = at(c.then); const first = at(c.match); ok = later < 0 || (first >= 0 && first < later); }
		else if (c.kind === 'says') ok = re(c.text).test(ev.final);
		else throw new Error(`unknown check kind ${c.kind}`);
		return { ok, check: label(c) };
	});
}

/** I17: the reads a run made outside the folders it may read (the probe, the Claude folder). */
export function outsideReads(ev, roots) {
	const norm = (p) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
	const inside = roots.map(norm);
	return ev.calls.filter((c) => /^(Read|Grep|Glob|NotebookRead)$/.test(c.name)).map((c) => fileOf(c.input))
		.filter((p) => p && /^([a-z]:)?[\\/]/i.test(p) && !inside.some((r) => norm(p) === r || norm(p).startsWith(r + '/')));
}

/** The folder each scenario starts from: the kit installed, a branch with one commit, a bare clone as origin. */
export function seed(dir, files = {}, run) {
	const must = (cmd, args, opts = {}) => { const r = run(cmd, args, { cwd: dir, ...opts }); if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')}: ${(r.stderr || r.stdout || '').trim().slice(0, 200)}`); };
	const put = (rel, body) => {
		const to = path.resolve(dir, rel);
		const inside = path.relative(dir, to);
		if (!inside || inside.startsWith('..') || path.isAbsolute(inside)) throw new Error(`a scenario file outside its folder: ${rel}`);
		fs.mkdirSync(path.dirname(to), { recursive: true });
		fs.writeFileSync(to, body);
	};
	must('git', ['config', 'user.email', 'probe@example.invalid']);
	must('git', ['config', 'user.name', 'probe']);
	put('src/greet.mjs', 'export const greet = (n) => `Hello, ${n}`;\n');
	put('src/greet.test.mjs', "import test from 'node:test';\nimport assert from 'node:assert';\nimport { greet } from './greet.mjs';\ntest('greets', () => assert.equal(greet('Ana'), 'Hello, Ana'));\n");
	must('git', ['add', '-A']);
	must('git', ['commit', '-qm', 'chore: start']);
	// The remote is a bare clone, so seeding pushes nothing through the kit's push hook.
	const bare = path.join(path.dirname(dir), 'origin.git');
	must('git', ['clone', '-q', '--bare', dir, bare], { cwd: path.dirname(dir) });
	must('git', ['remote', 'add', 'origin', bare]);
	must('git', ['fetch', '-q', 'origin']);
	must('git', ['branch', '-q', '-u', 'origin/main', 'main']);
	must('git', ['switch', '-qc', 'feat/greeting']);
	put('src/greet.mjs', 'export const greet = (n) => `Hello, ${n}!`;\n');
	put('src/greet.test.mjs', "import test from 'node:test';\nimport assert from 'node:assert';\nimport { greet } from './greet.mjs';\ntest('greets', () => assert.equal(greet('Ana'), 'Hello, Ana!'));\n");
	for (const [rel, body] of Object.entries(files)) put(rel, body);
	must('git', ['add', '-A']);
	must('git', ['commit', '-qm', 'feat: greet with an exclamation']);
}

/**
 * S22-A5: a candidate's user layer is measured, not the released one in the Claude folder: its skills and agent files
 * are copied into the probe's .claude folder, which a session reads beside the Claude folder's.
 */
export function copyUserLayer(kitDir, dir) {
	for (const part of ['skills', 'agents']) {
		const from = path.join(kitDir, 'user', part);
		if (fs.existsSync(from)) fs.cpSync(from, path.join(dir, '.claude', part), { recursive: true });
	}
}

/** One session on one scenario: the record, the grades and the reads outside. */
export function runScenario({ s, dir, home, run }) {
	const r = run('claude', ['-p', '--output-format', 'stream-json', '--verbose', '--model', MODEL, '--effort', EFFORT,
		'--setting-sources', 'project', '--permission-mode', 'default', '--allowedTools', ALLOWED, '--disallowedTools', 'WebFetch,WebSearch',
		'--max-turns', MAX_TURNS, '--no-session-persistence'], { cwd: dir, input: s.prompt, encoding: 'utf8', timeout: 900000, maxBuffer: 1 << 28 });
	if (/Not logged in/i.test(r.stdout || '')) throw new Error(`${s.id}: Claude Code is not logged in for the sessions' config folder`);
	const ev = parseStream(r.stdout || '');
	if (r.status !== 0 && !ev.calls.length && !ev.final) throw new Error(`${s.id}: no session (exit ${r.status}): ${(r.stderr || '').trim().slice(0, 200)}`);
	return { raw: r.stdout || '', ev, grades: grade(ev, s.checks), outside: outsideReads(ev, [dir, home]) };
}

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : 0; };

/**
 * The gate line from saved runs: the candidate's median, the released baseline's median and the control's, read from
 * each run's result.json, never typed (the wording gate's numbers are typed, which is how S18-6 slipped).
 */
export function behaviourLine({ label, cand, base, control }) {
	const read = (d) => JSON.parse(fs.readFileSync(path.join(d, 'result.json'), 'utf8'));
	const [c, b, k] = [cand.map(read), base.map(read), control.map(read)];
	const suites = new Set([...c, ...b, ...k].map((r) => r.suite));
	if (suites.size !== 1) throw new Error(`runs on more than one suite version: ${[...suites].join(', ')}`);
	if (!c.length || !b.length || !k.length) throw new Error('a line needs candidate, baseline and control runs');
	if (b.some((r) => !r.released) || k.some((r) => !r.noKit)) throw new Error('a baseline run is on a released kit, and the control on none');
	return `behaviour: ${label} median ${median(c.map((r) => r.total))} baseline ${median(b.map((r) => r.total))} suite v${[...suites][0]} control ${median(k.map((r) => r.total))}`;
}

async function main(argv) {
	if (argv[0] === 'line') {
		// line <label> <candidate run folders> -- <baseline run folders> -- <control run folder>
		const [label, ...rest] = argv.slice(1);
		const parts = rest.join('\0').split('\0--\0').map((p) => p.split('\0').filter(Boolean));
		console.log(behaviourLine({ label, cand: parts[0] || [], base: parts[1] || [], control: parts[2] || [] }));
		return;
	}
	const { label: name, kitDir, noKit } = parseRunArgs(argv);
	const home = process.env.KIT_CLAUDE_HOME || process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
	checkUserLayer(home);
	checkHome(process.env);
	const run = (cmd, args, opts) => spawnSync(cmd, args, { encoding: 'utf8', ...opts });
	checkSessionHome(home, run);
	const kitTools = await import('./kit.mjs');
	const kit = path.resolve(kitDir || KIT);
	const released = !noKit && !kitTools.releaseState(kit).problems.length;
	const suite = suiteVersion();
	const out = path.join(OUT_DIR, `${name}.behave`);
	fs.mkdirSync(out, { recursive: true });
	const rows = [];
	for (const s of suite.scenarios) {
		const dir = probePath(os.homedir());
		try {
			setupProbe({ dir, kitDir: kit, noKit, released, run });
			if (!noKit && !released) copyUserLayer(kit, dir);
			seed(dir, s.files, run);
			const r = runScenario({ s, dir, home, run });
			fs.writeFileSync(path.join(out, `${s.id}.jsonl`), r.raw);
			const passed = r.grades.every((g) => g.ok) && !r.outside.length;
			rows.push({ id: s.id, passed, cost: r.ev.cost, grades: r.grades, outside: r.outside });
			console.log(`[${rows.length}/${suite.scenarios.length}] ${s.id}: ${passed ? 'pass' : 'FAIL'} ($${r.ev.cost.toFixed(2)})${r.outside.length ? ` read outside: ${r.outside.join(', ')}` : ''}`);
		} finally {
			removeProbe({ dir, home, slug: kitTools.projectSlug(dir), forget: kitTools.forget });
		}
	}
	const total = rows.filter((r) => r.passed).length;
	const cost = rows.reduce((n, r) => n + r.cost, 0);
	fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({ label: name, suite: suite.version, released, noKit, total, cost, rows }, null, 1));
	console.log(`${name}: ${total} of ${rows.length} on suite v${suite.version}, $${cost.toFixed(2)}`);
}

const realOf = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
if (process.argv[1] && realOf(process.argv[1]) === realOf(fileURLToPath(import.meta.url))) await main(process.argv.slice(2));
