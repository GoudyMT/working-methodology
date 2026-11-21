// Build 22 sweep: the launcher holds a kit tool run from another Claude folder (K206), and the sweep found spellings that
// got past it, and reads it held by mistake. Each test runs a copy of the launcher whose home is a throwaway folder.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import kitTemp from '../project/.claude/kit-temp.cjs';
import { GUARDED } from '../scripts/build-record.mjs';

kitTemp.sessionRoot();
const require = createRequire(import.meta.url);
const SRC = path.resolve('user/kit-tools/kit-launch.cjs');
const posix = (p) => p.split(path.sep).join('/');

// The session's own folder (home), a user folder holding .claude (user), and other Claude folders with a kit install:
// one with a plain name and one with a space in its path.
function world() {
	const home = kitTemp.makeTemp('oh-home-');
	fs.mkdirSync(path.join(home, 'kit-tools'));
	const file = path.join(home, 'kit-tools', 'kit-launch.cjs');
	fs.copyFileSync(SRC, file);
	const L = require(file);
	const user = kitTemp.makeTemp('oh-user-');
	const mk = (...parts) => { const d = path.join(...parts); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, 'kit-install.json'), '{}'); return d; };
	const dirs = { home, user, plain: mk(kitTemp.makeTemp('oh-alt-'), 'alt', '.claude'), spaced: mk(kitTemp.makeTemp('oh-sp-'), 'My Claude', '.claude'), userClaude: mk(user, '.claude') };
	fs.writeFileSync(path.join(home, 'kit-install.json'), '{}');
	const call = (command, tool = 'Bash', cwd = user) => L && L.otherHomeTool({ tool_name: tool, tool_input: { command }, cwd }, home, user);
	return { L, call, ...dirs };
}
const verdict = (o) => o?.hookSpecificOutput?.permissionDecision ?? null;

// why: catches a session running another Claude folder's kit tool with an option, a cd, a quote or a home variable in the way
test('a kit tool run from another Claude folder is held however the command is spelled', () => {
	const { L, call, plain, spaced } = world();
	assert.equal(typeof L.otherHomeTool, 'function', 'the launcher checks the folder a kit tool runs from');
	const P = posix(plain);
	const rows = {
		// An argument between node and the path (finding 2).
		'a node option': `node --no-warnings ${P}/skills/pre-pr-sweep/approve.mjs c.json`,
		'the end of options': `node -- ${P}/kit-tools/merge-gate.mjs arm 12`,
		'an option with a value': `node --import x ${P}/kit-tools/merge-gate.mjs arm 12`,
		// A folder moved into first (finding 3).
		'cd then a relative path': `cd ${P} && node kit-tools/merge-gate.mjs arm 12`,
		'cd then ./': `cd ${P} && node ./kit-tools/merge-gate.mjs`,
		'cd with a quoted folder': `cd "${P}"; node kit-tools/merge-gate.mjs arm 12`,
		'pushd': `pushd ${P}; node kit-tools/merge-gate.mjs arm 12`,
		'Set-Location': `Set-Location -Path ${P}; node kit-tools/merge-gate.mjs arm 12`,
		// Quotes (finding 4).
		'a space inside quotes': `node "${posix(spaced)}/kit-tools/merge-gate.mjs" arm 12`,
		'a quote ending inside the path': `node "${P}"/kit-tools/merge-gate.mjs arm 12`,
		'escaped spaces': `node ${posix(spaced).replace(/ /g, '\\ ')}/kit-tools/merge-gate.mjs arm 12`,
		// Another way to start node.
		'an env assignment first': `NODE_OPTIONS= node ${P}/kit-tools/merge-gate.mjs arm 12`,
		'a full node path': `"${posix(process.execPath)}" ${P}/kit-tools/merge-gate.mjs arm 12`,
		'a shell -c string': `bash -c "node ${P}/kit-tools/merge-gate.mjs arm 12"`,
		'a later segment': `echo go && node ${P}/kit-tools/merge-gate.mjs arm 12`,
	};
	for (const [name, command] of Object.entries(rows)) {
		assert.equal(verdict(call(command)), 'deny', `held: ${name}: ${command}`);
	}
	// A relative folder is read from the session's own folder.
	assert.equal(verdict(call('cd alt/.claude && node kit-tools/merge-gate.mjs arm 12', 'Bash', path.dirname(path.dirname(plain)))), 'deny', 'held: cd, relative to the session folder');
	assert.equal(verdict(call(`& node "${P}/kit-tools/merge-gate.mjs" arm 12`, 'PowerShell')), 'deny', 'held: the call operator');
});

// why: catches the user's home spelled $USERPROFILE (Git Bash) or ${env:USERPROFILE} (PowerShell) getting past the check
test('the user home spelled with USERPROFILE is expanded like ~ and $HOME', () => {
	const { L, call } = world();
	assert.equal(typeof L.otherHomeTool, 'function');
	assert.equal(verdict(call('node $USERPROFILE/.claude/kit-tools/merge-gate.mjs arm 12')), 'deny', 'Git Bash $USERPROFILE');
	assert.equal(verdict(call('node "${env:USERPROFILE}\\.claude\\kit-tools\\merge-gate.mjs" arm 12', 'PowerShell')), 'deny', 'PowerShell ${env:USERPROFILE}');
	assert.equal(verdict(call('node $USERPROFILEX/.claude/kit-tools/merge-gate.mjs arm 12')), null, 'another variable is not the home');
});

// why: catches a read or search that only mentions node being held, and the session's own folder through a link taken for another
test('a read that only mentions node passes, and so does the own folder through a link', () => {
	const { L, call, plain, home } = world();
	assert.equal(typeof L.otherHomeTool, 'function');
	const P = posix(plain);
	const passes = {
		'grep': `grep -n node ${P}/kit-tools/merge-gate.mjs`,
		'rg': `rg "node" ${P}/skills/pre-pr-sweep/approve.mjs`,
		'echo': `echo "run: node ${P}/kit-tools/merge-gate.mjs"`,
		'git log -S': `git log -S"node ${P}/kit-tools/merge-gate.mjs"`,
		'cat after cd': `cd ${P} && cat kit-tools/merge-gate.mjs`,
		'another script after cd': `cd ${P} && node scripts/build.mjs`,
		'the path as an argument of another script': `node scripts/x.mjs ${P}/kit-tools/merge-gate.mjs`,
		'node eval': `node -e "console.log(1)" ${P}/kit-tools/merge-gate.mjs`,
	};
	for (const [name, command] of Object.entries(passes)) assert.equal(verdict(call(command)), null, `not held: ${name}: ${command}`);
	// The session's own folder by a link is the same folder; a link to another one is still another.
	const links = kitTemp.makeTemp('oh-links-');
	const toOwn = path.join(links, 'own');
	const toOther = path.join(links, 'other');
	fs.symlinkSync(home, toOwn, 'junction');
	fs.symlinkSync(plain, toOther, 'junction');
	assert.equal(verdict(call(`node ${posix(toOwn)}/kit-tools/merge-gate.mjs arm 12`)), null, 'a link to the own folder is not another');
	assert.equal(verdict(call(`node ${posix(toOther)}/kit-tools/merge-gate.mjs arm 12`)), 'deny', 'a link to another folder is held');
});

// The /c/ drive spelling is Git Bash on Windows; Linux reads /c/ as a real path, so the Windows job runs this one.
// why: catches the Git Bash /c/ spelling of a Windows path getting past the check as C:\c\Users\...
test('on Windows the /c/ spelling of another Claude folder is held', { windows: true }, () => {
	const { L, call, plain } = world();
	assert.equal(typeof L.otherHomeTool, 'function');
	const gitBash = `/${plain[0].toLowerCase()}${posix(plain).slice(2)}`;
	assert.equal(verdict(call(`node ${gitBash}/kit-tools/merge-gate.mjs arm 12`)), 'deny');
	assert.equal(verdict(call(`cd ${gitBash} && node kit-tools/merge-gate.mjs arm 12`)), 'deny');
});

// why: catches a held session not told it may read the tool, or sent a ~ path PowerShell 5.1 does not expand
test('the hold says reading is fine and names this session\'s copy, with a full path for PowerShell', () => {
	const { L, plain, user, userClaude } = world();
	assert.equal(typeof L.otherHomeTool, 'function');
	const run = (tool) => L.otherHomeTool({ tool_name: tool, tool_input: { command: `node ${posix(plain)}/kit-tools/merge-gate.mjs arm 12` }, cwd: user }, userClaude, user)?.hookSpecificOutput?.permissionDecisionReason ?? '';
	const bash = run('Bash');
	assert.ok(bash.includes('node ~/.claude/kit-tools/merge-gate.mjs'), bash);
	assert.ok(/reading it is fine/i.test(bash), bash);
	const ps = run('PowerShell');
	assert.ok(ps.includes(`node ${posix(userClaude)}/kit-tools/merge-gate.mjs`), ps);
	assert.ok(!ps.includes('node ~/'), 'PowerShell 5.1 leaves ~ unexpanded');
});

// why: catches a fix to the guard start script shipping with no test, since it was not on the guarded list
test('the guard start script is a guarded file, so a fix to it owes a test', () => {
	assert.equal(GUARDED.test('user/kit-tools/kit-start.sh'), true);
	assert.equal(GUARDED.test('user/kit-tools/kit-launch.cjs'), true);
	assert.equal(GUARDED.test('user/kit-tools/kit-start.sh.bak'), false, 'the name ends the match');
});
