// U17 (lane B): every build has a written plan file, and plan-check reads it before any unit runs. The records part of
// the spec (--records) is not tested here: the spec does not say how a record file names its unit, so it waits for the lead.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import kitTemp from '../project/.claude/kit-temp.cjs';

kitTemp.sessionRoot();
const CHECK = fileURLToPath(new URL('../user/kit-tools/plan-check.mjs', import.meta.url));
const TEMPLATE = fileURLToPath(new URL('../user/skills/agent-team-build/templates/batch-plan.md', import.meta.url));
const SKILL = fileURLToPath(new URL('../user/skills/agent-team-build/SKILL.md', import.meta.url));

// The template's Units columns, in its order. `key` names the cell in a test; `head` is the header the template writes.
const COLS = [
	{ key: 'Id', head: 'Id' },
	{ key: 'Title', head: 'Title' },
	{ key: 'Files', head: 'Files (exact; mark new files)' },
	{ key: 'Tests', head: 'Tests to write first, and the failure each must show' },
	{ key: 'Done', head: 'Done when' },
	{ key: 'Risk', head: 'Risk' },
	{ key: 'Tester', head: 'Tester' },
	{ key: 'Runs', head: 'Runs' },
	{ key: 'Built', head: 'Built by' },
];
const DEFAULTS = { Title: 't', Files: '`src/a.mjs`', Tests: 'x', Done: 'x', Risk: 'low', Tester: '', Runs: 'alone', Built: 'builder' };
const unit = (id, over = {}) => ({ Id: id, ...DEFAULTS, ...over });
// Builds a Units table from the given columns and rows; the separator row matches the header's width.
const planText = (rows, cols = COLS) => {
	const head = `| ${cols.map((c) => c.head).join(' | ')} |`;
	const sep = `|${cols.map(() => '---').join('|')}|`;
	const body = rows.map((r) => `| ${cols.map((c) => r[c.key]).join(' | ')} |`);
	return ['# Batch plan - x', '', '## Units', '', head, sep, ...body, '', '## Collision list', ''].join('\n');
};
// Runs plan-check on a plan text written to a temp git repo. A missing script fails here, with its name, not as a crash.
const run = (text) => {
	assert.ok(fs.existsSync(CHECK), 'user/kit-tools/plan-check.mjs is missing');
	const dir = kitTemp.makeTemp('plan-check-');
	spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
	const file = path.join(dir, 'plan.md');
	fs.writeFileSync(file, text);
	return spawnSync(process.execPath, [CHECK, file], { cwd: dir, encoding: 'utf8' });
};
const out = (res) => res.stdout + res.stderr;

// why: catches a plan with no Units table passing, so a build starts with no written list of units to check.
test('P1 spec 1: a plan with no Units table is an error that names the Units table', () => {
	const res = run('# Batch plan - x\n\n## Collision list\n');
	assert.equal(res.status, 1, out(res));
	assert.match(out(res), /Units/);
});

// why: catches a Units table missing its Id column passing, so no unit can be named in a fault.
// why: catches a Units table missing its Files column passing, so no unit's files can be checked against the others.
// why: catches a Units table missing its Runs column passing, so the parallel order cannot be read at all.
// why: catches a Units table missing its Risk column passing, so the tester model has no risk to read.
// why: catches a Units table missing its Tester column passing, so a unit has no named tester.
for (const key of ['Id', 'Files', 'Runs', 'Risk', 'Tester']) {
	test(`P2 spec 1: a Units table without a ${key} column is an error that names ${key}`, () => {
		const res = run(planText([unit('U1')], COLS.filter((c) => c.key !== key)));
		assert.equal(res.status, 1, out(res));
		assert.match(out(res), new RegExp(key));
	});
}

// why: catches a unit with an empty Files cell passing, so a unit that names no file is built blind.
test('P3 spec 1: a unit row with an empty Files cell is an error that names the unit and Files', () => {
	const res = run(planText([unit('U1', { Files: '' })]));
	assert.equal(res.status, 1, out(res));
	assert.match(out(res), /U1/);
	assert.match(out(res), /Files/);
});

// why: catches a unit with an empty Runs cell passing, so its place among the parallel units is never decided.
test('P4 spec 1: a unit row with an empty Runs cell is an error that names the unit and Runs', () => {
	const res = run(planText([unit('U1', { Runs: '' })]));
	assert.equal(res.status, 1, out(res));
	assert.match(out(res), /U1/);
	assert.match(out(res), /Runs/);
});

// why: catches a clean plan with two units kept apart by order and by running alone failing, which would block every correct plan.
test('P5 spec 1: a plan whose units all hold their cells and keep their files apart is ok', () => {
	const res = run(planText([
		unit('U1', { Files: '`src/a.mjs`', Runs: 'parallel' }),
		unit('U2', { Files: '`src/b.mjs`', Runs: 'parallel' }),
		unit('U3', { Files: '`src/a.mjs`', Runs: 'after U1' }),
	]));
	assert.equal(res.status, 0, out(res));
});

// why: catches two parallel units that share a file passing the plan, so the two builders collide on one file.
test('P6 spec 1: two parallel units that touch the same file are a fault that names both units and the file', () => {
	const res = run(planText([
		unit('U1', { Files: '`src/a.mjs`', Runs: 'parallel' }),
		unit('U2', { Files: '`src/a.mjs`', Runs: 'parallel' }),
	]));
	assert.equal(res.status, 1, out(res));
	assert.match(out(res), /U1 and U2/);
	assert.match(out(res), /src\/a\.mjs/);
});

// why: catches a unit that runs after a unit the plan does not hold passing, so its order points at nothing.
test('P7 spec 1: a unit that runs after an unknown unit is a fault that names it', () => {
	const res = run(planText([unit('U1', { Runs: 'after U9' })]));
	assert.equal(res.status, 1, out(res));
	assert.match(out(res), /U9/);
});

// why: catches a plan path that cannot be read being reported as a plan fault, which hides the real cause from the lead.
test('P8 spec 1: a plan file that cannot be read exits 2', () => {
	assert.ok(fs.existsSync(CHECK), 'user/kit-tools/plan-check.mjs is missing');
	const dir = kitTemp.makeTemp('plan-check-');
	const res = spawnSync(process.execPath, [CHECK, path.join(dir, 'no-such-plan.md')], { cwd: dir, encoding: 'utf8' });
	assert.equal(res.status, 2, out(res));
});

// why: catches the unfilled template passing, which would let a plan with blank Files and Runs cells start a build.
test('P9 spec 2: the batch-plan template as written is refused for its blank Files and Runs example row', () => {
	const res = run(fs.readFileSync(TEMPLATE, 'utf8'));
	assert.equal(res.status, 1, out(res));
	assert.match(out(res), /U1/);
});

// why: catches the template's own column layout drifting from what plan-check reads, which would refuse every plan built from it.
test('P10 spec 2: the batch-plan template with its example row filled passes plan-check', () => {
	const filled = fs.readFileSync(TEMPLATE, 'utf8').split('\n').map((l) => (l.startsWith('| U1 |')
		? '| U1 | t | `src/a.mjs` | x | x | low | | alone | builder |'
		: l)).join('\n');
	const res = run(filled);
	assert.equal(res.status, 0, out(res));
});

// why: catches SKILL.md never naming plan-check.mjs, so an agent reading the skill never learns the check exists.
test('P11 spec 3: user/skills/agent-team-build/SKILL.md names plan-check.mjs', () => {
	assert.match(fs.readFileSync(SKILL, 'utf8'), /plan-check\.mjs/);
});

// why: catches SKILL.md dropping the rule that every build has a written plan every agent reads, so agents build from memory.
test('P12 spec 3: SKILL.md has one paragraph that says every build has a written plan file every agent reads', () => {
	const paragraphs = fs.readFileSync(SKILL, 'utf8').split(/\r?\n\s*\r?\n/);
	const hit = paragraphs.some((p) => /every build/i.test(p) && /plan file/i.test(p) && /every agent/i.test(p) && /\bread/i.test(p));
	assert.ok(hit, 'no paragraph says every build has a written plan file every agent reads');
});

// The records part (lead ruling): each record file is a whole hand-back, prose then RECORD: then JSONL. A record names
// its unit only by unit on its role line; a record with no unit is skipped, not an error.
const RECORD_FIELDS = { id: 'K1', severity: 'low', status: 'red', where: '-', claim: 'c', proof: 'p', fix: '-' };
const handBack = (role, unit, clarity) => {
	const roleLine = { role, commit: '158ec54' };
	if (unit !== undefined) roleLine.unit = unit;
	if (clarity !== undefined) roleLine.clarity = clarity;
	return ['Prose the hand-back holds.', 'RECORD:', JSON.stringify(roleLine), JSON.stringify(RECORD_FIELDS)].join('\n');
};
// Runs plan-check with --records on a folder of .jsonl hand-backs, each written under its name.
const runWithRecords = (text, records) => {
	assert.ok(fs.existsSync(CHECK), 'user/kit-tools/plan-check.mjs is missing');
	const dir = kitTemp.makeTemp('plan-check-rec-');
	spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
	const file = path.join(dir, 'plan.md');
	fs.writeFileSync(file, text);
	const recDir = path.join(dir, 'records');
	fs.mkdirSync(recDir);
	for (const [name, body] of Object.entries(records)) fs.writeFileSync(path.join(recDir, name), body);
	return spawnSync(process.execPath, [CHECK, file, '--records', recDir], { cwd: dir, encoding: 'utf8' });
};

// why: catches a builder hand-back naming a unit the plan does not hold passing, so work outside the plan goes unseen.
test('R1 spec 1: a builder record naming a unit the plan does not hold is an error that names that unit', () => {
	const res = runWithRecords(planText([unit('U1')]), { 'builder-u9.jsonl': handBack('builder', 'U9') });
	assert.equal(res.status, 1, out(res));
	assert.match(out(res), /U9/);
});

// why: catches a tester hand-back naming a unit the plan does not hold passing, so a review of a missing unit goes unseen.
test('R2 spec 1: a tester record naming a unit the plan does not hold is an error that names that unit', () => {
	const res = runWithRecords(planText([unit('U1')]), { 'tester-u9.jsonl': handBack('tester', 'U9', 'clear') });
	assert.equal(res.status, 1, out(res));
	assert.match(out(res), /U9/);
});

// why: catches a builder that built U1 with no tester record for U1 passing, so an unreviewed unit ships untested.
test('R3 spec 1: a builder record for a unit with no tester record is an error that names the unit and the tester', () => {
	const res = runWithRecords(planText([unit('U1')]), { 'builder-u1.jsonl': handBack('builder', 'U1') });
	assert.equal(res.status, 1, out(res));
	assert.match(out(res), /U1/);
	assert.match(out(res), /tester/i);
});

// why: catches a complete set of builder and tester records for every unit being refused, which would block every good build.
test('R4 spec 1: a builder and a tester record for each unit in the plan is ok', () => {
	const res = runWithRecords(planText([unit('U1'), unit('U2')]), {
		'builder-u1.jsonl': handBack('builder', 'U1'),
		'tester-u1.jsonl': handBack('tester', 'U1', 'clear'),
		'builder-u2.jsonl': handBack('builder', 'U2'),
		'tester-u2.jsonl': handBack('tester', 'U2', 'clear'),
	});
	assert.equal(res.status, 0, out(res));
});

// why: catches a hand-back with no unit on its role line being refused as a fault, when the lead ruled it is skipped.
test('R5 spec 1: a builder record with no unit on its role line is skipped, not an error', () => {
	const res = runWithRecords(planText([unit('U1')]), { 'builder-anon.jsonl': handBack('builder', undefined) });
	assert.equal(res.status, 0, out(res));
});
