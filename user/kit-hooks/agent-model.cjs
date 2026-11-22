'use strict';
// E36 (build 24): the agent model hook. An Agent or Task call names a subagent_type, and that role's file in the Claude
// config folder names the model the role runs on. This logs a line to kit-agent-model.log in the repo's git common folder
// when the role has no file, or when the call names a model of another family than the role file. A checker call also
// logs "checker on a non-risky unit" (its plan row's Files hit no guard path) or "checker with no plan named" (U15, build
// 24). Its hold (in holds.json, read through hold-mode.cjs) decides the mismatch: under enforce a call that names another
// family than its role file is refused; under log it runs as it would. Each logged row records the mode it read. The git
// launch stays inline: the guard loads this file from the Claude folder, beside hold-mode.cjs.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const LOG = 'kit-agent-model.log';
const FAMILIES = ['opus', 'sonnet', 'haiku'];
const family = (m) => {
	const s = String(m).toLowerCase();
	return FAMILIES.find((f) => s.includes(f)) || s;
};

// The model line in a role file's frontmatter: null when the file has none, undefined when there is no role file.
function roleModel(type) {
	if (!/^[\w.-]+$/.test(type)) return undefined;
	const home = process.env.KIT_CLAUDE_HOME || process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
	let text;
	try {
		text = fs.readFileSync(path.join(home, 'agents', `${type}.md`), 'utf8');
	} catch {
		return undefined;
	}
	const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
	const m = front && /^model:\s*['"]?([^'"\s]+)['"]?\s*$/m.exec(front[1]);
	return m ? m[1] : null;
}

// The git common folder of a repo folder (the main repo's .git, also from a linked worktree), or null outside one.
function commonDir(cwd) {
	const r = spawnSync('git', ['-C', cwd, '-c', 'core.fsmonitor=false', 'rev-parse', '--path-format=absolute', '--git-common-dir'], {
		encoding: 'utf8',
		timeout: 3000,
		windowsHide: true,
		cwd: path.dirname(process.execPath),
		env: { ...process.env, NoDefaultCurrentDirectoryInExePath: '1' },
	});
	return r.status === 0 ? r.stdout.trim() : null;
}

// The hold's mode from hold-mode.cjs beside this file. A copy with no hold-mode.cjs beside it (the kit's tests copy this
// file alone) falls back to log, and the row says so with holdModeMissing.
function holdMode(id) {
	try {
		return { mode: require('./hold-mode.cjs').mode(id) };
	} catch {
		return { mode: 'log', missing: true };
	}
}

// The refusal for a model of another family than the role file's: the PreToolUse deny shape canary.cjs and call-cap.cjs use.
const deny = (reason) => ({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } });

// The guard paths (R2): the same list as GUARD_PATHS in user/kit-tools/tester-model.mjs. This file loads alone from the
// Claude folder, so it cannot import that module; the flow-lock test holds this export equal to tester-model.mjs's.
const GUARD_PATHS = ['kit-hooks/', '.githooks/', 'guard*.cjs', 'settings.json', 'approve.mjs', 'merge-gate.mjs'];
const globRe = (glob) => new RegExp(`^${glob.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')}$`);
// The first guard path a file matches (a folder anywhere in the path, a glob on the file name, or an exact name), or undefined.
function guardOf(file) {
	const base = file.split('/').pop();
	return GUARD_PATHS.find((g) => (g.endsWith('/') ? `/${file}`.includes(`/${g}`) : g.includes('*') ? globRe(g).test(base) : base === g));
}

// The Files cell of a unit's row in a plan's "## Units" table, or null when the plan or the row is not there.
function filesCell(text, unit) {
	const lines = String(text).replace(/\r\n/g, '\n').split('\n');
	const at = lines.findIndex((l) => /^## Units\b/.test(l));
	let head = null;
	for (const l of at < 0 ? [] : lines.slice(at + 1)) {
		if (/^#{1,6} /.test(l)) break;
		if (!/^\s*\|/.test(l)) { if (head) break; continue; }
		const cells = l.trim().split(/(?<!\\)\|/).slice(1, -1).map((c) => c.trim());
		if (!head) { head = cells.map((c) => c.toLowerCase()); continue; }
		if (cells.every((c) => /^:?-+:?$/.test(c))) continue;
		const id = (cells[head.findIndex((h) => h.startsWith('id'))] || '').replace(/[*_`]/g, '').trim();
		if (id.toUpperCase() === unit.toUpperCase()) return cells[head.findIndex((h) => h.startsWith('files'))] || '';
	}
	return null;
}

// A cell's paths: each comma-separated part's backticked names, or else the part itself; one spelling per path, as
// tester-model.mjs. The twin of filesOf in user/kit-tools/test-budget.mjs (this file loads alone, so it copies the rule).
function filesOf(cell) {
	return (String(cell).match(/(?:`[^`]*`|[^,`])+/g) || []).flatMap((seg) => {
		const ticked = [...seg.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
		return ticked.length ? ticked : [seg];
	}).map((p) => p.trim().replace(/\\/g, '/').replace(/^(\.\/)+/, '').toLowerCase()).filter(Boolean);
}

// The why for a checker call: no Plan line, a unit row whose Files hit no guard path, or null (risky, or nothing to say).
function checkerWhy(prompt, cwd) {
	const plan = /^Plan:[ \t]*(.+?)[ \t]*$/m.exec(prompt);
	if (!plan) return 'checker with no plan named';
	const unit = /^Unit:[ \t]*(\S+)/m.exec(prompt);
	if (!unit) return null;
	let text;
	try {
		text = fs.readFileSync(path.resolve(cwd, plan[1]), 'utf8');
	} catch {
		return null;
	}
	const cell = filesCell(text, unit[1]);
	return cell !== null && !filesOf(cell).some((f) => guardOf(f)) ? 'checker on a non-risky unit' : null;
}

// Appends one row to the repo's kit-agent-model.log; nothing when the folder is not a repo.
function logRow(cwd, row, hold) {
	const common = commonDir(cwd);
	if (common) fs.appendFileSync(path.join(common, LOG), `${JSON.stringify({ at: new Date().toISOString(), hook: 'agent-model', mode: hold.mode, ...(hold.missing ? { holdModeMissing: true } : {}), ...row })}\n`);
}

// The hook's answer for one Agent call: a deny when the hold reads enforce and the model is of another family, else nothing.
function check(input) {
	let refuse = null;
	try {
		const call = input && input.tool_input && typeof input.tool_input === 'object' ? input.tool_input : {};
		const type = call.subagent_type == null ? '' : String(call.subagent_type);
		const model = call.model == null || call.model === '' ? null : String(call.model);
		const cwd = String((input && input.cwd) || process.cwd());
		const want = roleModel(type);
		const hold = holdMode('agent-model');
		const whys = [];
		if (type === 'checker') {
			const why = checkerWhy(call.prompt == null ? '' : String(call.prompt), cwd);
			if (why) whys.push(why);
		}
		if (want === undefined) whys.push(type ? `no role file for ${type}` : 'no subagent_type named');
		else if (want !== null && model && family(model) !== family(want)) {
			const why = `the call names ${model}, the role file ${type} names ${want}`;
			whys.push(why);
			if (hold.mode === 'enforce') refuse = deny(`${why}: a role runs on its own model family. Call it with the role's model.`);
		}
		for (const why of whys) logRow(cwd, { type, model, want: want === undefined ? null : want, why }, hold);
	} catch {
		/* a hook that fails never stops a call */
	}
	return refuse;
}

module.exports = { check, GUARD_PATHS };
