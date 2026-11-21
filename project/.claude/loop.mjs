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
//   node .claude/loop.mjs count fix-round|canary-miss --unit <id> | visual | visual-check | ci-fix | ci-green
//        visual-check is the owner looking: it needs their Yes to `loop visual-check <code>` (show prints it)
//        ci-fix is one push meant to fix a red CI run; it halts at limits.ciFix when the owner set one, and ci-green
//        (or the ci step done) ends the red streak (K210)
//   node .claude/loop.mjs halt "<why>" | resume                a stop; only the owner's Yes to `loop resume <code>` clears it
//   node .claude/loop.mjs shadow --would yes|no --why "<why>" [--risk "<risk>"]... [--item <id>]
//        the plan's self-approval line (S3), once, before the owner is asked to lock it; the plan step is not done
//        without it. --risk names what could make the owner refuse or change the plan (up to 3); a plan counts toward
//        the streak only when the owner refused it over a risk it named (K210). With no run open, --item names the plan
//        and done <plan step> locks it alone, where plans are locked outside a run
//   node .claude/loop.mjs chain <handoff.md> [--open]          GO or STOP for opening the next thread (S13); --open
//                                                              records the opening against limits.threadsPerDay
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
const COUNTERS = { 'fix-round': 'fixRound', 'canary-miss': 'canaryMiss', visual: 'visual', 'visual-check': null, 'ci-fix': 'ciFix', 'ci-green': null };
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
	for (const k of ['threadsPerDay', 'ciFix']) if (limits[k] !== undefined && (!Number.isInteger(limits[k]) || limits[k] < 1)) return { why: `.claude/bounds.json: limits.${k}, when set, is a whole number of at least 1` };
	// The plan shadow (T7 slice 2, S3): which owner step is the plan lock, and how many agreeing plans in a row the
	// owner's bar is (10, the owner's pick 2026-11-16). Self-approval itself is not built; the streak is data.
	const shadow = { step: 'design', streak: 10, ...((b && b.shadow) || {}) };
	if (!/^[a-z][a-z-]*$/.test(String(shadow.step)) || !Number.isInteger(shadow.streak) || shadow.streak < 1) return { why: '.claude/bounds.json: shadow needs { "step": "<the plan step>", "streak": <a whole number of at least 1> }' };
	return { hash: sha(raw), steps, limits, shadow };
}

/** The log read once: the open run, what it has done, its counts, whether it is halted, loop mode, the last bounds. */
function read() {
	const lines = LOG && fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8').split('\n').filter(Boolean) : [];
	const s = { run: null, done: [], counts: {}, visualSince: 0, checks: 0, halt: null, taps: new Set(), mode: { state: 'off', why: 'not armed', time: '' }, opened: null, lastBounds: null, shadow: null, plan: null, streak: 0, chains: [] };
	// The streak runs across runs: a plan whose verdict agreed with the owner adds one, a disagreement ends it; any other
	// outcome moves nothing.
	const tally = (e) => { if (e.shadow && e.shadow.outcome === 'agree') s.streak++; else if (e.shadow && e.shadow.outcome === 'disagree') s.streak = 0; };
	const handEdit = (at) => ({ why: 'the loop log was changed by hand', at, time: new Date(0).toISOString() });
	lines.forEach((l, i) => {
		let e;
		try { e = JSON.parse(l); } catch { e = null; }
		if (!e || typeof e !== 'object' || e.prev !== (i ? sha(lines[i - 1]) : '')) { s.broken = { at: i }; if (s.run && !s.halt) s.halt = handEdit(i); if (e && e.kind === 'chain') s.chains.push(e.time); return; }
		if (e.tap) s.taps.add(e.tap);
		if (e.kind === 'mode') s.mode = { state: e.state, why: e.why || '', time: e.time };
		else if (e.kind === 'start') { Object.assign(s, { run: { item: e.item, id: e.run, bounds: e.bounds }, done: [], counts: {}, visualSince: 0, checks: 0, halt: null, opened: e.time, shadow: null }); s.lastBounds = e.bounds; }
		else if (e.kind === 'chain') { s.chains.push(e.time); if (e.bounds) s.lastBounds = e.bounds; }
		// The owner accepts the log as it stood: an edit made later to a line above the acceptance is a new break (the
		// build 13 sweep: an edit at an index accepted before stayed hidden).
		else if (e.kind === 'accept') { if (e.prefix === sha(lines.slice(0, i).join('\n'))) s.broken = null; else s.broken = { at: i }; }
		// K210: a plan locked with no run open (its verdict, then its lock); it counts in the same streak.
		else if (e.kind === 'shadow' && e.solo) s.plan = { item: e.item, would: e.would, time: e.time, session: e.session, scored: e.scored === true, risks: e.risks || [] };
		else if (e.kind === 'done' && e.solo) { s.plan = null; tally(e); }
		else if (!s.run) return;
		else if (e.kind === 'done') {
			s.done.push(e.step); s.opened = e.time; s.shadow = null;
			// A green CI ends a red streak, so the ci-fix cap is per streak (K210).
			if (e.step === 'ci') delete s.counts['ci-fix'];
			tally(e);
		}
		else if (e.kind === 'shadow') s.shadow = { would: e.would, step: e.step, time: e.time, session: e.session, scored: e.scored === true, risks: e.risks || [] };
		else if (e.kind === 'count' && e.counter === 'ci-green') delete s.counts['ci-fix'];
		else if (e.kind === 'count') { s.counts[e.key] = (s.counts[e.key] || 0) + 1; if (e.counter === 'visual-check') { s.visualSince = 0; s.checks++; } else if (e.counter === 'visual') s.visualSince++; }
		else if (e.kind === 'halt') s.halt = { why: e.why, at: i, time: e.time };
		// A resume clears the halt only: a hand edit stays until the owner accepts the log itself (the build 13 sweep: a
		// Yes to resume an unrelated halt also passed an edited chain count, and the owner was never shown the edit).
		else if (e.kind === 'resume') { s.halt = null; s.run.bounds = e.bounds; s.lastBounds = e.bounds; s.opened = e.time; }
		else if (e.kind === 'close') s.run = null;
	});
	let head = '';
	try { head = fs.readFileSync(HEAD, 'utf8').trim(); } catch { /* none yet */ }
	// An emptied or deleted log beside a head file is a hand edit too (the build 13 sweep: it reset the day's count).
	if (head && !lines.length) s.broken = { at: 0 };
	if (lines.length && head !== sha(lines[lines.length - 1])) { s.broken = { at: lines.length - 1 }; if (s.run && !s.halt) s.halt = handEdit(lines.length - 1); }
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
	// The owner's latest answer decides, and a Yes counts only for a question quoting this one act, as the guards read
	// it (the build 13 sweep).
	const yes = yesReader.sessionLatest(act, { since: Date.parse(since), repo: ROOT, sessionId: sid });
	if (yes && yes.yes && !yes.single) return { why: `the owner's Yes was to a question quoting more than \`${act}\`; ask with this act alone` };
	if (!yes || !yes.yes || s.taps.has(yes.tap)) return { why: `this session holds no unused Yes from the owner to \`${act}\` since then${yes && !yes.yes ? ' (their latest answer is not Yes)' : ''}` };
	return { tap: yes.tap };
}

const hash6 = (s) => sha(s).slice(0, 6);
const code = (s, what) => hash6(`${s.run.id}:${what}`);
const resumeAct = (s) => `loop resume ${code(s, `resume:${s.halt.at}`)}`;
const logLines = () => (LOG && fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8').split('\n').filter(Boolean) : []);
// The act names the log as it is now, so a Yes to an earlier state of it accepts nothing.
const brokenAct = (s) => `loop resume ${hash6(`log:${s.broken.at}:${sha(logLines().join('\n'))}`)}`;
const checkAct = (s) => `loop visual-check ${code(s, `check:${s.checks}`)}`;
const boundsAct = (s, b) => `loop bounds ${hash6(`${s.lastBounds}:${b.hash}`)}`;
// The kill switch by any spelling the owner may make: Explorer's new text file hides ".txt", and a dash or an
// underscore reads the same to a person (the build 13 sweep).
const KILL = /^autonomy[-_ ]?off(\..*)?$/i;
const killSwitch = () => { try { return fs.readdirSync(yesReader.home()).some((f) => KILL.test(f)); } catch { return false; } };
// The act an owner's step is answered on. The plan step's act exists only once its self-approval line is recorded,
// and is made from that line, so no ask made before the verdict can quote the act its agreement is read from (the
// build 13 review: a No asked first, then a verdict written to fit it).
const stepAct = (s, b, step) => (step.step !== b.shadow.step ? `loop ${step.step} ${code(s, step.step)}` : s.shadow ? `loop ${step.step} ${code(s, `${step.step}:${s.shadow.time}:${s.shadow.would}`)}` : null);
const nextStep = (s, b) => b.steps.find((x) => !s.done.includes(x.step)) || null;
// K210: the act a plan locked with no run open is answered on, made from its verdict as stepAct is.
const soloAct = (s, b) => `loop ${b.shadow.step} ${hash6(`solo:${s.plan.item}:${s.plan.time}:${s.plan.would}`)}`;
// The words of a risk or an answer that can match: lower case, four letters or more.
const sig = (t) => [...new Set(String(t || '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4))];
// A named risk matches what the owner said when at least two of its words, and at least half, are in their answer.
const riskMet = (risks, said) => { const heard = new Set(sig(said)); return (risks || []).some((r) => { const w = sig(r); const hit = w.filter((x) => heard.has(x)).length; return hit >= 2 && hit * 2 >= w.length; }); };
// K210 (the self-grading review B): the owner says Yes to nearly every plan, so a verdict that matched a Yes proved
// nothing, and an always-yes verdict reached the bar. A plan agrees only when the owner refused or changed it (a No
// before the Yes that locked it) and the verdict, written before they were asked, named that risk. A plain Yes scores
// nothing; a yes verdict on a refused plan, or a refusal over a risk it never named, is a disagreement.
function outcomeOf(sh, answers, unseen) {
	const refused = answers.filter((a) => !a.yes);
	if (sh.would === 'yes') return refused.length ? 'disagree' : unseen ? 'unscored' : 'plain-yes';
	if (unseen) return 'unscored';
	if (!refused.length) return 'cautious';
	return riskMet(sh.risks, refused.map((a) => a.answer || '').join(' ')) ? 'agree' : 'disagree';
}
// The owner's answers to a plan's act since its verdict, or the reason the plan cannot lock yet; and whether every
// answer could be seen: the same session as the verdict, no owner message since it, a transcript the reader holds whole.
function planAnswers(sh, act) {
	const answers = yesReader.sessionAnswers(act, { since: Date.parse(sh.time), repo: ROOT, sessionId: session() });
	const last = answers.length ? answers[answers.length - 1].at : null;
	if (!answers.length || answers.some((a) => a.at === last && !a.yes)) return { why: `the owner's latest answer to \`${act}\` is ${answers.length ? 'not Yes' : 'not given yet'}` };
	const msg = lastOwnerMessage();
	const unseen = !sh.scored || sh.session !== session() || Boolean(msg && Date.parse(msg.at) > Date.parse(sh.time)) || yesReader.sessionCut(session(), ROOT);
	return { answers, unseen };
}
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

// The plan shadow's record: the streak against the owner's bar.
function shadowLine(s, b) {
	const at = `shadow: ${s.streak} of ${b.shadow.streak} agreeing plans in a row (a plan agrees when the owner refused it over a risk its verdict named)`;
	return s.streak >= b.shadow.streak ? `${at}; reached: the owner may decide whether plans like these approve themselves; self-approval stays off until then` : `${at}; self-approval stays off`;
}

// Thread chaining (T7 slice 2, S13): the next thread opens on its own only when the handoff it starts from passes the
// closeout audit, no run is open or halted, the kill switch is off, and today's cap is not reached. With no cap in the
// bounds file, chaining is off: the cap is the owner's to set. Opening the thread itself is the coordinator's.
function chain(s, b, handoff, open) {
	const stops = [];
	const audit = path.join(yesReader.home(), 'skills', 'closeout', 'audit.mjs');
	let next = '';
	if (!fs.existsSync(audit)) stops.push(`the closeout audit is not installed (${audit}); run install user from the release copy`);
	else if (!fs.existsSync(handoff)) stops.push(`no handoff at ${handoff}`);
	else {
		const r = spawnSync(process.execPath, [audit, path.resolve(handoff)], { cwd: ROOT, encoding: 'utf8', timeout: 30000 });
		if (r.status !== 0) stops.push(`the handoff fails the closeout audit: ${String(r.stdout || r.stderr || r.error).trim().split('\n').join('; ')}`);
		// The What: line the audit read: in the Next Step section, at the start of a line (the build 13 sweep: the first
		// "What:" anywhere, a note in another section included, became the task GO named).
		const text = fs.readFileSync(handoff, 'utf8');
		const at = text.search(/^## Next Step/m);
		const body = at < 0 ? '' : text.slice(at).split(/\r?\n/).slice(1).join('\n').split(/^## /m)[0];
		next = ((body.match(/^[ \t]*(?:- )?What:[ \t]*(.+)$/m) || [])[1] || '').trim();
		if (!next) stops.push('the handoff\'s Next Step names no What: line');
	}
	if (s.run && s.halt) stops.push(`run ${s.run.item} is halted: ${s.halt.why}`);
	else if (s.run) stops.push(`run ${s.run.item} is still open; finish it first`);
	if (killSwitch()) stops.push('the kill switch autonomy-off is on in the Claude folder');
	// The count lives in the log, so a broken log is no count (the build 13 review): any break stops it, run or not.
	if (s.broken) stops.push(`the loop log was changed by hand, so the day's count cannot be trusted: the owner looks first, then answers Yes in the pop-up quoting \`${brokenAct(s)}\`, and node .claude/loop.mjs resume accepts the log as it is`);
	// A bounds file other than the one last used (a raised cap) applies only on the owner's Yes to it, as start asks.
	let tap;
	if (s.lastBounds && s.lastBounds !== b.hash) {
		const act = boundsAct(s, b);
		const yes = ownerYes(s, act, new Date(0).toISOString());
		if (yes.tap) tap = yes.tap;
		else stops.push(`.claude/bounds.json differs from the one last used, so the owner reads it first: ask in the pop-up, the question quoting \`${act}\` (${yes.why})`);
	}
	const cap = b.limits.threadsPerDay;
	// A time that does not read counts as today: an unreadable entry never frees a place under the cap.
	const today = s.chains.filter((t) => !(Date.now() - Date.parse(t) >= 24 * 3600 * 1000)).length;
	if (cap === undefined) stops.push('chaining is off: the owner sets limits.threadsPerDay in .claude/bounds.json (a pop-up Yes to that exact edit)');
	else if (today >= cap) stops.push(`${today} of ${cap} threads opened in the last 24 hours`);
	if (stops.length) { out(['STOP: the next thread waits for the owner.', ...stops.map((x) => `- ${x}`)].join('\n')); return 1; }
	if (open) write({ kind: 'chain', next: next.slice(0, 200), bounds: b.hash, ...(tap ? { tap } : {}) });
	out(`GO: open the next thread for: ${next}${open ? ` (recorded: ${today + 1} of ${cap} in the last 24 hours)` : ''}`);
	return 0;
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

// The plan's verdict from the command line: { would, why, risks } or { usage }. Each --risk names one thing that could
// make the owner refuse or change the plan, in at least two words of four letters or more, so it can be matched.
function verdict(rest, opt) {
	const would = opt('--would');
	const why = opt('--why');
	const risks = rest.flatMap((a, i) => (a === '--risk' && i + 1 < rest.length ? [String(rest[i + 1]).trim().slice(0, 200)] : []));
	const usage = 'usage: node .claude/loop.mjs shadow --would yes|no --why "<what the verdict rests on: the item, the spec and charter, the impact test, the red-team pass>" [--risk "<what could make the owner refuse or change it>"]... (up to 3 risks, each in at least two words of four letters or more)';
	if (!['yes', 'no'].includes(would) || !why || !String(why).trim() || risks.length > 3 || risks.some((r) => sig(r).length < 2)) return { usage };
	return { would, why: String(why), risks };
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
	if (cmd === 'chain' && (!rest[0] || rest[0].startsWith('--'))) { out('usage: node .claude/loop.mjs chain <handoff.md> [--open]'); return 2; }
	if (b.why) { out(`${cmd === 'chain' ? 'STOP: ' : 'loop: '}${b.why}.`); return 1; }
	s = settle(s, b);
	if (cmd === 'chain') return chain(s, b, rest[0], rest.includes('--open'));
	if (['start', 'next', 'show'].includes(cmd)) {
		if (cmd === 'show') out(`loop mode: ${s.mode.state}${s.mode.state === 'off' ? ` (${s.mode.why})` : ''}`);
		if (!s.run) {
			if (cmd === 'show') out(shadowLine(s, b));
			if (s.plan) out(`NEXT ${b.shadow.step} (plan ${s.plan.item}, no run open): the owner's; ask in the pop-up, the question quoting \`${soloAct(s, b)}\`, then node .claude/loop.mjs done ${b.shadow.step} --evidence "<the plan>"`);
			out('No loop run is open: node .claude/loop.mjs start <item>.');
			return 0;
		}
		if (s.halt) { out(card(s, b, s.halt.why)); return 0; }
		const step = nextStep(s, b);
		if (!step) { out(`Run ${s.run.item}: every step is done.`); return 0; }
		const who = whoFor(step);
		out(who === 'alone' ? `NEXT ${step.step}: alone`
			: who === 'guard' ? `NEXT ${step.step}: the guard's; the act itself waits for the owner's yes where the guards hold it, then record its evidence`
				: `NEXT ${step.step}: the owner's${step.who !== 'owner' ? ' (the kill switch autonomy-off is on)' : ''}; ${stepAct(s, b, step) ? `ask in the pop-up, the question quoting \`${stepAct(s, b, step)}\`` : 'the plan lock: first record its self-approval line, node .claude/loop.mjs shadow --would yes|no --why "<why>"; then next prints the act to quote'}`);
		if (cmd === 'show') out(shadowLine(s, b));
		if (cmd === 'show') out(`Run ${s.run.item}: done ${s.done.join(', ') || 'nothing yet'}; counts ${Object.entries(s.counts).map(([k, n]) => `${k} ${n}`).join(', ') || 'none'}; visual since the last check ${s.visualSince}, the owner's check: \`${checkAct(s)}\``);
		return 0;
	}
	if (cmd === 'resume' && !s.run && s.broken) {
		const yes = ownerYes(s, brokenAct(s), new Date(0).toISOString());
		if (!yes.tap) { out(`loop: refused: the log was changed by hand with no run open; the owner accepts it with a Yes quoting \`${brokenAct(s)}\` (${yes.why}). Nothing written.`); return 1; }
		write({ kind: 'accept', tap: yes.tap, prefix: sha(logLines().join('\n')) });
		out('loop: the owner accepted the log as it is.');
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
	// K210: the plan shadow where plans are locked with no run open: the verdict names its item, and the lock is the
	// owner's Yes to the act made from it, scored as the plan step in a run is.
	if (!s.run && cmd === 'shadow') {
		const v = verdict(rest, opt);
		const item = String(opt('--item') || '').trim().slice(0, 80);
		if (v.usage || !item) { out(v.usage || 'usage: with no run open, the plan names its item: node .claude/loop.mjs shadow --item <id> --would yes|no --why "<why>" [--risk "<risk>"]...'); return 2; }
		if (s.plan) { out(`loop: refused: plan ${s.plan.item} already carries a verdict and waits for its lock; the record keeps the first verdict. Nothing written.`); return 1; }
		write({ kind: 'shadow', solo: true, item, step: b.shadow.step, would: v.would, why: v.why, risks: v.risks, session: session(), scored: true });
		out(`loop: recorded: plan ${item} would${v.would === 'yes' ? '' : ' not'} approve itself. Ask the owner now, as always: self-approval stays off. node .claude/loop.mjs next prints the act to quote.`);
		return 0;
	}
	if (!s.run && cmd === 'done' && rest[0] === b.shadow.step && s.plan) {
		const evidence = opt('--evidence');
		if (!evidence || !String(evidence).trim()) { out(`usage: node .claude/loop.mjs done ${b.shadow.step} --evidence "<proof>"`); return 2; }
		const act = soloAct(s, b);
		const seen = planAnswers(s.plan, act);
		if (seen.why) { out(`loop: refused: ${seen.why}. Nothing written.`); return 1; }
		const yes = ownerYes(s, act, s.plan.time);
		if (!yes.tap) { out(`loop: refused: the plan lock is the owner's, and ${yes.why}. Nothing written.`); return 1; }
		write({ kind: 'done', solo: true, step: b.shadow.step, item: s.plan.item, evidence: String(evidence), tap: yes.tap, shadow: { would: s.plan.would, outcome: outcomeOf(s.plan, seen.answers, seen.unseen) } });
		out(`loop: plan ${s.plan.item} locked on the owner's Yes. ${shadowLine(read(), b)}`);
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
	if (cmd === 'shadow') {
		const v = verdict(rest, opt);
		if (v.usage) { out(v.usage); return 2; }
		const { would, why, risks } = v;
		const step = nextStep(s, b);
		if (!step || step.step !== b.shadow.step) { out(`loop: refused: the self-approval line belongs to the plan step (${b.shadow.step}), and the next step is ${step ? step.step : 'none'}. Nothing written.`); return 1; }
		// One verdict per plan: a second could hide the first after the owner answered it.
		if (s.shadow) { out(`loop: refused: this plan already says it would${s.shadow.would === 'yes' ? '' : ' not'} approve itself; the record keeps the first verdict. Nothing written.`); return 1; }
		// A verdict written after the owner already answered or wrote since the step opened could fit what they said (the
		// build 13 sweep: an ask that did not quote the act, then a verdict to match). It is kept, but scores nothing.
		const sid = session();
		const msg = lastOwnerMessage();
		const talked = yesReader.sessionAnswers(null, { since: Date.parse(s.opened), repo: ROOT, sessionId: sid }).length > 0 || Boolean(msg && Date.parse(msg.at) > Date.parse(s.opened));
		write({ kind: 'shadow', step: step.step, would, why: String(why), risks, session: sid, scored: !talked });
		out(`loop: recorded: the plan would${would === 'yes' ? '' : ' not'} approve itself${talked ? ' (unscored: the owner answered or wrote after the step opened, so the verdict could fit their answer)' : ''}. Ask the owner now, as always: self-approval stays off.`);
		return 0;
	}
	if (cmd === 'done') {
		const stepName = rest[0];
		const evidence = opt('--evidence');
		if (!stepName || !evidence || !String(evidence).trim()) { out('usage: node .claude/loop.mjs done <step> --evidence "<proof>"'); return 2; }
		const step = nextStep(s, b);
		if (!step || step.step !== stepName) { out(card(s, b, `step ${stepName} is out of order`, { halted: false })); return 1; }
		let tap;
		let shadowed;
		const plan = step.step === b.shadow.step && whoFor(step) === 'owner';
		if (plan && !s.shadow) { out(`loop: refused: ${step.step} is the plan lock, and the plan carries no self-approval line yet: node .claude/loop.mjs shadow --would yes|no --why "<why>", then ask the owner. Nothing written.`); return 1; }
		if (plan) {
			// Agreement is read from the owner's own answers to the plan's act since the verdict, never the session's word.
			// The owner's latest answer decides the lock, a No at the same moment as a Yes included, as the guards read it
			// (the build 13 sweep: a Yes then a No locked the plan and counted as agreement).
			// Scored only where every answer can be seen (planAnswers); a No to a yes verdict is a disagreement wherever it is seen.
			const seen = planAnswers(s.shadow, stepAct(s, b, step));
			if (seen.why) { out(`loop: refused: ${seen.why}. Nothing written.`); return 1; }
			shadowed = { would: s.shadow.would, outcome: outcomeOf(s.shadow, seen.answers, seen.unseen) };
		}
		if (whoFor(step) === 'owner') {
			const yes = ownerYes(s, stepAct(s, b, step), plan ? s.shadow.time : s.opened);
			if (!yes.tap) { out(`loop: refused: ${step.step} is the owner's step, and ${yes.why}. Ask in the pop-up, then run this again. Nothing written.`); return 1; }
			tap = yes.tap;
		}
		write({ kind: 'done', step: step.step, evidence: String(evidence), ...(tap ? { tap } : {}), ...(shadowed ? { shadow: shadowed } : {}) });
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
					: counter === 'ci-fix' ? `ci-fix round ${n} since the last green CI (the bounds allow ${limit - 1}): the owner looks at the red run before more`
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
