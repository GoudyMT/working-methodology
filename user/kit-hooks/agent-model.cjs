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
const LIST = 'kit-unit-files.txt';
const LIST_COMMAND = 'node user/kit-tools/unit-lock.mjs --tester --files';
const OPEN = 'kit-guard-open.log';
const ROUND_LIMIT = 2;
const FAMILIES = ['opus', 'sonnet', 'haiku'];
const family = (m) => {
	const s = String(m).toLowerCase();
	return FAMILIES.find((f) => s.includes(f)) || s;
};

// The model line in a role file's frontmatter: null when the file has none, undefined when there is no role file.
function roleModel(type) {
	// A plugin role (kit:checker) reads as its bare name, as edit-fence reads it.
	const name = String(type).split(':').pop();
	if (!/^[\w.-]+$/.test(name)) return undefined;
	const home = process.env.KIT_CLAUDE_HOME || process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
	let text;
	try {
		text = fs.readFileSync(path.join(home, 'agents', `${name}.md`), 'utf8');
	} catch {
		return undefined;
	}
	const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
	const m = front && /^model:\s*['"]?([^'"\s]+)['"]?\s*$/m.exec(front[1]);
	return m ? m[1] : null;
}

// One git rev-parse line run in a folder, or null when git fails (a folder git cannot read, or one that is not there).
function gitLine(cwd, args) {
	const r = spawnSync('git', ['-C', cwd, '-c', 'core.fsmonitor=false', 'rev-parse', ...args], {
		encoding: 'utf8',
		timeout: 3000,
		windowsHide: true,
		cwd: path.dirname(process.execPath),
		env: { ...process.env, NoDefaultCurrentDirectoryInExePath: '1' },
	});
	return r.status === 0 ? r.stdout.trim() : null;
}

// The git common folder of a repo folder (the main repo's .git, also from a linked worktree), or null outside one.
function commonDir(cwd) {
	return gitLine(cwd, ['--path-format=absolute', '--git-common-dir']);
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

// The role a spawn runs as for the list gate: tester or writer, by its subagent_type (a plugin prefix dropped, any case) or,
// for a general agent, by its brief's Role: line. Null for every other spawn.
function listRole(type, prompt) {
	const bare = String(type).split(':').pop().toLowerCase();
	if (bare === 'tester' || bare === 'writer') return bare;
	if (bare !== 'general-purpose' && bare !== '') return null;
	const line = /^role:(.*)$/im.exec(prompt);
	const named = line ? line[1].trim().toLowerCase() : '';
	return named === 'tester' || named === 'writer' ? named : null;
}

// The folder a spawn's brief names with its Worktree: line (resolved from the hook's cwd), else the hook's cwd.
function worktreeOf(prompt, cwd) {
	const line = /^worktree:(.*)$/im.exec(prompt);
	return line && line[1].trim() ? path.resolve(cwd, line[1].trim()) : cwd;
}

// A checker spawn: subagent_type checker (a plugin prefix dropped, any case), or any type whose prompt has a Plan: and a Unit: line.
function isChecker(type, prompt) {
	return String(type).split(':').pop().toLowerCase() === 'checker' || (/^Plan:/m.test(prompt) && /^Unit:/m.test(prompt));
}

// The units named by a spawn's Unit: line, comma-separated, as written.
function unitsOf(prompt) {
	const line = /^Unit:(.*)$/m.exec(prompt);
	return line ? line[1].split(',').map((u) => u.trim()).filter(Boolean) : [];
}

// A unit's count key: case folded, with the * ` and _ markup stripped, so every spelling of one unit counts together.
const unitKey = (u) => String(u).trim().toLowerCase().replace(/[*`_]/g, '').trim();

// The counted check rounds per unit key in the repo's kit-agent-model.log: rows with round "check" that are not denied. A
// missing log is zero rounds. A log that cannot be read, or a line that is not a check record, throws.
function roundCounts(common) {
	const counts = new Map();
	const file = path.join(common, LOG);
	if (!fs.existsSync(file)) return counts;
	for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
		if (!line.trim()) continue;
		const row = JSON.parse(line);
		if (!row || typeof row !== 'object') throw new Error('a log line is not a record');
		if (row.round !== 'check' || row.denied === true) continue;
		if (!Array.isArray(row.units)) throw new Error('a check row names no units list');
		for (const key of new Set(row.units.map(unitKey))) counts.set(key, (counts.get(key) || 0) + 1);
	}
	return counts;
}

// The round cap for a checker spawn. A unit with ROUND_LIMIT counted rounds already is refused (under the round-cap hold's
// enforce mode). Every checked spawn appends a check row, denied when refused. An error in this check refuses with
// "hook error: lead review" whatever the hold says, and appends its cause to kit-guard-open.log.
function roundGate(cwd, type, model, prompt) {
	const hold = holdMode('round-cap');
	const units = unitsOf(prompt);
	let common = null;
	try {
		common = commonDir(cwd);
		const counts = common === null ? new Map() : roundCounts(common);
		const capped = units.find((u) => (counts.get(unitKey(u)) || 0) >= ROUND_LIMIT);
		const refuse = capped !== undefined && hold.mode === 'enforce';
		logRow(cwd, { type, model, want: null, round: 'check', units, ...(refuse ? { denied: true } : {}) }, hold);
		return refuse ? deny(`a third check round on ${capped} is refused: what is still open goes to the next patch list; CI is the gate.`) : null;
	} catch (err) {
		const cause = String((err && err.message) || err);
		try {
			if (common) fs.appendFileSync(path.join(common, OPEN), `${JSON.stringify({ at: new Date().toISOString(), hook: 'agent-model', cause })}\n`);
		} catch {
			/* the open log itself failed: the refusal still stands */
		}
		return deny(`hook error: lead review (${cause})`);
	}
}

// Appends one row to the repo's kit-agent-model.log; nothing when the folder is not a repo.
function logRow(cwd, row, hold) {
	const common = commonDir(cwd);
	if (common) fs.appendFileSync(path.join(common, LOG), `${JSON.stringify({ at: new Date().toISOString(), hook: 'agent-model', mode: hold.mode, ...(hold.missing ? { holdModeMissing: true } : {}), ...row })}\n`);
}

// The hook's answer for one Agent call: a deny when the hold reads enforce and the model is of another family, else nothing.
function check(input) {
	let refuse = null;
	let cwd = process.cwd();
	try {
		const call = input && input.tool_input && typeof input.tool_input === 'object' ? input.tool_input : {};
		const type = call.subagent_type == null ? '' : String(call.subagent_type);
		const model = call.model == null || call.model === '' ? null : String(call.model);
		cwd = String((input && input.cwd) || process.cwd());
		const prompt = call.prompt == null ? '' : String(call.prompt);
		const want = roleModel(type);
		const hold = holdMode('agent-model');
		const whys = [];
		if (type === 'checker') {
			const why = checkerWhy(prompt, cwd);
			if (why) whys.push(why);
		}
		if (want === undefined) whys.push(type ? `no role file for ${type}` : 'no subagent_type named');
		else if (want !== null && model && family(model) !== family(want)) {
			const why = `the call names ${model}, the role file ${type} names ${want}`;
			whys.push(why);
			if (hold.mode === 'enforce') refuse = deny(`${why}: a role runs on its own model family. Call it with the role's model.`);
		}
		for (const why of whys) logRow(cwd, { type, model, want: want === undefined ? null : want, why }, hold);
		// The list gate: a tester or writer spawn waits for kit-unit-files.txt in the worktree its brief names. Isolated spawns
		// pass (their worktree does not exist until the spawn); a worktree git cannot read passes and is logged.
		const role = listRole(type, prompt);
		if (role && call.isolation !== 'worktree') {
			const wt = worktreeOf(prompt, cwd);
			const gate = holdMode('spawn-list');
			const list = gitLine(wt, ['--path-format=absolute', '--git-path', LIST]);
			if (list === null) {
				logRow(cwd, { type: role, model, want: null, why: `worktree ${wt} cannot be read by git, so its list is not checked and the spawn passes` }, gate);
			} else if (!fs.existsSync(list)) {
				const why = `a ${role} spawn names worktree ${wt}, which has no ${LIST}`;
				logRow(cwd, { type: role, model, want: null, why }, gate);
				if (gate.mode === 'enforce') refuse = deny(`${why}. Run ${LIST_COMMAND} <test files> from that worktree, then spawn.`);
			}
		}
		// The round cap: a checker spawn on a unit with two counted check rounds already is refused (K366).
		if (isChecker(type, prompt)) refuse = roundGate(cwd, type, model, prompt) || refuse;
	} catch {
		/* a hook that fails never stops a call; the row says the call passed unchecked */
		try {
			logRow(cwd, { type: '', model: null, want: null, why: 'hook error: the call passes unchecked' }, holdMode('agent-model'));
		} catch {
			/* the log itself failed: nothing more to do */
		}
	}
	return refuse;
}

module.exports = { check, GUARD_PATHS };
