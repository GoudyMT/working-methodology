// T3 (1.30.0): the resume packet. A session starts from one check command instead of re-reading every tracking file;
// the check must catch every way the packet can be stale or wrong, and fall back to the full reading when it cannot
// tell. Each case builds a project from the kit's own templates, the way install leaves one, then drifts it.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import kitTemp from '../project/.claude/kit-temp.cjs';

kitTemp.sessionRoot();
const KIT = path.resolve('.');
const SCRIPT = path.join(KIT, 'project', '.claude', 'resume-packet.mjs');
const TRACKING = ['_Start Here.md', '_Active Plan.md', '_Working Memory.md', '_Loop Learnings.md', '_Session Log.md', '_Master Roadmap.md'];
const git = (dir, ...a) => spawnSync('git', ['-C', dir, ...a], { encoding: 'utf8' });

function project({ fill = true } = {}) {
	const dir = kitTemp.makeTemp('packet-');
	git(dir, 'init', '-q', '-b', 'main');
	git(dir, 'config', 'user.email', 't@example.invalid');
	git(dir, 'config', 'user.name', 't');
	for (const f of TRACKING) fs.copyFileSync(path.join(KIT, 'project', f), path.join(dir, f));
	if (fill) {
		const put = (f, from, to) => { const p = path.join(dir, f); fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace(from, to)); };
		put('_Active Plan.md', /\*\*NEXT:\*\* .*/, '**NEXT:** (1) build the export step in [the plan](docs/plans/export%20step.md); (2) its sweep.');
		put('_Active Plan.md', /\*\*Pending the owner:\*\*\n- .*/, '**Pending the owner:**\n- pick the export format');
		put('_Working Memory.md', /\*\*Last Session:\*\* .*/, '**Last Session:** 7 (2026-11-14 - import done).');
		put('_Loop Learnings.md', /## Open lessons\n\n<!--.*-->/, '## Open lessons\n\n### L-03 | Stale fixture | open\n- What happened: a test read an old fixture\n- Root cause: copied once\n- Rule (never/always): always build fixtures in the test\n- Recurred: 0');
		fs.mkdirSync(path.join(dir, 'docs', 'plans'), { recursive: true });
		fs.writeFileSync(path.join(dir, 'docs', 'plans', 'export step.md'), '# Export step\n');
	}
	fs.writeFileSync(path.join(dir, 'app.txt'), 'x\n');
	git(dir, 'add', 'app.txt');
	git(dir, 'commit', '-q', '-m', 'first');
	return dir;
}
const run = (dir, ...a) => spawnSync(process.execPath, [SCRIPT, ...a], { cwd: dir, encoding: 'utf8' });
const packet = (dir) => path.join(dir, '.kit', 'resume-packet.md');
const verdict = (out) => (out.match(/^VERDICT: .*$/m) || [''])[0];

// why: guards rule:post-compact-orientation
test('write finds every section in the shipped templates and a filled project, and stays under 2,048 bytes', () => {
	for (const fill of [false, true]) {
		const dir = project({ fill });
		const w = run(dir, 'write');
		assert.equal(w.status, 0, w.stderr);
		assert.match(w.stdout, /written:/, w.stdout + w.stderr);
		const text = fs.readFileSync(packet(dir), 'utf8');
		assert.doesNotMatch(text, /not found/i, text);
		assert.ok(Buffer.byteLength(text) <= 2048, `${Buffer.byteLength(text)} bytes`);
		for (const f of TRACKING) assert.match(text, new RegExp(`^[0-9a-f]{16} ${f.replace('.', '\\.')}$`, 'm'));
	}
	const filled = project();
	run(filled, 'write');
	const text = fs.readFileSync(packet(filled), 'utf8');
	assert.match(text, /build the export step/);
	assert.match(text, /pick the export format/);
	assert.match(text, /L-03 \| Stale fixture[^\n]*\n[^\n]*always build fixtures in the test/);
	assert.match(text, /^[0-9a-f]{16} docs\/plans\/export step\.md$/m);
});

// why: guards rule:post-compact-orientation
test('check after write reads only the plan; a changed or missing file is named for a fresh read', () => {
	const dir = project();
	run(dir, 'write');
	let c = run(dir, 'check');
	assert.equal(c.status, 0);
	assert.match(c.stdout, /^same _Active Plan\.md$/m);
	assert.equal(verdict(c.stdout), 'VERDICT: read docs/plans/export step.md');
	fs.appendFileSync(path.join(dir, '_Working Memory.md'), '\nmore\n');
	fs.rmSync(path.join(dir, '_Master Roadmap.md'));
	c = run(dir, 'check');
	assert.match(c.stdout, /^CHANGED _Working Memory\.md$/m);
	assert.match(c.stdout, /^missing _Master Roadmap\.md$/m);
	assert.equal(verdict(c.stdout), 'VERDICT: read docs/plans/export step.md, _Working Memory.md, _Master Roadmap.md');
	// The orientation steps reach the session whatever it opens next.
	assert.match(c.stdout, /Branch check/);
	assert.match(c.stdout, /Sweep check/);
});

// why: guards rule:post-compact-orientation
test('a hand-edited packet or a dropped hash line means the full reading, never a trusted packet', () => {
	const dir = project();
	run(dir, 'write');
	const p = packet(dir);
	const orig = fs.readFileSync(p, 'utf8');
	fs.writeFileSync(p, orig.replace('build the export step', 'delete the export step'));
	let c = run(dir, 'check');
	assert.match(c.stdout, /packet text: CHANGED/);
	assert.match(verdict(c.stdout), /^VERDICT: full reading: _Start Here\.md, AGENTS\.md, _Loop Learnings\.md/);
	fs.writeFileSync(p, orig.replace(/^[0-9a-f]{16} _Active Plan\.md\n/m, ''));
	c = run(dir, 'check');
	assert.match(verdict(c.stdout), /^VERDICT: full reading/);
});

// why: guards rule:post-compact-orientation
test('git state is read live: a commit or a branch switch after write is flagged', () => {
	const dir = project();
	run(dir, 'write');
	fs.writeFileSync(path.join(dir, 'app.txt'), 'y\n');
	git(dir, 'commit', '-qam', 'second');
	let c = run(dir, 'check');
	assert.match(c.stdout, /^git head: CHANGED/m);
	git(dir, 'switch', '-q', '-c', 'feat/other');
	c = run(dir, 'check');
	assert.match(c.stdout, /^git branch: CHANGED \(packet main, now feat\/other\)$/m);
});

// why: guards rule:post-compact-orientation
test('no packet, a broken packet or a check that cannot run still ends in the full reading', () => {
	const dir = project();
	let c = run(dir, 'check');
	assert.equal(c.status, 0);
	assert.match(verdict(c.stdout), /^VERDICT: full reading/);
	fs.mkdirSync(path.join(dir, '.kit'), { recursive: true });
	fs.writeFileSync(packet(dir), '\u0000garbage');
	c = run(dir, 'check');
	assert.match(verdict(c.stdout), /^VERDICT: full reading/);
	// A packet path that is a folder makes the read throw: still a verdict.
	fs.rmSync(packet(dir));
	fs.mkdirSync(packet(dir));
	c = run(dir, 'check');
	assert.equal(c.status, 0);
	assert.match(verdict(c.stdout), /^VERDICT: full reading/);
});

// why: guards rule:post-compact-orientation
test('a long Pending list is trimmed, but the Resume Point, every hash line and every open lesson stay', () => {
	const dir = project();
	const plan = path.join(dir, '_Active Plan.md');
	fs.writeFileSync(plan, fs.readFileSync(plan, 'utf8').replace('- pick the export format', Array.from({ length: 80 }, (_, i) => `- decision ${i} waiting on the owner, with a long reason attached`).join('\n')));
	run(dir, 'write');
	const text = fs.readFileSync(packet(dir), 'utf8');
	assert.ok(Buffer.byteLength(text) <= 2048, `${Buffer.byteLength(text)} bytes`);
	assert.match(text, /build the export step/);
	assert.match(text, /always build fixtures in the test/);
	assert.match(text, /trimmed/);
	assert.equal((text.match(/^[0-9a-f]{16} /gm) || []).length, TRACKING.length + 1);
});

// why: guards rule:security-standards
test('a Resume Point naming a file outside the project is refused, never hashed or read', () => {
	for (const bad of ['../outside.md', 'C:/Windows/win.md', '/etc/passwd.md', '..\\\\up.md']) {
		const dir = project();
		const p = path.join(dir, '_Active Plan.md');
		fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace('docs/plans/export%20step.md', bad));
		run(dir, 'write');
		const text = fs.readFileSync(packet(dir), 'utf8');
		assert.match(text, /plan: refused/, bad);
		assert.doesNotMatch(text, /outside\.md$|win\.md$|passwd\.md$|up\.md$/m, bad);
	}
});

// why: guards rule:security-standards
test('the packet\'s git calls run no program a repo config names', () => {
	const dir = project();
	const marker = path.join(dir, 'ran.txt');
	const hook = path.join(dir, 'fsmon.cjs');
	fs.writeFileSync(hook, `require('fs').writeFileSync(${JSON.stringify(marker)}, 'x');`);
	git(dir, 'config', 'core.fsmonitor', `"${process.execPath}" "${hook}"`);
	run(dir, 'write');
	assert.match(run(dir, 'check').stdout, /^VERDICT: /m);
	assert.match(fs.readFileSync(packet(dir), 'utf8'), /^branch: main /m);
	assert.equal(fs.existsSync(marker), false);
});

// why: guards rule:post-compact-orientation
test('no file the kit ships still orders the old full Reading Order', () => {
	const shipped = ['rules/core.md', 'rules/_parts/agents-head.md', 'rules/tracking-and-handoff.md', 'project/_Start Here.md', 'project/CLAUDE.md', 'user/skills/closeout/SKILL.md', 'user/skills/closeout/examples/handoff-a.md', 'user/skills/closeout/examples/handoff-b.md', 'NEW-PROJECT.md', 'scripts/kit.mjs'];
	for (const f of shipped) {
		const t = fs.readFileSync(path.join(KIT, f), 'utf8');
		assert.doesNotMatch(t, /fresh reads of the Reading Order|Fresh Read calls\*\* on every file in the handoff's Reading Order|fresh reads of the reading order/i, f);
		assert.doesNotMatch(t, /^@_(Start\\ Here|Loop\\ Learnings|Working\\ Memory|Active\\ Plan)\.md$/m, f);
	}
	assert.match(fs.readFileSync(path.join(KIT, 'project/CLAUDE.md'), 'utf8'), /^@AGENTS\.md$/m);
	assert.match(fs.readFileSync(path.join(KIT, 'project/CLAUDE.md'), 'utf8'), /resume-packet\.mjs check/);
	const allow = JSON.parse(fs.readFileSync(path.join(KIT, 'project/.claude/settings.json'), 'utf8')).permissions.allow;
	assert.ok(allow.includes('Bash(node .claude/resume-packet.mjs check)'), 'the check runs with no permission prompt');
	assert.ok(allow.includes('PowerShell(node .claude/resume-packet.mjs check)'));
});

// why: guards rule:post-compact-orientation
test('the pre-compact hook writes the packet first, even with the kit missing or a later step throwing', () => {
	for (const broken of ['no-kit', 'throws']) {
		const dir = project();
		fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
		for (const f of ['kit-hook.cjs', 'resume-packet.mjs']) fs.copyFileSync(path.join(KIT, 'project', '.claude', f), path.join(dir, '.claude', f));
		const home = kitTemp.makeTemp('packet-home-');
		if (broken === 'throws') {
			const kit = kitTemp.makeTemp('packet-kit-');
			fs.mkdirSync(path.join(kit, 'scripts'));
			fs.writeFileSync(path.join(kit, 'scripts', 'kit.mjs'), 'export function preCompactReport() { throw new Error("fold-back broke"); }\n');
			fs.writeFileSync(path.join(home, 'kit-install.json'), JSON.stringify({ kitDir: kit }));
		}
		const r = spawnSync(process.execPath, [path.join(dir, '.claude', 'kit-hook.cjs'), 'pre-compact'], { cwd: dir, encoding: 'utf8', input: JSON.stringify({ session_id: 'abc-123' }), env: { ...process.env, KIT_CLAUDE_HOME: home, CLAUDE_PROJECT_DIR: dir } });
		assert.equal(r.status, 0, broken);
		assert.match(fs.readFileSync(packet(dir), 'utf8'), /^session: abc-123$/m, broken);
	}
});

// why: guards rule:post-compact-orientation
test('install wires the packet; a project whose settings lack the hook is named, and status names the old start lines', async () => {
	const { install, status } = await import('../scripts/kit.mjs');
	const dir = project();
	const home = kitTemp.makeTemp('packet-home-');
	install({ kit: KIT, home, target: 'user' });
	install({ kit: KIT, home, target: 'project', projectDir: dir });
	const use = () => JSON.parse(spawnSync(process.execPath, [path.join(dir, '.claude', 'use-check.mjs'), '--json'], { cwd: dir, encoding: 'utf8', env: { ...process.env, KIT_CLAUDE_HOME: home } }).stdout).parts.find((p) => p.name === 'resume-packet');
	assert.equal(use().wired.ok, true);
	const file = path.join(dir, '.claude', 'settings.json');
	const s = JSON.parse(fs.readFileSync(file, 'utf8'));
	delete s.hooks.PreCompact;
	fs.writeFileSync(file, JSON.stringify(s));
	assert.equal(use().wired.ok, false);
	const old = spawnSync('git', ['show', 'v1.29.0:project/CLAUDE.md'], { cwd: KIT, encoding: 'utf8' });
	assert.equal(old.status, 0, 'the v1.29.0 tag must exist locally');
	fs.writeFileSync(path.join(dir, 'CLAUDE.md'), old.stdout);
	const text = status({ kit: KIT, home, projectDir: dir, ahead: () => 0 }).text;
	assert.match(text, /CLAUDE\.md still inlines the tracking files[^\n]*"@_Start\\ Here\.md"[^\n]*"@_Active\\ Plan\.md"/);
	assert.match(text, /hard rule 11 is the old full reading/);
});
