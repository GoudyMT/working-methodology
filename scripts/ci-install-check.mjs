#!/usr/bin/env node
// The install check (T15 D1 and D2, the owner 2026-11-10; when it runs, the owner's pick 2026-11-12): what the
// release verify proves on the owner's PC, proved in CI on every change to install or the guards, every push to main
// and before a release.
//   D1  install user and install project from this checkout, into a throwaway home and git repo, each exits 0 and
//       the use check says every part is wired; then an upgrade: the previous release installed first, this build
//       over it, the same checks, and status names no gap but the unreleased build.
//   D2  every command the push guard's proof must hold goes through the installed launcher, the way Claude Code
//       calls it (the hook command install wrote, run by sh, the call as JSON on stdin), and is held; every command
//       the proof must pass, passes. The planted forms of the 1.26.0 review (S2, S3, C6) and every K1 spelling are held,
//       each with its kind (never, or the owner's yes), and the false holds 1.28.0 fixed run (build 2b pass bars 1, 4).
//   node scripts/ci-install-check.mjs [--root <empty folder>]     exit 0 every check passed, 1 a check failed
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import kitTemp from '../project/.claude/kit-temp.cjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fails = [];
const say = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fails.push(what); return ok; };
const git = (cwd, ...a) => spawnSync('git', ['-c', 'user.name=kit-ci', '-c', 'user.email=kit-ci@users.noreply.github.com', '-c', 'commit.gpgsign=false', ...a], { cwd, encoding: 'utf8' });

function kit(from, home, ...args) {
	const r = spawnSync(process.execPath, [path.join(from, 'scripts', 'kit.mjs'), ...args], { encoding: 'utf8', env: { ...process.env, KIT_CLAUDE_HOME: home, CLAUDE_CONFIG_DIR: home, CLAUDE_CODE_REMOTE: '' } });
	return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

function newRepo(dir) {
	fs.mkdirSync(dir, { recursive: true });
	git(dir, 'init', '-q', '-b', 'main');
	git(dir, 'commit', '-q', '--allow-empty', '-m', 'init');
	return dir;
}

// Install user, then install project, from one kit folder; both exit 0 and the use check finds every part wired.
function installBoth(from, home, proj, label, extra = []) {
	const u = kit(from, home, 'install', 'user', ...extra);
	say(u.code === 0, `${label}: install user exits 0${u.code === 0 ? '' : `\n${u.out}`}`);
	const p = kit(from, home, 'install', 'project', proj, ...extra);
	say(p.code === 0 && /Use check: every part present and wired/.test(p.out), `${label}: install project exits 0 and every part is wired${p.code === 0 ? '' : `\n${p.out}`}`);
}

// The newest release tag below this checkout's VERSION.
function previousTag() {
	const now = fs.readFileSync(path.join(KIT, 'VERSION'), 'utf8').trim().split('.').map(Number);
	const below = (v) => { for (let i = 0; i < 3; i++) if (v[i] !== now[i]) return v[i] < now[i]; return false; };
	return git(KIT, 'tag', '--list', 'v*', '--sort=-v:refname').stdout.split(/\r?\n/).find((t) => /^v\d+\.\d+\.\d+$/.test(t) && below(t.slice(1).split('.').map(Number))) || null;
}

// The hook command install wrote for every tool call, run the way Claude Code runs it.
function launcher(home, proj, transcript) {
	const settings = JSON.parse(fs.readFileSync(path.join(home, 'settings.json'), 'utf8'));
	const entry = (settings.hooks.PreToolUse || []).flatMap((h) => h.hooks || []).find((h) => /kit-launch\.cjs['"]?\s*$/.test(h.command));
	if (!entry) return null;
	// at: the folder the call runs in (the project unless named); bare: no CLAUDE_PROJECT_DIR, as a hook may be called.
	return (tool, command, { at = proj, bare = false } = {}) => {
		const input = { session_id: 'ci-install-check', transcript_path: transcript, cwd: at, hook_event_name: 'PreToolUse', tool_name: tool, tool_input: { command } };
		const env = { ...process.env, CLAUDE_PROJECT_DIR: proj, KIT_CLAUDE_HOME: home, CLAUDE_CONFIG_DIR: home };
		if (bare) delete env.CLAUDE_PROJECT_DIR;
		const r = spawnSync('sh', ['-c', entry.command], { cwd: at, input: JSON.stringify(input), encoding: 'utf8', timeout: 30000, env });
		let decision = '';
		try { decision = JSON.parse(r.stdout).hookSpecificOutput.permissionDecision; } catch { /* no decision: the call goes on */ }
		const out = `${r.stdout}${r.stderr}`.trim();
		const held = r.status === 2 || decision === 'deny' || decision === 'ask';
		return { held, out, kind: !held ? 'runs' : /Never by a tool/.test(out) ? 'never' : /Owner's yes needed/.test(out) ? 'ask' : 'held' };
	};
}

function main(argv) {
	const at = argv.indexOf('--root');
	kitTemp.sessionRoot();
	const root = at >= 0 ? path.resolve(argv[at + 1]) : kitTemp.makeTemp('install-check-');
	console.log('='.repeat(60));
	console.log('INSTALL CHECK');
	console.log('='.repeat(60));

	// D1: a fresh install of this build.
	const home = path.join(root, 'home');
	const proj = newRepo(path.join(root, 'proj'));
	installBoth(KIT, home, proj, 'fresh', ['--unreleased']);

	// D1: the previous release, then this build over it.
	const prev = previousTag();
	if (say(Boolean(prev), `a release tag below this build to upgrade from (${prev || 'none'})`)) {
		const prevKit = path.join(root, 'prev-kit');
		const c = git(root, 'clone', '--quiet', '--no-hardlinks', '--branch', prev, KIT, prevKit);
		if (say(c.status === 0, `clone ${prev}${c.status === 0 ? '' : `: ${c.stderr}`}`)) {
			const home2 = path.join(root, 'home-upgrade');
			const proj2 = newRepo(path.join(root, 'proj-upgrade'));
			installBoth(prevKit, home2, proj2, `release ${prev}`);
			installBoth(KIT, home2, proj2, `upgrade ${prev} to this build`, ['--unreleased']);
			const s = kit(KIT, home2, 'status', proj2);
			const gaps = s.out.split('\n').filter((l) => /differs from the kit|behind kit|not wired|missing/i.test(l));
			say(gaps.length === 0, `upgrade: status names no gap but the unreleased build${gaps.length ? `\n    ${gaps.join('\n    ')}` : ''}`);
		}
	}

	// D2: the guards, as installed, through the launcher.
	const transcript = path.join(root, 'transcript.jsonl');
	fs.writeFileSync(transcript, '');
	const call = fs.existsSync(path.join(home, 'settings.json')) ? launcher(home, proj, transcript) : null;
	if (say(Boolean(call), 'install user wired the kit launcher for every tool call')) {
		const lists = spawnSync(process.execPath, ['-e', `process.stdout.write(JSON.stringify(require(${JSON.stringify(path.join(proj, '.claude', 'guard-outward-check.cjs'))})))`], { encoding: 'utf8' });
		const { ASK, PASS } = JSON.parse(lists.stdout || '{"ASK":[],"PASS":[]}');
		say(ASK.length > 0 && PASS.length > 0, `the installed push proof names its cases (${ASK.length} held, ${PASS.length} passed)`);
		const planted = [
			// S2, S3: hooks moved or turned off for one command.
			['Bash', 'git -c core.hooksPath=/dev/null push origin feat/x'],
			['Bash', 'GIT_DIR=../other/.git git push origin feat/x'],
			['Bash', 'git --git-dir=../other/.git push origin feat/x'],
			['Bash', 'git -c include.path=../evil.cfg push origin feat/x'],
			// C6: the AI shell markers cleared before a push.
			['Bash', 'CLAUDECODE= git push origin feat/x'],
			['Bash', 'env -u CLAUDECODE git push origin feat/x'],
		];
		const missed = [];
		for (const command of ASK) if (!call('Bash', command).held) missed.push(command);
		for (const [tool, command] of planted) if (!call(tool, command).held) missed.push(`[planted] ${command}`);
		say(missed.length === 0, `every command the proof holds is held through the launcher${missed.length ? `; missed ${missed.length}:\n    ${missed.join('\n    ')}` : ''}`);
		// Pass bar 1 of build 2b (never lowered): each planted case, and each spelling of a gate bypass the 1.27.0 sweep
		// found (K1), is held with its kind: a bypass is never by a tool, an act outside the push bound is the owner's yes.
		// Also from another repo, and with no project folder named (the plan check's P13).
		const other = newRepo(path.join(root, 'other'));
		const kinds = [
			...planted.map(([tool, command]) => [tool, command, 'never']),
			['Bash', '"C:\\Program Files\\GitHub CLI\\gh.exe" api -X PUT repos/o/r/contents/a.txt -f branch=main -f message=x -f content=eA==', 'never'],
			['Bash', 'GIT_DIR+=/x git push origin feat/x', 'never'],
			['PowerShell', 'Set-Item Env:GIT_DIR C:\\x; git push origin feat/x', 'never'],
			['PowerShell', '$env:GIT_DIR = "C:\\x"; git push origin feat/x', 'never'],
			['Bash', 'env -vi git push origin feat/x', 'never'],
			['Bash', 'env --ignore-env git push origin feat/x', 'never'],
			['Bash', 'unset ${!CLAUDE*}; git push origin feat/x', 'never'],
			['Bash', 'exec -c git push origin feat/x', 'never'],
			['PowerShell', 'Start-Process git -ArgumentList "push","origin","feat/x" -UseNewEnvironment', 'never'],
			['Bash', "printf -v CLAUDECODE ''; git push origin feat/x", 'never'],
			['Bash', 'V=CODE; unset CLAUDE$V; git push origin feat/x', 'never'],
			['Bash', 'echo x > .claude/guard.cjs', 'never'],
			['Bash', 'git push origin main', 'ask'],
			['Bash', 'git push origin feat/x', 'ask', { at: other }],
			['Bash', 'git -c core.hooksPath=/dev/null push origin feat/x', 'never', { bare: true }],
		];
		const wrong = [];
		for (const [tool, command, want, opts] of kinds) {
			const got = call(tool, command, opts).kind;
			if (got !== want) wrong.push(`${command}${opts ? ` ${JSON.stringify(opts).replace(root, '<root>')}` : ''}: ${got}, not ${want}`);
		}
		say(wrong.length === 0, `every planted case is held with its kind (${kinds.length} cases)${wrong.length ? `; wrong ${wrong.length}:\n    ${wrong.join('\n    ')}` : ''}`);
		// Pass bar 4: the false holds V1, K2 and K19 run.
		const reads = ['npm test -- tests/*', 'sed -n 1,20p .claude/guard.cjs', 'cat .claude/settings.json | head -60; ls .claude/', 'grep -n CLAUDECODE notes.txt', 'echo $CLAUDECODE'];
		const heldReads = reads.filter((command) => call('Bash', command).held);
		say(heldReads.length === 0, `the false holds the build fixed run (${reads.length} reads)${heldReads.length ? `; held:\n    ${heldReads.join('\n    ')}` : ''}`);
		// The push proof's safe commands are safe for the push guard; another guard may hold one by its own rule. Each
		// such hold is named here with its reason, and printed, never dropped.
		const OTHER_GUARD = [
			// task-gate: a commit waits until the session has read the commit rules; this session has read nothing.
			[/^git commit\b/, /Held: before git commit, read /, 'task-gate holds a commit until the session reads its rules (by design)'],
			// owner-proof: a program it does not know, given a folder/* word, is read as maybe writing a guard file. Found
			// by this check (2026-11-12) in 1.26.0 as released; on the improvement list, not changed in this build.
			[/^twine check dist\/\*$/, /^.*Never by a tool: the kit's guards/, 'owner-proof holds an unknown program given a folder/* word (on the improvement list)'],
		];
		const stopped = [];
		for (const command of PASS) {
			const r = call('PowerShell', command);
			if (!r.held) continue;
			const named = OTHER_GUARD.find(([cmd, why]) => cmd.test(command) && why.test(r.out));
			if (named) console.log(`NOTE  ${command}: held by ${named[2]}`);
			else stopped.push(`${command}\n        ${r.out.split('\n')[0].slice(0, 200)}`);
		}
		say(stopped.length === 0, `every command the proof passes, passes through the launcher${stopped.length ? `; held ${stopped.length}:\n    ${stopped.join('\n    ')}` : ''}`);
	}

	console.log(fails.length ? `Install check: ${fails.length} check(s) FAILED` : 'Install check: every check passed');
	if (at < 0) kitTemp.removeTemp(root);
	return fails.length ? 1 : 0;
}

process.exitCode = main(process.argv.slice(2));
