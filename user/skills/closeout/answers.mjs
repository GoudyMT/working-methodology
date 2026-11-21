#!/usr/bin/env node
// Owner answers not yet recorded (K208, build 23a; the closeout skill, step 3). Saving a decision was prose only: the
// workbench's _Decisions.jsonl gained no row for days while the owner answered many pop-ups. This lists each answer the
// owner tapped in this session's pop-ups (AskUserQuestion) that no _Decisions.jsonl row quotes, and fails until each
// is recorded with `state.mjs decide --from <file.json>` or marked "not a decision" with a reason.
//
// Usage (from the project folder, in the session closing out):
//   node answers.mjs                         list the answers no decision row quotes; exit 1 while any is left
//   node answers.mjs not <id> <reason...>    mark one answer "not a decision", with its reason
//                                            (kept in .kit/not-decisions.jsonl)
//
// An owner answer is read as state.mjs reads one: a person's turn (not a subagent's, not a meta line) whose pop-up
// record is accepted by the user. A question quoting one act in a code span, answered Yes or No, is an owner yes to
// that act (owner-yes.cjs), not a decision, and is not listed. A row quotes an answer when its words_from names that
// turn, its words are the answer, or one holds the other (three words or more) word for word. Limit: a card answered
// in a project thread is not in the transcript, so it is not read here.
// Exit 0 = every answer recorded or marked (or no transcript to read, said so); 1 = answers left; 2 = usage.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = process.cwd();
const SESSION = String(process.env.CLAUDE_CODE_SESSION_ID || '');
const MARKS = path.join('.kit', 'not-decisions.jsonl');
const home = () => process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const show = (s) => String(s).replace(/[\x00-\x1f\x7f]+/g, ' ').replace(/[^\x20-\x7e]/g, '?').trim();
const words = (t) => ` ${String(t).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;
const lines = (text) => text.split('\n').map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter((e) => e && typeof e === 'object');
const readText = (rel) => { try { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); } catch { return ''; } };

/** This session's transcript files, by the keys Claude Code gives this folder and its parents (as state.mjs reads). */
function transcripts() {
	if (!/^[0-9a-f-]{36}$/i.test(SESSION)) return [];
	let real = ROOT;
	try { real = fs.realpathSync.native(ROOT); } catch { /* as given */ }
	const keys = [];
	for (let d = path.resolve(real); ; d = path.dirname(d)) { keys.push(d.replace(/[^A-Za-z0-9]/g, '-').toLowerCase()); if (path.dirname(d) === d) break; }
	const root = path.join(home(), 'projects');
	let dirs = [];
	try { dirs = fs.readdirSync(root).filter((d) => keys.includes(d.toLowerCase())); } catch { return []; }
	return dirs.map((d) => path.join(root, d, `${SESSION}.jsonl`)).filter((p) => fs.existsSync(p));
}

/** The owner's pop-up answers in this session, each { id, question, answer, turn }; act approvals left out. */
function answers(files) {
	const out = [];
	for (const f of files) {
		let text = '';
		try { text = fs.readFileSync(f, 'utf8'); } catch { continue; }
		for (const e of lines(text)) {
			if (e.type !== 'user' || e.isSidechain || e.isMeta || typeof e.uuid !== 'string') continue;
			const d = e.permissionDecision || {};
			const got = e.toolUseResult && e.toolUseResult.answers;
			if (!got || typeof got !== 'object' || d.decision !== 'accept' || !/^user/.test(String(d.source || ''))) continue;
			Object.entries(got).forEach(([question, answer], i) => {
				const act = /`[^`]+`/.test(question) && /^(yes(\s*\(recommended\))?|no\b.*)$/i.test(String(answer).trim());
				if (!act) out.push({ id: `${e.uuid}#${i + 1}`, question: String(question), answer: String(answer), turn: e.uuid });
			});
		}
	}
	return out;
}

/** Whether a decision row quotes the answer: it points at the turn, or its words and the answer hold one another. */
function quoted(a, rows) {
	const want = words(a.answer);
	return rows.some((r) => {
		if (String(r.words_from || '') === `${SESSION}:${a.turn}`) return true;
		// A short answer ("Yes") is quoted only whole: inside a longer row's words it could be any word of another call.
		const have = words(r.words || '');
		const n = (w) => w.trim().split(' ').filter(Boolean).length;
		if (!n(have) || !n(want)) return false;
		return have === want || (n(have) >= 3 && want.includes(have)) || (n(want) >= 3 && have.includes(want));
	});
}

function main(argv) {
	const files = transcripts();
	if (!files.length) {
		console.log(`Owner answers: not checked: no transcript of this session (${SESSION ? 'its id is set' : 'no CLAUDE_CODE_SESSION_ID'}) under ${show(path.join(home(), 'projects'))}`);
		return 0;
	}
	const all = answers(files);
	const marks = lines(readText(MARKS));
	if (argv[0] === 'not') {
		const [, id, ...why] = argv;
		if (!id || !why.join(' ').trim()) { console.log('Usage: node answers.mjs not <id> <reason why it is not a decision>'); return 2; }
		if (!all.some((a) => a.id === id)) { console.log(`${show(id)} is not an owner answer in this session: run node answers.mjs to list them`); return 1; }
		const dir = path.join(ROOT, '.kit');
		try { if (fs.lstatSync(dir).isSymbolicLink()) throw new Error('link'); } catch (e) { if (e.code !== 'ENOENT') { console.log('.kit is a link or cannot be read; nothing written'); return 1; } fs.mkdirSync(dir); }
		try { const st = fs.lstatSync(path.join(ROOT, MARKS)); if (st.isSymbolicLink() || !st.isFile() || st.nlink > 1) { console.log(`${MARKS} is a link or not a plain file; nothing written`); return 1; } } catch { /* new */ }
		fs.appendFileSync(path.join(ROOT, MARKS), `${JSON.stringify({ id, session: SESSION, date: new Date().toISOString().slice(0, 10), reason: show(why.join(' ')) })}\n`);
		console.log(`${show(id)} marked not a decision`);
		return 0;
	}
	if (argv.length) { console.log('Usage: node answers.mjs | node answers.mjs not <id> <reason>'); return 2; }
	const rows = lines(readText('_Decisions.jsonl'));
	const marked = new Set(marks.filter((m) => m.session === SESSION && String(m.reason || '').trim()).map((m) => m.id));
	const left = all.filter((a) => !marked.has(a.id) && !quoted(a, rows));
	if (!left.length) {
		console.log(`Owner answers: every owner answer in this session is recorded or marked (${all.length} read)`);
		return 0;
	}
	console.log(`Owner answers: ${left.length} owner answer(s) no decision row quotes. Record each with node .claude/state.mjs decide --from <file.json> (its words the owner's answer, its why the reason), or mark it: node <this skill's folder>/answers.mjs not <id> <reason>`);
	for (const a of left) console.log(`  ${a.id}: "${show(a.question)}" -> "${show(a.answer)}"`);
	return 1;
}

process.exitCode = main(process.argv.slice(2));
