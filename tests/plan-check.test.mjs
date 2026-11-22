// U17 (lane B): every build has a written plan file, and plan-check reads it before any unit runs, and reads the saved
// hand-back records against it.
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

// why: catches a Units table with a column missing passing, so a unit's files, runs, risk or tester goes unread.
for (const key of ['Id', 'Files', 'Runs', 'Risk', 'Tester']) {
	test(`P2 spec 1: a Units table without a ${key} column is an error that names the ${key} column`, () => {
		const res = run(planText([unit('U1')], COLS.filter((c) => c.key !== key)));
		assert.equal(res.status, 1, out(res));
		assert.match(out(res), new RegExp(`\\b${key}\\b`));
		assert.match(out(res), /column/i);
	});
}

// why: catches a unit with a blank Files cell passing, so a unit that names no file is built blind.
test('P3 spec 1: a unit row with an empty Files cell is an error that names the unit and Files', () => {
	const res = run(planText([unit('U1', { Files: '' })]));
	assert.equal(res.status, 1, out(res));
	assert.match(out(res), /U1/);
	assert.match(out(res), /Files/);
});

// why: catches a unit with a blank Runs cell passing, so its place among the parallel units is never decided.
test('P4 spec 1: a unit row with an empty Runs cell is an error that names the unit and Runs', () => {
	const res = run(planText([unit('U1', { Runs: '' })]));
	assert.equal(res.status, 1, out(res));
	assert.match(out(res), /U1/);
	assert.match(out(res), /Runs/);
});

// why: catches a Units table with no unit rows passing, so an empty plan starts a build with nothing in it.
test('P5 spec 1: a Units table with zero rows is an error that says no units', () => {
	const res = run(planText([]));
	assert.equal(res.status, 1, out(res));
	assert.match(out(res), /no units/i);
});

// why: catches a clean plan with two units kept apart by order and by running alone failing, which would block every correct plan.
test('P6 spec 1: a plan whose units all hold their cells and keep their files apart is ok', () => {
	const res = run(planText([
		unit('U1', { Files: '`src/a.mjs`', Runs: 'parallel' }),
		unit('U2', { Files: '`src/b.mjs`', Runs: 'parallel' }),
		unit('U3', { Files: '`src/a.mjs`', Runs: 'after U1' }),
	]));
	assert.equal(res.status, 0, out(res));
});

// why: catches two parallel units that share a file passing the plan, so the two builders collide on one file.
test('P7 spec 1: two parallel units that touch the same file are a fault that names both units and the file', () => {
	const res = run(planText([
		unit('U1', { Files: '`src/a.mjs`', Runs: 'parallel' }),
		unit('U2', { Files: '`src/a.mjs`', Runs: 'parallel' }),
	]));
	assert.equal(res.status, 1, out(res));
	assert.match(out(res), /U1 and U2/);
	assert.match(out(res), /src\/a\.mjs/);
});

// why: catches a unit that runs after a unit the plan does not hold passing, so its order points at nothing.
test('P8 spec 1: a unit that runs after an unknown unit is a fault that names it', () => {
	const res = run(planText([unit('U1', { Runs: 'after U9' })]));
	assert.equal(res.status, 1, out(res));
	assert.match(out(res), /U9/);
});

// why: catches a plan path that cannot be read being reported as a plan fault, which hides the real cause from the lead.
test('P9 spec 1: a plan file that cannot be read exits 2', () => {
	assert.ok(fs.existsSync(CHECK), 'user/kit-tools/plan-check.mjs is missing');
	const dir = kitTemp.makeTemp('plan-check-');
	const res = spawnSync(process.execPath, [CHECK, path.join(dir, 'no-such-plan.md')], { cwd: dir, encoding: 'utf8' });
	assert.equal(res.status, 2, out(res));
});

// why: catches the unfilled template passing, which would let a plan with blank Files cells start a build.
test('P10 spec 2: the batch-plan template as written is refused for its blank Files example row', () => {
	const res = run(fs.readFileSync(TEMPLATE, 'utf8'));
	assert.equal(res.status, 1, out(res));
	assert.match(out(res), /Files/);
});

// why: catches the template's own column layout drifting from what plan-check reads, which would refuse every plan built from it.
test('P11 spec 2: the batch-plan template with its example row filled passes plan-check', () => {
	const filled = fs.readFileSync(TEMPLATE, 'utf8').split('\n').map((l) => (l.startsWith('| U1 |')
		? '| U1 | t | `src/a.mjs` | x | x | low | | alone | builder |'
		: l)).join('\n');
	const res = run(filled);
	assert.equal(res.status, 0, out(res));
});

// why: catches SKILL.md never naming plan-check.mjs, so an agent reading the skill never learns the check exists.
test('P12 spec 3: user/skills/agent-team-build/SKILL.md names plan-check.mjs', () => {
	assert.match(fs.readFileSync(SKILL, 'utf8'), /plan-check\.mjs/);
});

// why: catches SKILL.md dropping the rule that every build has a written plan every agent reads, so agents build from memory.
test('P13 spec 3: SKILL.md has one paragraph that says every build has a written plan file every agent reads', () => {
	const paragraphs = fs.readFileSync(SKILL, 'utf8').split(/\r?\n\s*\r?\n/);
	const hit = paragraphs.some((p) => /every build/i.test(p) && /plan file/i.test(p) && /every agent/i.test(p) && /\bread/i.test(p));
	assert.ok(hit, 'no paragraph says every build has a written plan file every agent reads');
});

// The records part (lead rulings): each record file is a whole hand-back, prose then RECORD: then JSONL. A record names
// its unit only by unit on its role line, compared exactly after trimming. A record with no unit is skipped with a
// warning line, not an error. An empty records folder passes; an unreadable one exits 2.
const RECORD_FIELDS = { id: 'K1', severity: 'low', status: 'red', where: '-', claim: 'c', proof: 'p', fix: '-' };
const handBack = (role, unit, clarity, extra = {}) => {
	const roleLine = { role, commit: '158ec54' };
	if (unit !== undefined) roleLine.unit = unit;
	if (clarity !== undefined) roleLine.clarity = clarity;
	return ['Prose the hand-back holds.', 'RECORD:', JSON.stringify(roleLine), JSON.stringify({ ...RECORD_FIELDS, ...extra })].join('\n');
};
// Runs plan-check with --records on a folder of .jsonl hand-backs, each written under its name. `folder` overrides the path.
const runWithRecords = (text, records, folder) => {
	assert.ok(fs.existsSync(CHECK), 'user/kit-tools/plan-check.mjs is missing');
	const dir = kitTemp.makeTemp('plan-check-rec-');
	spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
	const file = path.join(dir, 'plan.md');
	fs.writeFileSync(file, text);
	const recDir = folder ?? path.join(dir, 'records');
	if (folder === undefined) {
		fs.mkdirSync(recDir);
		for (const [name, body] of Object.entries(records)) fs.writeFileSync(path.join(recDir, name), body);
	}
	return spawnSync(process.execPath, [CHECK, file, '--records', recDir], { cwd: dir, encoding: 'utf8' });
};

// why: catches a builder hand-back naming a unit the plan does not hold passing, so work outside the plan goes unseen.
test('R1 spec 1: a builder record naming a unit the plan does not hold is an error that names that unit', () => {
	const res = runWithRecords(planText([unit('U1')]), { 'rec1.jsonl': handBack('builder', 'U9') });
	assert.equal(res.status, 1, out(res));
	assert.match(out(res), /U9/);
});

// why: catches a tester hand-back naming a unit the plan does not hold passing, so a review of a missing unit goes unseen.
test('R2 spec 1: a tester record naming a unit the plan does not hold is an error that names that unit', () => {
	const res = runWithRecords(planText([unit('U1')]), { 'rec1.jsonl': handBack('tester', 'U9', 'clear') });
	assert.equal(res.status, 1, out(res));
	assert.match(out(res), /U9/);
});

// why: catches a checker hand-back naming a unit the plan does not hold passing, so a check of a missing unit goes unseen.
test('R3 spec 1: a checker record naming a unit the plan does not hold is an error that names that unit', () => {
	const res = runWithRecords(planText([unit('U1')]), { 'rec1.jsonl': handBack('checker', 'U9') });
	assert.equal(res.status, 1, out(res));
	assert.match(out(res), /U9/);
});

// why: catches a test-reviewer hand-back naming a unit the plan does not hold passing, so a review of a missing unit goes unseen.
test('R4 spec 1: a test-reviewer record naming a unit the plan does not hold is an error that names that unit', () => {
	const res = runWithRecords(planText([unit('U1')]), { 'rec1.jsonl': handBack('test-reviewer', 'U9', 'clear', { status: 'open' }) });
	assert.equal(res.status, 1, out(res));
	assert.match(out(res), /U9/);
});

// why: catches a builder that built U1 with no tester record for U1 passing, so an unreviewed unit ships untested.
test('R5 spec 1: a builder record for a unit with no tester record is an error that names the unit and the tester', () => {
	const res = runWithRecords(planText([unit('U1')]), { 'rec1.jsonl': handBack('builder', 'U1') });
	assert.equal(res.status, 1, out(res));
	assert.match(out(res), /U1/);
	assert.match(out(res), /tester/i);
});

// why: catches a complete set of builder and tester records for every unit being refused, which would block every good build.
test('R6 spec 1: a builder and a tester record for each unit in the plan is ok', () => {
	const res = runWithRecords(planText([unit('U1'), unit('U2')]), {
		'rec1.jsonl': handBack('builder', 'U1'),
		'rec2.jsonl': handBack('tester', 'U1', 'clear'),
		'rec3.jsonl': handBack('builder', 'U2'),
		'rec4.jsonl': handBack('tester', 'U2', 'clear'),
	});
	assert.equal(res.status, 0, out(res));
});

// why: catches a tester record alone for a unit being refused, when the rule only asks for a tester where a builder built it.
test('R7 spec 1: a tester record alone for U1 is ok', () => {
	const res = runWithRecords(planText([unit('U1')]), { 'rec1.jsonl': handBack('tester', 'U1', 'clear') });
	assert.equal(res.status, 0, out(res));
});

// why: catches two builders for one unit with one tester refused, which is a valid build with a rebuilt unit.
test('R8 spec 1: two builder records and one tester record for U1 are ok', () => {
	const res = runWithRecords(planText([unit('U1')]), {
		'rec1.jsonl': handBack('builder', 'U1'),
		'rec2.jsonl': handBack('builder', 'U1'),
		'rec3.jsonl': handBack('tester', 'U1', 'clear'),
	});
	assert.equal(res.status, 0, out(res));
});

// why: catches a unit id compared case-insensitively, which would let u1 pass as U1 and hide a record that names no unit in the plan.
test('R9 spec 1: a builder record naming u1 when the plan holds U1 is an error that names u1', () => {
	const res = runWithRecords(planText([unit('U1')]), { 'rec1.jsonl': handBack('builder', 'u1') });
	assert.equal(res.status, 1, out(res));
	assert.match(out(res), /u1/);
});

// why: catches a unit id with spaces around it being refused, when the rule trims the id before it compares.
test('R10 spec 1: a tester record whose unit has spaces around the id is ok when the id matches after trimming', () => {
	const res = runWithRecords(planText([unit('U1')]), { 'rec1.jsonl': handBack('tester', ' U1 ', 'clear') });
	assert.equal(res.status, 0, out(res));
});

// why: catches a hand-back with no unit on its role line being refused as a fault, when the lead ruled it is skipped.
test('R11 spec 1: a builder record with no unit is skipped with a warning line that names the file, and exits 0', () => {
	const res = runWithRecords(planText([unit('U1')]), { 'builder-u9.jsonl': handBack('builder', undefined) });
	assert.equal(res.status, 0, out(res));
	assert.match(out(res), /record without unit: builder-u9\.jsonl/);
});

// why: catches a file name that spells a unit being trusted over its role line, which would bind a record to the wrong unit.
test('R12 spec 1: a file named u9 whose tester role line says U1 is read as U1 and is ok', () => {
	const res = runWithRecords(planText([unit('U1')]), { 'u9.jsonl': handBack('tester', 'U1', 'clear') });
	assert.equal(res.status, 0, out(res));
});

// why: catches a unit named only in a finding line or in prose being read as the record's unit, which binds it to a unit the role line never named.
test('R13 spec 1: a record whose role line has no unit, but whose finding holds unit U9 and prose says U9, is skipped and exits 0', () => {
	const body = ['Prose that says Unit: U9 for this hand-back.', 'RECORD:', JSON.stringify({ role: 'builder', commit: '158ec54' }), JSON.stringify({ ...RECORD_FIELDS, unit: 'U9' })].join('\n');
	const res = runWithRecords(planText([unit('U1')]), { 'rec1.jsonl': body });
	assert.equal(res.status, 0, out(res));
	assert.match(out(res), /record without unit: rec1\.jsonl/);
});

// why: catches an empty records folder being refused, when a build with no records yet has nothing to check against.
test('R14 spec 1: an empty --records folder exits 0', () => {
	const res = runWithRecords(planText([unit('U1')]), {});
	assert.equal(res.status, 0, out(res));
});

// why: catches a records folder that cannot be read passing silently, which would show a clean check over records it never read.
test('R15 spec 1: an unreadable --records folder exits 2', () => {
	const dir = kitTemp.makeTemp('plan-check-rec-');
	const res = runWithRecords(planText([unit('U1')]), {}, path.join(dir, 'no-such-folder'));
	assert.equal(res.status, 2, out(res));
});
