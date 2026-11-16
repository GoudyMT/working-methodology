#!/usr/bin/env node
// The loop driver (T7 slice 1, build 12, the owner's lock 2026-11-16; rule:loop-driver). The v2.0 teardown counted
// 26 stop rules in the kit: 6 held by code, 17 resting on the model remembering them, and six numeric limits with no
// counter. This script owns a build loop's state, says the one next step, refuses a step out of order, counts the
// stops that have a number, and stops with a triage card (E11: why, the data, the options) that only the owner's Yes
// clears. It also holds loop mode's state machine (rule:loop-workflow-mode), which was one paragraph of prose.
//
// Usage (one command per call; the project is the one this script sits in, wherever it is run from):
//   node .claude/loop.mjs start <item>                         opens a run for one list item
//   node .claude/loop.mjs next | show                          the one next step | the run, its counts and loop mode
//   node .claude/loop.mjs done <step> --evidence "<proof>"     an owner's step needs the owner's Yes to the
//                                                              `loop <step> <code>` act next prints, after it opened
//   node .claude/loop.mjs count fix-round|canary-miss --unit <id> | visual | visual-check | ci-fix
//        visual-check is the owner looking: it needs their Yes to `loop visual-check <code>` (show prints it)
//   node .claude/loop.mjs halt "<why>" | resume                a stop; only the owner's Yes to `loop resume <code>` clears it
//   node .claude/loop.mjs mode arm | prompt --text "<message>" | off --why "<why>"
//        arm: only when the session's latest owner message is exactly "begin loop workflow" and came after loop mode
//        was last turned off; prompt and off are the hooks' (any other owner message halts the loop; session start and
//        a compact turn it off)
//
// State: <git common dir>/kit-loop.jsonl, one JSON line per event, each holding the hash of the line before, and the
// newest line's hash in kit-loop.jsonl.head. The guards hold every tool write, move or delete that names .git/kit-*,
// so a line changed by a tool halts the run. Limit: the chain has no key, and a script the session writes itself is
// not read by the guards, so such a script could write a line that passes (as owner-proof.cjs says of the transcripts).
// The owner's answers are read from the session the kit's hooks record in <git common dir>/kit-loop-session, never
// from the caller's environment.
// The steps and limits: .claude/bounds.json (J6), the owner's file. The guards treat it as a settings file, so a tool
// writes it only on the owner's pop-up Yes to that exact edit; a run keeps its hash and halts when it changes, and a
// run started on a bounds file other than the last run's waits for the owner's Yes to it.
// The kill switch: autonomy-off in the Claude folder (the merge gate's) makes every step the thread does alone the
// owner's (I11).
// Exit 0 done, 1 refused (nothing written), 2 a usage error, 3 this call halted the run.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const yesReader = createRequire(import.meta.url)('./owner-yes.cjs');
const PHRASE = 'begin loop workflow';
const COUNTERS = { 'fix-round': 'fixRound', 'canary-miss': 'canaryMiss', visual: 'visual', 'visual-check': null, 'ci-fix': null };
const PER_UNIT = new Set(['fix-round', 'canary-miss']);
const WHO = ['alone', 'owner', 'guard'];
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);

// The project is the folder above this script's .claude, not the caller's folder (the build 12 sweep: run from another
// repo, it read that repo's bounds file and kept its log there).
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const common = spawnSync('git', ['-C', ROOT, 'rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' });
const GIT = common.status === 0 ? common.stdout.trim() : null;
const LOG = GIT ? path.join(GIT, 'kit-loop.jsonl') : null;
const HEAD = LOG ? `${LOG}.head` : null;
const BOUNDS = path.join(ROOT, '.claude', 'bounds.json');

const out = (s) => process.stdout.write(`${s}\n`);
function write(entry) {
	const lines = fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8').split('\n').filter(Boolean) : [];
	const line = JSON.stringify({ time: new Date().toISOString(), ...entry, prev: lines.length ? sha(lines[lines.length - 1]) : '' });
	fs.appendFileSync(LOG, line + '\n');
	fs.writeFileSync(HEAD, sha(line));
}

/** The bounds file: { hash, steps: [{ step, who }], limits }, or { why } when it cannot be used. */
function bounds() {
	let raw;
	try { raw = fs.readFileSync(BOUNDS, 'utf8'); } catch { return { why: '.claude/bounds.json is missing (install project seeds it; it is the owner\'s file)' }; }
	let b;
	try { b = JSON.parse(raw); } catch { return { why: '.claude/bounds.json is not JSON' }; }
	const steps = Array.isArray(b && b.steps) ? b.steps : [];
	if (!steps.length || steps.some((s) => !s || !/^[a-z][a-z-]*$/.test(String(s.step)) || !WHO.includes(s.who))) return { why: `.claude/bounds.json needs steps, each { "step": "<name>", "who": "${WHO.join('" | "')}" }` };
	const limits = (b && b.limits) || {};
	for (const k of ['fixRound', 'canaryMiss', 'visual']) if (!Number.isInteger(limits[k]) || limits[k] < 1) return { why: `.claude/bounds.json needs limits.${k}, a whole number of at least 1` };
	return { hash: sha(raw), steps, limits };
}

/** The log read once: the open run, what it has done, its counts, whether it is halted, loop mode, the last bounds. */
function read() {
	const lines = LOG && fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8').split('\n').filter(Boolean) : [];
	const s = { run: null, done: [], counts: {}, visualSince: 0, checks: 0, halt: null, taps: new Set(), mode: { state: 'off', why: 'not armed', time: '' }, opened: null, lastBounds: null };
	const handEdit = (at) => ({ why: 'the loop log was changed by hand', at, time: new Date(0).toISOString() });
	lines.forEach((l, i) => {
		let e;
		try { e = JSON.parse(l); } catch { e = null; }
		if (!e || typeof e !== 'object' || e.prev !== (i ? sha(lines[i - 1]) : '')) { if (s.run && !s.halt) s.halt = handEdit(i); return; }
		if (e.tap) s.taps.add(e.tap);
		if (e.kind === 'mode') s.mode = { state: e.state, why: e.why || '', time: e.time };
		else if (e.kind === 'start') { Object.assign(s, { run: { item: e.item, id: e.run, bounds: e.bounds }, done: [], counts: {}, visualSince: 0, checks: 0, halt: null, opened: e.time }); s.lastBounds = e.bounds; }
		else if (!s.run) return;
		else if (e.kind === 'done') { s.done.push(e.step); s.opened = e.time; }
		else if (e.kind === 'count') { s.counts[e.key] = (s.counts[e.key] || 0) + 1; if (e.counter === 'visual-check') { s.visualSince = 0; s.checks++; } else if (e.counter === 'visual') s.visualSince++; }
		else if (e.kind === 'halt') s.halt = { why: e.why, at: i, time: e.time };
		else if (e.kind === 'resume') { s.halt = null; s.run.bounds = e.bounds; s.lastBounds = e.bounds; s.opened = e.time; }
		else if (e.kind === 'close') s.run = null;
	});
	let head = '';
	try { head = fs.readFileSync(HEAD, 'utf8').trim(); } catch { /* none yet */ }
	if (lines.length && head !== sha(lines[lines.length - 1]) && s.run && !s.halt) s.halt = handEdit(lines.length - 1);
	return s;
}

// The session the kit's hooks recorded: the one whose owner's answers count.
function session() {
	try { const id = fs.readFileSync(path.join(GIT, 'kit-loop-session'), 'utf8').trim(); return /^[0-9a-f-]{36}$/i.test(id) ? id : null; } catch { return null; }
}
// The owner's unused Yes to an act since a time, in the recorded session, or the reason there is none.
function ownerYes(s, act, since) {
	const sid = session();
	if (!sid) return { why: 'no session is recorded (the kit\'s prompt hook records it at the owner\'s next message)' };
	const yes = yesReader.sessionYes(act, { since: Date.parse(since), repo: ROOT, sessionId: sid });
	if (!yes || s.taps.has(yes.tap)) return { why: `this session holds no unused Yes from the owner to \`${act}\` since then` };
	return { tap: yes.tap };
}

const hash6 = (s) => sha(s).slice(0, 6);
const code = (s, what) => hash6(`${s.run.id}:${what}`);
const resumeAct = (s) => `loop resume ${code(s, `resume:${s.halt.at}`)}`;
const checkAct = (s) => `loop visual-check ${code(s, `check:${s.checks}`)}`;
const boundsAct = (s, b) => `loop bounds ${hash6(`${s.lastBounds}:${b.hash}`)}`;
const killSwitch = () => fs.existsSync(path.join(yesReader.home(), 'autonomy-off'));
const nextStep = (s, b) => b.steps.find((x) => !s.done.includes(x.step)) || null;
// The kill switch makes every step the owner's, a guard's step included (the build 12 sweep).
const whoFor = (step) => (killSwitch() ? 'owner' : step.who);
const unitKey = (u) => String(u).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');

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
	const sid = session();
	if (!sid) return null;
	let real = ROOT;
	try { real = fs.realpathSync.native(ROOT); } catch { /* as given */ }
	// The project's own transcript folder only (the build 12 sweep: a folder above it holds other projects' sessions).
	const key = path.resolve(real).replace(/[^A-Za-z0-9]/g, '-').toLowerCase();
	const root = path.join(yesReader.home(), 'projects');
	let dirs = [];
	try { dirs = fs.readdirSync(root).filter((d) => d.toLowerCase() === key); } catch { return null; }
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
	if (!LOG) { out('loop: this project is in no git repository, so there is nowhere to keep the run.'); return 1; }
	const [cmd, ...rest] = argv;
	const opt = (name) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : undefined; };
	const b = bounds();
	let s = read();
	if (cmd === 'mode') {
		const what = rest[0];
		if (what === 'arm') {
			const m = lastOwnerMessage();
			if (!m || m.text.trim() !== PHRASE || (s.mode.time && Date.parse(m.at) <= Date.parse(s.mode.time))) { out(`loop mode: not armed. Only the owner arms it, with a message that is exactly "${PHRASE}", sent since loop mode was last on or off; the session's latest owner message is not.`); return 1; }
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
		// A bounds file other than the last run's (an edit, a restore, a stash) applies only on the owner's Yes to it.
		let tap;
		if (s.lastBounds && s.lastBounds !== b.hash) {
			const act = boundsAct(s, b);
			const yes = ownerYes(s, act, new Date(0).toISOString());
			if (!yes.tap) { out(`loop: no run started: .claude/bounds.json differs from the last run's, so the owner reads it first: ask in the pop-up, the question quoting \`${act}\`, then run this again (${yes.why}). Nothing written.`); return 1; }
			tap = yes.tap;
		}
		write({ kind: 'start', item: String(item), run: sha(`${item}:${Date.now()}:${crypto.randomBytes(8).toString('hex')}`), bounds: b.hash, ...(tap ? { tap } : {}) });
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
		out(who === 'alone' ? `NEXT ${step.step}: alone`
			: who === 'guard' ? `NEXT ${step.step}: the guard's; the act itself waits for the owner's yes where the guards hold it, then record its evidence`
				: `NEXT ${step.step}: the owner's${step.who !== 'owner' ? ' (the kill switch autonomy-off is on)' : ''}; ask in the pop-up, the question quoting \`loop ${step.step} ${code(s, step.step)}\``);
		if (cmd === 'show') out(`Run ${s.run.item}: done ${s.done.join(', ') || 'nothing yet'}; counts ${Object.entries(s.counts).map(([k, n]) => `${k} ${n}`).join(', ') || 'none'}; visual since the last check ${s.visualSince}, the owner's check: \`${checkAct(s)}\``);
		return 0;
	}
	if (cmd === 'resume') {
		if (!s.run || !s.halt) { out('loop: nothing is halted; nothing to resume. Nothing written.'); return 1; }
		const yes = ownerYes(s, resumeAct(s), s.halt.time);
		if (!yes.tap) { out(`loop: refused: ${yes.why}. Nothing written.`); return 1; }
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
		if (!stepName || !evidence || !String(evidence).trim()) { out('usage: node .claude/loop.mjs done <step> --evidence "<proof>"'); return 2; }
		const step = nextStep(s, b);
		if (!step || step.step !== stepName) { out(card(s, b, `step ${stepName} is out of order`, { halted: false })); return 1; }
		let tap;
		if (whoFor(step) === 'owner') {
			const yes = ownerYes(s, `loop ${step.step} ${code(s, step.step)}`, s.opened);
			if (!yes.tap) { out(`loop: refused: ${step.step} is the owner's step, and ${yes.why}. Ask in the pop-up, then run this again. Nothing written.`); return 1; }
			tap = yes.tap;
		}
		write({ kind: 'done', step: step.step, evidence: String(evidence), ...(tap ? { tap } : {}) });
		const next = nextStep(read(), b);
		if (!next) { write({ kind: 'close' }); out(`Run ${s.run.item}: every step is done; the run is closed.`); return 0; }
		out(`NEXT ${next.step}: ${whoFor(next) === 'alone' ? 'alone' : whoFor(next) === 'guard' ? 'the guard\'s' : 'the owner\'s'}`);
		return 0;
	}
	if (cmd === 'count') {
		const counter = rest[0];
		if (!(counter in COUNTERS)) { out(`usage: node .claude/loop.mjs count ${Object.keys(COUNTERS).join('|')} [--unit <id>]`); return 2; }
		const unit = opt('--unit');
		if (PER_UNIT.has(counter) && !(unit && unitKey(unit).replace(/-/g, ''))) { out(`usage: ${counter} is counted per unit: --unit <id>`); return 2; }
		// One unit by any spelling (the build 12 sweep: a change of case or a space started the count again).
		const key = PER_UNIT.has(counter) ? `${counter}:${unitKey(unit)}` : counter;
		let tap;
		if (counter === 'visual-check') {
			const yes = ownerYes(s, checkAct(s), s.run ? s.opened : new Date(0).toISOString());
			if (!yes.tap) { out(`loop: refused: the visual check is the owner looking, and ${yes.why}. Ask in the pop-up, the question quoting \`${checkAct(s)}\`. Nothing written.`); return 1; }
			tap = yes.tap;
		}
		write({ kind: 'count', counter, key, ...(unit ? { unit: unitKey(unit) } : {}), ...(tap ? { tap } : {}) });
		const now = read();
		const limit = COUNTERS[counter] ? b.limits[COUNTERS[counter]] : null;
		const n = counter === 'visual' ? now.visualSince : now.counts[key];
		if (limit && n >= limit) {
			const why = counter === 'fix-round' ? `fix round ${n} of unit ${unitKey(unit)} (the bounds allow ${limit - 1})`
				: counter === 'canary-miss' ? `canary miss ${n} on unit ${unitKey(unit)}: a second strike stops the run`
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
