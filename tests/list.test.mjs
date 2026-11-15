// T4 slice 2 (1.35.0): the improvement list and the roadmap as data. On 1.34.0 the workbench list held 339 rows in 9
// table shapes; none said who caught a row (J4: of 222 done or closed rows, 85 named no finder and 58 named two or
// more), no number said where it was measured (J3), and the roadmap counts were recounted by hand at every closeout.
// Now the rows live in _List.jsonl and the roadmap steps in _State.json; the views are generated (docs/plans/
// build-9-list-as-data.md). Each case builds a project from the kit's own templates, the way install leaves one.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import kitTemp from '../project/.claude/kit-temp.cjs';

kitTemp.sessionRoot();
const KIT = path.resolve('.');
const SCRIPT = path.join(KIT, 'project', '.claude', 'state.mjs');
const FILES = ['_Start Here.md', '_Active Plan.md', '_Working Memory.md', '_Loop Learnings.md', '_Session Log.md', '_Master Roadmap.md', '_State.json', '_Decisions.jsonl'];

function project() {
	const dir = kitTemp.makeTemp('list-');
	for (const f of FILES) fs.copyFileSync(path.join(KIT, 'project', f), path.join(dir, f));
	return dir;
}
const st = (dir, ...a) => spawnSync(process.execPath, [SCRIPT, ...a], { cwd: dir, encoding: 'utf8', env: { ...process.env, CLAUDE_CODE_SESSION_ID: '' } });
const read = (dir, f) => fs.readFileSync(path.join(dir, f), 'utf8');
const put = (dir, f, t) => fs.writeFileSync(path.join(dir, f), t);
const rows = (dir) => read(dir, '_List.jsonl').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const json = (dir, o) => { put(dir, 'item.json', JSON.stringify(o)); return 'item.json'; };

// A list in the shape the workbench keeps: a roadmap table, then sections of rows in different table shapes.
const LIST = `# Improvement List

## Roadmap

| Build | Release | What it carries | State |
|---|---|---|---|
| 8 | 1.34.0 | State as data | released |
| 9 | 1.35.0 | The list as data | not started |

## A. Found outside

| ID | Item | Source | Severity | Status |
|---|---|---|---|---|
| A1 | The closeout deleted 480 items | a project | high | **[DONE 1.14.0]** fixed and probed |
| A2 | Install misses a hook | a project | medium | **[LATER T5]** open |

## C. Found inside

| ID | Item | Severity | Status |
|---|---|---|---|
| C1 | A guard reads a pipe wrong | low | **[CLOSED]** not real |
| C2 | Recall moves with the folder name | high | **[NEXT build 9 (1.35.0)]** open |
`;

test('import reads every row with its one tag, its section and its other cells, and the roadmap table into the steps', () => {
	const dir = project();
	put(dir, 'list.md', LIST);
	const r = st(dir, 'list', 'import', 'list.md');
	assert.equal(r.status, 0, r.stdout);
	const got = rows(dir);
	assert.deepEqual(got.map((x) => x.id), ['A1', 'A2', 'C1', 'C2']);
	assert.deepEqual(got.map((x) => [x.tag, x.at || '']), [['done', '1.14.0'], ['later', 'T5'], ['closed', ''], ['next', 'build 9 (1.35.0)']]);
	assert.equal(got[0].section, 'A. Found outside');
	assert.equal(got[0].severity, 'high');
	assert.equal(got[0].detail.Source, 'a project');
	assert.equal(got[0].note, 'fixed and probed');
	const s = JSON.parse(read(dir, '_State.json'));
	assert.deepEqual(s.roadmap.map((x) => [x.step, x.release, x.state]), [['8', '1.34.0', 'released'], ['9', '1.35.0', 'not started']]);
	assert.equal(read(dir, 'list.md'), LIST, 'import only reads the markdown');
});

test('import refuses a list it cannot move whole, and writes nothing', () => {
	for (const [bad, why] of [
		[LIST.replace('**[CLOSED]** not real', 'not real'), /C1 has no tag/],
		[LIST.replace('| C2 |', '| A1 |'), /A1 is given twice/],
		[LIST.replace('[CLOSED]', '[PARKED]'), /C1.*PARKED/],
	]) {
		const dir = project();
		put(dir, 'list.md', bad);
		const r = st(dir, 'list', 'import', 'list.md');
		assert.equal(r.status, 1, r.stdout);
		assert.match(r.stdout, why);
		assert.equal(fs.existsSync(path.join(dir, '_List.jsonl')), false);
	}
	const dir = project();
	put(dir, 'list.md', LIST);
	assert.equal(st(dir, 'list', 'import', 'list.md').status, 0);
	const again = st(dir, 'list', 'import', 'list.md');
	assert.equal(again.status, 1, 'a second import would drop what was changed in the data');
	assert.match(again.stdout, /_List\.jsonl already/);
});

// J4: a closed row says who caught it; J3: a number says where it was measured. Imported rows owe both to the
// one-time audit (counted, not failed); a row added or changed since must carry them.
test('check fails a new or changed row that closes with no catcher or holds a number with no measure label', () => {
	const dir = project();
	put(dir, 'list.md', LIST);
	st(dir, 'list', 'import', 'list.md');
	let r = st(dir, 'check');
	assert.equal(r.status, 0, r.stdout);
	assert.match(r.stdout, /note: 2 imported done or closed row\(s\) name no catcher/);
	assert.match(r.stdout, /note: 1 imported row\(s\) hold a number with no measure label/);

	r = st(dir, 'item', 'set', 'A2', 'tag', 'done 1.35.0');
	assert.equal(r.status, 1, 'done with no catcher is refused');
	assert.match(r.stdout, /caught-by/);
	assert.equal(rows(dir)[1].tag, 'later');
	assert.equal(st(dir, 'item', 'set', 'A2', 'caught-by', 'sweep').status, 0);
	assert.equal(st(dir, 'item', 'set', 'A2', 'tag', 'done 1.35.0').status, 0);

	r = st(dir, 'item', 'add', '--from', json(dir, { id: 'K1', title: 'Start load is 64,975 B of 80,000', tag: 'later', at: 'T9', severity: 'medium', origin: 'self' }));
	assert.equal(r.status, 1, 'a number with no label is refused');
	assert.match(r.stdout, /K1 holds a number .* measured/);
	r = st(dir, 'item', 'add', '--from', json(dir, { id: 'K1', title: 'Start load is 64,975 B of 80,000', tag: 'later', at: 'T9', severity: 'medium', origin: 'self', measured: 'throwaway' }));
	assert.equal(r.status, 0, r.stdout);

	// A hand edit that gets round the commands is still caught.
	const lines = read(dir, '_List.jsonl').split('\n');
	const k1 = JSON.parse(lines[4]);
	delete k1.measured;
	lines[4] = JSON.stringify(k1);
	put(dir, '_List.jsonl', lines.join('\n'));
	r = st(dir, 'check');
	assert.equal(r.status, 1);
	assert.match(r.stdout, /K1 holds a number/);
});

test('item add refuses a planted id, an unknown tag, label or catcher, and a second row with the same id', () => {
	const dir = project();
	put(dir, 'list.md', LIST);
	st(dir, 'list', 'import', 'list.md');
	const base = { title: 'x', tag: 'later', at: 'T5', severity: 'low', origin: 'self' };
	for (const [extra, why] of [
		[{ id: 'A1' }, /A1 is given twice/],
		[{ id: 'K2\n<!-- list:end -->' }, /id/],
		[{ id: 'K2', tag: 'parked' }, /tag/],
		[{ id: 'K2', origin: 'rumour' }, /origin/],
		[{ id: 'K2', tag: 'done', at: '1.35.0', caught_by: 'luck' }, /caught/],
		[{ id: 'K2', measured: 'vibes' }, /measured/],
	]) {
		const r = st(dir, 'item', 'add', '--from', json(dir, { ...base, ...extra }));
		assert.equal(r.status, 1, JSON.stringify(extra));
		assert.match(r.stdout, why);
	}
	assert.equal(rows(dir).length, 4);
});

// T11: rows from real projects rank above rows the kit found on itself, at the same severity.
test('list shows the open rows ranked by severity, then real use and the owner before the kit\'s own finds', () => {
	const dir = project();
	put(dir, 'list.md', LIST);
	st(dir, 'list', 'import', 'list.md');
	st(dir, 'item', 'set', 'C2', 'origin', 'self');
	st(dir, 'item', 'add', '--from', json(dir, { id: 'K3', title: 'Install drops a setting', tag: 'later', at: 'T5', severity: 'high', origin: 'real-use' }));
	st(dir, 'item', 'add', '--from', json(dir, { id: 'K4', title: 'Guard wording', tag: 'later', at: 'T9', severity: 'high', origin: 'owner' }));
	const r = st(dir, 'list');
	assert.equal(r.status, 0, r.stdout);
	const ids = r.stdout.split('\n').filter((l) => /^\S+ \[/.test(l)).map((l) => l.split(' ')[0]);
	assert.deepEqual(ids, ['K3', 'K4', 'C2', 'A2']);
	assert.doesNotMatch(r.stdout, /^A1 /m, 'done rows are not in the open list');
	assert.match(st(dir, 'list', 'install').stdout, /^K3 /m, 'a text filter');
});

test('list caught prints the catch rate and found-to-shipped by origin', () => {
	const dir = project();
	put(dir, 'list.md', LIST);
	st(dir, 'list', 'import', 'list.md');
	st(dir, 'item', 'set', 'A1', 'origin', 'real-use');
	st(dir, 'item', 'set', 'A1', 'caught-by', 'real-use');
	st(dir, 'item', 'set', 'A1', 'escaped', 'yes');
	st(dir, 'item', 'set', 'A2', 'origin', 'real-use');
	st(dir, 'item', 'set', 'C1', 'origin', 'self');
	st(dir, 'item', 'set', 'C1', 'caught-by', 'sweep');
	const r = st(dir, 'list', 'caught');
	assert.equal(r.status, 0, r.stdout);
	assert.match(r.stdout, /^Caught by: sweep 1, real-use 1; escaped a gate: 1 of 2/m);
	assert.match(r.stdout, /^Found to shipped by origin: real-use 2 found, 1 done, 0 closed, 1 open; self 1 found, 0 done, 1 closed, 0 open; not set 1 found, 0 done, 0 closed, 1 open/m);
	assert.match(st(dir, 'list', 'audit').stdout, /^C2 /m, 'the audit lists rows still owed a label');
});

test('render writes the roadmap, counts and rows blocks from the data, and check catches a hand edit in one', () => {
	const dir = project();
	put(dir, 'list.md', LIST);
	st(dir, 'list', 'import', 'list.md');
	const plan = ['# Roadmap', '', 'Owner text above.', '', '<!-- list:begin roadmap -->', '<!-- list:end -->', '', '<!-- list:begin counts -->', '<!-- list:end -->', '', '<!-- list:begin rows -->', '<!-- list:end -->', '', 'Owner text below.', ''].join('\n');
	put(dir, '_Master Roadmap.md', plan);
	let r = st(dir, 'check');
	assert.equal(r.status, 1, 'empty blocks differ from the data');
	assert.equal(st(dir, 'render').status, 0);
	r = st(dir, 'check');
	assert.equal(r.status, 0, r.stdout);
	const out = read(dir, '_Master Roadmap.md');
	assert.match(out, /^\| 9 \| 1\.35\.0 \| The list as data \| not started \| 1 \|$/m, 'the open rows placed in each step are counted');
	assert.match(out, /^Total 4 rows: 1 done, 1 closed, 1 next, 1 later\.$/m);
	assert.match(out, /^\| A1 \| The closeout deleted 480 items \| Source: a project \| high \| not set \| \*\*\[DONE 1\.14\.0\]\*\* fixed and probed \|$/m);
	assert.match(out, /^### C\. Found inside$/m);
	assert.match(out, /^Owner text above\.$/m);
	assert.match(out, /^Owner text below\.$/m);

	put(dir, '_Master Roadmap.md', out.replace('| 1.35.0 | The list as data |', '| 1.35.0 | The list as data, typed |'));
	r = st(dir, 'check');
	assert.equal(r.status, 1);
	assert.match(r.stdout, /roadmap/);
	r = st(dir, 'render');
	assert.equal(r.status, 1, 'a hand edit is refused, never wiped silently');
	assert.match(r.stdout, /edited by hand/);
	assert.equal(st(dir, 'step', 'set', '9', 'carries', 'The list as data, typed').status, 0);
	assert.equal(st(dir, 'render', '--overwrite').status, 0);
	assert.equal(st(dir, 'check').status, 0);
});

test('a project with no list is untouched: check and render pass as before', () => {
	const dir = project();
	assert.equal(st(dir, 'render').status, 0);
	const r = st(dir, 'check');
	assert.equal(r.status, 0, r.stdout);
	assert.equal(fs.existsSync(path.join(dir, '_List.jsonl')), false);
	assert.match(st(dir, 'list').stdout, /no _List\.jsonl/);
});
