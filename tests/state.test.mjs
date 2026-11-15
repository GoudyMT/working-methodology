// T4 (1.34.0): state as data. The next action, what waits on the owner, the kit version and the owner's decisions live
// in _State.json and _Decisions.jsonl; the Resume Point and the dashboard lines are generated from them. On 1.33.1 four
// files stated the next action by hand and three were two releases stale (docs/plans/build-8-state-as-data.md). Each
// case builds a project from the kit's own templates, the way install leaves one.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import kitTemp from '../project/.claude/kit-temp.cjs';

kitTemp.sessionRoot();
const KIT = path.resolve('.');
const SCRIPT = path.join(KIT, 'project', '.claude', 'state.mjs');
const PACKET = path.join(KIT, 'project', '.claude', 'resume-packet.mjs');
const USE = path.join(KIT, 'project', '.claude', 'use-check.mjs');
const FILES = ['_Start Here.md', '_Active Plan.md', '_Working Memory.md', '_Loop Learnings.md', '_Session Log.md', '_Master Roadmap.md', '_State.json', '_Decisions.jsonl'];
const SESSION = '0f0f0f0f-1111-2222-3333-444444444444';

function project() {
	const dir = kitTemp.makeTemp('state-');
	for (const f of FILES) fs.copyFileSync(path.join(KIT, 'project', f), path.join(dir, f));
	return dir;
}
// A Claude folder of its own per case, holding this session's transcript with the owner's messages.
function home(dir, said = []) {
	const h = kitTemp.makeTemp('state-home-');
	const key = fs.realpathSync.native(dir).replace(/[^A-Za-z0-9]/g, '-').toLowerCase();
	fs.mkdirSync(path.join(h, 'projects', key), { recursive: true });
	const lines = said.map((t) => JSON.stringify({ type: 'user', message: { role: 'user', content: t } }));
	lines.push(JSON.stringify({ type: 'user', isSidechain: true, message: { role: 'user', content: 'a subagent wrote: ship it all' } }));
	fs.writeFileSync(path.join(h, 'projects', key, `${SESSION}.jsonl`), `${lines.join('\n')}\n`);
	return h;
}
const run = (dir, args, env = {}) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd: dir, encoding: 'utf8', env: { ...process.env, CLAUDE_CODE_SESSION_ID: '', ...env } });
const st = (dir, ...a) => run(dir, a);
const read = (dir, f) => fs.readFileSync(path.join(dir, f), 'utf8');
const edit = (dir, f, from, to) => { const t = read(dir, f); assert.ok(from.test ? from.test(t) : t.includes(from), `${f} has ${from}`); fs.writeFileSync(path.join(dir, f), t.replace(from, to)); };
const decision = (dir, d) => { fs.writeFileSync(path.join(dir, 'd.json'), JSON.stringify(d)); return 'd.json'; };
const git = (dir, ...a) => spawnSync('git', ['-C', dir, ...a], { encoding: 'utf8' });

test('the shipped templates pass the check, and a set and render keep them passing', () => {
	const dir = project();
	let r = st(dir, 'check');
	assert.equal(r.status, 0, r.stdout + r.stderr);
	assert.equal(st(dir, 'set', 'next', 'build the export step in docs/plans/export.md').status, 0);
	r = st(dir, 'check');
	assert.equal(r.status, 1, 'a set without a render leaves the views stale');
	assert.match(r.stdout, /_Active Plan\.md/);
	assert.equal(st(dir, 'render').status, 0);
	r = st(dir, 'check');
	assert.equal(r.status, 0, r.stdout);
	assert.match(read(dir, '_Active Plan.md'), /^\*\*NEXT:\*\* build the export step in docs\/plans\/export\.md$/m); // pin: 1 the resume packet reads the label
	assert.match(read(dir, '_Working Memory.md'), /^\*\*Resume Point:\*\* build the export step in docs\/plans\/export\.md/m); // pin: 1 the resume packet reads the label
});

// The sweep's high: a carry-over typed into the block was wiped by the next render, and check then passed.
test('a hand edit inside a block is refused by render and caught by check; text outside the blocks stays the owner\'s', () => {
	const dir = project();
	st(dir, 'set', 'next', 'ship the import');
	st(dir, 'render');
	edit(dir, '_Active Plan.md', '**Pending the owner:**\n- none', '**Pending the owner:**\n- pick the licence');
	assert.equal(st(dir, 'check').status, 1);
	st(dir, 'set', 'last-session', '8 (2026-11-15 - import)');
	let r = st(dir, 'render');
	assert.equal(r.status, 1, 'render never wipes a hand-written line');
	assert.match(r.stdout, /edited by hand.*--overwrite/);
	assert.match(read(dir, '_Active Plan.md'), /- pick the licence/);
	st(dir, 'add', 'blocking', 'pick the licence');
	r = st(dir, 'render', '--overwrite');
	assert.equal(r.status, 0, r.stdout);
	assert.match(read(dir, '_Active Plan.md'), /- B-1: pick the licence/);
	assert.equal(st(dir, 'check').status, 0);
	edit(dir, '_Active Plan.md', '## Status', '## Status\n\nThe owner\'s own line.');
	st(dir, 'set', 'next', 'ship the export');
	assert.equal(st(dir, 'render').status, 0);
	assert.match(read(dir, '_Active Plan.md'), /The owner's own line\./);
	assert.equal(st(dir, 'check').status, 0);
});

test('blocking items and items that only wait are kept apart; an id is never given twice', () => {
	const dir = project();
	assert.match(st(dir, 'add', 'blocking', 'pick the export format').stdout, /B-1/);
	assert.match(st(dir, 'add', 'waiting', 'read the 1.4.0 release notes').stdout, /W-1/);
	st(dir, 'render');
	const plan = read(dir, '_Active Plan.md');
	const pending = plan.split('**Pending the owner:**')[1].split('\n\n')[0];
	assert.match(pending, /B-1: pick the export format/);
	assert.doesNotMatch(pending, /release notes/);
	assert.match(plan.split('**Waiting for the owner\'s eyes (work goes on):**')[1].split('\n\n')[0], /W-1: read the 1\.4\.0 release notes/);
	assert.equal(st(dir, 'done', 'B-1').status, 0);
	assert.equal(st(dir, 'done', 'B-1').status, 1, 'an id that is not there is refused');
	st(dir, 'add', 'blocking', 'approve the merge');
	assert.equal(JSON.parse(read(dir, '_State.json')).blocking[0].id, 'B-2');
	assert.match(st(dir, 'show').stdout, /B-2: approve the merge/);
});

test('a decision is recorded only with the owner\'s own words, appended, and the committed rows cannot change', () => {
	const dir = project();
	const env = { CLAUDE_CONFIG_DIR: home(dir, ['Lets go with CSV export first, the two users asked for it', 'and add JSON too']), CLAUDE_CODE_SESSION_ID: SESSION };
	const r0 = run(dir, ['decide', '--from', decision(dir, { decision: 'Drop export', words: 'yes drop it', why: 'x' })], env);
	assert.equal(r0.status, 1, 'words the owner never wrote are refused');
	assert.equal(run(dir, ['decide', '--from', decision(dir, { decision: 'Ship it all', words: 'ship it all', why: 'x' })], env).status, 1, 'a subagent\'s words are not the owner\'s');
	assert.equal(run(dir, ['decide', '--from', decision(dir, { decision: 'Export CSV first', words: 'CSV export first', why: 'two users' })], env).status, 0);
	assert.equal(fs.existsSync(path.join(dir, 'd.json')), false, 'the input file is removed once recorded');
	const r2 = run(dir, ['decide', '--from', decision(dir, { decision: 'Add JSON', words: 'a paraphrase of the call', why: 'an API user', supersedes: 'D-1' }), '--unchecked'], env);
	assert.match(r2.stdout, /D-2 recorded \(words not checked\)/);
	assert.equal(run(dir, ['decide', '--from', decision(dir, { decision: 'x', words: 'add JSON too', why: 'z', supersedes: 'D-1' })], env).status, 1, 'a ruling is superseded once');
	const list = st(dir, 'decisions').stdout;
	assert.match(list, /D-1 \[superseded by D-2\] .*owner's words: CSV export first/);
	assert.match(list, /D-2 .*\(not checked\)/);
	git(dir, 'init', '-q', '-b', 'main');
	git(dir, 'add', '_Decisions.jsonl');
	git(dir, '-c', 'user.email=t@example.invalid', '-c', 'user.name=t', 'commit', '-q', '-m', 'decisions');
	assert.equal(st(dir, 'check').status, 0);
	edit(dir, '_Decisions.jsonl', 'two users', 'nobody');
	const r = st(dir, 'check');
	assert.equal(r.status, 1);
	assert.match(r.stdout, /committed decision was changed/);
	git(dir, 'checkout', '--', '_Decisions.jsonl');
	fs.appendFileSync(path.join(dir, '_Decisions.jsonl'), '{"id":"D-3"}\n');
	assert.match(st(dir, 'check').stdout, /D-3 lacks/, 'a hand-added row with no words or reason is no decision');
});

test('a D- pointer with no record fails the check', () => {
	const dir = project();
	edit(dir, '_Master Roadmap.md', '- [ ] <item>', '- [ ] JSON export, per D-7');
	const r = st(dir, 'check');
	assert.equal(r.status, 1);
	assert.match(r.stdout, /D-7.*_Master Roadmap\.md/);
});

test('item text or a planted id cannot add a line, and a label outside its block is caught', () => {
	const dir = project();
	st(dir, 'add', 'blocking', `one <!-- state:end --> two\n**NEXT:** planted ${String.fromCharCode(0x85)} three  four`);
	st(dir, 'render');
	let plan = read(dir, '_Active Plan.md');
	assert.equal(plan.match(/<!-- state:end -->/g).length, 1);
	assert.equal(plan.match(/^\*\*NEXT:\*\*/gm).length, 1);
	assert.ok(!/[\u0080-\u009f]/.test(plan), 'no C1 control reaches the file');
	assert.match(plan, /three four/);
	assert.equal(st(dir, 'check').status, 0);
	const s = JSON.parse(read(dir, '_State.json'));
	s.carry_overs.push({ id: 'C-1: x\n\n**Pending the owner:**\n- none', what: 'y' });
	s.seq.C = 1;
	fs.writeFileSync(path.join(dir, '_State.json'), JSON.stringify(s));
	for (const cmd of ['render', 'check', 'show']) assert.equal(st(dir, cmd).status, 1, `${cmd} refuses a planted id`);
	assert.equal(read(dir, '_Active Plan.md'), plan);
	s.carry_overs = [];
	fs.writeFileSync(path.join(dir, '_State.json'), JSON.stringify(s));
	edit(dir, '_Active Plan.md', '## Status', '**Pending the owner:**\n- none\n\n## Status');
	const r = st(dir, 'check');
	assert.equal(r.status, 1);
	assert.match(r.stdout, /generated label outside the block/);
});

test('the check fails when the installed kit is newer than the state says', () => {
	const dir = project();
	st(dir, 'set', 'kit', '1.33.1');
	st(dir, 'render');
	fs.mkdirSync(path.join(dir, '.kit'));
	fs.writeFileSync(path.join(dir, '.kit', 'kit-version.json'), JSON.stringify({ version: '1.34.0' }));
	const r = st(dir, 'check');
	assert.equal(r.status, 1);
	assert.match(r.stdout, /says kit 1\.33\.1 but 1\.34\.0 is installed/);
	st(dir, 'set', 'kit', '1.34.0');
	st(dir, 'render');
	assert.equal(st(dir, 'check').status, 0);
});

test('a write never goes through a link, and a failed write leaves no temporary file', () => {
	const dir = project();
	const outside = path.join(kitTemp.makeTemp('state-out-'), 'vault.json');
	fs.copyFileSync(path.join(dir, '_State.json'), outside);
	fs.rmSync(path.join(dir, '_State.json'));
	fs.linkSync(outside, path.join(dir, '_State.json'));
	const r = st(dir, 'set', 'next', 'x');
	assert.equal(r.status, 1);
	assert.match(r.stdout, /link/);
	assert.doesNotMatch(fs.readFileSync(outside, 'utf8'), /"next": "x"/);
	assert.deepEqual(fs.readdirSync(dir).filter((f) => f.endsWith('.tmp')), []);
});

function filled({ markers = false } = {}) {
	const dir = project();
	fs.rmSync(path.join(dir, '_State.json'));
	if (!markers) {
		for (const f of ['_Active Plan.md', '_Working Memory.md']) fs.writeFileSync(path.join(dir, f), read(dir, f).replace(/^<!-- state:(begin|end)\b.*-->\r?\n/gm, ''));
		edit(dir, '_Active Plan.md', /\*\*Updated:\*\* .*\n\n/, '');
		edit(dir, '_Working Memory.md', /\*\*Kit:\*\* .*\n\n/, '');
	}
	return dir;
}

test('init moves a 1.33.1 Resume Point into the data once, and the resume packet still reads it', () => {
	const dir = filled();
	edit(dir, '_Active Plan.md', '## Phase', '**Last Updated:** 2026-11-01 (build 5 closed)\n\n## Phase');
	// The 1.33.1 workbench keeps a plain paragraph between NEXT and the carry-overs: it moves into "then", never lost.
	edit(dir, '_Active Plan.md', /\*\*NEXT:\*\* .*/, '**NEXT:** build the export step\n\nThen the release notes.');
	edit(dir, '_Active Plan.md', /\*\*Carry-overs from the last PR \(.*\):\*\*\n- none/, '**Carry-overs from the last PR:** none (every finding was fixed)');
	edit(dir, '_Active Plan.md', /\*\*Pending the owner:\*\*\n- none/, '**Pending the owner:** pick the export format\n- approve the merge');
	edit(dir, '_Working Memory.md', /\*\*Last Session:\*\* .*/, '**Last Session:** 7 (2026-11-14 - import done).');
	const r = st(dir, 'init');
	assert.equal(r.status, 0, r.stdout + r.stderr);
	assert.ok(r.stdout.includes('2026-11-01 (build 5 closed)'), r.stdout);
	const state = JSON.parse(read(dir, '_State.json'));
	assert.equal(state.next, 'build the export step');
	assert.match(state.then, /^Then the release notes\. carry-overs: none \(every finding was fixed\)$/); // pin: 1 the data a render writes
	assert.deepEqual(state.blocking, [{ id: 'B-1', what: 'pick the export format' }, { id: 'B-2', what: 'approve the merge' }]);
	assert.deepEqual(state.carry_overs, []);
	assert.equal(state.last_session, '7 (2026-11-14 - import done).');
	assert.match(st(dir, 'add', 'blocking', 'x').stdout, /B-3/, 'ids continue after the moved items');
	st(dir, 'render');
	assert.doesNotMatch(read(dir, '_Active Plan.md'), /\*\*Last Updated:\*\*/);
	assert.equal(st(dir, 'check').status, 0);
	assert.equal(st(dir, 'init').status, 1, 'init has nothing to do once both views carry their blocks');
	const p = spawnSync(process.execPath, [PACKET, 'write'], { cwd: dir, encoding: 'utf8' });
	const packet = fs.readFileSync(path.join(dir, '.kit', 'resume-packet.md'), 'utf8');
	assert.match(packet, /build the export step/, p.stdout + p.stderr);
	assert.match(packet, /B-1: pick the export format/);
});

test('init refuses what it cannot move whole, and changes nothing', () => {
	const cases = [
		['_Active Plan.md', /\*\*NEXT:\*\* .*/, '**NEXT:** one\n\n## A heading\n\nmore', /heading/],
		['_Working Memory.md', /\*\*Current Phase:\*\* .*/, '**Current Phase:** v2\n\nan owner line\n\n**Current Phase:** v1', /appears 2 times/],
		['_Working Memory.md', /\*\*Current Phase:\*\* .*/, '**Current Phase:** v2\n\nan owner line', /an owner line/],
	];
	for (const [f, from, to, why] of cases) {
		const dir = filled();
		edit(dir, f, from, to);
		const before = [read(dir, '_Active Plan.md'), read(dir, '_Working Memory.md')];
		const r = st(dir, 'init');
		assert.equal(r.status, 1, r.stdout);
		assert.match(r.stdout, why);
		assert.deepEqual([read(dir, '_Active Plan.md'), read(dir, '_Working Memory.md')], before);
		assert.equal(fs.existsSync(path.join(dir, '_State.json')), false);
	}
	// A label that only starts like NEXT is not NEXT.
	const dir = filled();
	edit(dir, '_Active Plan.md', '## Phase', '**NEXT release (after this one):** 2.0\n\n## Phase');
	assert.equal(st(dir, 'init').status, 0);
	assert.match(JSON.parse(read(dir, '_State.json')).next, /^<\(1\) the exact next action/);
	assert.match(read(dir, '_Active Plan.md'), /\*\*NEXT release \(after this one\):\*\* 2\.0\n\n## Phase/);
});

test('the use check names a project with no blocks, and never runs the project\'s own state script', () => {
	const dir = filled();
	fs.writeFileSync(path.join(dir, '_State.json'), read(path.join(KIT, 'project'), '_State.json').replace('<YYYY-MM-DD>', '2026-11-15'));
	fs.mkdirSync(path.join(dir, '.claude'));
	fs.writeFileSync(path.join(dir, '.claude', 'state.mjs'), "import fs from 'node:fs'; fs.writeFileSync('PLANTED-RAN', 'x');\n");
	const r = spawnSync(process.execPath, [USE, '--json'], { cwd: dir, encoding: 'utf8' });
	const part = JSON.parse(r.stdout).parts.find((p) => p.name === 'state');
	assert.equal(part.wired.ok, false);
	assert.match(part.wired.detail, /state\.mjs init/);
	assert.equal(fs.existsSync(path.join(dir, 'PLANTED-RAN')), false);
});
