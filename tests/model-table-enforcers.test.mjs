// E36 (build 24): what holds the model table at run time. The table in kit.config.json names a model and effort for
// each step; these tests fix the enforcers beside it: the size rule (pr-size.mjs), the log-only agent model hook, CI's
// table check, the lead's settings, and the list row a session start adds for a model the kit has not measured. No test
// here calls a model. A missing module fails on an assertion: each one is run as a child process or imported on demand.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import kitTemp from '../project/.claude/kit-temp.cjs';
import { caseKit, makeKit, makeTemp, sessionStartReport } from './kit-helpers.mjs';
import { install } from '../scripts/kit.mjs';

const require = createRequire(import.meta.url);
kitTemp.sessionRoot();

const SRC = path.resolve('project/.claude');
const OPUS = 'claude-opus-5-5';
const HAIKU = 'claude-haiku-5-5';

const write = (dir, rel, text) => {
	fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
	fs.writeFileSync(path.join(dir, rel), text);
};
const gitIn = (repo) => (...a) => spawnSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...a], { encoding: 'utf8' });

// ---------------------------------------------------------------------------------------------------------------
// 1. pr-size.mjs
// ---------------------------------------------------------------------------------------------------------------

// A kit folder holding a copy of the script beside a config with two odd model names, so the output proves the models
// are read from the config and not written into the script.
function sizeKit() {
	const kit = makeTemp('size-kit-');
	write(kit, 'kit.config.json', JSON.stringify({ steps: { writer: { model: 'claude-small-1', effort: 'medium', enforcer: 'role:writer' }, 'writer-large': { model: 'claude-large-2', effort: 'medium', enforcer: 'script:user/kit-tools/pr-size.mjs' } } }));
	fs.mkdirSync(path.join(kit, 'user/kit-tools'), { recursive: true });
	for (const f of ['pr-size.mjs', 'model-table.mjs']) {
		const from = path.resolve('user/kit-tools', f);
		if (fs.existsSync(from)) fs.copyFileSync(from, path.join(kit, 'user/kit-tools', f));
	}
	return path.join(kit, 'user/kit-tools/pr-size.mjs');
}
// A repo with a main branch of one file and a feature branch that changes n files.
function sizeRepo(n) {
	const repo = makeTemp('size-repo-');
	const g = gitIn(repo);
	g('init', '-q', '-b', 'main');
	write(repo, 'base.txt', 'base\n');
	g('add', 'base.txt');
	g('commit', '-qm', 'base');
	g('switch', '-qc', 'feat/x');
	for (let i = 0; i < n; i++) write(repo, `src/f${i}.txt`, `${i}\n`);
	g('add', 'src');
	g('commit', '-qm', 'change');
	return repo;
}
const sizeRun = (script, cwd, args = []) => spawnSync(process.execPath, [script, ...args], { cwd, encoding: 'utf8' });

// why: guards rule:agent-role-table (a change of ten files or fewer goes to the large writer, or the small one is never used)
test('pr-size names the small writer for a change of ten files', () => {
	const r = sizeRun(sizeKit(), sizeRepo(10), ['main']);
	assert.equal(r.status, 0, r.stderr);
	assert.equal(r.stdout.trim(), 'writer: claude-small-1 (10 files)');
});

// why: guards rule:agent-role-table (a change past ten files stays on the small writer, which cannot hold it)
test('pr-size names the large writer for a change of eleven files', () => {
	const r = sizeRun(sizeKit(), sizeRepo(11), ['main']);
	assert.equal(r.status, 0, r.stderr);
	assert.equal(r.stdout.trim(), 'writer: claude-large-2 (11 files)');
});

// why: catches a default base that is missing so the script fails with no argument
test('pr-size falls back to main when there is no origin/main', () => {
	const r = sizeRun(sizeKit(), sizeRepo(3));
	assert.equal(r.status, 0, r.stderr);
	assert.equal(r.stdout.trim(), 'writer: claude-small-1 (3 files)');
});

// why: catches a count taken from the working tree instead of the branch against its base
test('pr-size counts the committed branch diff, not files left uncommitted', () => {
	const repo = sizeRepo(10);
	const g = gitIn(repo);
	g('switch', '-q', 'main');
	for (let i = 0; i < 5; i++) write(repo, `main${i}.txt`, 'x\n');
	g('add', '-A');
	g('commit', '-qm', 'main moves on');
	g('switch', '-q', 'feat/x');
	for (let i = 0; i < 3; i++) write(repo, `loose${i}.txt`, 'x\n');
	const r = sizeRun(sizeKit(), repo, ['main']);
	assert.equal(r.stdout.trim(), 'writer: claude-small-1 (10 files)');
});

// why: catches a default base that ignores origin/main when it exists
test('pr-size with no base argument counts against origin/main when it exists', () => {
	const repo = makeTemp('size-origin-repo-');
	const origin = makeTemp('size-origin-bare-');
	const g = gitIn(repo);
	spawnSync('git', ['init', '-q', '-b', 'main', '--bare', origin], { encoding: 'utf8' });
	g('init', '-q', '-b', 'main');
	write(repo, 'base.txt', 'base\n');
	g('add', 'base.txt');
	g('commit', '-qm', 'base');
	g('remote', 'add', 'origin', origin);
	g('push', '-q', 'origin', 'main');
	write(repo, 'local0.txt', 'x\n');
	write(repo, 'local1.txt', 'x\n');
	g('add', '-A');
	g('commit', '-qm', 'local main only');
	g('switch', '-qc', 'feat/x');
	for (let i = 0; i < 9; i++) write(repo, `src/f${i}.txt`, `${i}\n`);
	g('add', 'src');
	g('commit', '-qm', 'change');
	const onOrigin = g('diff', '--name-only', 'origin/main...HEAD').stdout.trim().split('\n').length;
	const onLocal = g('diff', '--name-only', 'main...HEAD').stdout.trim().split('\n').length;
	assert.notEqual(onOrigin, onLocal, 'the two bases must give different counts for this test to mean anything');
	const r = sizeRun(sizeKit(), repo);
	assert.equal(r.status, 0, r.stderr);
	assert.equal(r.stdout.trim(), `writer: claude-large-2 (${onOrigin} files)`);
});

// why: guards rule:agent-role-table (the size rule run outside a repo prints a writer as if the change were empty)
test('pr-size exits 2 outside a git repository', () => {
	const r = sizeRun(sizeKit(), makeTemp('size-bare-'));
	assert.equal(r.status, 2, `${r.stdout}${r.stderr}`);
	assert.doesNotMatch(r.stdout, /^writer:/m);
});

// why: guards rule:agent-role-table (the shipped size rule reads the real table's writers, so a missing script is found)
test('the real pr-size names the real table writers', () => {
	assert.ok(fs.existsSync('user/kit-tools/pr-size.mjs'), 'user/kit-tools/pr-size.mjs is missing');
	const steps = JSON.parse(fs.readFileSync('kit.config.json', 'utf8')).steps;
	assert.equal(steps['writer-large']?.model, OPUS, 'steps.writer-large is not in kit.config.json');
	const r = sizeRun(path.resolve('user/kit-tools/pr-size.mjs'), sizeRepo(11), ['main']);
	assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
	assert.equal(r.stdout.trim(), `writer: ${OPUS} (11 files)`);
	assert.equal(sizeRun(path.resolve('user/kit-tools/pr-size.mjs'), sizeRepo(10), ['main']).stdout.trim(), `writer: ${HAIKU} (10 files)`);
});

// ---------------------------------------------------------------------------------------------------------------
// 2. the writer-large step
// ---------------------------------------------------------------------------------------------------------------

// why: guards rule:agent-role-table (the table has no entry for the large writer, so the size rule names an unchecked model)
test('the real table holds a writer-large step on opus, medium, enforced by pr-size', () => {
	assert.ok(fs.existsSync('user/kit-tools/pr-size.mjs'), 'user/kit-tools/pr-size.mjs is missing');
	const step = JSON.parse(fs.readFileSync('kit.config.json', 'utf8')).steps['writer-large'];
	assert.ok(step, 'steps.writer-large is missing');
	assert.deepEqual({ model: step.model, effort: step.effort, enforcer: step.enforcer }, { model: OPUS, effort: 'medium', enforcer: 'script:user/kit-tools/pr-size.mjs' });
});

// ---------------------------------------------------------------------------------------------------------------
// 3. the agent model hook (log only)
// ---------------------------------------------------------------------------------------------------------------

const HOOK = path.resolve('user/kit-hooks/agent-model.cjs');
const GUARDS = ['guard.cjs', 'owner-proof.cjs', 'task-gate.cjs', 'guard-outward.cjs', 'guard-delete.cjs', 'guard-read.cjs', 'owner-yes.cjs'];

// A Claude folder holding the hook (recorded as install user records it) and, per role, a role file; a git repo to run in.
function hookSetup(roles = {}) {
	const dir = makeTemp('amodel-guard-');
	for (const f of GUARDS) fs.copyFileSync(path.join(SRC, f), path.join(dir, f));
	const cfg = makeTemp('amodel-cfg-');
	fs.mkdirSync(path.join(cfg, 'kit-hooks'));
	if (fs.existsSync(HOOK)) fs.copyFileSync(HOOK, path.join(cfg, 'kit-hooks/agent-model.cjs'));
	const files = {};
	for (const f of fs.readdirSync(path.join(cfg, 'kit-hooks'))) files[`kit-hooks/${f}`] = crypto.createHash('sha256').update(fs.readFileSync(path.join(cfg, 'kit-hooks', f))).digest('hex');
	fs.writeFileSync(path.join(cfg, 'kit-install.json'), JSON.stringify({ files }));
	// A fake home holds the same role files as the Claude folder, so a run never reads the owner's real home.
	const home = makeTemp('amodel-home-');
	const roleText = (name, model) => `---\nname: ${name}\n${model ? `model: ${model}\n` : ''}---\n\nbody\n`;
	for (const [name, model] of Object.entries(roles)) {
		write(cfg, `agents/${name}.md`, roleText(name, model));
		write(home, `.claude/agents/${name}.md`, roleText(name, model));
	}
	const repo = makeTemp('amodel-repo-');
	gitIn(repo)('init', '-q', '-b', 'main');
	const log = path.join(repo, '.git', 'kit-agent-model.log');
	const run = (tool_name, tool_input, cwd = repo) => {
		const env = { ...process.env, CLAUDE_CONFIG_DIR: cfg, KIT_CLAUDE_HOME: cfg, CLAUDE_PROJECT_DIR: repo, HOME: home, USERPROFILE: home };
		const r = spawnSync(process.execPath, [path.join(dir, 'guard.cjs')], { input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name, tool_input, cwd }), encoding: 'utf8', env });
		assert.equal(r.status, 0, r.stderr);
		return r.stdout ? JSON.parse(r.stdout).hookSpecificOutput : {};
	};
	const lines = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
	return { run, lines, repo };
}

// why: guards rule:agent-role-table (the agent model hook is not on the guard's list for Agent and Task calls)
test('the guard routes Agent and Task calls to the agent model hook and no other tool', () => {
	const { routes } = require(path.join(SRC, 'guard.cjs'));
	assert.ok(routes('Agent').includes('agent-model.cjs'), `Agent: ${routes('Agent')}`);
	assert.ok(routes('Task').includes('agent-model.cjs'), `Task: ${routes('Task')}`);
	assert.ok(!routes('Bash').includes('agent-model.cjs'));
	assert.ok(!routes('Read').includes('agent-model.cjs'));
});

// why: guards rule:agent-role-table (a call that names no model and has no role file runs on the lead's model unseen)
test('a call with no model and no role file is logged with the fields, and still goes through', () => {
	const { run, lines } = hookSetup({});
	const out = run('Agent', { subagent_type: 'writer', prompt: 'x' });
	assert.equal(out.permissionDecision, undefined, JSON.stringify(out));
	const rows = lines();
	assert.equal(rows.length, 1, 'no line in kit-agent-model.log');
	assert.equal(rows[0].hook, 'agent-model');
	assert.equal(rows[0].type, 'writer');
	assert.ok(!rows[0].model, `model: ${rows[0].model}`);
	assert.ok(typeof rows[0].why === 'string' && rows[0].why.length > 0, 'why');
	assert.ok(!Number.isNaN(Date.parse(rows[0].at)), 'at');
	assert.ok('want' in rows[0], 'want');
	// Folded control (was its own test): catches a role file with no model line being read as a missing role file.
	{
		const quiet = hookSetup({ scanner: '' });
		quiet.run('Agent', { subagent_type: 'scanner', prompt: 'x' });
		quiet.run('Agent', { subagent_type: 'scanner', model: 'opus', prompt: 'x' });
		assert.deepEqual(quiet.lines(), []);
	}
});

// why: guards rule:agent-role-table (a call whose model family differs from its role file runs a step on the wrong model)
test('a call naming a model of another family than the role file is logged with both, and goes through', () => {
	const { run, lines } = hookSetup({ writer: HAIKU });
	const out = run('Agent', { subagent_type: 'writer', model: 'opus', prompt: 'x' });
	assert.equal(out.permissionDecision, undefined, JSON.stringify(out));
	const rows = lines();
	assert.equal(rows.length, 1, 'no line in kit-agent-model.log');
	assert.equal(rows[0].type, 'writer');
	assert.match(rows[0].model, /opus/);
	assert.match(rows[0].want, /haiku/);
});

// why: guards rule:agent-role-table (the Task tool name skips the hook that the Agent name reaches)
test('a Task call is logged the same as an Agent call', () => {
	const { run, lines } = hookSetup({ writer: HAIKU });
	run('Task', { subagent_type: 'writer', model: 'sonnet', prompt: 'x' });
	assert.equal(lines().length, 1);
});

// why: catches the log landing in a worktree git dir instead of the common dir
test('the agent model log lands in the main repo git dir when the call runs in a linked worktree', () => {
	const { run, lines, repo } = hookSetup({ writer: HAIKU });
	const g = gitIn(repo);
	write(repo, 'a.txt', 'a\n');
	g('add', 'a.txt');
	g('commit', '-qm', 'init');
	const wt = path.join(makeTemp('amodel-wt-'), 'wt');
	g('worktree', 'add', '-q', wt, '-b', 'feat/wt');
	run('Agent', { subagent_type: 'writer', model: 'opus', prompt: 'x' }, wt);
	assert.equal(lines().length, 1, 'no line in the main repo kit-agent-model.log');
	const wtGitDir = path.resolve(wt, gitIn(wt)('rev-parse', '--git-dir').stdout.trim());
	assert.equal(fs.existsSync(path.join(wtGitDir, 'kit-agent-model.log')), false, `a log in the worktree git dir ${wtGitDir}`);
});

// why: catches a matching call writing a log line on every agent start
test('a call that matches its role file writes nothing, by full id, family name or no model', () => {
	assert.ok(fs.existsSync(HOOK));
	const { run, lines } = hookSetup({ writer: HAIKU });
	run('Agent', { subagent_type: 'writer', model: HAIKU, prompt: 'x' });
	run('Agent', { subagent_type: 'writer', model: 'haiku', prompt: 'x' });
	run('Agent', { subagent_type: 'writer', prompt: 'x' });
	assert.deepEqual(lines(), []);
});

// why: guards rule:agent-role-table (a hook that refuses turns a log-only slip-catcher into a stop on every agent)
test('the agent model hook never refuses or asks, whatever the call names', () => {
	assert.ok(fs.existsSync(HOOK));
	const { run, lines } = hookSetup({ writer: HAIKU });
	for (const input of [{ subagent_type: 'writer', model: 'opus' }, { subagent_type: 'nobody' }, { prompt: 'x' }, { subagent_type: 'writer', model: 'not-a-model' }]) {
		const out = run('Agent', { prompt: 'x', ...input });
		assert.equal(out.permissionDecision, undefined, JSON.stringify(input));
	}
	assert.ok(lines().some((r) => r.type === 'writer' && /opus/.test(r.model) && /haiku/.test(r.want)), 'the mismatched writer call on opus logged no line');
});

// why: catches an agent model hook that returns something other than null to the guard
test('the agent model hook module returns null for a mismatched call', () => {
	assert.ok(fs.existsSync(HOOK), 'user/kit-hooks/agent-model.cjs is missing');
	const cfg = makeTemp('amodel-direct-');
	write(cfg, 'agents/writer.md', `---\nname: writer\nmodel: ${HAIKU}\n---\n`);
	const repo = makeTemp('amodel-direct-repo-');
	gitIn(repo)('init', '-q', '-b', 'main');
	const home = makeTemp('amodel-direct-home-');
	write(home, '.claude/agents/writer.md', `---\nname: writer\nmodel: ${HAIKU}\n---\n`);
	const prev = { a: process.env.KIT_CLAUDE_HOME, b: process.env.CLAUDE_CONFIG_DIR, h: process.env.HOME, u: process.env.USERPROFILE };
	process.env.KIT_CLAUDE_HOME = cfg;
	process.env.CLAUDE_CONFIG_DIR = cfg;
	process.env.HOME = home;
	process.env.USERPROFILE = home;
	try {
		const hook = require(HOOK);
		assert.equal(hook.check({ tool_name: 'Agent', tool_input: { subagent_type: 'writer', model: 'opus' }, cwd: repo }), null);
	} finally {
		if (prev.a === undefined) delete process.env.KIT_CLAUDE_HOME; else process.env.KIT_CLAUDE_HOME = prev.a;
		if (prev.b === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = prev.b;
		if (prev.h === undefined) delete process.env.HOME; else process.env.HOME = prev.h;
		if (prev.u === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = prev.u;
	}
});

// ---------------------------------------------------------------------------------------------------------------
// 4. CI runs the table check
// ---------------------------------------------------------------------------------------------------------------

// why: guards rule:agent-role-table (the table check is never run by CI, so a drifted role file merges)
test('ci.yml runs the model table check on the kit folder as a live step', () => {
	const ci = fs.readFileSync('.github/workflows/ci.yml', 'utf8');
	assert.match(ci, /^\s*(?:- )?(?:run: )?node user\/kit-tools\/model-table\.mjs check \.\s*$/m);
});

// ---------------------------------------------------------------------------------------------------------------
// 5. lead settings
// ---------------------------------------------------------------------------------------------------------------

const leadKit = (extra = {}) => {
	const ctx = makeKit();
	const config = JSON.parse(fs.readFileSync(path.join(ctx.kit, 'kit.config.json'), 'utf8'));
	fs.writeFileSync(path.join(ctx.kit, 'kit.config.json'), JSON.stringify({ ...config, steps: { lead: { model: 'claude-lead-7', effort: 'xhigh', enforcer: 'settings' } }, ...extra }));
	return ctx;
};
const settingsOf = (home) => JSON.parse(fs.readFileSync(path.join(home, 'settings.json'), 'utf8'));

// why: guards rule:agent-role-table (the lead runs on whatever model the owner's Claude folder was last set to)
test('install user writes the lead model and effort into settings.json', () => {
	const { kit, home } = leadKit();
	install({ kit, home, target: 'user' });
	const s = settingsOf(home);
	assert.equal(s.model, 'claude-lead-7');
	assert.equal(s.effortLevel, 'xhigh');
	// Folded control (was its own test): catches a kit with no lead step writing an empty or invented model into settings.json.
	{
		const bare = makeKit();
		install({ kit: bare.kit, home: bare.home, target: 'user' });
		const none = settingsOf(bare.home);
		assert.equal('model' in none, false);
		assert.equal('effortLevel' in none, false);
	}
});

// why: catches install user dropping the owner's other settings keys when it writes the lead
test('install user keeps the settings keys already in settings.json beside the lead', () => {
	const { kit, home } = leadKit();
	const foreign = { matcher: 'Foo', hooks: [{ type: 'command', command: 'echo foreign' }] };
	fs.writeFileSync(path.join(home, 'settings.json'), JSON.stringify({ theme: 'dark', permissions: { allow: ['Read'] }, model: 'claude-old-1', hooks: { PreToolUse: [foreign] } }));
	install({ kit, home, target: 'user' });
	const s = settingsOf(home);
	assert.equal(s.theme, 'dark');
	assert.deepEqual(s.permissions, { allow: ['Read'] });
	assert.equal(s.model, 'claude-lead-7', 'the lead model replaces the old one');
	assert.ok(s.hooks && s.hooks.PreToolUse, 'the launcher hooks are still wired');
	assert.ok(s.hooks.PreToolUse.some((e) => JSON.stringify(e).includes('echo foreign')), 'the foreign PreToolUse entry was dropped');
	// Folded control (was its own test): catches a second install user moving the lead or doubling the hooks in settings.json.
	{
		const twice = leadKit();
		install({ kit: twice.kit, home: twice.home, target: 'user' });
		const once = fs.readFileSync(path.join(twice.home, 'settings.json'), 'utf8');
		install({ kit: twice.kit, home: twice.home, target: 'user' });
		assert.equal(fs.readFileSync(path.join(twice.home, 'settings.json'), 'utf8'), once);
	}
});

// ---------------------------------------------------------------------------------------------------------------
// 6. session start writes a list row for an unmeasured or retiring model
// ---------------------------------------------------------------------------------------------------------------

// The kit's own state tools, beside a project list file, in the kit folder and the project as the kit lays them out.
function listKit() {
	const { kit, home, proj } = caseKit();
	fs.writeFileSync(path.join(kit, 'kit.config.json'), JSON.stringify({ ownerName: 'Pat', roles: { builder: { model: 'claude-a-1', effort: 'high' }, scanner: { model: 'claude-b-1', effort: 'low' }, checker: { model: 'claude-c-1', effort: 'high' } }, models: { measured: ['claude-a-1', 'claude-b-1', 'claude-c-1'], retiring: ['claude-c-1'] } }));
	fs.mkdirSync(path.join(home, 'agents'), { recursive: true });
	fs.writeFileSync(path.join(home, 'agents/scanner.md'), '---\nname: scanner\nmodel: claude-z-9\n---\n');
	for (const base of [path.join(kit, 'project/.claude'), path.join(proj, '.claude')]) {
		fs.mkdirSync(base, { recursive: true });
		for (const f of ['state.mjs', 'list-data.mjs', 'retired-check.mjs', 'retired-wording.json']) fs.copyFileSync(path.join(SRC, f), path.join(base, f));
	}
	fs.copyFileSync(path.resolve('project/_State.json'), path.join(proj, '_State.json'));
	fs.writeFileSync(path.join(proj, '_List.jsonl'), '');
	fs.writeFileSync(path.join(proj, '_Decisions.jsonl'), '');
	const start = () => sessionStartReport({ kit, home, projectDir: proj, env: {}, ahead: () => ({ count: 0 }) });
	const rows = () => fs.readFileSync(path.join(proj, '_List.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
	return { kit, home, proj, start, rows };
}
const rowFor = (rows, role, model) => rows.filter((r) => JSON.stringify(r).includes(role) && JSON.stringify(r).includes(model));

// why: guards rule:agent-role-table (a role on an unmeasured or retiring model is named once and then forgotten)
test('session start adds one list row for each role on a retiring or unmeasured model', () => {
	const { start, rows } = listKit();
	start();
	const made = rows();
	assert.equal(made.length, 2, JSON.stringify(made));
	assert.equal(rowFor(made, 'checker', 'claude-c-1').length, 1, 'the retiring checker');
	assert.equal(rowFor(made, 'scanner', 'claude-z-9').length, 1, 'the unmeasured scanner');
	for (const r of made) assert.ok(typeof r.id === 'string' && r.id.length > 0 && typeof r.title === 'string', JSON.stringify(r));
	// Folded control (was its own test): catches a clean kit with every role measured still adding rows at session start.
	{
		const clean = listKit();
		fs.rmSync(path.join(clean.home, 'agents/scanner.md'));
		fs.writeFileSync(path.join(clean.kit, 'kit.config.json'), JSON.stringify({ ownerName: 'Pat', roles: { builder: { model: 'claude-a-1', effort: 'high' } }, models: { measured: ['claude-a-1'], retiring: [] } }));
		clean.start();
		assert.deepEqual(clean.rows(), []);
	}
	// Folded control (was its own test): catches one failed row write dropping all session start text.
	{
		const blocked = listKit();
		fs.rmSync(path.join(blocked.proj, '.kit'), { recursive: true, force: true });
		fs.writeFileSync(path.join(blocked.proj, '.kit'), 'a plain file, not a folder');
		assert.match(String(blocked.start()), /Kit roles:/);
	}
});

// why: catches a later session start adding the same role and model row a second time
test('a later session start adds no second row for the same role and model', () => {
	const { start, rows } = listKit();
	start();
	start();
	start();
	assert.equal(rows().length, 2);
});

// why: catches a role moved to a new unmeasured model never getting its own row after the first one
test('a role moved to another unmeasured model gets one more row', () => {
	const { home, start, rows } = listKit();
	start();
	fs.writeFileSync(path.join(home, 'agents/scanner.md'), '---\nname: scanner\nmodel: claude-y-8\n---\n');
	start();
	const made = rows();
	assert.equal(made.length, 3, JSON.stringify(made));
	assert.equal(rowFor(made, 'scanner', 'claude-y-8').length, 1);
});

// why: catches the row written by hand so the list fails its own check
test('the rows session start adds pass the state check of the project', () => {
	const { proj, start } = listKit();
	start();
	const r = spawnSync(process.execPath, [path.join(proj, '.claude/state.mjs'), 'list', '--all'], { cwd: proj, encoding: 'utf8' });
	assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
	assert.match(r.stdout, /claude-z-9/);
	// Folded control (was its own test): catches a row file written through a linked folder.
	{
		const linked = listKit();
		const outside = makeTemp('kit-link-target-');
		fs.rmSync(path.join(linked.proj, '.kit'), { recursive: true, force: true });
		fs.symlinkSync(outside, path.join(linked.proj, '.kit'), 'junction');
		linked.start();
		assert.deepEqual(fs.readdirSync(outside), []);
	}
});


// why: guards rule:ci-gate (PR code runs in the base-copy gate job)
test('the model table check runs in unit-tests, never in kit-tests', () => {
	const ci = fs.readFileSync('.github/workflows/ci.yml', 'utf8');
	const unit = ci.slice(ci.indexOf('\n  unit-tests:'), ci.indexOf('\n  test-check:'));
	assert.match(unit, /node user\/kit-tools\/model-table\.mjs check \./);
	const kit = ci.slice(ci.indexOf('\n  kit-tests:'));
	assert.doesNotMatch(kit, /model-table\.mjs/);
});

// why: catches session start running project code instead of the kit copy
test('session start never runs the project state.mjs', () => {
	const { proj, start, rows } = listKit();
	fs.writeFileSync(path.join(proj, '.claude/state.mjs'), `import fs from 'node:fs';\nfs.writeFileSync(${JSON.stringify(path.join(proj, 'ran.txt'))}, 'ran');\n`);
	start();
	assert.equal(fs.existsSync(path.join(proj, 'ran.txt')), false, 'the project state.mjs ran at session start');
	assert.equal(rows().length, 2);
});
