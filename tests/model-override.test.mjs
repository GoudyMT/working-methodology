// K341 (build 24, unit U8): a project may override a step's model in .kit/models.json. An override may raise or lower a
// row, except that one naming a model below the step's floor, or changing a never-drop step, is refused. Install refuses
// it (naming the step and writing nothing new), and the installed .claude/model-override.mjs is the same check a
// project's CI runs. Each test drives a fixture kit in temp folders; the kit's CLI runs as a child process with HOME,
// USERPROFILE and the Claude folder pointed at temp dirs, so no run touches this repo or the owner's home.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import kitTemp from '../project/.claude/kit-temp.cjs';
import { copyKitCli, makeKit, makeTemp } from './kit-helpers.mjs';

kitTemp.sessionRoot();

const REAL_CONFIG = JSON.parse(fs.readFileSync(path.resolve('kit.config.json'), 'utf8'));

// A file the kit ships, copied in when this build has it. A missing one leaves the fixture without it, so only the tests
// that need it fail, on their own assertions.
const copyIfThere = (kit, rel) => {
	const src = path.resolve(rel);
	if (!fs.existsSync(src)) return;
	fs.mkdirSync(path.dirname(path.join(kit, rel)), { recursive: true });
	fs.copyFileSync(src, path.join(kit, rel));
};

// A kit with the real step table (so the floors and the never-drop row are the shipped ones), the CLI, the model table
// module the install reads, and the project override check. Unreleased: the fixture has no git history.
function tableKit() {
	const ctx = makeKit();
	fs.writeFileSync(path.join(ctx.kit, 'kit.config.json'), JSON.stringify({ ownerName: 'Pat', steps: REAL_CONFIG.steps, roles: REAL_CONFIG.roles }));
	copyKitCli(ctx.kit);
	copyIfThere(ctx.kit, 'user/kit-tools/model-table.mjs');
	copyIfThere(ctx.kit, 'project/.claude/model-override.mjs');
	const fakeHome = makeTemp('mo-home-');
	const env = { ...process.env, HOME: fakeHome, USERPROFILE: fakeHome, CLAUDE_CONFIG_DIR: ctx.home, KIT_CLAUDE_HOME: ctx.home };
	delete env.CLAUDE_CODE_REMOTE;
	return { ...ctx, env };
}

const installProject = (ctx) =>
	spawnSync(process.execPath, [path.join(ctx.kit, 'scripts/kit.mjs'), 'install', 'project', ctx.proj, '--unreleased'], { encoding: 'utf8', env: ctx.env });

// Writes .kit/models.json in the project; a string goes in as written (for a malformed file), anything else as JSON.
const writeOverride = (proj, body) => {
	fs.mkdirSync(path.join(proj, '.kit'), { recursive: true });
	fs.writeFileSync(path.join(proj, '.kit', 'models.json'), typeof body === 'string' ? body : JSON.stringify(body));
};

const runCheck = (proj) =>
	spawnSync(process.execPath, ['.claude/model-override.mjs', 'check'], { cwd: proj, encoding: 'utf8' });

// Every entry under a folder, directories included, sorted: a refused install must leave this list as it was.
const entries = (dir) => fs.readdirSync(dir, { recursive: true }).sort();

// why: guards rule:agent-role-table (a project override lowering the checker below its opus floor installs anyway)
test('install project refuses an override that names a model below a floor, naming the step and writing nothing', () => {
	const ctx = tableKit();
	writeOverride(ctx.proj, { steps: { checker: { model: 'claude-haiku-5-5' } } });
	const before = entries(ctx.proj);
	const r = installProject(ctx);
	assert.notEqual(r.status, 0, 'a refused override exited 0');
	assert.match(r.stderr + r.stdout, /checker/, 'the refusal does not name the step');
	assert.deepEqual(entries(ctx.proj), before, 'a refused install wrote into the project');
	// An override equal to the checker floor is accepted, so a project can pin a row at its floor.
	const equal = tableKit();
	writeOverride(equal.proj, { steps: { checker: { model: 'claude-opus-5-5' } } });
	const e = installProject(equal);
	assert.equal(e.status, 0, `an equal-to-floor override was refused: ${e.stderr}`);
});

// why: guards rule:agent-role-table (an older generation of the floor's own family slips under the floor unnoticed)
test('install project refuses an override naming an older generation of the floor family', () => {
	const ctx = tableKit();
	writeOverride(ctx.proj, { steps: { checker: { model: 'claude-opus-5-4' } } });
	const before = entries(ctx.proj);
	const r = installProject(ctx);
	assert.notEqual(r.status, 0, 'an older opus under the opus-5-5 floor installed');
	assert.match(r.stderr + r.stdout, /checker/, 'the refusal does not name the step');
	assert.deepEqual(entries(ctx.proj), before, 'a refused install wrote into the project');
	// A newer generation of the floor family is accepted, so an upgrade is not blocked as a lowering.
	const newer = tableKit();
	writeOverride(newer.proj, { steps: { checker: { model: 'claude-opus-6-0' } } });
	const n = installProject(newer);
	assert.equal(n.status, 0, `a newer-generation override was refused: ${n.stderr}`);
});

// why: guards rule:agent-role-table (a sonnet floor on sweep-breadth is lowered to haiku by a project and installed)
test('install project refuses a haiku override on the sonnet-floored sweep-breadth step, naming it', () => {
	const ctx = tableKit();
	writeOverride(ctx.proj, { steps: { 'sweep-breadth': { model: 'claude-haiku-5-5' } } });
	const before = entries(ctx.proj);
	const r = installProject(ctx);
	assert.notEqual(r.status, 0, 'a haiku override under the sonnet floor installed');
	assert.match(r.stderr + r.stdout, /sweep-breadth/, 'the refusal does not name the step');
	assert.deepEqual(entries(ctx.proj), before, 'a refused install wrote into the project');
});

// why: catches a never-drop step (step6) changed by a project override and installed without a word
test('install project refuses any change to the never-drop step, naming it', () => {
	const ctx = tableKit();
	writeOverride(ctx.proj, { steps: { step6: { model: 'claude-haiku-5-5' } } });
	const before = entries(ctx.proj);
	const r = installProject(ctx);
	assert.notEqual(r.status, 0, 'a change to the never-drop step installed');
	assert.match(r.stderr + r.stdout, /step6/, 'the refusal does not name the step');
	assert.deepEqual(entries(ctx.proj), before, 'a refused install wrote into the project');
});

// why: catches a raise of the never-drop step (step6) accepted because only lowering was checked, so the row moves
test('install project refuses a raise of the never-drop step, and the installed check exits 1 naming it', () => {
	const ctx = tableKit();
	writeOverride(ctx.proj, { steps: { step6: { model: 'claude-opus-5-5' } } });
	const before = entries(ctx.proj);
	const r = installProject(ctx);
	assert.notEqual(r.status, 0, 'a raise of the never-drop step installed');
	assert.match(r.stderr + r.stdout, /step6/, 'the refusal does not name the step');
	assert.deepEqual(entries(ctx.proj), before, 'a refused install wrote into the project');
	// The check is the same rule: a clean install, then the override put back, must fail the check naming the step.
	fs.rmSync(path.join(ctx.proj, '.kit', 'models.json'));
	assert.equal(installProject(ctx).status, 0, 'the clean install failed');
	writeOverride(ctx.proj, { steps: { step6: { model: 'claude-opus-5-5' } } });
	const c = runCheck(ctx.proj);
	assert.equal(c.status, 1, `exit ${c.status}: ${c.stderr}`);
	assert.match(c.stderr + c.stdout, /step6/, 'the check does not name the step');
});

// why: catches a raise of a floor row refused as a lowering, so a project cannot raise a row it was meant to keep
test('install project accepts a raise above a floor and installs the project copy of the check', () => {
	const ctx = tableKit();
	writeOverride(ctx.proj, { steps: { 'sweep-breadth': { model: 'claude-opus-5-5' } } });
	const r = installProject(ctx);
	assert.equal(r.status, 0, `a raise was refused: ${r.stderr}`);
	assert.ok(fs.existsSync(path.join(ctx.proj, '.claude', 'model-override.mjs')), 'the project has no .claude/model-override.mjs');
});

// why: guards rule:agent-role-table (an override on a step with no floor is refused, so a project cannot change a row freely)
test('install project accepts a change to a step with no floor, and the installed check passes it', () => {
	const ctx = tableKit();
	writeOverride(ctx.proj, { steps: { writer: { model: 'claude-opus-5-5' } } });
	const r = installProject(ctx);
	assert.equal(r.status, 0, `a change to a floorless step was refused: ${r.stderr}`);
	const c = runCheck(ctx.proj);
	assert.equal(c.status, 0, `exit ${c.status}: ${c.stderr}`);
	assert.ok(c.stdout.trim().length > 0, 'the check printed nothing');
});

// why: catches a malformed override read as no override, so every row silently takes its default model
test('install project refuses a malformed .kit/models.json, naming the file', () => {
	const ctx = tableKit();
	writeOverride(ctx.proj, '{ "steps": { "checker": ');
	const before = entries(ctx.proj);
	const r = installProject(ctx);
	assert.notEqual(r.status, 0, 'a malformed models.json installed');
	assert.match(r.stderr + r.stdout, /models\.json/, 'the refusal does not name the file');
	assert.deepEqual(entries(ctx.proj), before, 'a refused install wrote into the project');
	// A project with no override file installs normally, or every project install would break.
	const clean = tableKit();
	const c = installProject(clean);
	assert.equal(c.status, 0, c.stderr);
});

// why: catches a wrong-shaped override (array steps, a bare string row, a non-string model, null) read as clean
test('install project and the installed check refuse each wrong-shaped models.json, naming the file', () => {
	const shapes = [{ steps: [] }, { steps: { writer: 'x' } }, { steps: { writer: { model: 5 } } }, null];
	for (const shape of shapes) {
		const ctx = tableKit();
		writeOverride(ctx.proj, shape);
		const before = entries(ctx.proj);
		const r = installProject(ctx);
		const label = JSON.stringify(shape);
		assert.notEqual(r.status, 0, `install accepted ${label}`);
		assert.match(r.stderr + r.stdout, /models\.json/, `install did not name the file for ${label}`);
		assert.deepEqual(entries(ctx.proj), before, `a refused install wrote into the project for ${label}`);
		// The check needs an installed copy: a clean install first, then the bad override.
		const clean = tableKit();
		assert.equal(installProject(clean).status, 0, 'the clean install failed');
		writeOverride(clean.proj, shape);
		const c = runCheck(clean.proj);
		assert.equal(c.status, 2, `check exit ${c.status} for ${label}: ${c.stderr}`);
	}
});

// why: guards rule:ci-gate (a project with no override file fails its CI on the check step it was given)
test('the installed override check exits 0 when the project has no .kit/models.json', () => {
	const ctx = tableKit();
	assert.equal(installProject(ctx).status, 0, 'the clean install failed');
	const r = runCheck(ctx.proj);
	assert.equal(r.status, 0, `exit ${r.status}: ${r.stderr}`);
});

// why: guards rule:ci-gate (a good override that CI's check refuses turns every green project red)
test('the installed override check exits 0 for a good override', () => {
	const ctx = tableKit();
	assert.equal(installProject(ctx).status, 0, 'the clean install failed');
	writeOverride(ctx.proj, { steps: { 'sweep-breadth': { model: 'claude-opus-5-5' }, writer: { model: 'claude-opus-5-5' } } });
	const r = runCheck(ctx.proj);
	assert.equal(r.status, 0, `exit ${r.status}: ${r.stderr}`);
});

// why: guards rule:ci-gate (a floor-lowering override added after install passes CI because the check reads it as clean)
test('the installed override check exits 1 naming the step when an override lowers a floor', () => {
	const ctx = tableKit();
	assert.equal(installProject(ctx).status, 0, 'the clean install failed');
	writeOverride(ctx.proj, { steps: { checker: { model: 'claude-haiku-5-5' } } });
	const r = runCheck(ctx.proj);
	assert.equal(r.status, 1, `exit ${r.status}: ${r.stderr}`);
	assert.match(r.stderr + r.stdout, /checker/, 'the check does not name the step');
});

// why: catches an unreadable override file that CI reads as a clean project, passing a broken check
test('the installed override check exits 2 when .kit/models.json cannot be read', () => {
	const ctx = tableKit();
	assert.equal(installProject(ctx).status, 0, 'the clean install failed');
	writeOverride(ctx.proj, '{ "steps": ');
	const r = runCheck(ctx.proj);
	assert.equal(r.status, 2, `exit ${r.status}: ${r.stderr}`);
});

// why: guards rule:ci-gate (the node CI template never runs the override check, so a refused override merges unseen)
test('the node CI template runs the override check as a live step', () => {
	const text = fs.readFileSync(path.resolve('project/_Templates/ci-node.yml'), 'utf8');
	assert.match(text, /^\s*(?:- )?run:\s*node \.claude\/model-override\.mjs check\s*$/m, 'no live step runs node .claude/model-override.mjs check');
});

// why: guards rule:ci-gate (the python CI template never runs the override check, so a refused override merges unseen)
test('the python CI template runs the override check as a live step', () => {
	const text = fs.readFileSync(path.resolve('project/_Templates/ci-python.yml'), 'utf8');
	assert.match(text, /^\s*(?:- )?run:\s*node \.claude\/model-override\.mjs check\s*$/m, 'no live step runs node .claude/model-override.mjs check');
});
