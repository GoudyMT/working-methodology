// K176 (build 23b): the owner's card tap in a cloud thread becomes a one-time grant a worker's guard accepts. A cloud
// worker has no pop-up, so a hold that asks for the owner's yes had no way to be lifted (cloud-plugin-proof, route A).
// The lead writes the grant with grant.mjs; kit-launch lifts one "Owner's yes needed" hold with it: the same session,
// tool and exact act, under an hour old, used once, never for a subagent or any other refusal.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import kitTemp from '../project/.claude/kit-temp.cjs';
import { install } from '../scripts/kit.mjs';

const require = createRequire(import.meta.url);
kitTemp.sessionRoot();
const KIT = path.resolve('.');
const GRANT_CLI = path.resolve('user/kit-tools/grant.mjs');
// The library is checked by path first, so a tree without it fails each test on an assertion, not a crash.
const GRANT_LIB = path.resolve('user/kit-tools/owner-grant.cjs');
const grantLib = () => { assert.ok(fs.existsSync(GRANT_LIB), 'owner-grant.cjs holds the grant check'); return require(GRANT_LIB); };
const { askText } = require('../project/.claude/owner-yes.cjs');
const ENV = { ...process.env };
for (const k of ['CLAUDECODE', 'AI_AGENT', 'KIT_PUSH_APPROVED', 'CLAUDE_CONFIG_DIR', 'KIT_CLAUDE_HOME', 'CLAUDE_PROJECT_DIR', 'CLAUDE_CODE_SESSION_ID', 'CLAUDE_CODE_REMOTE']) delete ENV[k];

const SESSION = '11111111-2222-3333-4444-555555555555';
const OTHER = '99999999-2222-3333-4444-555555555555';
const ACT = 'KIT_PUSH_APPROVED=1 git push --force origin main';
const call = (over = {}) => ({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: ACT }, session_id: SESSION, tool_use_id: 'toolu_1', ...over });
// The guard's hold for that act, as owner-yes.cjs words it.
const held = (input = call()) => ({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: askText('a force push is outside the push bound', input, ACT) } });
const decision = (o) => o && o.hookSpecificOutput && o.hookSpecificOutput.permissionDecision;
// The lead's side: grant.mjs, run as the lead runs it, writing into the home it names.
function grant(home, { session = SESSION, tool = 'Bash', act = ACT, card = 'cmsg_card1', env = {} } = {}) {
	const r = spawnSync(process.execPath, [GRANT_CLI, session, tool, act, card], { encoding: 'utf8', env: { ...ENV, KIT_CLAUDE_HOME: home, ...env } });
	return r;
}
const newHome = () => kitTemp.makeTemp('grant-home-');
function granted(opts = {}) {
	const home = newHome();
	const r = grant(home, opts);
	assert.equal(r.status, 0, r.stderr + r.stdout);
	return home;
}

// why: guards rule:outward-acts
test('K176 a grant lifts the one hold it names, once, with a note naming the card', () => {
	const home = granted();
	const out = grantLib().lift(held(), call(), home);
	assert.equal(decision(out), 'allow');
	assert.match(JSON.stringify(out), /cmsg_card1/);
	assert.match(JSON.stringify(out), /once/);
});

// why: guards rule:outward-acts
test('K176 a grant is spent on first use: the same act again is held (replay refused)', () => {
	const home = granted();
	assert.equal(decision(grantLib().lift(held(), call(), home)), 'allow');
	assert.equal(decision(grantLib().lift(held(), call({ tool_use_id: 'toolu_2' }), home)), 'deny', 'replay');
	assert.equal(decision(grantLib().lift(held(), call(), home)), 'deny', 'the same call id again');
});

// why: guards rule:outward-acts
test('K176 a grant older than an hour, or dated ahead of the clock, is refused', () => {
	const home = granted();
	const { lift, FRESH_MS } = grantLib();
	assert.equal(decision(lift(held(), call(), home, Date.now() + FRESH_MS + 1000)), 'deny', 'expired');
	const ahead = granted();
	assert.equal(decision(lift(held(), call(), ahead, Date.now() - 60 * 1000)), 'deny', 'a grant from the future');
});

// why: guards rule:outward-acts
test('K176 a grant binds one session, one tool and the exact act', () => {
	const { lift } = grantLib();
	assert.equal(decision(lift(held(), call({ session_id: OTHER }), granted())), 'deny', 'other session');
	assert.equal(decision(lift(held(), call({ tool_name: 'PowerShell' }), granted())), 'deny', 'other tool');
	assert.equal(decision(lift(held(), call({ tool_input: { command: ACT + 'x' } }), granted())), 'deny', 'one char more');
	assert.equal(decision(lift(held(), call({ tool_input: { command: ACT.replace('main', 'mainx') } }), granted())), 'deny', 'other act');
	assert.equal(decision(lift(held(), call({ tool_input: { command: ACT.replace('force', 'Force') } }), granted())), 'deny', 'case');
});

// why: guards rule:outward-acts
test('K176 a subagent call is never lifted: it hands the act back', () => {
	const home = granted();
	const sub = call({ agent_id: 'agent-1' });
	assert.equal(decision(grantLib().lift(held(), sub, home)), 'deny');
	// Unspent: the main session can still use it.
	assert.equal(decision(grantLib().lift(held(), call(), home)), 'allow');
});

// why: guards rule:outward-acts
test('K176 only an "Owner\'s yes needed" hold is lifted, never another refusal or one merged beside it', () => {
	const { lift } = grantLib();
	const deny = (r) => ({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: r } });
	for (const r of ['Never by a tool: the kit\'s guards are protected files.', 'Held: the guard files changed.', 'Hand back: a subagent cannot get the owner\'s yes.', 'A brief must carry its cap.',
		`${held().hookSpecificOutput.permissionDecisionReason} | Never by a tool: the kit's guards are protected files.`,
		`Held: x | ${held().hookSpecificOutput.permissionDecisionReason}`]) {
		const home = granted();
		assert.equal(decision(lift(deny(r), call(), home)), 'deny', r.slice(0, 60));
		assert.equal(decision(lift(held(), call(), home)), 'allow', 'the grant was not spent by the refusal it could not lift');
	}
	const ask = { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask', permissionDecisionReason: 'Owner\'s yes needed: x.' } };
	assert.deepEqual(lift(ask, call(), granted()), ask);
	assert.equal(lift(null, call(), granted()), null);
	// Two holds that both ask for the owner's yes for this act: one tap answers both.
	const two = deny(`${held().hookSpecificOutput.permissionDecisionReason} | ${held().hookSpecificOutput.permissionDecisionReason}`);
	assert.equal(decision(lift(two, call(), granted())), 'allow');
});

// why: guards rule:outward-acts
test('K176 a hand-edited grant is refused', () => {
	const home = granted();
	const dir = path.join(home, 'kit-grants');
	const f = fs.readdirSync(dir).find((n) => n.endsWith('.json'));
	const g = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
	fs.writeFileSync(path.join(dir, f), JSON.stringify({ ...g, session: OTHER }));
	assert.equal(decision(grantLib().lift(held(), call({ session_id: OTHER }), home)), 'deny', 'session changed');
	fs.writeFileSync(path.join(dir, f), JSON.stringify({ ...g, card: 'cmsg_other' }));
	assert.equal(decision(grantLib().lift(held(), call(), home)), 'deny', 'card changed');
});

// why: guards rule:outward-acts
test('K176 a missing, unreadable or linked grants folder fails closed', () => {
	const { lift } = grantLib();
	assert.equal(decision(lift(held(), call(), newHome())), 'deny', 'no folder');
	assert.equal(decision(lift(held(), call(), path.join(newHome(), 'gone'))), 'deny', 'no home');
	const home = newHome();
	fs.writeFileSync(path.join(home, 'kit-grants'), 'not a folder');
	assert.equal(decision(lift(held(), call(), home)), 'deny', 'a file');
	if (process.platform !== 'win32') {
		const real = granted();
		const linked = newHome();
		fs.symlinkSync(path.join(real, 'kit-grants'), path.join(linked, 'kit-grants'));
		assert.equal(decision(lift(held(), call(), linked)), 'deny', 'a linked folder');
		const dir = path.join(real, 'kit-grants');
		const f = fs.readdirSync(dir).find((n) => n.endsWith('.json'));
		const other = newHome();
		fs.mkdirSync(path.join(other, 'kit-grants'));
		fs.symlinkSync(path.join(dir, f), path.join(other, 'kit-grants', f));
		assert.equal(decision(lift(held(), call(), other)), 'deny', 'a linked grant file');
	}
});

// why: guards rule:outward-acts
test('K176 two calls racing for one grant: exactly one is let through', async () => {
	const home = granted();
	const lib = path.resolve('user/kit-tools/owner-grant.cjs');
	const code = `const g = require(${JSON.stringify(lib)}); const o = g.lift(${JSON.stringify(held())}, ${JSON.stringify(call())}, ${JSON.stringify(home)}); process.stdout.write(o.hookSpecificOutput.permissionDecision);`;
	const { spawn } = await import('node:child_process');
	const runs = Array.from({ length: 8 }, () => new Promise((res) => { const c = spawn(process.execPath, ['-e', code]); let s = ''; c.stdout.on('data', (d) => { s += d; }); c.on('close', () => res(s)); }));
	const got = await Promise.all(runs);
	assert.equal(got.filter((d) => d === 'allow').length, 1, got.join(','));
});

// why: guards rule:outward-acts
test('K176 grant.mjs refuses a bad session id, a card id that is no name, an empty act, and a session granting itself', () => {
	const home = newHome();
	assert.notEqual(grant(home, { session: '../../x' }).status, 0);
	assert.notEqual(grant(home, { card: '../evil' }).status, 0);
	assert.notEqual(grant(home, { act: '   ' }).status, 0);
	assert.notEqual(grant(home, { env: { CLAUDE_CODE_SESSION_ID: SESSION } }).status, 0, 'a worker cannot grant itself');
	assert.equal(fs.existsSync(path.join(home, 'kit-grants')) && fs.readdirSync(path.join(home, 'kit-grants')).length, false);
	// The act is matched as the guard reads it: runs of spaces read as one, ends trimmed.
	const h2 = granted({ act: `  ${ACT.replace(/ /g, '   ')} ` });
	assert.equal(decision(grantLib().lift(held(), call(), h2)), 'allow');
});

// The real thing: kit installed into a temp home and project, the launcher run as Claude Code runs it.
function installed() {
	const root = kitTemp.makeTemp('grant-');
	const home = path.join(root, '.claude');
	const proj = path.join(root, 'app');
	fs.mkdirSync(proj);
	const git = (args) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { cwd: proj, encoding: 'utf8' });
	git(['init', '-q', '-b', 'main']);
	fs.writeFileSync(path.join(proj, 'README.md'), 'app\n');
	git(['add', 'README.md']);
	git(['commit', '-q', '-m', 'init']);
	install({ kit: KIT, home, target: 'user' });
	install({ kit: KIT, home, target: 'project', projectDir: proj });
	const launch = (input) => {
		const r = spawnSync(process.execPath, [path.join(home, 'kit-tools', 'kit-launch.cjs')], { input: JSON.stringify({ cwd: proj, ...input }), encoding: 'utf8', env: { ...ENV, CLAUDE_PROJECT_DIR: proj, CLAUDE_CONFIG_DIR: home } });
		return r.stdout ? JSON.parse(r.stdout) : null;
	};
	return { root, home, proj, launch };
}

// why: guards rule:outward-acts
test('K176 the installed launcher lifts a held act once with a grant, and holds it again after', () => {
	const { home, launch } = installed();
	assert.equal(decision(launch(call())), 'deny', 'held with no grant');
	assert.match(launch(call()).hookSpecificOutput.permissionDecisionReason, /^Owner's yes needed/);
	assert.equal(grant(home).status, 0);
	const out = launch(call());
	assert.equal(decision(out), 'allow', JSON.stringify(out));
	assert.match(out.hookSpecificOutput.permissionDecisionReason, /cmsg_card1/);
	assert.equal(decision(launch(call({ tool_use_id: 'toolu_2' }))), 'deny', 'spent');
});

// why: guards rule:outward-acts
test('K176 a worker cannot write into the grants folder, nor run grant.mjs to grant itself', () => {
	const { home, launch } = installed();
	const bash = (command) => decision(launch(call({ tool_input: { command } })));
	const f = path.join(home, 'kit-grants', 'aa.json');
	assert.equal(decision(launch(call({ tool_name: 'Write', tool_input: { file_path: f, content: '{}' } }))), 'deny', 'Write');
	assert.equal(bash(`echo {} > ${f.split(path.sep).join('/')}`), 'deny', 'shell by full path');
	assert.equal(bash('echo {} > ~/.claude/kit-grants/aa.json'), 'deny', 'shell by .claude');
	assert.equal(bash(`node ${path.join(home, 'kit-tools', 'grant.mjs').split(path.sep).join('/')} ${SESSION} Bash "${ACT}" cmsg_x`), 'deny', 'grant.mjs run by the worker');
	assert.equal(bash('node ~/.claude/kit-tools/grant.mjs x'), 'deny', 'grant.mjs by ~');
	assert.equal(bash('cd x && "node" ./grant.mjs x'), 'deny', 'grant.mjs from its folder');
	// The kit's own work names the file without running it.
	const why = (command) => JSON.stringify(launch(call({ tool_input: { command } })) || {});
	assert.doesNotMatch(why('git add user/kit-tools/grant.mjs'), /grant\.mjs records/, 'git add');
	assert.doesNotMatch(why('node --test tests/owner-grant.test.mjs'), /grant\.mjs records/, 'its tests');
	assert.equal(fs.existsSync(path.join(home, 'kit-grants')), false);
});

// why: guards rule:outward-acts
test('K176 the launcher lifts nothing when another check refuses the same call beside the owner\'s-yes hold', () => {
	const { home, launch } = installed();
	const act = `${ACT} && node tools/grant.mjs`;
	assert.equal(grant(home, { act }).status, 0);
	const out = launch(call({ tool_input: { command: act } }));
	assert.equal(decision(out), 'deny', JSON.stringify(out));
	assert.match(out.hookSpecificOutput.permissionDecisionReason, /^Owner's yes needed/, 'the guard\'s hold is the answer kept');
});
