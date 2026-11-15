// T4 (1.34.0): state as data. The next action, what waits on the owner and the owner's decisions live in
// _State.json and _Decisions.jsonl; the Resume Point and the dashboard lines are generated from them. On 1.33.1 four
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
const FILES = ['_Start Here.md', '_Active Plan.md', '_Working Memory.md', '_Loop Learnings.md', '_Session Log.md', '_Master Roadmap.md', '_State.json', '_Decisions.jsonl'];

function project() {
	const dir = kitTemp.makeTemp('state-');
	for (const f of FILES) fs.copyFileSync(path.join(KIT, 'project', f), path.join(dir, f));
	return dir;
}
const run = (dir, ...a) => spawnSync(process.execPath, [SCRIPT, ...a], { cwd: dir, encoding: 'utf8' });
const read = (dir, f) => fs.readFileSync(path.join(dir, f), 'utf8');
const edit = (dir, f, from, to) => { const t = read(dir, f); assert.ok(from.test ? from.test(t) : t.includes(from), `${f} has ${from}`); fs.writeFileSync(path.join(dir, f), t.replace(from, to)); };

test('the shipped templates pass the check, and a set and render keep them passing', () => {
	const dir = project();
	let r = run(dir, 'check');
	assert.equal(r.status, 0, r.stdout + r.stderr);
	assert.equal(run(dir, 'set', 'next', 'build the export step in docs/plans/export.md').status, 0);
	r = run(dir, 'check');
	assert.equal(r.status, 1, 'a set without a render leaves the views stale');
	assert.match(r.stdout, /_Active Plan\.md/);
	assert.equal(run(dir, 'render').status, 0);
	r = run(dir, 'check');
	assert.equal(r.status, 0, r.stdout);
	assert.match(read(dir, '_Active Plan.md'), /^\*\*NEXT:\*\* build the export step in docs\/plans\/export\.md$/m);
	assert.match(read(dir, '_Working Memory.md'), /^\*\*Resume Point:\*\* build the export step in docs\/plans\/export\.md/m);
});

test('a hand edit inside a generated block is caught; text outside the blocks stays the owner\'s', () => {
	const dir = project();
	run(dir, 'set', 'next', 'ship the import');
	run(dir, 'render');
	edit(dir, '_Active Plan.md', '**NEXT:** ship the import', '**NEXT:** something else');
	let r = run(dir, 'check');
	assert.equal(r.status, 1);
	assert.match(r.stdout, /_Active Plan\.md/);
	run(dir, 'render');
	assert.equal(run(dir, 'check').status, 0);
	edit(dir, '_Active Plan.md', '## Current Phase', '## Current Phase\n\nThe owner\'s own line.');
	edit(dir, '_Working Memory.md', '## Project Identity', '## Project Identity\n\nKept as written.');
	run(dir, 'set', 'next', 'ship the export');
	run(dir, 'render');
	assert.match(read(dir, '_Active Plan.md'), /The owner's own line\./);
	assert.match(read(dir, '_Working Memory.md'), /Kept as written\./);
	assert.equal(run(dir, 'check').status, 0);
});

test('blocking items and items that only wait for the owner are kept apart, and done removes one', () => {
	const dir = project();
	const b = run(dir, 'add', 'blocking', 'pick the export format');
	const w = run(dir, 'add', 'waiting', 'read the 1.4.0 release notes');
	assert.match(b.stdout, /B-1/);
	assert.match(w.stdout, /W-1/);
	run(dir, 'render');
	const plan = read(dir, '_Active Plan.md');
	const pending = plan.split('**Pending the owner:**')[1].split('\n\n')[0];
	assert.match(pending, /B-1: pick the export format/);
	assert.doesNotMatch(pending, /release notes/);
	assert.match(plan.split('**Waiting for the owner\'s eyes (work goes on):**')[1].split('\n\n')[0], /W-1: read the 1\.4\.0 release notes/);
	assert.equal(run(dir, 'done', 'B-1').status, 0);
	assert.equal(run(dir, 'done', 'B-1').status, 1, 'an id that is not there is refused');
	run(dir, 'add', 'blocking', 'approve the merge');
	assert.match(JSON.parse(read(dir, '_State.json')).blocking[0].id, /^B-2$/, 'an id is never given twice');
	const shown = run(dir, 'show').stdout;
	assert.match(shown, /B-2: approve the merge/);
	assert.match(shown, /W-1: read the 1\.4\.0 release notes/);
});

test('a decision gets the next id with the owner\'s words; a D- pointer with no record fails the check', () => {
	const dir = project();
	assert.equal(run(dir, 'decide', 'Export as CSV first').status, 1, 'a decision needs the owner\'s words and the reason');
	const d1 = run(dir, 'decide', 'Export as CSV first', '--words', 'CSV is enough for now', '--why', 'the two users asked for it');
	assert.equal(d1.status, 0, d1.stderr);
	assert.match(d1.stdout, /D-1/);
	const d2 = run(dir, 'decide', 'Add JSON export', '--words', 'add JSON too', '--why', 'an API user', '--supersedes', 'D-1');
	assert.match(d2.stdout, /D-2/);
	assert.equal(run(dir, 'decide', 'x', '--words', 'y', '--why', 'z', '--supersedes', 'D-9').status, 1, 'a decision cannot replace one that is not there');
	const rows = read(dir, '_Decisions.jsonl').trim().split('\n').map((l) => JSON.parse(l));
	assert.deepEqual(rows.map((d) => [d.id, d.words, d.supersedes]), [['D-1', 'CSV is enough for now', null], ['D-2', 'add JSON too', 'D-1']]);
	assert.match(run(dir, 'decisions', 'csv').stdout, /D-1 .*superseded by D-2/);
	run(dir, 'add', 'waiting', 'confirm the JSON shape (D-2)');
	run(dir, 'render');
	assert.equal(run(dir, 'check').status, 0);
	edit(dir, '_Master Roadmap.md', '- [ ] <item>', '- [ ] JSON export, per D-7');
	const r = run(dir, 'check');
	assert.equal(r.status, 1);
	assert.match(r.stdout, /D-7.*_Master Roadmap\.md/);
});

test('item text cannot end a generated block early or add a line', () => {
	const dir = project();
	run(dir, 'add', 'blocking', 'one <!-- state:end --> two\n**NEXT:** planted');
	run(dir, 'render');
	const plan = read(dir, '_Active Plan.md');
	assert.equal(plan.match(/<!-- state:end -->/g).length, 1);
	assert.equal(plan.match(/^\*\*NEXT:\*\*/gm).length, 1);
	assert.equal(run(dir, 'check').status, 0);
});

test('init moves a filled-in Resume Point into the data once, and the resume packet still reads it', () => {
	const dir = project();
	fs.rmSync(path.join(dir, '_State.json'));
	// An Active Plan and Working Memory filled in the way 1.33.1 left them: no generated block yet.
	const strip = (f) => { const t = read(dir, f).replace(/^<!-- state:(begin|end)\b.*-->\r?\n/gm, ''); fs.writeFileSync(path.join(dir, f), t); };
	strip('_Active Plan.md');
	strip('_Working Memory.md');
	edit(dir, '_Active Plan.md', '## Current Phase', '**Last Updated:** 2026-11-01 (build 5 closed)\n\n## Current Phase');
	// The 1.33.1 workbench keeps a plain paragraph between NEXT and the carry-overs: it moves into "then", never lost.
	edit(dir, '_Active Plan.md', /\*\*NEXT:\*\* .*/, '**NEXT:** build the export step\n\nThen the release notes.');
	edit(dir, '_Active Plan.md', /\*\*Pending the owner:\*\*\n- .*/, '**Pending the owner:**\n- pick the export format');
	edit(dir, '_Working Memory.md', /\*\*Last Session:\*\* .*/, '**Last Session:** 7 (2026-11-14 - import done).');
	const r = run(dir, 'init');
	assert.equal(r.status, 0, r.stdout + r.stderr);
	const state = JSON.parse(read(dir, '_State.json'));
	assert.equal(state.next, 'build the export step');
	assert.equal(state.then, 'Then the release notes.');
	assert.doesNotMatch(read(dir, '_Active Plan.md'), /\*\*Last Updated:\*\*/, 'the hand-kept date line is replaced by the generated one');
	assert.match(read(dir, '_Active Plan.md'), new RegExp(`^\\*\\*Updated:\\*\\* ${state.updated}$`, 'm'));
	assert.match(read(dir, '_Active Plan.md'), /^\*\*Then:\*\* Then the release notes\.$/m);
	assert.deepEqual(state.blocking.map((i) => i.what), ['pick the export format']);
	assert.equal(state.last_session, '7 (2026-11-14 - import done).');
	assert.equal(run(dir, 'check').status, 0);
	assert.equal(run(dir, 'init').status, 1, 'init never writes over state already in use');
	const p = spawnSync(process.execPath, [PACKET, 'write'], { cwd: dir, encoding: 'utf8' });
	assert.match(fs.readFileSync(path.join(dir, '.kit', 'resume-packet.md'), 'utf8'), /build the export step/, p.stdout + p.stderr);
	assert.match(fs.readFileSync(path.join(dir, '.kit', 'resume-packet.md'), 'utf8'), /pick the export format/);
});
