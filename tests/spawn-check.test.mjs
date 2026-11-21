// The spawn check (build 23; the owner's pick 2026-11-21: every launch of a bare program name in the installed kit
// starts from node's own folder, held by a CI check with no list of known-bad sites).
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import kitTemp from '../project/.claude/kit-temp.cjs';
import { scanText, scan, mask } from '../scripts/spawn-check.mjs';

kitTemp.sessionRoot();
const SCRIPT = path.resolve('scripts/spawn-check.mjs');
const programs = (src) => scanText(src).map((f) => `${f.line} ${f.call}(${f.program})`);

// why: catches a git or gh launch from the project folder that the check lets through on Windows
test('the check names each bare-name launch with no safe folder, in every form a kit file writes one', () => {
	const bad = [
		"const r = spawnSync('git', ['status'], { encoding: 'utf8' });",
		"const out = execFileSync('git', ['log'], { cwd: projectDir });",
		"const x = require('node:child_process').spawnSync('gh', ['api'], { encoding: 'utf8', timeout: 3000 });",
		"child_process.execFile(\"gh\", args, cb);",
		"spawn(`ps`, ['-eo', 'comm']);",
		"execSync('git status --porcelain', { encoding: 'utf8' });",
		"cp.exec('gh pr view 1');",
		// Options held in a variable cannot be read, so the launch counts as unsafe.
		"spawnSync('git', args, opts);",
		// A folder that only looks safe: a cwd: inside a string, a different folder, the project.
		"spawnSync('git', ['x', 'cwd: path.dirname(process.execPath)'], { encoding: 'utf8' });",
		"spawnSync('git', a, { cwd: path.dirname(process.cwd()) });",
		"spawnSync('git', a, {\n  encoding: 'utf8',\n  cwd: PROJECT,\n});",
	];
	assert.deepEqual(programs(bad.join('\n')), [
		'1 spawnSync(git)', '2 execFileSync(git)', '3 spawnSync(gh)', '4 execFile(gh)', '5 spawn(ps)', '6 execSync(git)',
		'7 exec(gh)', '8 spawnSync(git)', '9 spawnSync(git)', '10 spawnSync(git)', '11 spawnSync(git)',
	]);
});

// why: catches a check that fails the safe launches every kit file must keep, so CI would block a fixed tree
test('the check passes a launch from node\'s own folder, a full path, the helper, and text that only names a call', () => {
	const good = [
		"const SAFE = path.dirname(process.execPath);",
		"spawnSync('git', ['-C', dir, 'status'], { encoding: 'utf8', cwd: path.dirname(process.execPath) });",
		"spawnSync('git', a, {\n  encoding: 'utf8',\n  timeout: 3000,\n  cwd: SAFE,\n});",
		"require('node:child_process').spawnSync('ps', ['-eo'], { cwd: require('node:path').dirname(process.execPath) });",
		"spawnSync(process.execPath, [file], { cwd: root });",
		"spawnSync('/usr/bin/git', ['status']);",
		"spawnSync('C:\\\\Windows\\\\System32\\\\whoami.exe', []);",
		"safeSpawn.git(dir, ['status'], { encoding: 'utf8' });",
		"safeSpawn.tool('gh', ['api', p], { encoding: 'utf8' });",
		"const m = /^(git|gh)$/.exec(name);",
		"const n = RE.exec(line);",
		"// spawnSync('git', ['status']) in a comment",
		"/* execSync('git status') in a block comment */",
		"const sample = \"node -e \\\"require('child_process').spawnSync('robocopy',['a','b'])\\\"\";",
		"const t = `spawnSync('git', [])`;",
		"const r = /spawnSync\\('git'/.test(s);",
	];
	assert.deepEqual(programs(good.join('\n')), []);
});

// why: catches a masked offset that moves a finding onto the wrong line of a long file
// planted: {"file":"scripts/spawn-check.mjs","was":"if (/[(,=:[!&|?{};+\\-*%<>~^]/.test(last)) return true;","to":"if (/[(,=:[!&|?{};+\\-*%<>~^)]/.test(last)) return true;"}
// planted: {"file":"scripts/spawn-check.mjs","was":"if (src[j] === '[') cls = true;","to":"if (src[j] === '[') cls = false;"}
test('the mask keeps every offset and line, and blanks only comments and the inside of literals', () => {
	const src = "a('x') // c\n/* d\ne */ b(/q/g, `t${1}`)\n";
	const m = mask(src);
	assert.equal(m.length, src.length);
	assert.equal(m.split('\n').length, src.split('\n').length);
	assert.equal(m.slice(0, 6), "a(' ')");
	assert.doesNotMatch(m, /c|d|e \*/);
	// The build 23a sweep (V3): a slash after a value is division, a quote inside a regex starts no string, and a
	// template is blanked through its ${...}; either slip would blank the code after it and hide a launch.
	const div = 'const q = (a) / b / c;';
	assert.equal(mask(div), div);
	assert.deepEqual(programs("const r = /[/]'/; spawnSync('git', []);"), ['1 spawnSync(git)']);
	assert.deepEqual(programs("const q = (a) / 2; spawnSync('git', []); const z = 1 / 2;"), ['1 spawnSync(git)']);
	assert.equal(mask('const t = `a${b}c`;'), 'const t = `      `;');
});

// why: guards the owner's pick of 2026-11-21 (every launch in project/ and user/ is checked, with no list of known-bad sites)
// planted: {"file":"scripts/spawn-check.mjs","was":"const EXTS = /\\.(mjs|cjs|js)$/;","to":"const EXTS = /\\.(mjs|cjs)$/;"}
// planted: {"file":"scripts/spawn-check.mjs","was":"if (e.name !== 'node_modules') walk(p);","to":"walk(p);"}
// planted: {"file":"scripts/spawn-check.mjs","was":"const at = args.indexOf('--dirs');","to":"const at = args.indexOf('--dir');"}
test('the command scans project/ and user/ of a kit root, names each file and line, and fails until none is left', () => {
	const root = kitTemp.makeTemp('spawn-check-');
	const put = (rel, text) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); };
	put('project/.claude/a.mjs', "import { spawnSync } from 'node:child_process';\nspawnSync('git', ['status']);\n");
	put('user/kit-hooks/b.cjs', "const { spawnSync } = require('child_process');\n\nspawnSync('gh', ['api'], { cwd: process.cwd() });\n");
	put('user/kit-tools/c.mjs', "spawnSync('git', [], { cwd: path.dirname(process.execPath) });\n");
	put('scripts/d.mjs', "spawnSync('git', ['status']);\n");
	put('project/notes.md', "spawnSync('git', ['status']);\n");
	assert.deepEqual(scan(root).map((f) => `${f.file}:${f.line}`), ['project/.claude/a.mjs:2', 'user/kit-hooks/b.cjs:3']);
	const r = spawnSync(process.execPath, [SCRIPT, root], { encoding: 'utf8' });
	assert.equal(r.status, 1, r.stdout + r.stderr);
	// Each site by its file, line and program, then the count CI fails on.
	const lines = r.stdout.trim().split(/\r?\n/);
	assert.deepEqual(lines.slice(0, 2), ['project/.claude/a.mjs:2 spawnSync(\'git\')', 'user/kit-hooks/b.cjs:3 spawnSync(\'gh\')']);
	assert.match(lines[2], /^2 /);
	put('project/.claude/a.mjs', "spawnSync('git', ['status'], { cwd: path.dirname(process.execPath) });\n");
	put('user/kit-hooks/b.cjs', "safeSpawn.tool('gh', ['api']);\n");
	const ok = spawnSync(process.execPath, [SCRIPT, root], { encoding: 'utf8' });
	assert.equal(ok.status, 0, ok.stdout);
	assert.match(ok.stdout, /^0 unsafe bare-name launches\n$/);
	assert.equal(spawnSync(process.execPath, [SCRIPT, path.join(root, 'nowhere')], { encoding: 'utf8' }).status, 2, 'a root with nothing to read is no pass');
	// The build 23a sweep (V4): a .js file is read, a package folder is not, and --dirs picks the folders.
	put('project/.claude/e.js', "spawnSync('git', ['status']);\n");
	put('project/node_modules/x/f.js', "spawnSync('git', ['status']);\n");
	put('scripts/g.mjs', "\nspawnSync('ps', []);\n");
	assert.deepEqual(scan(root).map((f) => `${f.file}:${f.line}`), ['project/.claude/e.js:1']);
	const only = spawnSync(process.execPath, [SCRIPT, root, '--dirs', 'scripts'], { encoding: 'utf8' });
	assert.equal(only.status, 1, only.stdout + only.stderr);
	assert.deepEqual(only.stdout.trim().split(/\r?\n/).slice(0, 2), ["scripts/d.mjs:1 spawnSync('git')", "scripts/g.mjs:2 spawnSync('ps')"]);
	assert.equal(spawnSync(process.execPath, [SCRIPT, root, '--dirs', 'nowhere'], { encoding: 'utf8' }).status, 2);
});

// The build 23a sweep (V2, F4): child_process under another name, a call renamed as it is taken out, a program held in
// a const, and a cwd: nested inside another option or the argument list each hid a launch.
// why: catches a git or gh launch from the project folder that the check let through under another name
test('the check follows child_process under another name, a renamed call, a program held in a name, and a nested cwd', () => {
	const cases = [
		["import * as proc from 'node:child_process';\nproc.spawnSync('git', []);", ['2 spawnSync(git)']],
		["import proc from 'child_process';\nproc.exec('gh pr view 1');", ['2 exec(gh)']],
		["const proc = require('node:child_process');\nproc.execFileSync('gh', ['api']);", ['2 execFileSync(gh)']],
		["const { spawnSync: run } = require('node:child_process');\nrun('git', ['status']);", ['2 spawnSync(git)']],
		["import { execSync as sh, spawn } from 'child_process';\nsh('git status');\nspawn('ps', []);", ['2 execSync(git)', '3 spawn(ps)']],
		["const GIT = 'git';\nspawnSync(GIT, ['status']);", ['2 spawnSync(git)']],
		["const SAFE = path.dirname(process.execPath);\nspawnSync('git', ['a'], { env: { cwd: SAFE } });", ['2 spawnSync(git)']],
		["const SAFE = path.dirname(process.execPath);\nspawnSync('git', [{ cwd: SAFE }]);", ['2 spawnSync(git)']],
		// The same forms from node's own folder, with a full path, or through a name that is no launch, pass.
		["const proc = require('child_process');\nproc.spawnSync('git', [], { cwd: path.dirname(process.execPath) });", []],
		["const { spawnSync: run } = require('node:child_process');\nrun(process.execPath, []);", []],
		["const GIT = '/usr/bin/git';\nspawnSync(GIT, []);", []],
		["const { run } = require('./lib.cjs');\nrun('git');", []],
		["const SAFE = path.dirname(process.execPath);\nspawnSync('git', a, { env: {}, cwd: SAFE });", []],
		["// import * as proc from 'child_process'\nproc.spawnSync('git');", []],
	];
	for (const [src, want] of cases) assert.deepEqual(programs(src), want, src);
});

// why: guards the owner's pick of 2026-11-21 (the kit's own installed files hold no unsafe launch, with no list of exceptions)
test('the kit\'s own installed files hold no bare-name launch outside node\'s own folder', () => {
	const r = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' });
	assert.equal(r.status, 0, r.stdout + r.stderr);
});
