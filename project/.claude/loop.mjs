#!/usr/bin/env node
// The loop driver (T7 slice 1, build 12, the owner's lock 2026-11-16; rule:loop-driver). The v2.0 teardown counted
// 26 stop rules in the kit: 6 held by code, 17 resting on the model remembering them, and six numeric limits with no
// counter. This script owns a build loop's state, says the one next step, refuses a step out of order, counts the
// stops that have a number, and stops with a triage card (E11: why, the data, the options) that only the owner's Yes
// clears. It also holds loop mode's state machine (rule:loop-workflow-mode), which was one paragraph of prose.
//
// Usage (from the project folder; one command per call):
//   node .claude/loop.mjs start <item>                         opens a run for one list item
//   node .claude/loop.mjs next | show                          the one next step | the run, its counts and loop mode
//   node .claude/loop.mjs done <step> --evidence "<proof>" [--act "<act>"]
//        an owner's step needs the owner's Yes after it opened: to `loop <step> <code>` (next prints it), or with
//        --act to the outward act the guard asked for (a merge, a tag), so no step costs a second tap
//   node .claude/loop.mjs count fix-round|canary-miss --unit <id> | visual | visual-check | ci-fix
//   node .claude/loop.mjs halt "<why>" | resume                a stop; only the owner's Yes to `loop resume <code>` clears it
//   node .claude/loop.mjs mode arm | prompt --text "<message>" | off --why "<why>"
//        arm: only when the session's latest owner message is exactly "begin loop workflow"; prompt and off are the
//        hooks' (any other owner message halts the loop; session start and a compact turn it off)
//
// State: <git common dir>/kit-loop.jsonl, one JSON line per event, each holding the hash of the line before. The
// guards hold every tool write to .git/kit-*, so only this script writes it; a line changed by hand halts the run.
// The steps and limits: .claude/bounds.json (J6), the owner's file. The guards treat it as a settings file, so a tool
// writes it only on the owner's pop-up Yes to that exact edit; a run keeps its hash and halts when it changes.
// The kill switch: autonomy-off in the Claude folder (the merge gate's) makes every step the owner's (I11).
// Exit 0 done, 1 refused (nothing written), 2 a usage error, 3 this call halted the run.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const yesReader = createRequire(import.meta.url)('./owner-yes.cjs');
const PHRASE = 'begin loop workflow';
const COUNTERS = { 'fix-round': 'fixRound', 'canary-miss': 'canaryMiss', visual: 'visual', 'visual-check': null, 'ci-fix': null };
const PER_UNIT = new Set(['fix-round', 'canary-miss']);
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);
const git = (...a) => spawnSync('git', a, { encoding: 'utf8' });

const top = git('rev-parse', '--show-toplevel');
const common = git('rev-parse', '--path-format=absolute', '--git-common-dir');
const ROOT = top.status === 0 ? top.stdout.trim() : process.cwd();
const LOG = common.status === 0 ? path.join(common.stdout.trim(), 'kit-loop.jsonl') : null;
const BOUNDS = path.join(ROOT, '.claude', 'bounds.json');
// The last line's hash, kept apart: a hand edit of the newest line has no line after it to show the break.
const HEAD = LOG ? `${LOG}.head` : null;

const out = (s) => process.stdout.write(`${s}\n`);
function write(entry) {
	const lines = fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8').split('\n').filter(Boolean) : [];
	const line = JSON.stringify({ time: new Date().toISOString(), ...entry, prev: lines.length ? sha(lines[lines.length - 1]) : '' });
	fs.appendFileSync(LOG, line + '\n');
	fs.writeFileSync(HEAD, sha(line));
}

/** The bounds file: { raw, hash, steps: [{ step, who }], limits }, or { why } when it cannot be used. */
function bounds() {
	let raw;
	try { raw = fs.readFileSync(BOUNDS, 'utf8'); } catch { return { why: '.claude/bounds.json is missing (install project seeds it; it is the owner\'s file)' }; }
	let b;
	try { b = JSON.parse(raw); } catch { return { why: '.claude/bounds.json is not JSON' }; }
	const steps = Array.isArray(b && b.steps) ? b.steps : [];
	if (!steps.length || steps.some((s) => !s || !/^[a-z][a-z-]*$/.test(String(s.step)) || !['alone', 'owner'].includes(s.who))) return { why: '.claude/bounds.json needs steps, each { "step": "<name>", "who": "alone" | "owner" }' };
	const limits = (b && b.limits) || {};
	for (const k of ['fixRound', 'canaryMiss', 'visual']) if (!Number.isInteger(limits[k]) || limits[k] < 1) return { why: `.claude/bounds.json needs limits.${k}, a whole number of at least 1` };
	return { raw, hash: sha(raw), steps, limits };
}

/** The log read once: the open run, what it has done, its counts, whether it is halted, and loop mode. */
function read() {
	const lines = LOG && fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8').split('\n').filter(Boolean) : [];
	const s = { run: null, done: [], counts: {}, visualSince: 0, halt: null, taps: new Set(), mode: { state: 'off', why: 'not armed' }, opened: null };
	lines.forEach((l, i) => {
		let e;
		try { e = JSON.parse(l); } catch { e = null; }
		const prev = i ? sha(lines[i - 1]) : '';
		if (!e || typeof e !== 'object' || e.prev !== prev) {
			// A line changed by hand: the run halts until the owner resumes it, and only lines from here on count.
			if (!s.halt || s.halt.why !== 'the loop log was changed by hand') s.halt = { why: 'the loop log was changed by hand', at: i, time: new Date(0).toISOString() };
			return;
		}
		if (e.tap) s.taps.add(e.tap);
		if (e.kind === 'mode') s.mode = { state: e.state, why: e.why || '' };
		else if (e.kind === 'start') Object.assign(s, { run: { item: e.item, id: e.run, bounds: e.bounds }, done: [], counts: {}, visualSince: 0, halt: null, opened: e.time });
		else if (!s.run) return;
		else if (e.kind === 'done') { s.done.push(e.step); s.opened = e.time; }
		else if (e.kind === 'count') { s.counts[e.key] = (s.counts[e.key] || 0) + 1; if (e.counter === 'visual-check') s.visualSince = 0; else if (e.counter === 'visual') s.visualSince++; }
		else if (e.kind === 'halt') s.halt = { why: e.why, at: i, time: e.time };
		else if (e.kind === 'resume') { s.halt = null; s.run.bounds = e.bounds; s.opened = e.time; }
		else if (e.kind === 'close') s.run = null;
	});
	let head = '';
	try { head = fs.readFileSync(HEAD, 'utf8').trim(); } catch { /* none yet */ }
	if (lines.length && head !== sha(lines[lines.length - 1]) && s.run && !s.halt) s.halt = { why: 'the loop log was changed by hand', at: lines.length - 1, time: new Date(0).toISOString() };
	return s;
}

const code = (s, what) => sha(`${s.run.id}:${what}`).slice(0, 6);
const resumeAct = (s) => `loop resume ${code(s, `resume:${s.halt.at}`)}`;
const killSwitch = () => fs.existsSync(path.join(yesReader.home(), 'autonomy-off'));
const nextStep = (s, b) => b.steps.find((x) => !s.done.includes(x.step)) || null;
const whoFor = (step) => (step.who === 'owner' || killSwitch() ? 'owner' : 'alone');

// E11: every stop says why, with the data, the options, and how the owner clears it.
function card(s, b, why, { halted = true } = {}) {
	const step = b.steps ? nextStep(s, b) : null;
	const counts = Object.entries(s.counts).map(([k, n]) => `${k} ${n}`).join(', ') || 'none';
	const lines = [`LOOP STOP - ${why}`,
		`Data:    run ${s.run ? s.run.item : 'none'}; done ${s.done.join(', ') || 'nothing yet'}; next step is ${step ? step.step : 'none'}; counts ${counts}; visual since the last check ${s.visualSince}`];
	if (halted) {
		lines.push('Options: fix the cause, then the owner resumes; or the owner changes the bounds file (a pop-up Yes to that exact edit) and resumes; or the owner ends the item here.',
			`Resume:  ask the owner in the pop-up, the question quoting \`${resumeAct(s)}\`, one option "Yes" and one starting "No"; after their Yes: node .claude/loop.mjs resume`);
	} else lines.push('Options: do the next step first, or ask the owner if the order itself is wrong. Nothing written.');
	return lines.join('\n');
}

// A halt the files show (a changed bounds file) is written once, so it holds until the owner resumes.
function settle(s, b) {
	if (s.run && !s.halt && b.hash && b.hash !== s.run.bounds) {
		write({ kind: 'halt', why: 'the bounds file changed during the run' });
		return read();
	}
	return s;
}

function lastOwnerMessage() {
	const sid = String(process.env.CLAUDE_CODE_SESSION_ID || '');
	if (!/^[0-9a-f-]{36}$/i.test(sid)) return null;
	let real = ROOT;
	try { real = fs.realpathSync.native(ROOT); } catch { /* as given */ }
	const keys = [];
	for (let d = path.resolve(real); ; d = path.dirname(d)) { keys.push(d.replace(/[^A-Za-z0-9]/g, '-').toLowerCase()); if (path.dirname(d) === d) break; }
	const root = path.join(yesReader.home(), 'projects');
	let dirs = [];
	try { dirs = fs.readdirSync(root).filter((d) => keys.includes(d.toLowerCase())); } catch { return null; }
	let last = null;
	for (const d of dirs) {
		let lines;
		try { lines = yesReader.tailLines(path.join(root, d, `${sid}.jsonl`)); } catch { continue; }
		for (const raw of lines) {
			let e;
			try { e = JSON.parse(raw); } catch { continue; }
			if (!e || e.type !== 'user' || e.isSidechain || e.isMeta || !e.message) continue;
			const c = e.message.content;
			const text = typeof c === 'string' ? c : Array.isArray(c) && !c.some((x) => x && x.type === 'tool_result') ? c.filter((x) => x && x.type === 'text').map((x) => x.text).join('\n') : null;
			if (text !== null && (!last || String(e.timestamp) >= last.at)) last = { text, at: String(e.timestamp) };
		}
	}
	return last;
}

function main(argv) {
	if (!LOG) { out('loop: this folder is in no git repository, so there is nowhere to keep the run.'); return 1; }
	const [cmd, ...rest] = argv;
	const opt = (name) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : undefined; };
	const b = bounds();
	let s = read();
	if (cmd === 'mode') {
		const what = rest[0];
		if (what === 'arm') {
			const m = lastOwnerMessage();
			if (!m || m.text.trim() !== PHRASE) { out(`loop mode: not armed. Only the owner arms it, with a message that is exactly "${PHRASE}"; the session's latest owner message is not.`); return 1; }
			write({ kind: 'mode', state: 'armed', why: 'the owner\'s phrase' });
			out('loop mode: armed. Any owner message halts it; session start and a compact turn it off.');
			return 0;
		}
		if (what === 'prompt') {
			if (s.mode.state === 'armed' && String(opt('--text') ?? '').trim() !== PHRASE) write({ kind: 'mode', state: 'off', why: 'an owner message halts the loop' });
			return 0;
		}
		if (what === 'off') { if (s.mode.state === 'armed') write({ kind: 'mode', state: 'off', why: String(opt('--why') || 'turned off') }); return 0; }
		out('usage: node .claude/loop.mjs mode arm | prompt --text "<message>" | off --why "<why>"');
		return 2;
	}
	if (cmd === 'start') {
		const item = rest[0];
		if (!item) { out('usage: node .claude/loop.mjs start <item>'); return 2; }
		if (b.why) { out(`loop: no run started: ${b.why}.`); return 1; }
		if (s.run) { out(`loop: run ${s.run.item} is still open; finish it or ask the owner to end it first. Nothing written.`); return 1; }
		write({ kind: 'start', item: String(item), run: sha(`${item}:${Date.now()}:${crypto.randomBytes(8).toString('hex')}`), bounds: b.hash });
		s = read();
	}
	if (b.why) { out(`loop: ${b.why}.`); return 1; }
	s = settle(s, b);
	if (['start', 'next', 'show'].includes(cmd)) {
		if (cmd === 'show') out(`loop mode: ${s.mode.state}${s.mode.state === 'off' ? ` (${s.mode.why})` : ''}`);
		if (!s.run) { out('No loop run is open: node .claude/loop.mjs start <item>.'); return 0; }
		if (s.halt) { out(card(s, b, s.halt.why)); return 0; }
		const step = nextStep(s, b);
		if (!step) { out(`Run ${s.run.item}: every step is done.`); return 0; }
		const who = whoFor(step);
		out(who === 'alone' ? `NEXT ${step.step}: alone` : `NEXT ${step.step}: the owner's${step.who === 'alone' ? ' (the kill switch autonomy-off is on)' : ''}; ask in the pop-up quoting \`loop ${step.step} ${code(s, step.step)}\`, or name the outward act the guard asked for with --act`);
		if (cmd === 'show') out(`Run ${s.run.item}: done ${s.done.join(', ') || 'nothing yet'}; counts ${Object.entries(s.counts).map(([k, n]) => `${k} ${n}`).join(', ') || 'none'}`);
		return 0;
	}
	if (cmd === 'resume') {
		if (!s.run || !s.halt) { out('loop: nothing is halted; nothing to resume. Nothing written.'); return 1; }
		const act = resumeAct(s);
		const yes = yesReader.sessionYes(act, { since: Date.parse(s.halt.time), repo: ROOT });
		if (!yes || s.taps.has(yes.tap)) { out(`loop: refused: this session holds no unused Yes from the owner to \`${act}\` since the halt. Nothing written.`); return 1; }
		write({ kind: 'resume', tap: yes.tap, bounds: b.hash });
		out(`loop: resumed on the owner's Yes. Run ${s.run.item} goes on.`);
		return 0;
	}
	if (!s.run) { out('loop: no run is open: node .claude/loop.mjs start <item>. Nothing written.'); return 1; }
	if (cmd === 'halt') {
		if (s.halt) { out(card(s, b, s.halt.why)); return 3; }
		write({ kind: 'halt', why: String(rest[0] || 'halted by the session') });
		out(card(read(), b, String(rest[0] || 'halted by the session')));
		return 3;
	}
	if (s.halt) { out(card(s, b, s.halt.why)); return 1; }
	if (cmd === 'done') {
		const stepName = rest[0];
		const evidence = opt('--evidence');
		if (!stepName || !evidence || !String(evidence).trim()) { out('usage: node .claude/loop.mjs done <step> --evidence "<proof>" [--act "<act>"]'); return 2; }
		const step = nextStep(s, b);
		if (!step || step.step !== stepName) { out(card(s, b, `step ${stepName} is out of order`, { halted: false })); return 1; }
		let tap;
		if (whoFor(step) === 'owner') {
			const act = opt('--act') ? String(opt('--act')) : `loop ${step.step} ${code(s, step.step)}`;
			const yes = yesReader.sessionYes(act, { since: Date.parse(s.opened), repo: ROOT });
			if (!yes || s.taps.has(yes.tap)) { out(`loop: refused: ${step.step} is the owner's step, and this session holds no unused owner's Yes to \`${act}\` since it opened. Ask in the pop-up, then run this again. Nothing written.`); return 1; }
			tap = yes.tap;
		}
		write({ kind: 'done', step: step.step, evidence: String(evidence), ...(tap ? { tap } : {}) });
		const after = read();
		const next = nextStep(after, b);
		if (!next) { write({ kind: 'close' }); out(`Run ${s.run.item}: every step is done; the run is closed.`); return 0; }
		out(`NEXT ${next.step}: ${whoFor(next) === 'alone' ? 'alone' : 'the owner\'s'}`);
		return 0;
	}
	if (cmd === 'count') {
		const counter = rest[0];
		if (!(counter in COUNTERS)) { out(`usage: node .claude/loop.mjs count ${Object.keys(COUNTERS).join('|')} [--unit <id>]`); return 2; }
		const unit = opt('--unit');
		if (PER_UNIT.has(counter) && !unit) { out(`usage: ${counter} is counted per unit: --unit <id>`); return 2; }
		const key = PER_UNIT.has(counter) ? `${counter}:${unit}` : counter;
		write({ kind: 'count', counter, key, ...(unit ? { unit: String(unit) } : {}) });
		const now = read();
		const limit = COUNTERS[counter] ? b.limits[COUNTERS[counter]] : null;
		const n = counter === 'visual' ? now.visualSince : now.counts[key];
		if (limit && n >= limit) {
			const why = counter === 'fix-round' ? `fix round ${n} of unit ${unit} (the bounds allow ${limit - 1})`
				: counter === 'canary-miss' ? `canary miss ${n} on unit ${unit}: a second strike stops the run`
					: `${n} visual increments since the last check: the owner looks before more`;
			write({ kind: 'halt', why });
			out(card(read(), b, why));
			return 3;
		}
		out(`loop: ${key} ${n}${limit ? ` (stops at ${limit})` : ''}`);
		return 0;
	}
	out('usage: node .claude/loop.mjs start | next | show | done | count | halt | resume | mode');
	return 2;
}

process.exitCode = main(process.argv.slice(2));
