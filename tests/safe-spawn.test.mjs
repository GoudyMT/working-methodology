// Build 23, K212-K214 and the class behind them (the owner's pick 2026-11-21: every launch). On Windows a program named
// by its bare name is looked for in the folder the child starts in before PATH, so a git.exe or gh.exe left in a
// project runs in place of the real one. Every installed file starts git, gh and the rest through safe-spawn.cjs, from
// node's own folder. The planted-tool tests run on Windows with a stand-in .exe; elsewhere the same launch is shown by
// putting "." first on PATH, which makes a POSIX lookup read the child's own folder in the same way.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import kitTemp from '../project/.claude/kit-temp.cjs';

kitTemp.sessionRoot();
const require = createRequire(import.meta.url);
const WIN = process.platform === 'win32';
const COPIES = ['project/.claude/safe-spawn.cjs', 'user/kit-tools/audits/safe-spawn.cjs', 'user/kit-hooks/safe-spawn.cjs'];

/**
 * A stand-in for a tool, left in a folder: when it runs it writes <name>-ran.txt beside itself and fails.
 * On Windows a copy of node named <name>.exe, which a preload names by its own file name; elsewhere a shell script,
 * with "." put first on PATH. Returns the marker's path and the environment the run under test needs.
 */
function plant(dir, name) {
	const marker = path.join(dir, `${name}-ran.txt`);
	if (WIN) {
		const exe = path.join(dir, `${name}.exe`);
		try { fs.linkSync(process.execPath, exe); } catch { fs.copyFileSync(process.execPath, exe); }
		const pre = path.join(dir, `${name}-stand-in.cjs`);
		fs.writeFileSync(pre, [
			"const path = require('path');",
			`if (path.basename(process.execPath).toLowerCase() === ${JSON.stringify(`${name}.exe`)}) {`,
			`\trequire('fs').writeFileSync(path.join(path.dirname(process.execPath), ${JSON.stringify(`${name}-ran.txt`)}), 'ran');`,
			'\tprocess.exit(3);',
			'}', ''].join('\n'));
		return { marker, env: { NODE_OPTIONS: `--require "${pre.split(path.sep).join('/')}"` } };
	}
	const script = path.join(dir, name);
	fs.writeFileSync(script, `#!/bin/sh\necho ran > "$(dirname "$0")/${name}-ran.txt"\nexit 3\n`);
	fs.chmodSync(script, 0o755);
	return { marker, env: { PATH: `.${path.delimiter}${process.env.PATH}` } };
}

// Set these variables for the length of fn, then put them back as they were.
function withEnv(vars, fn) {
	const was = {};
	for (const [k, v] of Object.entries(vars)) { was[k] = process.env[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v; }
	try { return fn(); } finally {
		for (const [k, v] of Object.entries(was)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
	}
}

// A repo with a name in its config and two commits, for the tools that read one.
function repo() {
	const dir = kitTemp.makeTemp('spawn-');
	const git = (...a) => { const r = spawnSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
	git('init', '-q', '-b', 'main');
	git('config', 'user.name', 'plantedcheckname');
	fs.writeFileSync(path.join(dir, 'RULES.md'), 'x'.repeat(27609));
	git('add', 'RULES.md'); git('commit', '-qm', 'base');
	const base = git('rev-parse', 'HEAD');
	fs.writeFileSync(path.join(dir, 'RULES.md'), 'x'.repeat(23834));
	git('add', 'RULES.md'); git('commit', '-qm', 'head');
	return { dir, base, head: git('rev-parse', 'HEAD') };
}

// why: guards rule:outward-acts (K212: a gh.exe left in the project ran with the owner's GitHub login when a report went out)
test('kit-report runs gh from node\'s own folder, never a gh left in the project', { windows: 'also' }, async () => {
	const dir = kitTemp.makeTemp('spawn-gh-');
	const { marker, env } = plant(dir, 'gh');
	const { github } = await import('../project/.claude/kit-report.mjs');
	// gh with no login and no token stops before it reaches the network, so the real one, if it runs, only fails.
	const ghHome = kitTemp.makeTemp('spawn-ghcfg-');
	const was = process.cwd();
	process.chdir(dir);
	try {
		const r = withEnv({ ...env, GH_CONFIG_DIR: ghHome, GH_TOKEN: undefined, GITHUB_TOKEN: undefined, GH_ENTERPRISE_TOKEN: undefined, GH_HOST: undefined }, () => github('GET', 'rate_limit'));
		assert.equal(fs.existsSync(marker), false, `the gh in the project ran: ${JSON.stringify(r)}`);
	} finally { process.chdir(was); }
});

// why: guards rule:outward-acts (K213: every report scrub ran git from the project folder, where a git.exe could wait)
test('the report scrub reads git from node\'s own folder, never a git left in the project', { windows: 'also' }, async () => {
	const r = repo();
	const { marker, env } = plant(r.dir, 'git');
	const { knownWords } = await import('../project/.claude/report-scrub.mjs');
	const words = withEnv(env, () => knownWords(r.dir, kitTemp.makeTemp('spawn-home-')));
	assert.equal(fs.existsSync(marker), false, 'the git in the project ran');
	assert.ok(words.includes('plantedcheckname'), `the real git's answer is missing: ${words.join(', ')}`);
});

// why: guards rule:outward-acts (K214: visuals ran git with no folder, so a git.exe in the project ran on every visuals run)
test('both installed copies of visuals run git from node\'s own folder, never a git left in the project', { windows: 'also' }, () => {
	for (const script of ['project/.claude/visuals.mjs', 'user/kit-tools/audits/visuals.mjs']) {
		const r = repo();
		const { marker, env } = plant(r.dir, 'git');
		const at = [r.base.slice(0, 7), r.head.slice(0, 7)];
		fs.writeFileSync(path.join(r.dir, 'visuals.json'), JSON.stringify({
			threshold: 0.01, price: { perMTok: 4, date: '2026-11-03' }, window: 400000, sessions: 1000,
			metrics: [{ name: 'Always-loaded rules file', paths: ['RULES.md'], limit: 25000, impact: ['cost', 'room'], tokens: { before: 9800, after: 8500, source: 'session context report', measuredAt: at } }],
		}));
		fs.writeFileSync(path.join(r.dir, 'body.md'), '# Body\n');
		const out = spawnSync(process.execPath, [path.resolve(script), r.base, r.head, '--config', 'visuals.json', '--body', 'body.md', '--out', 'out'],
			{ cwd: r.dir, encoding: 'utf8', env: { ...process.env, VISUALS_BROWSER: 'none', ...env } });
		assert.equal(fs.existsSync(marker), false, `${script}: the git in the project ran`);
		assert.doesNotMatch(out.stdout + out.stderr, /is not a commit here/, `${script}: the real git's answer is missing`);
		assert.equal(out.status, 0, `${script}: ${out.stdout}${out.stderr}`);
	}
});

// why: guards rule:outward-acts (a hook or an audit loads only its own folder, so the helper ships three times and must never drift)
test('the three installed copies of the safe-spawn helper are the same bytes', () => {
	for (const f of COPIES) assert.ok(fs.existsSync(path.resolve(f)), `${f} is not in the kit`);
	const [first, ...rest] = COPIES.map((f) => fs.readFileSync(path.resolve(f)));
	for (const [i, b] of rest.entries()) assert.ok(first.equals(b), `${COPIES[i + 1]} differs from ${COPIES[0]}`);
});

// why: guards rule:outward-acts (each launch starts in node's own folder, hidden, timed, and git names its folder with -C)
test('the helper starts every program from node\'s own folder, hidden, with a time limit, and git on the folder it names', () => {
	assert.ok(fs.existsSync(path.resolve(COPIES[0])), `${COPIES[0]} is not in the kit`);
	const s = require(path.resolve(COPIES[0]));
	const o = s.options({ encoding: 'utf8', cwd: '/somewhere/else', env: { A: '1' } });
	assert.equal(o.cwd, path.dirname(process.execPath), 'a caller\'s cwd never wins');
	assert.equal(o.windowsHide, true);
	assert.equal(o.timeout, 60000);
	assert.deepEqual(o.env, { A: '1', NoDefaultCurrentDirectoryInExePath: '1' });
	assert.equal(s.options({ timeout: 3000 }).timeout, 3000, 'a caller\'s own limit stays');
	const here = s.tool(process.execPath, ['-e', 'process.stdout.write(process.cwd() + "|" + process.env.NoDefaultCurrentDirectoryInExePath)'], { encoding: 'utf8' });
	assert.equal(here.stdout, `${path.dirname(process.execPath)}|1`);
	const r = repo();
	assert.equal(s.gitRead(r.dir, ['config', 'user.name'], { encoding: 'utf8' }).stdout.trim(), 'plantedcheckname', 'git -C reads the folder named');
	assert.equal(s.git(r.dir, ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim(), r.head);
	assert.equal(s.toolOut('git', ['-C', r.dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), r.head);
	assert.throws(() => s.toolOut('git', ['-C', r.dir, 'no-such-command'], { encoding: 'utf8', stdio: 'pipe' }), 'a failure throws, as execFileSync');
	// A read turns every fetch protocol off; a git that may fetch or push keeps them.
	assert.ok(s.NO_PROGRAMS.includes('protocol.allow=never') && s.NO_PROGRAMS.includes('core.fsmonitor=false'));
	assert.deepEqual(s.NO_FSMONITOR, ['-c', 'core.fsmonitor=false']);
});
