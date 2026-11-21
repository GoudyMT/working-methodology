// K208 (build 23a): saving a decision was prose only. The workbench's _Decisions.jsonl gained no row from 2026-11-17
// while the owner answered many pop-ups (hook-memory RESULT sec 3), and nothing at closeout named the gap: state.mjs
// check passes with an answer unrecorded. The closeout skill's answers.mjs lists each answer the owner tapped in this
// session's pop-ups that no decision row quotes, and fails until each is recorded with state.mjs decide or marked
// "not a decision" with a reason. A pop-up that approves one held act (a code span answered Yes or No) is an owner
// yes, not a decision, and is not listed.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import kitTemp from '../project/.claude/kit-temp.cjs';

kitTemp.sessionRoot();
const KIT = path.resolve('.');
const STATE = path.join(KIT, 'project', '.claude', 'state.mjs');
const ANSWERS = path.join(KIT, 'user', 'skills', 'closeout', 'answers.mjs');
const FILES = ['_Start Here.md', '_Active Plan.md', '_Working Memory.md', '_Loop Learnings.md', '_Session Log.md', '_Master Roadmap.md', '_State.json', '_Decisions.jsonl'];
const SESSION = '0f0f0f0f-1111-2222-3333-555555555555';

function project() {
	const dir = kitTemp.makeTemp('answers-');
	for (const f of FILES) fs.copyFileSync(path.join(KIT, 'project', f), path.join(dir, f));
	return dir;
}
// One answered pop-up as Claude Code writes it: the question asked, then the person's answer, accepted by the user.
function popup(n, question, answer, { source = 'user_temporary', side = false } = {}) {
	const id = `toolu_ask${n}`;
	return [
		{ type: 'assistant', uuid: `ask-${n}`, message: { role: 'assistant', content: [{ type: 'tool_use', id, name: 'AskUserQuestion', input: { questions: [{ question, options: [{ label: answer }, { label: 'No, other' }] }] } }] } },
		{ type: 'user', uuid: `ans-${n}`, isSidechain: side, permissionDecision: { decision: 'accept', source }, toolUseResult: { questions: [{ question }], answers: { [question]: answer } }, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'answered' }] } },
	];
}
function home(dir, entries) {
	const h = kitTemp.makeTemp('answers-home-');
	const key = fs.realpathSync.native(dir).replace(/[^A-Za-z0-9]/g, '-').toLowerCase();
	fs.mkdirSync(path.join(h, 'projects', key), { recursive: true });
	fs.writeFileSync(path.join(h, 'projects', key, `${SESSION}.jsonl`), `${entries.map((e) => JSON.stringify(e)).join('\n')}\n`);
	return h;
}
const run = (script, dir, args, h) => spawnSync(process.execPath, [script, ...args], { cwd: dir, encoding: 'utf8', env: { ...process.env, CLAUDE_CONFIG_DIR: h, CLAUDE_CODE_SESSION_ID: SESSION } });

// why: catches an owner's pop-up answer left out of the decision record at closeout
test('the closeout names each pop-up answer no decision row quotes, and passes once each is recorded or marked', () => {
	const dir = project();
	const h = home(dir, [
		{ type: 'user', uuid: 'say-0', message: { role: 'user', content: 'lets plan the export' } },
		...popup(1, 'Which export goes first?', 'CSV export first'),
		...popup(2, 'Where should the report live?', 'Keep it in the project folder'),
		// An owner yes to one held act is not a decision, and a subagent's or Claude's own answer is no owner answer.
		...popup(3, 'Run `git push origin feat/x`?', 'Yes'),
		...popup(4, 'Which colour for the chart?', 'Blue for every series', { side: true }),
		...popup(5, 'Which font?', 'Serif for headings', { source: 'claude' }),
	]);
	// The gap, as it stands: one of two answers recorded, and the state check is clean.
	fs.writeFileSync(path.join(dir, 'd.json'), JSON.stringify({ decision: 'CSV export before JSON', words: 'CSV export first', why: 'two users asked for it' }));
	assert.match(run(STATE, dir, ['decide', '--from', 'd.json'], h).stdout, /D-1 recorded/);
	assert.equal(run(STATE, dir, ['check'], h).status, 0, 'state.mjs check does not see the unrecorded answer');
	let r = run(ANSWERS, dir, [], h);
	assert.equal(r.status, 1, r.stdout + r.stderr);
	assert.match(r.stdout, /1 owner answer\(s\) no decision row quotes/);
	// The id, the question and the answer are the session's own data, quoted back so the session can mark the answer.
	assert.ok(r.stdout.includes('ans-2#1') && r.stdout.includes('Where should the report live?') && r.stdout.includes('Keep it in the project folder'), r.stdout);
	for (const other of ['CSV export first', 'git push', 'Blue for every', 'Serif']) assert.ok(!r.stdout.includes(other), other);
	// Marked "not a decision" with a reason, it is no longer named; a mark with no reason, or for no answer, is refused.
	assert.equal(run(ANSWERS, dir, ['not', 'ans-2#1'], h).status, 2, 'a mark needs its reason');
	assert.equal(run(ANSWERS, dir, ['not', 'ans-9#1', 'typo'], h).status, 1, 'a mark names an answer of this session');
	r = run(ANSWERS, dir, ['not', 'ans-2#1', 'a place, not a choice between options'], h);
	assert.equal(r.status, 0, r.stdout);
	r = run(ANSWERS, dir, [], h);
	assert.equal(r.status, 0, r.stdout);
	assert.match(r.stdout, /^Owner answers: .*\(\d+ read\)$/m, 'the pass line counts what it read');
});

// why: catches an owner's pop-up answer left out of the decision record at closeout
test('an answer recorded with state.mjs decide is not named, and a session with no answers passes silent', () => {
	const dir = project();
	const h = home(dir, [...popup(1, 'Which export goes first?', 'CSV export first'), ...popup(2, 'Ship on Friday?', 'Ship it on Friday morning')]);
	for (const [words, n] of [['CSV export first', 1], ['ship it on Friday morning', 2]]) {
		fs.writeFileSync(path.join(dir, 'd.json'), JSON.stringify({ decision: `call ${n}`, words, why: 'the owner said why' }));
		assert.match(run(STATE, dir, ['decide', '--from', 'd.json'], h).stdout, new RegExp(`D-${n} recorded`));
	}
	assert.equal(run(ANSWERS, dir, [], h).status, 0);
	const quiet = project();
	const hq = home(quiet, [{ type: 'user', uuid: 'say-0', message: { role: 'user', content: 'hello' } }]);
	const r = run(ANSWERS, quiet, [], hq);
	assert.equal(r.status, 0, r.stdout);
	assert.match(r.stdout, /^Owner answers: .*\(\d+ read\)$/m, 'the pass line counts what it read');
});
