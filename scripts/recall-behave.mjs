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
//        node scripts/recall-behave.mjs <label> [kit folder] --just <id,...>   (a second look: those scenarios alone)
//        node scripts/recall-behave.mjs line <label> <cand> -- <base> -- <control> [-- <cand again> -- <base again>]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { armUserLayer, carryUserLayer, checkUserLayer, checkGateHome, checkHome, checkSessionHome, gateModel, parseRunArgs, probePath, setupProbe, removeProbe, refuseOverCap } from './recall.mjs';

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

/**
 * Seen twice (the owner's pick, 2026-11-21): the scenarios a second look runs, alone. Every scenario when none are
 * named; a name the suite lacks is refused before any session starts.
 */
export function pickScenarios(scenarios, just) {
	if (!just) return scenarios;
	const missing = [...just].find((id) => !scenarios.some((x) => x.id === id));
	if (missing) throw new Error(`--just: no scenario ${missing} in the suite`);
	return scenarios.filter((x) => just.has(x.id));
}

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

const label = (c) => (c.kind === 'any' ? `any of (${c.of.map(label).join('; ')})` : `${c.kind} ${JSON.stringify(c.match || c.text)}${c.then ? ` then ${JSON.stringify(c.then)}` : ''}`);

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
		// K134 (build 17): a behaviour a session may show by a tool call or in its reply (an ask by pop-up, or in words).
		else if (c.kind === 'any') ok = grade(ev, c.of).some((g) => g.ok);
		else throw new Error(`unknown check kind ${c.kind}`);
		return { ok, check: label(c) };
	});
}

/**
 * I17: the reads a run made outside the folders it may read (the probe, the Claude folder). The build 16 sweep: a
 * relative or ~ path and a Glob pattern count too, each read from the probe; a root ending in "-" is a name prefix
 * (the system temp folder only for the scenario's kit-scratch- files), and a root ending in "/" is that folder alone.
 */
export function outsideReads(ev, roots, { cwd = '', home = os.homedir() } = {}) {
	const norm = (p) => path.posix.normalize(p.replace(/\\/g, '/')).replace(/\/+$/, '').toLowerCase();
	// A record from a Windows run keeps Windows path rules on any machine, so a regrade on Linux names the same reads.
	const P = /^[a-z]:/i.test(cwd || home) ? path.win32 : path;
	const full = (p) => (p.startsWith('~') ? P.join(home, p.slice(1)) : /^([a-z]:)?[\\/]/i.test(p) || !cwd ? p : P.resolve(cwd, p));
	const allowed = (p) => roots.some((r) => {
		const n = norm(r.replace(/[-/]$/, '')) + (r.endsWith('-') ? '-' : '');
		if (r.endsWith('/')) return norm(p) === norm(r);
		return r.endsWith('-') ? norm(p).startsWith(n) : norm(p) === n || norm(p).startsWith(n + '/');
	});
	const paths = (c) => [fileOf(c.input), c.name === 'Glob' ? String(c.input.pattern ?? '') : ''].filter(Boolean);
	// A glob is read from the folder before its first wildcard.
	const base = (p) => { const i = p.search(/[*?[]/); if (i < 0) return p; const h = p.slice(0, i); return /[\\/]$/.test(h) || !h ? h : path.dirname(h); };
	return ev.calls.filter((c) => /^(Read|Grep|Glob|NotebookRead)$/.test(c.name)).flatMap(paths).map(base)
		.filter((p) => p && (cwd || /^([a-z]:)?[\\/]|^~/i.test(p))).map(full)
		.filter((p) => p && !allowed(p));
}

/**
 * The build 16 sweep: the installed project settings allow a few shell reads (cat, grep, git diff, Get-Content), which
 * a run's own allowed tools then added to. A probe is a throwaway copy, so its allow list keeps no shell or write tool:
 * every shell call is refused and recorded, as the run's design says.
 */
export function readOnlyProbe(dir) {
	const f = path.join(dir, '.claude', 'settings.json');
	let s;
	try { s = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return; }
	if (s.permissions && Array.isArray(s.permissions.allow)) {
		s.permissions.allow = s.permissions.allow.filter((p) => !/^(Bash|PowerShell|Edit|Write|MultiEdit|NotebookEdit)\b/.test(p));
		fs.writeFileSync(f, JSON.stringify(s, null, 2) + '\n');
	}
}

/** The folder each scenario starts from: the kit installed, a branch with one commit, a bare clone as origin. */
export function seed(dir, files = {}, run, merged = false) {
	// The build 16 sweep (high): a scenario file in .git (a hook, a config with core.fsmonitor) ran on the owner's PC at
	// the seed's own commit. Seeding runs git with no hooks and no file monitor, and a scenario may not write git's
	// folders or the kit's own (.git, .githooks, .claude).
	const SAFE = ['-c', `core.hooksPath=${os.devNull}`, '-c', 'core.fsmonitor=false'];
	const must = (cmd, args, opts = {}) => { const r = run(cmd, cmd === 'git' ? [...SAFE, ...args] : args, { cwd: dir, ...opts }); if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')}: ${(r.stderr || r.stdout || '').trim().slice(0, 200)}`); };
	const put = (rel, body) => {
		const to = path.resolve(dir, rel);
		const inside = path.relative(dir, to);
		if (!inside || inside.startsWith('..') || path.isAbsolute(inside)) throw new Error(`a scenario file outside its folder: ${rel}`);
		if (/^\.(git|githooks|claude)$/i.test(inside.split(/[\\/]/)[0].replace(/[. ]+$/, ''))) throw new Error(`a scenario file in a folder git or the kit runs from: ${rel}`);
		fs.mkdirSync(path.dirname(to), { recursive: true });
		fs.writeFileSync(to, body);
	};
	must('git', ['config', 'user.email', 'probe@example.invalid']);
	must('git', ['config', 'user.name', 'probe']);
	put('src/greet.mjs', 'export const greet = (n) => `Hello, ${n}`;\n');
	put('src/greet.test.mjs', "import test from 'node:test';\nimport assert from 'node:assert';\nimport { greet } from './greet.mjs';\ntest('greets', () => assert.equal(greet('Ana'), 'Hello, Ana'));\n");
	must('git', ['add', '-A']);
	must('git', ['commit', '-qm', 'chore: start']);
	must('git', ['switch', '-qc', 'feat/greeting']);
	put('src/greet.mjs', 'export const greet = (n) => `Hello, ${n}!`;\n');
	put('src/greet.test.mjs', "import test from 'node:test';\nimport assert from 'node:assert';\nimport { greet } from './greet.mjs';\ntest('greets', () => assert.equal(greet('Ana'), 'Hello, Ana!'));\n");
	for (const [rel, body] of Object.entries(files)) put(rel, body);
	must('git', ['add', '-A']);
	must('git', ['commit', '-qm', 'feat: greet with an exclamation']);
	// A scenario after the merge (13): the branch is merged into main and released, as the task says it is.
	if (merged) {
		must('git', ['switch', '-q', 'main']);
		must('git', ['merge', '-q', '--ff-only', 'feat/greeting']);
		must('git', ['tag', 'v1.1.0']);
	}
	// The remote is a bare clone of main (and its tags), made last, so seeding pushes nothing through the kit's push hook
	// and the feature branch is not on it yet.
	const bare = path.join(path.dirname(dir), 'origin.git');
	must('git', ['clone', '-q', '--bare', '--single-branch', '--branch', 'main', dir, bare], { cwd: path.dirname(dir) });
	must('git', ['remote', 'add', 'origin', bare]);
	must('git', ['fetch', '-q', 'origin']);
	must('git', ['branch', '-q', '-u', 'origin/main', 'main']);
}

/**
 * S22-A5: a candidate's user layer is measured, not the released one in the Claude folder: its skills and agent files
 * are copied into the probe's .claude folder, which a session reads beside the Claude folder's.
 */
export function copyUserLayer(kitDir, dir, home) {
	for (const part of ['skills', 'agents']) {
		const from = path.join(kitDir, 'user', part);
		if (fs.existsSync(from)) fs.cpSync(from, path.join(dir, '.claude', part), { recursive: true });
	}
	// K206: the text names kit files as {{CLAUDE_HOME}}/..., which install fills; filled here with the arm's own folder.
	if (!home) return;
	const own = path.resolve(home).split(path.sep).join('/');
	const fill = (d) => {
		for (const e of fs.readdirSync(d, { withFileTypes: true })) {
			const p = path.join(d, e.name);
			if (e.isDirectory()) fill(p);
			// A real file only: a link copied from the kit points outside the probe, and is never written through.
			else if (e.isFile() && e.name.endsWith('.md')) { const t = fs.readFileSync(p, 'utf8'); if (t.includes('{{CLAUDE_HOME}}')) fs.writeFileSync(p, t.replaceAll('{{CLAUDE_HOME}}', own)); }
		}
	};
	for (const part of ['skills', 'agents']) if (fs.existsSync(path.join(dir, '.claude', part))) fill(path.join(dir, '.claude', part));
}

/**
 * K195 (reproduced on 1.47.0): a session run with project settings only never loads the Claude folder's skills, so a
 * release arm had no kit skills while the candidate's were copied in. The release arm gets the skills and agents its
 * install record lists, copied the same way, and nothing the kit did not install.
 */
export function releasedUserLayer(home, dir) {
	const files = JSON.parse(fs.readFileSync(path.join(home, 'kit-install.json'), 'utf8')).files || {};
	for (const rel of Object.keys(files).filter((k) => /^(skills|agents)\//.test(k))) {
		const to = path.resolve(dir, '.claude', rel);
		const inside = path.relative(path.join(dir, '.claude'), to);
		if (inside.startsWith('..') || path.isAbsolute(inside) || path.relative(home, path.resolve(home, rel)).startsWith('..')) throw new Error(`an install record path outside the Claude folder: ${rel}`);
		fs.mkdirSync(path.dirname(to), { recursive: true });
		fs.copyFileSync(path.join(home, rel), to);
	}
}

/** One session on one scenario: the record, the grades and the reads outside. */
export function runScenario({ s, dir, home, run, model = MODEL }) {
	const r = run('claude', ['-p', '--output-format', 'stream-json', '--verbose', '--model', model, '--effort', EFFORT,
		'--setting-sources', 'project', '--strict-mcp-config', '--permission-mode', 'default', '--allowedTools', ALLOWED, '--disallowedTools', 'WebFetch,WebSearch',
		'--max-turns', MAX_TURNS, '--no-session-persistence'], { cwd: dir, input: s.prompt, encoding: 'utf8', timeout: 900000, maxBuffer: 1 << 28 });
	if (/Not logged in/i.test(r.stdout || '')) throw new Error(`${s.id}: Claude Code is not logged in for the sessions' config folder`);
	const ev = parseStream(r.stdout || '');
	if (r.status !== 0 && !ev.calls.length && !ev.final) throw new Error(`${s.id}: no session (exit ${r.status}): ${(r.stderr || '').trim().slice(0, 200)}`);
	// The probe's own parent (its bare origin sits there) and the system temp folder a scenario may name are its own too.
	return { raw: r.stdout || '', ev, grades: grade(ev, s.checks), outside: outsideReads(ev, [path.dirname(dir), home, os.tmpdir() + '/', path.join(os.tmpdir(), 'kit-scratch-')], { cwd: dir }) };
}

/**
 * The scenarios a resumed run need not run again: those whose record a run of the same label saved, when that run
 * was on the same kit commit, suite version and kit side (run.json, written before the first scenario). Anything else
 * is a different run, and nothing is reused.
 */
export function reusable(out, marker, ids) {
	let was = null;
	try { was = JSON.parse(fs.readFileSync(path.join(out, 'run.json'), 'utf8')); } catch { return []; }
	if (JSON.stringify(was) !== JSON.stringify(marker)) return [];
	return ids.filter((id) => fs.existsSync(path.join(out, `${id}.jsonl`)));
}

/**
 * The records a run may grade without a session, and the label's folder made ready. The build 16 sweep: --only grades
 * the other scenarios from records only when they were saved on this same kit commit, suite and side; a run that
 * reuses nothing clears the label's old records before it writes its marker, so a crash never leaves another run's
 * records under this run's marker for a resume to take.
 */
export function startRun(out, marker, ids, { only = null, resume = false, name = '', just = null } = {}) {
	// The build 22 sweep: a second look under a label that holds runs would delete them; it takes a new label.
	if (just && ['run.json', 'result.json'].some((f) => fs.existsSync(path.join(out, f)))) throw new Error(`--just: ${name} already holds saved runs; a second look takes a new label (cand-<x>-<n>, base-<x>-<n>)`);
	const saved = reusable(out, marker, ids);
	if (only) {
		const missing = ids.filter((id) => !only.has(id) && !saved.includes(id));
		if (missing.length) throw new Error(`--only: ${name} has no record of ${missing.join(', ')} saved on this kit commit, suite and side; run the label again`);
		return new Set(saved.filter((id) => !only.has(id)));
	}
	const reuse = new Set(resume ? saved : []);
	if (!reuse.size) for (const id of ids) fs.rmSync(path.join(out, `${id}.jsonl`), { force: true });
	fs.writeFileSync(path.join(out, 'run.json'), JSON.stringify(marker));
	return reuse;
}

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : 0; };

/**
 * The gate line from saved runs: the candidate's median, the released baseline's median and the control's, read from
 * each run's result.json, never typed (the wording gate's numbers are typed, which is how S18-6 slipped).
 */
// K198 (Max's picks, 2026-11-20): 5 candidate and 5 release runs, flat, the release measured the same day; a second
// line names each scenario the candidate passed in fewer runs than the release, for the gate's no-worse check.
// Seen twice (the owner's pick, 2026-11-21; recall-score.mjs says why): such a scenario is run again alone (--just), 5
// runs a side the same day, and is worse only when it passes in fewer runs again. One look prints "behaviour lower
// once" and no worse line, so the gate cannot pass on it.
const RUNS = 5;
const DAY_MS = 24 * 60 * 60 * 1000;
export function behaviourLine({ label, cand, base, control, candAgain = null, baseAgain = null }) {
	const read = (d) => JSON.parse(fs.readFileSync(path.join(d, 'result.json'), 'utf8'));
	const [c, b, k] = [cand.map(read), base.map(read), control.map(read)];
	const suites = new Set([...c, ...b, ...k].map((r) => r.suite));
	if (suites.size !== 1) throw new Error(`runs on more than one suite version: ${[...suites].join(', ')}`);
	// K428: one line is one model, the second look's runs too; a run saved before the setting ran on the pin.
	const models = new Set([...c, ...b, ...k, ...(candAgain || []).map(read), ...(baseAgain || []).map(read)].map((r) => r.model ?? MODEL));
	if (models.size !== 1) throw new Error(`runs on more than one model: ${[...models].join(', ')}`);
	if (!c.length || !b.length || !k.length) throw new Error('a line needs candidate, baseline and control runs');
	if (b.some((r) => !r.released) || k.some((r) => !r.noKit)) throw new Error('a baseline run is on a released kit, and the control on none');
	if (c.length !== RUNS || b.length !== RUNS) throw new Error(`a gate is ${RUNS} candidate runs and ${RUNS} release runs, flat; got ${c.length} and ${b.length}`);
	// The build 22 sweep: a --just run asked some scenarios alone, so it is a second look, never a first.
	if ([...c, ...b, ...k].some((r) => r.just)) throw new Error('a first look runs the whole suite: a --just run is a second look only');
	const timeOf = (runs) => runs.map((r) => Date.parse(r.when ?? ''));
	const sameDay = (times) => { if (times.some(Number.isNaN) || Math.max(...times) - Math.min(...times) > DAY_MS) throw new Error('the release arm must be measured the same day as the candidate: every candidate and release run needs its time, within a day of the others'); };
	sameDay(timeOf([...c, ...b]));
	const passes = (runs, id) => runs.filter((r) => r.rows.some((x) => x.id === id && x.passed)).length;
	const ids = [...new Set([...c, ...b].flatMap((r) => r.rows.map((x) => x.id)))];
	const lower = ids.filter((id) => passes(c, id) < passes(b, id));
	const named = [...models][0] === MODEL ? '' : `\nbehaviour model: ${[...models][0]}`;
	const head = `behaviour: ${label} median ${median(c.map((r) => r.total))} baseline ${median(b.map((r) => r.total))} suite v${[...suites][0]} control ${median(k.map((r) => r.total))}${named}`;
	const again = candAgain || baseAgain;
	if (!again) return lower.length ? `${head}\nbehaviour lower once: ${lower.join(', ')}` : `${head}\nbehaviour worse: none`;
	if (!lower.length) throw new Error('nothing passed in fewer runs than the release on the first look, so no second look is owed: write the line from the first look alone');
	const [c2, b2] = [(candAgain || []).map(read), (baseAgain || []).map(read)];
	if (c2.length !== RUNS || b2.length !== RUNS) throw new Error(`a second look is ${RUNS} candidate runs and ${RUNS} release runs, flat; got ${c2.length} and ${b2.length}`);
	if ([...c2, ...b2].some((r) => r.suite !== [...suites][0])) throw new Error('a second look runs on the first look\'s suite version');
	if (b2.some((r) => !r.released) || c2.some((r) => r.released || r.noKit)) throw new Error('a second look\'s release runs are on a released kit, and its candidate runs on the candidate');
	for (const id of lower) if ([...c2, ...b2].some((r) => !r.rows.some((x) => x.id === id))) throw new Error(`a second look runs every lower scenario again; a run has no ${id} (recall-behave.mjs --just ${lower.join(',')})`);
	// New sessions of the lower scenarios alone: each run saved as a --just run of exactly those.
	const want = [...lower].sort().join(',');
	if ([...c2, ...b2].some((r) => !Array.isArray(r.just) || [...r.just].sort().join(',') !== want)) throw new Error(`a second look is new runs of the lower scenarios alone: run each side with recall-behave.mjs <label> [kit folder] --just ${lower.join(',')}`);
	sameDay(timeOf([...c, ...b, ...c2, ...b2]));
	const asked = lower.map((id) => `${id} (${passes(c, id)} of ${RUNS} against ${passes(b, id)}, then ${passes(c2, id)} of ${RUNS} against ${passes(b2, id)})`);
	const worse = lower.filter((id) => passes(c2, id) < passes(b2, id));
	return `${head}\nbehaviour asked again: ${asked.join('; ')}\nbehaviour worse: ${worse.join(', ') || 'none'}`;
}

async function main(argv) {
	if (argv[0] === 'line') {
		// line <label> <candidate run folders> -- <baseline run folders> -- <control run folder>
		//   [-- <candidate second-look folders> -- <baseline second-look folders>]
		const [label, ...rest] = argv.slice(1);
		const parts = rest.join('\0').split('\0--\0').map((p) => p.split('\0').filter(Boolean));
		const out = behaviourLine({ label, cand: parts[0] || [], base: parts[1] || [], control: parts[2] || [], candAgain: parts[3] || null, baseAgain: parts[4] || null });
		console.log(out);
		const once = out.match(/^behaviour lower once: (.+)$/m);
		if (once) {
			console.log(`\nNo worse line yet: one look cannot tell a break from an unlucky run. Run ${once[1]} again alone, today, 5 new runs a side (recall-behave.mjs <label> [kit folder] --just ${once[1].replace(/, /g, ',')}), then write the line again with both looks: line <label> <cand> -- <base> -- <control> -- <cand again> -- <base again>.`);
			process.exitCode = 1;
		}
		return;
	}
	// --only <id,...>: run only those scenarios again; every other one is graded again, under the current checks, from the
	// record the earlier run of this label saved (a fixed check never needs a session rerun).
	// --resume: after a crash, the scenarios this label already saved on the same commit are graded from their records.
	const resume = argv.includes('--resume');
	argv = argv.filter((a) => a !== '--resume');
	// --just <id,...>: a second look (seen twice) runs only those scenarios, each in a fresh session, and saves only them.
	const justAt = argv.indexOf('--just');
	const just = justAt >= 0 ? new Set(String(argv[justAt + 1] || '').split(',').filter(Boolean)) : null;
	if (justAt >= 0) argv = [...argv.slice(0, justAt), ...argv.slice(justAt + 2)];
	if (just && (!just.size || argv.includes('--only') || resume)) throw new Error('--just names one or more scenarios, and goes alone: not with --only or --resume');
	const at = argv.indexOf('--only');
	const only = at >= 0 ? new Set(String(argv[at + 1] || '').split(',').filter(Boolean)) : null;
	if (at >= 0) argv = [...argv.slice(0, at), ...argv.slice(at + 2)];
	const { label: name, kitDir, noKit } = parseRunArgs(argv);
	refuseOverCap(kitDir, noKit);
	const home = process.env.KIT_CLAUDE_HOME || process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
	checkUserLayer(home);
	// Every arm on its own throwaway Claude folder (the 2026-11-21 paired run; see recall.mjs checkGateHome).
	checkGateHome(home);
	checkHome(process.env);
	const model = gateModel(process.env);
	const kit = path.resolve(kitDir || KIT);
	// K231 (S7): the arm's own global CLAUDE.md, checked before any session; see recall.mjs armUserLayer.
	const layer = armUserLayer({ home, kitDir: kit, noKit });
	const run = (cmd, args, opts) => spawnSync(cmd, args, { encoding: 'utf8', ...opts });
	checkSessionHome(home, run);
	const kitTools = await import('./kit.mjs');
	const released = !noKit && !kitTools.releaseState(kit).problems.length;
	const suite = suiteVersion();
	suite.scenarios = pickScenarios(suite.scenarios, just);
	const out = path.join(OUT_DIR, `${name}.behave`);
	fs.mkdirSync(out, { recursive: true });
	const rows = [];
	const before = (() => { try { return JSON.parse(fs.readFileSync(path.join(out, 'result.json'), 'utf8')); } catch { return null; } })();
	const head = run('git', ['rev-parse', 'HEAD'], { cwd: kit }).stdout.trim();
	// K428: the model is in the marker, so a resume never mixes two.
	const marker = { head, suite: suite.version, released, noKit: !!noKit, userLayer: layer.line, model };
	const reuse = startRun(out, marker, suite.scenarios.map((s) => s.id), { only, resume, name, just });
	if (resume) console.log(`--resume: ${reuse.size} scenario(s) saved on ${head.slice(0, 7)} are graded from their records`);
	for (const s of suite.scenarios) {
		if ((only && !only.has(s.id)) || reuse.has(s.id)) {
			const saved = path.join(out, `${s.id}.jsonl`);
			if (!fs.existsSync(saved) || (!before && !reuse.has(s.id))) throw new Error(`--only: no saved record of ${s.id} under ${name} to grade again`);
			const ev = parseStream(fs.readFileSync(saved, 'utf8'));
			const grades = grade(ev, s.checks);
			// The probe folder is gone: any probe under kit-probes stands for it.
			const outside = outsideReads(ev, [path.join(os.homedir(), 'kit-probes'), home, os.tmpdir() + '/', path.join(os.tmpdir(), 'kit-scratch-')]);
			const passed = grades.every((g) => g.ok) && !outside.length;
			rows.push({ id: s.id, passed, cost: ev.cost, grades, outside, regraded: true });
			console.log(`[${rows.length}/${suite.scenarios.length}] ${s.id}: ${passed ? 'pass' : 'FAIL'} (graded again from the saved record)`);
			continue;
		}
		const dir = probePath(os.homedir());
		try {
			setupProbe({ dir, kitDir: kit, noKit, released, run });
			if (!noKit && !released) copyUserLayer(kit, dir, home);
				else if (!noKit) releasedUserLayer(home, dir);
			carryUserLayer(dir, layer);
			readOnlyProbe(dir);
			seed(dir, s.files, run, s.merged === true);
			const r = runScenario({ s, dir, home, run, model });
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
	if (before && only && (before.released !== released || before.noKit !== noKit)) throw new Error(`--only: ${name} was run on another kit side; start a new label`);
	fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({ label: name, suite: suite.version, released, noKit, userLayer: layer.line, model, total, cost, rows, when: new Date().toISOString(), ...(just ? { just: [...just] } : {}) }, null, 1));
	console.log(`${name}: ${total} of ${rows.length} on suite v${suite.version}, $${cost.toFixed(2)}`);
}

const realOf = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
if (process.argv[1] && realOf(process.argv[1]) === realOf(fileURLToPath(import.meta.url))) await main(process.argv.slice(2));
