#!/usr/bin/env node
// The use check (T14, the owner 2026-11-10: "We have to make use of these parts we are putting together. And
// enforce/check that its being used"). For each kit part in this project, three levels:
//   present  the files are there
//   wired    they are connected so they can run (a hook registered, a git setting made)
//   used     there is a trace that they ran in real work
// Install is finished only when every part is present and wired; a part the project does not take is named in
// .kit/parts.json ({ "optOut": ["<part>"] }), never just missing. Used is reported, never an install fault: a part
// with no trace yet says so. This is the frame: each later step adds its own part here with its three checks.
// It reads only; it writes nothing. Usage: node .claude/use-check.mjs [--json]   (run in the project folder)
// Exit 0 every part present and wired (or opted out), 1 a part is not, 2 it could not run.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const dir = process.cwd();
const has = (rel) => fs.existsSync(path.join(dir, rel));
// git starts from Node's own folder, so a git.exe planted in the project is not the one found first on Windows.
const git = (...a) => spawnSync('git', ['-C', dir, ...a], { encoding: 'utf8', cwd: path.dirname(process.execPath) });
const isRepo = () => git('rev-parse', '--git-dir').status === 0;
const toPosix = (p) => p.split(path.sep).join('/');
// The Claude config folder: status passes it in; otherwise the one Claude Code uses.
const HOME = process.env.KIT_CLAUDE_HOME || process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
// Where install keeps this project's guard record and hook shims (V3), named as kit.mjs guardDir names it.
const guardDir = () => { const slug = path.resolve(dir).replace(/[^A-Za-z0-9]/g, '-'); return path.join(HOME, 'kit-guard', process.platform === 'win32' ? slug.toLowerCase() : slug); };

// Each check returns [ok, detail]; ok null means the level does not apply here (said why, and never a fault).
const PARTS = [
	{
		name: 'guards',
		what: 'the PreToolUse guard process and the guards it runs (T1, T2)',
		present: () => {
			const missing = ['guard.cjs', 'owner-proof.cjs', 'task-gate.cjs', 'guard-outward.cjs', 'guard-delete.cjs', 'owner-yes.cjs', 'guard-read.cjs'].filter((f) => !has(`.claude/${f}`));
			return [missing.length === 0, missing.length ? `missing ${missing.join(', ')}` : 'all 7 files'];
		},
		wired: () => {
			// V3 (1.25.1): the guards run through the launcher in the Claude config folder's settings, and only against the
			// record install wrote there; the project's own settings carry no guard entry.
			const user = (() => { try { return JSON.parse(fs.readFileSync(path.join(HOME, 'settings.json'), 'utf8')); } catch { return null; } })();
			const on = (event, all) => ((user?.hooks?.[event]) || []).some((h) => (!all || ['.*', '*', ''].includes(h.matcher ?? '')) && (h.hooks || []).some((x) => [x.command, ...(x.args || [])].map(String).some((w) => /kit-launch.cjs$/.test(w))));
			if (!on('PreToolUse', true)) return [false, `${toPosix(HOME)}/settings.json does not run kit-launch.cjs on every tool: run kit.mjs install user`];
			if (!on('ConfigChange', false)) return [false, `${toPosix(HOME)}/settings.json does not run kit-launch.cjs on settings changes: run kit.mjs install user`];
			if (!fs.existsSync(path.join(guardDir(), 'record.json'))) return [false, 'no guard record for this project in the Claude config folder: run kit.mjs install project'];
			return [true, 'the Claude config folder runs kit-launch.cjs on every tool, against the record of this project'];
		},
		used: () => [null, 'no trace yet: the guards keep no log (a later step adds one)'],
	},
	{
		name: 'git-hooks',
		what: 'the commit, push and secret checks git runs (.githooks)',
		present: () => {
			const missing = ['pre-commit', 'commit-msg', 'pre-push'].filter((f) => !has(`.githooks/${f}`));
			return [missing.length === 0, missing.length ? `missing ${missing.join(', ')}` : 'all 3 hooks'];
		},
		wired: () => {
			if (!isRepo()) return [null, 'not a git repository'];
			const now = git('config', 'core.hooksPath').stdout.trim().replace(/\\/g, '/');
			// V3: the shims beside the record check the guard files, then run the project's .githooks.
			const want = toPosix(path.join(guardDir(), 'hooks'));
			const ok = now.toLowerCase() === want.toLowerCase();
			return [ok, ok ? `core.hooksPath is ${now}` : `core.hooksPath is ${now || 'unset'}, not the kit's hook shims (${want}): run kit.mjs install project`];
		},
		used: () => {
			if (!isRepo()) return [null, 'not a git repository'];
			const common = git('rev-parse', '--git-common-dir').stdout.trim();
			const log = path.resolve(dir, common, 'kit-push.log');
			return fs.existsSync(log) ? [true, 'kit-push.log has pushes'] : [null, 'no push yet'];
		},
	},
	{
		name: 'test-lanes',
		what: 'the lane-state report (E32)',
		present: () => [has('.claude/lane-state.mjs'), has('.claude/lane-state.mjs') ? 'lane-state.mjs' : 'missing lane-state.mjs'],
		wired: () => [null, 'nothing to wire: a test in the slow-lane folder turns the slow lane on'],
		used: () => [null, 'the project CI reads it (a later step traces it)'],
	},
];

function run() {
	let optOut = [];
	try {
		const raw = fs.readFileSync(path.join(dir, '.kit', 'parts.json'), 'utf8');
		optOut = JSON.parse(raw).optOut || [];
		if (!Array.isArray(optOut)) throw new Error('optOut is not a list');
	} catch (e) {
		if (e.code !== 'ENOENT') return { error: `.kit/parts.json: ${e.message}` };
	}
	const parts = PARTS.map((p) => {
		if (optOut.includes(p.name)) return { name: p.name, what: p.what, optedOut: true };
		const level = (fn) => { const [ok, detail] = fn(); return { ok, detail }; };
		return { name: p.name, what: p.what, present: level(p.present), wired: level(p.wired), used: level(p.used) };
	});
	const failing = parts.filter((p) => !p.optedOut && (p.present.ok === false || p.wired.ok === false)).map((p) => p.name);
	return { parts, failing };
}

const r = run();
if (r.error) {
	console.error(`use check: ${r.error}`);
	process.exitCode = 2;
} else if (process.argv.includes('--json')) {
	process.stdout.write(JSON.stringify(r, null, 2) + '\n');
	process.exitCode = r.failing.length ? 1 : 0;
} else {
	const mark = (l) => (l.ok === true ? 'yes' : l.ok === false ? 'NO' : '-');
	console.log(r.failing.length ? `Use check: not finished, ${r.failing.join(', ')} not present or wired.` : 'Use check: every part present and wired.');
	for (const p of r.parts) {
		if (p.optedOut) { console.log(`    ${p.name}: opted out (.kit/parts.json)`); continue; }
		console.log(`    ${p.name}: present ${mark(p.present)}, wired ${mark(p.wired)}, used ${mark(p.used)} (${[p.present, p.wired, p.used].filter((l) => l.ok !== true).map((l) => l.detail).join('; ') || 'all traced'})`);
	}
	process.exitCode = r.failing.length ? 1 : 0;
}
