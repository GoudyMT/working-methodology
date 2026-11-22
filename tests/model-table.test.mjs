// E36 and K341 (build 24): one model table per step. Each step of the kit's work names its model and effort, and the
// role files, script constants and frontmatter the step runs on must agree with it. Model lines were set by hand per
// file, and nothing checked that a never-drop step (checker, gate, scorers) stayed on its model, or that a retry tier
// stayed one rank up. user/kit-tools/model-table.mjs holds those checks; these tests fix what they must say, on fixture
// kits and on the real repo. No test here calls a model.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import kitTemp from '../project/.claude/kit-temp.cjs';
import { rank, tableFaults } from '../user/kit-tools/model-table.mjs';

kitTemp.sessionRoot();

const OPUS = 'claude-opus-5-5';
const SONNET = 'claude-sonnet-5-5';
const HAIKU = 'claude-haiku-5-5';
const MODULE = path.resolve('user/kit-tools/model-table.mjs');
const REAL_DIR = path.resolve('.');

// A role file as the table reads it: name, model and effort in the frontmatter, and a tools line.
const roleFile = (name, model, effort, tools = 'Read, Grep, Glob') =>
	`---\nname: ${name}\nmodel: ${model}\neffort: ${effort}\ntools: ${tools}\n---\n\nRole body.\n`;

// A small kit whose table is sound: two role steps, each matched by its role entry and its role file.
const soundConfig = () => ({
	roles: { builder: { model: SONNET, effort: 'high' }, checker: { model: OPUS, effort: 'high' } },
	steps: {
		builder: { model: SONNET, effort: 'high', enforcer: 'role:builder' },
		checker: { model: OPUS, effort: 'high', enforcer: 'role:checker', floor: OPUS },
	},
});
const soundFiles = () => ({
	'user/agents/builder.md': roleFile('builder', SONNET, 'high'),
	'user/agents/checker.md': roleFile('checker', OPUS, 'high'),
});

// Writes a fixture kit folder: kit.config.json from the config, and each file at its path under the folder.
function kit(config, files = {}) {
	const dir = kitTemp.makeTemp('model-table-');
	write(dir, 'kit.config.json', JSON.stringify(config, null, 2));
	for (const [rel, text] of Object.entries(files)) write(dir, rel, text);
	return dir;
}
function write(dir, rel, text) {
	const file = path.join(dir, rel);
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, text);
}
// The faults of a fixture kit, with its folder written first so file enforcers can read it.
function faultsOf(config, files = soundFiles()) {
	return tableFaults(config, kit(config, files));
}
// Passes when some fault names every given word (a step, a key, a path, a role).
function assertFault(faults, ...words) {
	assert.ok(faults.some((f) => words.every((w) => f.includes(w))), `no fault names ${words.join(' + ')} in ${JSON.stringify(faults)}`);
}
// The frontmatter block of a role file: the lines between its first two --- lines.
function frontmatter(text) {
	const parts = text.split('---');
	return parts[1].split('\n').map((l) => l.trim()).filter(Boolean);
}
// The tokens of a role file's tools line, read from the real file.
function toolsOf(file) {
	const line = frontmatter(fs.readFileSync(path.join(REAL_DIR, 'user/agents', file), 'utf8')).find((l) => l.startsWith('tools:'));
	return line ? line.slice('tools:'.length).split(',').map((s) => s.trim()) : [];
}

// why: guards rule:agent-role-table (the three model families rank 3, 2 and 1 for the floor and stepUp checks)
test('rank orders opus above sonnet above haiku', () => {
	assert.equal(rank(OPUS), 3);
	assert.equal(rank(SONNET), 2);
	assert.equal(rank(HAIKU), 1);
});

// why: catches a mixed-case model id that ranks zero and passes
test('rank ignores case in a model name', () => {
	assert.equal(rank('Claude-OPUS-5-5'), 3);
	assert.equal(rank('CLAUDE-Sonnet-5-5'), 2);
	assert.equal(rank('CLAUDE-HAIKU-5-5'), 1);
});

// why: guards rule:agent-role-table (a step with no model, or an unknown id, never passes as a tier)
test('rank gives zero for an unknown or missing model', () => {
	assert.equal(rank(undefined), 0);
	assert.equal(rank('none'), 0);
	assert.equal(rank('claude-mystery-1'), 0);
});

// why: guards rule:agent-role-table (a sound table with every role matched gives no fault, or every install is blocked)
test('a sound table with every role matched gives no fault', () => {
	assert.deepEqual(faultsOf(soundConfig()), []);
});

// why: catches a step with no effort line that installs silently
test('a step missing its effort is a fault naming the step and the key', () => {
	const config = soundConfig();
	delete config.steps.builder.effort;
	assertFault(faultsOf(config), 'builder', 'effort');
});

// why: catches a step with a blank enforcer that checks nothing
test('a step missing its enforcer is a fault naming the step and the key', () => {
	const config = soundConfig();
	delete config.steps.checker.enforcer;
	assertFault(faultsOf(config), 'checker', 'enforcer');
});

// why: guards rule:agent-role-table (a role step whose model differs from its role entry is a fault that names the step)
test('a role step whose model differs from its role entry is a fault naming the step', () => {
	const config = soundConfig();
	config.steps.builder.model = OPUS;
	assertFault(faultsOf(config), 'builder');
});

// why: guards rule:agent-role-table (a role step whose effort differs from its role entry is a fault that names the step)
test('a role step whose effort differs from its role entry is a fault naming the step', () => {
	const config = soundConfig();
	config.roles.checker.effort = 'medium';
	assertFault(faultsOf(config), 'checker');
});

// why: guards rule:agent-role-table (a role file whose model line drifts from the table is a fault that names the step)
test('a role file whose model line differs from the step is a fault naming the step', () => {
	const files = soundFiles();
	files['user/agents/builder.md'] = roleFile('builder', HAIKU, 'high');
	assertFault(faultsOf(soundConfig(), files), 'builder');
});

// why: guards rule:agent-role-table (a role file whose effort line drifts from the table is a fault that names the step)
test('a role file whose effort line differs from the step is a fault naming the step', () => {
	const files = soundFiles();
	files['user/agents/checker.md'] = roleFile('checker', OPUS, 'medium');
	assertFault(faultsOf(soundConfig(), files), 'checker');
});

// why: catches a step that names a role the config never defines
test('a role step whose role is missing from roles is a fault naming the role', () => {
	const config = soundConfig();
	delete config.roles.builder;
	assertFault(faultsOf(config), 'builder');
});

// why: catches a step with no model line that installs with a blank model
test('a step missing its model is a fault naming the step and the key', () => {
	const config = soundConfig();
	delete config.steps.builder.model;
	assertFault(faultsOf(config), 'builder', 'model');
});

// why: guards rule:agent-role-table (a role step whose role file is gone is a fault naming the step and the path)
test('a role step whose role file is missing is a fault naming the step and the path', () => {
	const files = soundFiles();
	delete files['user/agents/builder.md'];
	assertFault(faultsOf(soundConfig(), files), 'builder', 'user/agents/builder.md');
});

// why: guards rule:agent-role-table (a role entry changed alone is a fault that names the role's step)
test('a role entry whose model changes alone is a fault naming builder', () => {
	const config = soundConfig();
	config.roles.builder.model = HAIKU;
	assertFault(faultsOf(config), 'builder');
});

// why: catches a lookup file deleted while its table row stays, which crashes the check
test('a file step whose target file is missing is a fault naming the step and the path', () => {
	const config = { roles: {}, steps: { lookup: { model: HAIKU, effort: 'medium', enforcer: 'file:project/.claude/agents/Explore.md' } } };
	assertFault(faultsOf(config, {}), 'lookup', 'project/.claude/agents/Explore.md');
});

// why: catches a script file deleted while its const row stays, which crashes the check
test('a const step whose target file is missing is a fault naming the step and the path', () => {
	const config = { roles: {}, steps: { sweep: { model: SONNET, effort: 'high', enforcer: 'const:scripts/approve.mjs#DEFAULT_MODEL' } } };
	assertFault(faultsOf(config, {}), 'sweep', 'scripts/approve.mjs');
});

// why: guards rule:agent-role-table (a lookup file whose model and effort agree with its step raises no fault)
test('a file step whose frontmatter matches the step gives no fault', () => {
	const config = { roles: {}, steps: { lookup: { model: HAIKU, effort: 'medium', enforcer: 'file:project/.claude/agents/Explore.md' } } };
	const files = { 'project/.claude/agents/Explore.md': roleFile('Explore', HAIKU, 'medium') };
	assert.deepEqual(faultsOf(config, files), []);
});

// why: catches a lookup file left on the old model after the table moves
test('a file step whose frontmatter model differs is a fault naming the step and the path', () => {
	const config = { roles: {}, steps: { lookup: { model: HAIKU, effort: 'medium', enforcer: 'file:project/.claude/agents/Explore.md' } } };
	const files = { 'project/.claude/agents/Explore.md': roleFile('Explore', SONNET, 'medium') };
	assertFault(faultsOf(config, files), 'lookup', 'project/.claude/agents/Explore.md');
});

// why: guards rule:agent-role-table (a file step whose effort line differs from the table is a fault naming the path)
test('a file step whose frontmatter effort differs is a fault naming the step and the path', () => {
	const config = { roles: {}, steps: { lookup: { model: HAIKU, effort: 'medium', enforcer: 'file:project/.claude/agents/Explore.md' } } };
	const files = { 'project/.claude/agents/Explore.md': roleFile('Explore', HAIKU, 'high') };
	assertFault(faultsOf(config, files), 'lookup', 'project/.claude/agents/Explore.md');
});

// why: guards rule:agent-role-table (a script constant that holds the table's model raises no fault)
test('a const step whose named constant matches the model gives no fault', () => {
	const config = { roles: {}, steps: { sweep: { model: SONNET, effort: 'high', enforcer: 'const:scripts/approve.mjs#DEFAULT_MODEL' } } };
	const files = { 'scripts/approve.mjs': `const DEFAULT_MODEL = '${SONNET}';\n` };
	assert.deepEqual(faultsOf(config, files), []);
});

// why: catches a sweep constant written as export const that the check misses
test('a const step accepts an exported constant line', () => {
	const config = { roles: {}, steps: { sweep: { model: SONNET, effort: 'high', enforcer: 'const:scripts/approve.mjs#DEFAULT_MODEL' } } };
	const files = { 'scripts/approve.mjs': `export const DEFAULT_MODEL = '${SONNET}';\n` };
	assert.deepEqual(faultsOf(config, files), []);
});

// why: guards rule:agent-role-table (a script constant that drifts from the table is a fault naming the step and the name)
test('a const step whose constant holds another model is a fault naming the step and the name', () => {
	const config = { roles: {}, steps: { sweep: { model: SONNET, effort: 'high', enforcer: 'const:scripts/approve.mjs#DEFAULT_MODEL' } } };
	const files = { 'scripts/approve.mjs': `const DEFAULT_MODEL = '${HAIKU}';\n` };
	assertFault(faultsOf(config, files), 'sweep', 'DEFAULT_MODEL');
});

// why: catches a renamed constant that the table still points at
test('a const step whose named constant is missing is a fault naming the step and the name', () => {
	const config = { roles: {}, steps: { sweep: { model: SONNET, effort: 'high', enforcer: 'const:scripts/approve.mjs#DEFAULT_MODEL' } } };
	const files = { 'scripts/approve.mjs': `const OTHER_NAME = '${SONNET}';\n` };
	assertFault(faultsOf(config, files), 'sweep', 'DEFAULT_MODEL');
});

// why: catches a sweep constant renamed to a near-match that the exact name check reads as absent
test('a const step whose file holds only a near-match name is a fault naming DEFAULT_MODEL', () => {
	const config = { roles: {}, steps: { sweep: { model: HAIKU, effort: 'high', enforcer: 'const:scripts/approve.mjs#DEFAULT_MODEL' } } };
	const files = { 'scripts/approve.mjs': `const DEFAULT_MODEL_OLD = '${HAIKU}';\n` };
	assertFault(faultsOf(config, files), 'sweep', 'DEFAULT_MODEL');
});

// why: guards rule:agent-role-table (steps the check does not read raise no fault from their enforcer alone)
test('settings, lead and script enforcers alone raise no fault', () => {
	const config = {
		roles: {},
		steps: {
			lead: { model: OPUS, effort: 'medium', enforcer: 'lead' },
			gate: { model: OPUS, effort: 'high', enforcer: 'settings' },
			run: { model: 'none', effort: '-', enforcer: 'script:scripts/missing.mjs' },
		},
	};
	assert.deepEqual(faultsOf(config, {}), []);
});

// why: guards rule:agent-role-table (a never-drop step below its floor is a fault that names the step as never-drop)
test('a step below its never-drop floor is a fault naming the step', () => {
	const config = { roles: {}, steps: { checker: { model: SONNET, effort: 'high', enforcer: 'lead', floor: OPUS } } };
	const faults = faultsOf(config, {});
	assertFault(faults, 'never-drop', 'checker');
});

// why: guards rule:agent-role-table (a step on its floor or above it raises no never-drop fault)
test('a step at or above its never-drop floor raises no floor fault', () => {
	const config = {
		roles: {},
		steps: {
			onFloor: { model: OPUS, effort: 'high', enforcer: 'lead', floor: OPUS },
			aboveFloor: { model: OPUS, effort: 'high', enforcer: 'lead', floor: SONNET },
		},
	};
	assert.deepEqual(faultsOf(config, {}), []);
});

// why: catches a script step given a floor it cannot meet
test('a script step given a floor is a fault naming the step', () => {
	const config = { roles: {}, steps: { step6: { model: 'none', effort: '-', enforcer: 'script:scripts/release-verify.mjs', floor: OPUS } } };
	assertFault(faultsOf(config, {}), 'never-drop', 'step6');
});

// why: guards rule:agent-role-table (a retry one tier above the model is the one allowed step up)
test('a stepUp one rank above the model gives no fault', () => {
	const config = { roles: {}, steps: { tester: { model: HAIKU, effort: 'medium', enforcer: 'lead', stepUp: SONNET } } };
	assert.deepEqual(faultsOf(config, {}), []);
});

// why: guards rule:agent-role-table (a retry that jumps two tiers past the table is a fault naming the step)
test('a stepUp two ranks above the model is a fault naming the step', () => {
	const config = { roles: {}, steps: { tester: { model: HAIKU, effort: 'medium', enforcer: 'lead', stepUp: OPUS } } };
	assertFault(faultsOf(config, {}), 'tester');
});

// why: catches a stepUp that retries on no higher model than the first run
test('a stepUp equal to or below the model is a fault naming the step', () => {
	const same = { roles: {}, steps: { tester: { model: HAIKU, effort: 'medium', enforcer: 'lead', stepUp: HAIKU } } };
	const below = { roles: {}, steps: { builder: { model: SONNET, effort: 'high', enforcer: 'lead', stepUp: HAIKU } } };
	assertFault(faultsOf(same, {}), 'tester');
	assertFault(faultsOf(below, {}), 'builder');
});

// why: guards rule:agent-role-table (a role entry that no step runs is a fault that names the role)
test('a role no step names is a fault naming the role', () => {
	const config = soundConfig();
	config.roles.spare = { model: HAIKU, effort: 'low' };
	assertFault(faultsOf(config), 'spare');
	delete config.roles.spare;
	assert.deepEqual(faultsOf(config), []);
});

// why: guards rule:agent-role-table (the real kit's table and its role files agree, or the shipped kit fails its own check)
test('the real kit table gives no fault', () => {
	const config = JSON.parse(fs.readFileSync(path.join(REAL_DIR, 'kit.config.json'), 'utf8'));
	assert.deepEqual(tableFaults(config, REAL_DIR), []);
});

// The real steps table, one entry per step: the values the table must hold, as the spec of this unit names them.
const EXPECTED = {
	lead: { model: OPUS, effort: 'medium', enforcer: 'settings', floor: OPUS },
	orchestrator: { model: OPUS, effort: 'high', enforcer: 'role:orchestrator' },
	tester: { model: HAIKU, effort: 'medium', enforcer: 'role:tester', stepUp: SONNET },
	'test-review': { model: HAIKU, effort: 'low', enforcer: 'role:test-reviewer' },
	builder: { model: HAIKU, effort: 'medium', enforcer: 'role:builder', stepUp: SONNET },
	checker: { model: OPUS, effort: 'high', enforcer: 'role:checker', floor: OPUS },
	'sweep-breadth': { model: SONNET, effort: 'high', enforcer: 'const:user/skills/pre-pr-sweep/approve.mjs#DEFAULT_MODEL', floor: SONNET },
	'sweep-lens': { model: OPUS, effort: 'high', enforcer: 'const:user/skills/pre-pr-sweep/approve.mjs#TOP_DEFAULT', floor: OPUS },
	'recall-gate': { model: OPUS, effort: 'fixed', enforcer: 'const:scripts/recall.mjs#RECALL_MODEL', floor: OPUS },
	'behaviour-gate': { model: OPUS, effort: 'fixed', enforcer: 'const:scripts/recall-behave.mjs#MODEL', floor: OPUS },
	scorers: { model: OPUS, effort: 'medium', enforcer: 'lead', floor: OPUS },
	scanner: { model: HAIKU, effort: 'low', enforcer: 'role:scanner' },
	researcher: { model: HAIKU, effort: 'medium', enforcer: 'role:researcher' },
	lookup: { model: HAIKU, effort: 'medium', enforcer: 'file:project/.claude/agents/Explore.md' },
	drafter: { model: HAIKU, effort: 'high', enforcer: 'role:drafter' },
	writer: { model: HAIKU, effort: 'medium', enforcer: 'role:writer' },
	closeout: { model: OPUS, effort: 'medium', enforcer: 'lead', floor: OPUS },
	step6: { model: 'none', effort: '-', enforcer: 'script:scripts/release-verify.mjs' },
	reviewer: { model: SONNET, effort: 'high', enforcer: 'role:reviewer', floor: SONNET },
};
const shape = (s) => ({ model: s.model, effort: s.effort, enforcer: s.enforcer, floor: s.floor, stepUp: s.stepUp });
const realSteps = () => JSON.parse(fs.readFileSync(path.join(REAL_DIR, 'kit.config.json'), 'utf8')).steps;

// why: guards rule:agent-role-table (a step dropped or renamed silently leaves its model unchecked)
test('the real steps table names the nineteen steps', () => {
	const names = Object.keys(realSteps()).sort();
	assert.equal(names.length, 19);
	assert.deepEqual(names, Object.keys(EXPECTED).sort());
});

// why: guards rule:agent-role-table (a never-drop step moved off its model or floor in the shipped table)
test('each real step carries its table model, effort, enforcer and floor', () => {
	const steps = realSteps();
	const actual = Object.fromEntries(Object.keys(EXPECTED).map((k) => [k, shape(steps[k])]));
	const expected = Object.fromEntries(Object.entries(EXPECTED).map(([k, v]) => [k, shape(v)]));
	assert.deepEqual(actual, expected);
});

// why: catches a script step given a floor it cannot be checked against
test('the step6 entry has no floor key at all', () => {
	assert.equal('floor' in realSteps().step6, false);
});

// why: guards rule:agent-role-table (a role file added or dropped without its table entry breaks the role set)
test('user/agents holds exactly the ten role files', () => {
	const files = fs.readdirSync(path.join(REAL_DIR, 'user/agents')).filter((f) => f.endsWith('.md')).sort();
	assert.deepEqual(files, ['builder.md', 'checker.md', 'drafter.md', 'orchestrator.md', 'researcher.md', 'reviewer.md', 'scanner.md', 'test-reviewer.md', 'tester.md', 'writer.md']);
});

// why: guards rule:agent-role-table (a read-only role that gains Edit or Write could change files it must only read)
test('the read-only role files list only Read, Grep and Glob as tools', () => {
	for (const file of ['researcher.md', 'drafter.md', 'test-reviewer.md']) {
		const text = fs.readFileSync(path.join(REAL_DIR, 'user/agents', file), 'utf8');
		assert.ok(frontmatter(text).includes('tools: Read, Grep, Glob'), `${file} tools line`);
		assert.equal(/\b(Edit|Write)\b/.test(frontmatter(text).join('\n')), false, `${file} frontmatter names Edit or Write`);
	}
});

// why: guards rule:agent-role-table (a writer that can edit, or lacks Write, breaks its own role)
test('writer.md tools include Write and not Edit', () => {
	const tools = toolsOf('writer.md');
	assert.ok(tools.includes('Write'));
	assert.equal(tools.includes('Edit'), false);
});

// why: guards rule:agent-role-table (a tester that cannot edit and write its own tests breaks the test step)
test('tester.md tools include Edit and Write', () => {
	const tools = toolsOf('tester.md');
	assert.ok(tools.includes('Edit'));
	assert.ok(tools.includes('Write'));
});

// why: guards rule:agent-role-table (the check passes a sound table with one line on stdout and nothing on stderr)
test('check exits 0 with one line for a sound kit', () => {
	const dir = kit(soundConfig(), soundFiles());
	const run = spawnSync(process.execPath, [MODULE, 'check', dir], { encoding: 'utf8' });
	assert.equal(run.status, 0, run.stderr);
	assert.equal(run.stderr, '');
	assert.equal(run.stdout.trim().split('\n').length, 1);
});

// why: catches a check that prints its faults in one stderr blob
test('check exits 1 with each fault on its own stderr line', () => {
	const config = soundConfig();
	config.steps.builder.model = OPUS;
	const dir = kit(config, soundFiles());
	const faults = tableFaults(config, dir);
	assert.ok(faults.length >= 2, 'the fixture needs at least two faults');
	const run = spawnSync(process.execPath, [MODULE, 'check', dir], { encoding: 'utf8' });
	assert.equal(run.status, 1);
	assert.deepEqual(run.stderr.split('\n').filter(Boolean), faults);
});

// why: guards rule:agent-role-table (a run from a kit folder checks that kit when no folder is given)
test('check defaults to the current folder when no folder is given', () => {
	const files = soundFiles();
	files['user/agents/builder.md'] = roleFile('builder', HAIKU, 'high');
	const config = soundConfig();
	const dir = kit(config, files);
	const faults = tableFaults(config, dir);
	assert.equal(faults.length, 1, 'the fixture needs exactly one fault');
	const run = spawnSync(process.execPath, [MODULE, 'check'], { cwd: dir, encoding: 'utf8' });
	assert.equal(run.status, 1);
	assert.deepEqual(run.stderr.split('\n').filter(Boolean), faults);
});

// why: catches a missing config read as a clean table
test('check exits 2 when the config cannot be read', () => {
	const dir = kitTemp.makeTemp('model-table-');
	const run = spawnSync(process.execPath, [MODULE, 'check', dir], { encoding: 'utf8' });
	assert.equal(run.status, 2);
});

// why: catches a broken config JSON that passes as a sound table
test('check exits 2 when the config is not valid JSON', () => {
	const dir = kitTemp.makeTemp('model-table-');
	write(dir, 'kit.config.json', '{ "roles": { ');
	const run = spawnSync(process.execPath, [MODULE, 'check', dir], { encoding: 'utf8' });
	assert.equal(run.status, 2);
});
