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
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { parseMarkdown } from './list-data.mjs';

const dir = process.cwd();
const has = (rel) => fs.existsSync(path.join(dir, rel));
// git starts from Node's own folder, so a git.exe planted in the project is not the one found first on Windows.
const git = (...a) => spawnSync('git', ['-C', dir, ...a], { encoding: 'utf8', cwd: path.dirname(process.execPath) });
const isRepo = () => git('rev-parse', '--git-dir').status === 0;
// A file the kit keeps in the git folder: in a worktree .git is a file, and the records sit in the common git folder (the
// build 14 sweep: a plan checked in a worktree read as never checked).
const hasGit = (name) => { const r = git('rev-parse', '--git-common-dir'); return r.status === 0 && fs.existsSync(path.join(path.resolve(dir, r.stdout.trim()), name)); };
const toPosix = (p) => p.split(path.sep).join('/');
// The Claude config folder: status passes it in; otherwise the one Claude Code uses.
const HOME = process.env.KIT_CLAUDE_HOME || process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
// The launcher install user put in the Claude config folder (V3, 1.25.1): its own reading of its wiring and its records.
const launcher = () => { try { return createRequire(import.meta.url)(path.join(HOME, 'kit-tools', 'kit-launch.cjs')); } catch { return null; } };
// Where install keeps this project's guard record and hook shims, named as the launcher names it.
const guardDir = () => { const L = launcher(); return L ? path.join(HOME, 'kit-guard', L.recordName(dir)) : path.join(HOME, 'kit-guard', '-'); };

// T9 (1.42.0, D-2): the cap on AGENTS.md, which every session loads at start, read as the project has it on disk.
const AGENTS_CAP = 25000;
// K111 (1.42.0): the compact window the kit sets, and Claude Code's floor (a value under it is ignored, not raised).
const WINDOW_MAX = 400000;
const WINDOW_MIN = 100000;
const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); } catch { return null; } };
const settingsOf = (name) => readJson(path.join(dir, '.claude', name));

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
			const read = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, '')); } catch { return null; } };
			const L = launcher();
			if (!L) return [false, `${toPosix(HOME)}/kit-tools/kit-launch.cjs is missing: run kit.mjs install user`];
			// The 1.25.0 entry that ran guard.cjs straight from the project would still run a swapped guard as code.
			for (const name of ['settings.json', 'settings.local.json']) {
				const s = read(path.join(dir, '.claude', name));
				if (JSON.stringify(s?.hooks?.PreToolUse || '').includes('.claude/guard.cjs')) return [false, `.claude/${name} still runs guard.cjs itself: run kit.mjs install project, which takes that entry out`];
				// K72 (1.36.0): a session cannot see this from inside, since its hooks are already off.
				let text = null;
				try { text = fs.readFileSync(path.join(dir, '.claude', name), 'utf8'); } catch { /* none */ }
				// A user layer from before 1.36.0 has no reader for this: name the update, never crash the check (install exits on it).
				if (text !== null && typeof L.settingsProblem !== 'function') return [false, `${toPosix(HOME)}/kit-tools/kit-launch.cjs is older than this check: run kit.mjs install user`];
				const why = text === null ? '' : L.settingsProblem(text);
				if (why) return [false, `.claude/${name}: ${why}; the owner takes it out`];
			}
			if (!L.launcherWired(read(path.join(HOME, 'settings.json')), path.join(HOME, 'kit-tools', 'kit-launch.cjs'), read(path.join(HOME, 'kit-install.json'))?.node)) return [false, `${toPosix(HOME)}/settings.json does not run kit-launch.cjs whole, on every tool and every settings change: run kit.mjs install user`];
			if (!fs.existsSync(path.join(guardDir(), 'record.json'))) return [false, 'no guard record for this project in the Claude config folder: run kit.mjs install project'];
			return [true, 'the Claude config folder runs kit-launch.cjs on every tool, against the record of this project'];
		},
		// Every owner's yes is read from one field of the pop-up's record in the session transcript (permissionDecision),
		// which Claude Code does not document. The newest answered pop-up for this project says whether it is there (the
		// 1.25.0 sweep, R7.1); a phone answer shows here after the owner taps one.
		used: () => {
			const folder = path.join(HOME, 'projects', path.resolve(dir).replace(/[^A-Za-z0-9]/g, '-'));
			let files = [];
			try { files = fs.readdirSync(folder).filter((f) => f.endsWith('.jsonl')).map((f) => path.join(folder, f)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs); } catch { /* no session yet */ }
			for (const f of files) {
				let lines = [];
				try { lines = fs.readFileSync(f, 'utf8').split('\n'); } catch { continue; }
				for (let i = lines.length - 1; i >= 0; i--) {
					let e = null;
					try { e = JSON.parse(lines[i]); } catch { continue; }
					if (!e || e.type !== 'user' || !e.toolUseResult || !e.toolUseResult.answers) continue;
					return e.permissionDecision && e.permissionDecision.decision
						? [true, 'the newest pop-up answer carries permissionDecision, the field the guards read the owner\'s yes from']
						: [false, 'the newest pop-up answer has no permissionDecision, so the guards cannot read the owner\'s yes from it: report this to the kit'];
				}
			}
			return [null, 'no pop-up answer in this project\'s sessions yet'];
		},
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
		// K71 (1.36.0, the owner's pick 2026-11-15: check only): saved approvals in settings.local.json can hold secrets.
		// Claude Code's global exclude and the kit's exclude block keep an untracked copy out; once git tracks the file,
		// no ignore line takes it out, so tracking is the fault. No .gitignore line: install leaves nothing git can see
		// (rule:kit-stays-local).
		name: 'private-files',
		what: 'the personal settings file kept out of git (.claude/settings.local.json)',
		present: () => [null, 'nothing to install: the file is the owner\'s'],
		wired: () => {
			if (!isRepo()) return [null, 'not a git repository'];
			if (git('ls-files', '--error-unmatch', '.claude/settings.local.json').status === 0) return [false, 'git tracks .claude/settings.local.json, whose saved approvals can hold secrets: run git rm --cached .claude/settings.local.json and commit (the file stays on disk)'];
			return [true, 'git does not track it'];
		},
		used: () => [null, 'nothing to trace'],
	},
	{
		name: 'start-load',
		what: 'AGENTS.md, which every session loads at start, under its cap as filled in here (T9)',
		present: () => [has('AGENTS.md'), has('AGENTS.md') ? 'AGENTS.md' : 'missing AGENTS.md'],
		wired: () => {
			if (!has('AGENTS.md')) return [null, 'no AGENTS.md here'];
			const bytes = fs.statSync(path.join(dir, 'AGENTS.md')).size;
			const n = (x) => x.toLocaleString('en-US');
			return bytes <= AGENTS_CAP ? [true, `${n(bytes)} B of ${n(AGENTS_CAP)}`] : [false, `AGENTS.md is ${n(bytes)} B, over the ${n(AGENTS_CAP)} B cap: move a section to a rule module, or cut prose a script enforces (rule:kit-standards)`];
		},
		used: () => [null, 'nothing to trace'],
	},
	{
		name: 'compact-window',
		what: 'a session compacts on its own at 400K tokens (K111)',
		present: () => [null, 'a setting, not a file'],
		// The project file beats the owner's own saved window (proven on 2.1.318), and the local file beats the project's;
		// every window set in either, top-level or per model, must sit inside the range.
		wired: () => {
			const set = [];
			for (const name of ['settings.json', 'settings.local.json']) {
				const s = settingsOf(name);
				if (s && s.autoCompactWindow !== undefined) set.push([`.claude/${name}`, s.autoCompactWindow]);
				for (const [model, m] of Object.entries((s && s.modelSettings) || {})) if (m && m.autoCompactWindow !== undefined) set.push([`.claude/${name} (${model})`, m.autoCompactWindow]);
			}
			if (settingsOf('settings.json')?.autoCompactWindow === undefined) return [false, `.claude/settings.json sets no autoCompactWindow: run kit.mjs install project`];
			const bad = set.filter(([, v]) => !Number.isInteger(v) || v > WINDOW_MAX || v < WINDOW_MIN);
			return bad.length ? [false, `${bad.map(([f, v]) => `${f} sets ${v}`).join('; ')}: keep it from ${WINDOW_MIN} to ${WINDOW_MAX} (under ${WINDOW_MIN} is ignored)`] : [true, `compacts at ${set.map(([, v]) => v).join(', ')}`];
		},
		used: () => [null, 'a compact leaves the resume packet (the resume-packet part)'],
	},
	{
		name: 'test-lanes',
		what: 'the lane-state report (E32)',
		present: () => [has('.claude/lane-state.mjs'), has('.claude/lane-state.mjs') ? 'lane-state.mjs' : 'missing lane-state.mjs'],
		wired: () => [null, 'nothing to wire: a test in the slow-lane folder turns the slow lane on'],
		used: () => [null, 'the project CI reads it (a later step traces it)'],
	},
	{
		name: 'resume-packet',
		what: 'the resume packet a compact writes and a new session checks (T3)',
		present: () => [has('.claude/resume-packet.mjs'), has('.claude/resume-packet.mjs') ? 'resume-packet.mjs' : 'missing resume-packet.mjs'],
		// A host repo that keeps its own settings never runs the kit's pre-compact hook, so it never gets a packet.
		wired: () => {
			let s = null;
			try { s = JSON.parse(fs.readFileSync(path.join(dir, '.claude', 'settings.json'), 'utf8').replace(/^\uFEFF/, '')); } catch { /* none */ }
			const hook = JSON.stringify(s?.hooks?.PreCompact || '').includes('kit-hook.cjs') && JSON.stringify(s?.hooks?.PreCompact || '').includes('pre-compact');
			if (!hook) return [false, '.claude/settings.json has no PreCompact kit-hook.cjs entry: a compact writes no packet (run kit.mjs install project)'];
			// Without the allow rule the session's first action stops on a permission prompt.
			const allow = s?.permissions?.allow || [];
			const missing = ['Bash', 'PowerShell'].filter((t) => !allow.includes(`${t}(node .claude/resume-packet.mjs check)`));
			return missing.length ? [false, `.claude/settings.json does not allow ${missing.map((t) => `${t}(node .claude/resume-packet.mjs check)`).join(' or ')}: the first action of a session asks for permission`] : [true, 'the PreCompact hook writes it and the check runs with no prompt'];
		},
		// A packet written proves the hook ran; the check's stamp proves a session read it.
		used: () => (has('.kit/resume-check.json') ? [true, 'a session ran the check'] : has('.kit/resume-packet.md') ? [null, 'a packet is written; no session has run the check yet'] : [null, 'no packet yet: written at the first closeout or compact']),
	},
	{
		name: 'state',
		what: 'the next action and the owner\'s decisions kept as data, with the Resume Point generated from them (T4)',
		present: () => {
			const missing = ['.claude/state.mjs', '_State.json', '_Decisions.jsonl'].filter((f) => !has(f));
			return [missing.length === 0, missing.length ? `missing ${missing.join(', ')}` : 'state.mjs, _State.json, _Decisions.jsonl'];
		},
		// A project from before 1.34.0 has a filled-in Resume Point with no generated block until init moves it.
		wired: () => {
			const unmarked = ['_Active Plan.md', '_Working Memory.md'].filter((f) => {
				try { const t = fs.readFileSync(path.join(dir, f), 'utf8'); return !/^<!-- state:begin\b.*-->\r?$/m.test(t) || !/^<!-- state:end -->\r?$/m.test(t); } catch { return true; }
			});
			return unmarked.length ? [false, `${unmarked.join(' and ')} ha${unmarked.length === 1 ? 's' : 've'} no generated block: run node .claude/state.mjs init once`] : [true, 'both views carry a generated block'];
		},
		used: () => {
			let s = null;
			try { s = JSON.parse(fs.readFileSync(path.join(dir, '_State.json'), 'utf8')); } catch { /* none */ }
			if (!s || /^<.*>$/.test(String(s.updated))) return [null, 'not filled in yet: the first closeout sets it'];
			// The state.mjs beside this script, never the project's copy: status runs this check on a folder it reads.
			const r = spawnSync(process.execPath, [path.join(path.dirname(fileURLToPath(import.meta.url)), 'state.mjs'), 'check'], { cwd: dir, encoding: 'utf8' });
			return r.status === 0 ? [true, `updated ${s.updated}; the views match the data`] : [false, `the views differ from the data: ${(r.stdout || '').split('\n')[0]}`];
		},
	},
	{
		// K69 (1.36.0, the owner: "ensure that this new data management standard is how all kits maintain their data"):
		// the roadmap's tasks are rows of _List.jsonl, shown by a generated checkbox view; a roadmap kept by hand moves once.
		name: 'list',
		what: 'the roadmap and its tasks kept as data, with the checkbox view generated from them (K69)',
		present: () => [has('_List.jsonl') || has('_Master Roadmap.md'), has('_List.jsonl') ? '_List.jsonl' : 'no _List.jsonl yet: the import or the first item add writes it'],
		wired: () => {
			let text = null;
			try { text = fs.readFileSync(path.join(dir, '_Master Roadmap.md'), 'utf8'); } catch { return [null, 'no _Master Roadmap.md']; }
			const hand = parseMarkdown(text).boxLines.length;
			if (hand) return [false, `_Master Roadmap.md has ${hand} checkbox line(s) kept by hand: move them into the data once with node .claude/state.mjs list import "_Master Roadmap.md" (the file as it was is kept in .kit/kit-backups)`];
			return /^<!-- list:begin boxes\b/m.test(text) ? [true, 'the tasks are data; the boxes view is generated'] : [false, '_Master Roadmap.md has no generated boxes block: copy the Tasks block from the kit\'s template (project/_Master Roadmap.md in the kit folder) where the tasks go, a <!-- list:begin boxes --> line and a <!-- list:end --> line, then run node .claude/state.mjs render'];
		},
		used: () => (has('_List.jsonl') && fs.statSync(path.join(dir, '_List.jsonl')).size > 0 ? [true, '_List.jsonl holds rows'] : [null, 'no rows yet']),
	},
	{
		// T7 (build 12): the loop driver and the bounds file it reads.
		name: 'loop',
		what: 'the loop driver: the build loop\'s steps, counted stops and loop mode, within the bounds file (T7)',
		present: () => {
			const missing = ['.claude/loop.mjs', '.claude/bounds.json'].filter((f) => !has(f));
			return [missing.length === 0, missing.length ? `missing ${missing.join(', ')} (run kit.mjs install project)` : 'loop.mjs, bounds.json'];
		},
		wired: () => {
			let b = null;
			try { b = JSON.parse(fs.readFileSync(path.join(dir, '.claude', 'bounds.json'), 'utf8')); } catch { return [false, '.claude/bounds.json is not JSON: the loop starts no run (the owner fixes it; a tool writes it only on the owner\'s pop-up Yes)']; }
			return Array.isArray(b && b.steps) && b.steps.length ? [true, `${b.steps.length} steps, ${b.steps.filter((s) => s && s.who === 'owner').length} of them the owner's`] : [false, '.claude/bounds.json has no steps: the loop starts no run'];
		},
		used: () => (hasGit('kit-loop.jsonl') ? [true, 'a run or loop mode was recorded'] : [null, 'no loop run yet']),
	},
	{
		// T8 (build 14): a batch plan's units read as a graph, so shared files between units that run at once are found.
		name: 'plan graph',
		what: 'the plan graph: units of a batch plan that may run at once and share a file (T8)',
		present: () => (has('.claude/plan-graph.mjs') ? [true, 'plan-graph.mjs'] : [false, 'missing .claude/plan-graph.mjs (run kit.mjs install project)']),
		wired: () => [true, 'run by the lead on a batch plan (agent-team-build)'],
		used: () => (hasGit('kit-plan-graph.jsonl') ? [true, 'a plan was checked'] : [null, 'no plan checked yet']),
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
