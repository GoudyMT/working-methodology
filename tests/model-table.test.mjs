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
// Each role's access lists match what soundFiles() writes: the default tools line, no disallowedTools, no skills.
const soundConfig = () => ({
	roles: {
		builder: { model: SONNET, effort: 'high', tools: ['Read', 'Grep', 'Glob'], denied: [], rules: [] },
		checker: { model: OPUS, effort: 'high', tools: ['Read', 'Grep', 'Glob'], denied: [], rules: [] },
	},
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
			run: { model: 'none', effort: '-', enforcer: 'script:scripts/present.mjs' },
		},
	};
	assert.deepEqual(faultsOf(config, { 'scripts/present.mjs': 'export {};\n' }), []);
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
	config.roles.spare = { model: HAIKU, effort: 'low', tools: [], denied: [], rules: [] };
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
	'test-review': { model: SONNET, effort: 'medium', enforcer: 'role:test-reviewer' },
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
	'writer-large': { model: OPUS, effort: 'medium', enforcer: 'script:user/kit-tools/pr-size.mjs' },
};
const shape = (s) => ({ model: s.model, effort: s.effort, enforcer: s.enforcer, floor: s.floor, stepUp: s.stepUp });
const realSteps = () => JSON.parse(fs.readFileSync(path.join(REAL_DIR, 'kit.config.json'), 'utf8')).steps;

// why: guards rule:agent-role-table (a step dropped or renamed silently leaves its model unchecked)
test('the real steps table names the twenty steps', () => {
	const names = Object.keys(realSteps()).sort();
	assert.equal(names.length, 20);
	assert.deepEqual(names, Object.keys(EXPECTED).sort());
});

// why: guards rule:agent-role-table (a never-drop step moved off its model or floor in the shipped table)
test('each real step carries its table model, effort, enforcer and floor', () => {
	const steps = realSteps();
	const actual = Object.fromEntries(Object.keys(EXPECTED).map((k) => [k, shape(steps[k])]));
	const expected = Object.fromEntries(Object.entries(EXPECTED).map(([k, v]) => [k, shape(v)]));
	assert.deepEqual(actual, expected);
});

// why: guards rule:agent-role-table (a script step that carries a floor key is checked against a floor it cannot meet)
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

// Fixture helpers for the checks added below.
const sweepConfig = (model = SONNET) => ({ roles: {}, steps: { sweep: { model, effort: 'high', enforcer: 'const:scripts/approve.mjs#DEFAULT_MODEL' } } });
const roleWith = (name, lines) => `---\nname: ${name}\nmodel: ${SONNET}\neffort: high\n${lines.join('\n')}\n---\n\nRole body.\n`;
const withRole = (role, fields) => {
	const config = soundConfig();
	Object.assign(config.roles[role], fields);
	return config;
};
// The builder's access, set in config.roles and in its role file, against the fixture kit.
// A line-less tools default keeps the sound tools line, so a case that tests denied or rules sees no tools fault.
const builderAccess = (fields, lines) => {
	const withTools = lines.some((l) => l.startsWith('tools:')) ? lines : ['tools: Read, Grep, Glob', ...lines];
	return faultsOf(withRole('builder', fields), { ...soundFiles(), 'user/agents/builder.md': roleWith('builder', withTools) });
};
// Passes when some fault names the role and a word matching the regex (the key, in config or in the file).
function assertFaultLike(faults, role, re) {
	assert.ok(faults.some((f) => f.includes(role) && re.test(f)), `no fault names ${role} + ${re} in ${JSON.stringify(faults)}`);
}

// why: guards rule:agent-role-table (a junction run of the CLI that skips its main block passes as a clean check)
test('the CLI run through a Windows junction exits 2 on a folder with no kit.config.json', { windows: 'also', skip: process.platform !== 'win32' && 'junction is Windows only' }, () => {
	const linkDir = path.join(kitTemp.makeTemp('model-table-link-'), 'link');
	fs.symlinkSync(path.dirname(MODULE), linkDir, 'junction');
	const empty = kitTemp.makeTemp('model-table-empty-');
	const run = spawnSync(process.execPath, [path.join(linkDir, 'model-table.mjs'), 'check', empty], { encoding: 'utf8' });
	assert.equal(run.status, 2, run.stderr);
});

// why: catches a step with no model key that passes with nothing said about the blank model
test('a step with no model key and nothing else wrong is a fault saying model is missing', () => {
	const faults = faultsOf({ roles: {}, steps: { gate: { effort: 'medium', enforcer: 'lead' } } }, {});
	assertFault(faults, 'gate', 'missing', 'model');
});

// why: catches a step with no effort key that passes with nothing said about the blank effort
test('a step with no effort key and nothing else wrong is a fault saying effort is missing', () => {
	const faults = faultsOf({ roles: {}, steps: { gate: { model: OPUS, enforcer: 'lead' } } }, {});
	assertFault(faults, 'gate', 'missing', 'effort');
});

// why: catches an unknown enforcer kind that the check passes as a step it cannot read
test('an unknown enforcer kind is a fault naming the step and the kind', () => {
	const faults = faultsOf({ roles: {}, steps: { gate: { model: OPUS, effort: 'high', enforcer: 'magic:x' } } }, {});
	assertFault(faults, 'gate', 'magic');
});

// why: catches a kit config with no steps object that exits 0 as a sound table
test('the CLI exits 1 and names steps when kit.config.json has no steps object', () => {
	const dir = kit({ roles: {} }, {});
	const run = spawnSync(process.execPath, [MODULE, 'check', dir], { encoding: 'utf8' });
	assert.equal(run.status, 1, run.stderr);
	assert.ok(run.stderr.includes('steps'), run.stderr);
});

// why: catches a role file or const file with CRLF line ends that reads as a mismatch on every value
test('a CRLF role file and a CRLF const file give no fault when the values match', () => {
	const config = { roles: {}, steps: { sweep: { model: SONNET, effort: 'high', enforcer: 'const:scripts/approve.mjs#DEFAULT_MODEL' } } };
	const files = { 'scripts/approve.mjs': `const DEFAULT_MODEL = '${SONNET}';\r\n` };
	assert.deepEqual(faultsOf(config, files), []);
	const roleFiles = { 'user/agents/builder.md': soundFiles()['user/agents/builder.md'].replace(/\n/g, '\r\n'), 'user/agents/checker.md': soundFiles()['user/agents/checker.md'].replace(/\n/g, '\r\n') };
	assert.deepEqual(faultsOf(soundConfig(), roleFiles), []);
});

// why: catches a const step with no name after the hash that the check passes silently
test('a const enforcer with no name after the hash is a fault naming the step', () => {
	const config = { roles: {}, steps: { sweep: { model: SONNET, effort: 'high', enforcer: 'const:scripts/x.mjs' } } };
	const files = { 'scripts/x.mjs': `const DEFAULT_MODEL = '${SONNET}';\n` };
	assertFault(faultsOf(config, files), 'sweep');
});

// why: catches a step written as a bare string that the check reads as a table row
test('a step that is a string and not an object is a fault naming the step', () => {
	const config = { roles: {}, steps: { bad: 'claude-sonnet-5-5' } };
	assertFault(faultsOf(config, {}), 'bad', 'not an object');
});

// why: catches an unknown CLI command that exits 0 and reads as a clean check
test('the CLI exits 2 on an unknown command', () => {
	const run = spawnSync(process.execPath, [MODULE, 'nope'], { encoding: 'utf8' });
	assert.equal(run.status, 2, run.stderr);
});

// why: catches a const check fooled by a commented-out line that holds the table's model
test('a const line inside a block comment does not satisfy a top-level line that holds another model', () => {
	const files = { 'scripts/approve.mjs': `/*\nconst DEFAULT_MODEL = '${SONNET}';\n*/\nconst DEFAULT_MODEL = '${HAIKU}';\n` };
	assertFault(faultsOf(sweepConfig(SONNET), files), 'sweep', 'DEFAULT_MODEL');
});

// why: catches a const check fooled by a line inside a template literal that holds the table's model
test('a const line inside a template literal does not satisfy a top-level line that holds another model', () => {
	const text = 'const HELP = `\nconst DEFAULT_MODEL = \'' + SONNET + '\';\n`;\nconst DEFAULT_MODEL = \'' + HAIKU + '\';\n';
	assertFault(faultsOf(sweepConfig(SONNET), { 'scripts/approve.mjs': text }), 'sweep', 'DEFAULT_MODEL');
});

// why: catches a const named twice at top level that the check reads as one sound definition
test('two top-level definitions of the same constant are a fault naming it', () => {
	const files = { 'scripts/approve.mjs': `const DEFAULT_MODEL = '${SONNET}';\nconst DEFAULT_MODEL = '${SONNET}';\n` };
	assertFault(faultsOf(sweepConfig(SONNET), files), 'sweep', 'DEFAULT_MODEL');
});

// why: catches a role file whose only model line is indented under another key and still reads as the top-level model
test('an indented model line under another key does not count as the frontmatter model', () => {
	const files = soundFiles();
	files['user/agents/builder.md'] = `---\nname: builder\neffort: high\ntools: Read, Grep, Glob\n  model: ${SONNET}\n---\n\nRole body.\n`;
	assertFault(faultsOf(soundConfig(), files), 'builder', 'user/agents/builder.md');
});

// why: catches a role file with two top-level model keys that the check reads as one value
test('a duplicate top-level model key in a role file is a fault naming the file', () => {
	const files = soundFiles();
	files['user/agents/builder.md'] = `---\nname: builder\nmodel: ${SONNET}\nmodel: ${SONNET}\neffort: high\ntools: Read, Grep, Glob\n---\n\nRole body.\n`;
	assertFault(faultsOf(soundConfig(), files), 'user/agents/builder.md', 'model');
});

// why: guards rule:agent-role-table (settings takes no argument, so settings:x is a fault naming the step)
test('a settings enforcer with an argument is a fault naming the step', () => {
	const config = { roles: {}, steps: { gate: { model: OPUS, effort: 'high', enforcer: 'settings:x' } } };
	assertFault(faultsOf(config, {}), 'gate', 'settings');
});

// why: guards rule:agent-role-table (lead takes no argument, so lead:foo is a fault naming the step)
test('a lead enforcer with an argument is a fault naming the step', () => {
	const config = { roles: {}, steps: { gate: { model: OPUS, effort: 'high', enforcer: 'lead:foo' } } };
	assertFault(faultsOf(config, {}), 'gate', 'lead');
});

// why: catches a script step whose named file is gone while its table row stays and passes
test('a script enforcer whose file does not exist is a fault naming the path', () => {
	const config = { roles: {}, steps: { run: { model: 'none', effort: '-', enforcer: 'script:scripts/missing.mjs' } } };
	assertFault(faultsOf(config, {}), 'run', 'scripts/missing.mjs');
});

// why: guards rule:agent-role-table (a script step whose file is present raises no fault from its enforcer)
test('a script enforcer whose file exists gives no fault', () => {
	const config = { roles: {}, steps: { run: { model: 'none', effort: '-', enforcer: 'script:scripts/present.mjs' } } };
	assert.deepEqual(faultsOf(config, { 'scripts/present.mjs': 'export {};\n' }), []);
});

// why: catches a misspelled step key such as Floor that the check ignores and passes as no floor
test('an unknown step key such as Floor is a fault naming the step and the key', () => {
	const config = { roles: {}, steps: { gate: { model: OPUS, effort: 'high', enforcer: 'lead', Floor: OPUS } } };
	assertFault(faultsOf(config, {}), 'gate', 'Floor');
});

// why: guards rule:agent-role-table (a step that uses only the six allowed keys raises no key fault)
test('a step using only the six allowed keys raises no key fault', () => {
	const config = { roles: {}, steps: { tester: { model: HAIKU, effort: 'medium', enforcer: 'lead', floor: HAIKU, stepUp: SONNET, neverDrop: true } } };
	assert.deepEqual(faultsOf(config, {}), []);
});

// why: catches a generation-3 opus that meets a generation-5-5 floor because both rank as opus
test('claude-opus-3 is a fault under a claude-opus-5-5 floor', () => {
	const config = { roles: {}, steps: { gate: { model: 'claude-opus-3', effort: 'high', enforcer: 'lead', floor: OPUS } } };
	assertFault(faultsOf(config, {}), 'gate', 'never-drop');
});

// why: guards rule:agent-role-table (claude-opus-5-5 meets a claude-opus-5-5 floor, so the family and generation check passes it)
test('claude-opus-5-5 meets a claude-opus-5-5 floor', () => {
	const config = { roles: {}, steps: { gate: { model: OPUS, effort: 'high', enforcer: 'lead', floor: OPUS } } };
	assert.deepEqual(faultsOf(config, {}), []);
});

// why: catches a generation read as a whole string so claude-opus-5-4 passes a claude-opus-5-5 floor
test('claude-opus-5-4 is a fault under a claude-opus-5-5 floor', () => {
	const config = { roles: {}, steps: { gate: { model: 'claude-opus-5-4', effort: 'high', enforcer: 'lead', floor: OPUS } } };
	assertFault(faultsOf(config, {}), 'gate', 'never-drop');
});

// why: guards rule:agent-role-table (a never-drop flag on a model step with no floor is a fault naming the step)
test('neverDrop on a model step with no floor is a fault naming the step', () => {
	const config = { roles: {}, steps: { gate: { model: OPUS, effort: 'high', enforcer: 'lead', neverDrop: true } } };
	assertFault(faultsOf(config, {}), 'gate', 'never-drop');
});

// why: guards rule:agent-role-table (neverDrop with a floor on a model step raises no fault)
test('neverDrop on a model step that has a floor gives no fault', () => {
	const config = { roles: {}, steps: { gate: { model: OPUS, effort: 'high', enforcer: 'lead', floor: OPUS, neverDrop: true } } };
	assert.deepEqual(faultsOf(config, {}), []);
});

// why: guards rule:agent-role-table (a script step may carry neverDrop with no floor and raise no fault)
test('neverDrop on a script step with no floor gives no fault', () => {
	const config = { roles: {}, steps: { step6: { model: 'none', effort: '-', enforcer: 'script:scripts/release-verify.mjs', neverDrop: true } } };
	assert.deepEqual(faultsOf(config, { 'scripts/release-verify.mjs': 'export {};\n' }), []);
});

// why: guards rule:agent-role-table (a role file tools line that differs from config.roles tools is a fault naming the role and the key)
test('a role file tools line that differs from config.roles tools is a fault naming the role and the key', () => {
	assertFault(builderAccess({ tools: ['Read', 'Edit', 'Write'] }, ['tools: Read, Grep, Glob']), 'builder', 'tools');
});

// why: guards rule:agent-role-table (a role file tools line that matches config.roles tools raises no fault)
test('a role file tools line that matches config.roles tools gives no fault', () => {
	assert.deepEqual(builderAccess({ tools: ['Read', 'Edit'] }, ['tools: Read, Edit']), []);
});

// why: guards rule:agent-role-table (a denied list with no disallowedTools line in the role file is a fault naming the role)
test('a config denied list with no disallowedTools line is a fault naming the role and the key', () => {
	assertFaultLike(builderAccess({ denied: ['WebFetch', 'Agent'] }, ['tools: Read, Grep, Glob']), 'builder', /denied|disallowed/);
});

// why: guards rule:agent-role-table (a disallowedTools line that matches config.roles denied raises no fault)
test('a disallowedTools line that matches config.roles denied gives no fault', () => {
	assert.deepEqual(builderAccess({ denied: ['WebFetch', 'Agent'] }, ['disallowedTools: WebFetch, Agent']), []);
});

// why: guards rule:agent-role-table (an empty denied list with a disallowedTools line in the role file is a fault naming the role)
test('an empty config denied list with a disallowedTools line is a fault naming the role and the key', () => {
	assertFaultLike(builderAccess({ denied: [] }, ['disallowedTools: Agent']), 'builder', /denied|disallowed/);
});

// why: guards rule:agent-role-table (an empty denied list with no disallowedTools line raises no fault)
test('an empty config denied list with no disallowedTools line gives no fault', () => {
	assert.deepEqual(builderAccess({ denied: [] }, []), []);
});

// why: guards rule:agent-role-table (a non-empty rules list with no skills line in the role file is a fault naming the role)
test('a config rules list with no skills line is a fault naming the role and the key', () => {
	assertFaultLike(builderAccess({ rules: ['edit-discipline'] }, []), 'builder', /rules|skills/);
});

// why: guards rule:agent-role-table (a skills line naming the role's rules skill raises no fault)
test('a config rules list with skills builder-rules gives no fault', () => {
	assert.deepEqual(builderAccess({ rules: ['edit-discipline'] }, ['skills: builder-rules']), []);
});

// why: guards rule:agent-role-table (an empty rules list with a skills line in the role file is a fault naming the role)
test('an empty config rules list with a skills line is a fault naming the role and the key', () => {
	assertFaultLike(builderAccess({ rules: [] }, ['skills: builder-rules']), 'builder', /rules|skills/);
});

// why: guards rule:agent-role-table (an empty rules list with no skills line raises no fault)
test('an empty config rules list with no skills line gives no fault', () => {
	assert.deepEqual(builderAccess({ rules: [] }, []), []);
});

// The access each original role held in the removed markdown role table (rules/agent-teams.md), now in kit.config.json roles.
const TABLE_ROLES = {
	builder: { tools: ['Read', 'Edit', 'Write', 'Grep', 'Glob', 'Bash', 'PowerShell'], denied: ['WebFetch', 'WebSearch', 'Agent'], rules: ['edit-discipline', 'test-integrity', 'test-value'] },
	checker: { tools: ['Read', 'Grep', 'Glob', 'Bash', 'PowerShell'], denied: ['Edit', 'Write', 'WebFetch', 'WebSearch', 'Agent'], rules: ['test-integrity', 'test-value', 'anti-hallucination', 'enumerate-before-you-count'] },
	scanner: { tools: ['Read', 'Grep', 'Glob'], denied: [], rules: [] },
	reviewer: { tools: ['Read', 'Grep', 'Glob', 'Bash', 'PowerShell', 'WebFetch', 'WebSearch'], denied: ['Edit', 'Write', 'Agent'], rules: ['anti-hallucination', 'enumerate-before-you-count'] },
	orchestrator: { tools: ['Agent', 'SendMessage', 'ToolSearch', 'Read', 'Edit', 'Write', 'Grep', 'Glob', 'Bash', 'PowerShell', 'WebSearch', 'WebFetch'], denied: [], rules: [] },
};
// The access the new roles must hold, as this unit's spec names it.
const NEW_ROLES = {
	tester: { tools: ['Read', 'Edit', 'Write', 'Grep', 'Glob', 'Bash', 'PowerShell'], denied: ['WebFetch', 'WebSearch', 'Agent'], rules: ['edit-discipline', 'test-integrity', 'test-value'] },
	'test-reviewer': { tools: ['Read', 'Grep', 'Glob'], denied: [], rules: ['test-integrity', 'test-value'] },
	researcher: { tools: ['Read', 'Grep', 'Glob'], denied: [], rules: ['anti-hallucination', 'enumerate-before-you-count'] },
	drafter: { tools: ['Read', 'Grep', 'Glob'], denied: [], rules: [] },
	writer: { tools: ['Read', 'Grep', 'Glob', 'Write'], denied: [], rules: [] },
};
const realRoles = () => JSON.parse(fs.readFileSync(path.join(REAL_DIR, 'kit.config.json'), 'utf8')).roles;
const accessOf = (role) => ({ tools: role.tools, denied: role.denied, rules: role.rules });

// why: guards rule:agent-role-table (a role in config.roles with no tools, denied or rules list cannot be checked against its file)
test('every real config role carries tools, denied and rules lists, and the real table gives no fault', () => {
	const roles = realRoles();
	const lists = Object.fromEntries(Object.entries(roles).map(([n, r]) => [n, [Array.isArray(r.tools), Array.isArray(r.denied), Array.isArray(r.rules)]]));
	assert.deepEqual(lists, Object.fromEntries(Object.keys(roles).map((n) => [n, [true, true, true]])));
	assert.deepEqual(tableFaults(JSON.parse(fs.readFileSync(path.join(REAL_DIR, 'kit.config.json'), 'utf8')), REAL_DIR), []);
});

// why: guards rule:agent-role-table (an original role's access in kit.config.json drifts from what the removed table held)
test('the five original roles hold the access the removed role table named, now in kit.config.json', () => {
	const roles = realRoles();
	assert.deepEqual(Object.fromEntries(Object.keys(TABLE_ROLES).map((n) => [n, accessOf(roles[n])])), TABLE_ROLES);
});

// why: guards rule:agent-role-table (a new role's access drifts from the spec's tools, denied and rules for it)
test('the new roles hold the access this unit names for tester, test-reviewer, researcher, drafter and writer', () => {
	const roles = realRoles();
	assert.deepEqual(Object.fromEntries(Object.keys(NEW_ROLES).map((n) => [n, accessOf(roles[n])])), NEW_ROLES);
});

// why: guards rule:agent-role-table (a const named only inside a block comment is not a definition the check may read)
test('a const named only inside a block comment is a fault, not a definition', () => {
	const files = { 'scripts/approve.mjs': `/*\nconst DEFAULT_MODEL = '${SONNET}';\n*/\nexport const OTHER = 1;\n` };
	assertFault(faultsOf(sweepConfig(SONNET), files), 'sweep', 'DEFAULT_MODEL');
});

// why: guards rule:agent-role-table (a const named only inside a template literal is not a definition the check may read)
test('a const named only inside a template literal is a fault, not a definition', () => {
	const text = 'const HELP = `\nconst DEFAULT_MODEL = \'' + SONNET + '\';\n`;\nexport const OTHER = 1;\n';
	assertFault(faultsOf(sweepConfig(SONNET), { 'scripts/approve.mjs': text }), 'sweep', 'DEFAULT_MODEL');
});

// why: guards rule:agent-role-table (a correct const with a stale definition inside a block comment passes as the real line)
test('a correct top-level const beside a stale definition inside a block comment gives no fault', () => {
	const files = { 'scripts/approve.mjs': `/*\nconst DEFAULT_MODEL = '${HAIKU}';\n*/\nconst DEFAULT_MODEL = '${SONNET}';\n` };
	assert.deepEqual(faultsOf(sweepConfig(SONNET), files), []);
});

// why: guards rule:agent-role-table (a correct const with a stale definition inside a template literal passes as the real line)
test('a correct top-level const beside a stale definition inside a template literal gives no fault', () => {
	const text = 'const HELP = `\nconst DEFAULT_MODEL = \'' + HAIKU + '\';\n`;\nconst DEFAULT_MODEL = \'' + SONNET + '\';\n';
	assert.deepEqual(faultsOf(sweepConfig(SONNET), { 'scripts/approve.mjs': text }), []);
});

// why: guards rule:agent-role-table (a matching const inside a comment does not hide a real let definition of another model)
test('a matching const inside a block comment beside a real let definition of another model is a fault', () => {
	const files = { 'scripts/approve.mjs': `/*\nconst DEFAULT_MODEL = '${SONNET}';\n*/\nlet DEFAULT_MODEL = '${HAIKU}';\n` };
	assertFault(faultsOf(sweepConfig(SONNET), files), 'sweep', 'DEFAULT_MODEL');
});

// why: guards rule:agent-role-table (a floor naming no known model family is never met, so it is a fault, not a pass)
test('a never-drop floor naming no known family is a fault naming the step', () => {
	const config = { roles: {}, steps: { gate: { model: OPUS, effort: 'high', enforcer: 'lead', floor: 'claude-sonet-5-5' } } };
	assertFault(faultsOf(config, {}), 'gate', 'never-drop');
});

// why: catches a role step whose config role has no tools, denied or rules list, which passes unchecked
test('a role step whose config role has no tools, denied or rules list is a fault naming the role and the missing key', () => {
	const config = soundConfig();
	delete config.roles.builder.tools;
	delete config.roles.builder.denied;
	delete config.roles.builder.rules;
	const faults = faultsOf(config, soundFiles());
	assertFault(faults, 'builder', 'tools');
	assertFault(faults, 'builder', 'denied');
	assertFault(faults, 'builder', 'rules');
});

// why: catches a neverDrop flag that is the string yes rather than true, which the check reads as no flag at all
test('neverDrop given as the string yes is a fault naming the step', () => {
	const config = { roles: {}, steps: { gate: { model: OPUS, effort: 'high', enforcer: 'lead', neverDrop: 'yes' } } };
	assertFault(faultsOf(config, {}), 'gate');
});

// why: guards rule:agent-role-table (a kit config that is JSON null is an unreadable config, so the CLI exits 2)
test('the CLI exits 2 when kit.config.json holds null', () => {
	const dir = kit(null, {});
	const run = spawnSync(process.execPath, [MODULE, 'check', dir], { encoding: 'utf8' });
	assert.equal(run.status, 2, run.stderr);
});

// why: catches a role file with no config.roles entry that widens access with no table row to check it against
test('a role file with no config.roles entry is a fault naming the file', () => {
	const files = { ...soundFiles(), 'user/agents/stray.md': roleFile('stray', SONNET, 'high') };
	assertFault(faultsOf(soundConfig(), files), 'user/agents/stray.md');
});
