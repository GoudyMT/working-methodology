'use strict';
// E36 (build 24): the agent model hook. An Agent or Task call names a subagent_type, and that role's file in the Claude
// config folder names the model the role runs on. This logs a line to kit-agent-model.log in the repo's git common folder
// when the role has no file, or when the call names a model of another family than the role file. A checker call also
// logs "checker on a non-risky unit" (its plan row's Files hit no guard path) or "checker with no plan named" (U15, build
// 24). Its hold (in holds.json, read through hold-mode.cjs) decides the mismatch: under enforce a call that names another
// family than its role file is refused; under log it runs as it would. Each logged row records the mode it read. The git
// launch stays inline: the guard loads this file from the Claude folder, beside hold-mode.cjs.
// Four more gates read the call, each with its own hold in holds.json, and each fails on its own terms:
//  - the list gate (spawn-list, small tier): a tester or writer spawn waits for kit-unit-files.txt in its worktree. Any error,
//    an unreadable worktree or a share path lets the call through and logs it (fail-open).
//  - the round cap (round-cap, high tier): a third check round on a unit under one plan is refused. Any error on a checker
//    spawn refuses with "hook error: lead review" and logs one row to kit-guard-open.log (fail-closed).
//  - the warm hold (warm-agents, small tier): a fresh tester or builder spawn, or a SendMessage to an agent over the limit, is
//    held. Under log mode the would-be hold passes and is logged. Any error lets the call through and logs it (fail-open).
//  - the closeout gate (closeout-spawn, high tier): in closeout a checker spawn, or a tester or writer spawn with no ticket, is
//    refused. Any error inside it refuses with "hook error: lead review" and logs it (fail-closed).
// Labelled brief lines (Plan:, Unit:, Role:, Worktree:, Lane:, Ticket:) are read by one rule, see lineValues.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const LOG = 'kit-agent-model.log';
const ROUNDS = 'kit-check-rounds.log';
const LIST = 'kit-unit-files.txt';
// Built from this file's own folder, so the command runs outside the kit repo; quoted with forward slashes, so it runs in
// bash as well as PowerShell, and a folder with a space stays one argument.
const LIST_COMMAND = `node "${path.join(__dirname, '..', 'kit-tools', 'unit-lock.mjs').replace(/\\/g, '/')}" --tester --files`;
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
// file alone) falls back to log, and the row says so with holdModeMissing. A hold-mode.cjs that is there but throws, at load
// or in mode(), falls back the same way for a small-tier hold; for a high-tier one (strict: round-cap, closeout-spawn) the
// error is thrown, so the gate refuses with its hook error.
function holdMode(id, strict) {
	try {
		return { mode: require('./hold-mode.cjs').mode(id) };
	} catch (err) {
		const absent = err && err.code === 'MODULE_NOT_FOUND' && /hold-mode\.cjs/.test(String(err.message).split('\n')[0]);
		if (strict && !absent) throw err;
		return { mode: 'log', missing: true };
	}
}

// The refusal for a model of another family than the role file's: the PreToolUse deny shape canary.cjs and call-cap.cjs use.
const deny = (reason) => ({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } });

// One label rule for the brief's labelled lines: case-insensitive, leading space, a list marker (- * +) and emphasis (* _ `)
// around the label allowed. Every matching line's value, trimmed and with edge emphasis dropped; [] when there is none.
function lineValues(prompt, label) {
	const re = new RegExp(`^[ \\t]*(?:[-*+][ \\t]+)?[*_\`]*(?:${label})[*_\`]*[ \\t]*:[*_\`]*[ \\t]*(.*)$`, 'gim');
	return [...String(prompt).matchAll(re)].map((m) => m[1].trim().replace(/^[*`]+|[*`]+$/g, '').trim());
}
const lineValue = (prompt, label) => { const v = lineValues(prompt, label); return v.length ? v[0] : null; };
const hasLine = (prompt, label) => lineValues(prompt, label).length > 0;
// The role words a Role: value is scanned for.
const ROLE_WORDS = ['builder', 'implementer', 'reviewer', 'lead', 'checker', 'tester', 'writer', 'test-writer'];
// The role the brief's Role: value names: the earliest ROLE_WORDS word in it, as a whole word (not inside a longer or
// hyphenated word), decides. "the checker for U17" names checker; "builder for the checker's findings" names builder;
// "rechecker" and "checkers-list" name none. Returns it when it is one of names, else null.
function roleNamed(prompt, names) {
	const v = lineValue(prompt, 'role');
	if (v === null) return null;
	let best = null;
	for (const n of ROLE_WORDS) {
		const m = new RegExp(`(?<![\\w-])${n}(?![\\w-])`, 'i').exec(v);
		if (m && (best === null || m.index < best.at)) best = { n, at: m.index };
	}
	return best && names.includes(best.n) ? best.n : null;
}
// The first word of a Role: line after markup, lower-cased; '' when there is none.
const roleOf = (prompt) => { const v = lineValue(prompt, 'role'); const m = v === null ? null : /^[*_`\s]*([a-z][\w-]*)/i.exec(v); return m ? m[1].toLowerCase() : ''; };

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
	const plan = lineValue(prompt, 'plan');
	if (!plan) return 'checker with no plan named';
	const unit = unitsOf(prompt)[0];
	if (!unit) return null;
	let text;
	try {
		text = fs.readFileSync(path.resolve(cwd, plan), 'utf8');
	} catch {
		return null;
	}
	const cell = filesCell(text, unit);
	return cell !== null && !filesOf(cell).some((f) => guardOf(f)) ? 'checker on a non-risky unit' : null;
}

// The role a spawn runs as for the list gate: tester or writer, by its subagent_type (a plugin prefix dropped, any case) or,
// for a general agent, by its brief's Role: line. Null for every other spawn.
function listRole(type, prompt) {
	const bare = String(type).split(':').pop().toLowerCase();
	if (bare === 'tester' || bare === 'writer') return bare;
	if (bare !== 'general-purpose' && bare !== '') return null;
	return roleNamed(prompt, ['tester', 'writer']);
}

// The folder a spawn's brief names with its Worktree: line (resolved from the hook's cwd), else the hook's cwd.
function worktreeOf(prompt, cwd) {
	const named = lineValue(prompt, 'worktree');
	return named ? path.resolve(cwd, named) : cwd;
}
// True when the brief's Worktree: path is a network share (starts with \\ or //): git is never run on it.
const isShare = (prompt) => /^(\\\\|\/\/)/.test(lineValue(prompt, 'worktree') || '');

// A checker spawn: subagent_type checker (a plugin prefix dropped, any case), or a general agent (general-purpose or no type)
// whose Role: line says checker, or that has no Role: line and has a Plan: and a Unit: line (Units: reads as Unit:). Every
// brief carries Plan: and Unit: lines, so a tester, builder or other typed agent, or a general agent with another role, is
// never a checker and never spends a check round.
function isChecker(type, prompt) {
	const bare = String(type).split(':').pop().toLowerCase();
	if (bare === 'checker') return true;
	if (bare !== 'general-purpose' && bare !== '') return false;
	const role = roleOf(prompt);
	if (roleNamed(prompt, ['checker'])) return true;
	return !role && hasLine(prompt, 'plan') && hasLine(prompt, 'units?');
}

// One key per plan file: the first path token (cut at whitespace, a comma or #; edge markup and trailing punctuation dropped), resolved from the hook's cwd, forward
// slashes, lower case on Windows; so ./PLAN.md, PLAN.md (round 3) and _PLAN.md_ are the plan PLAN.md is. Null with no Plan: line.
function planKey(raw, cwd) {
	if (raw === null || raw === undefined) return null;
	const token = String(raw).trim().replace(/^[*_`]+/, '').split(/[\s,#]/)[0].replace(/[.;:!?*_`'")\]]+$/, '');
	if (!token) return null;
	const key = path.resolve(cwd, token).replace(/\\/g, '/');
	return process.platform === 'win32' ? key.toLowerCase() : key;
}

// The canonical unit ids in a text: each match of /[A-Z]+\d+[a-z]?/i, upper-cased, so case, markup and trailing text cannot change an id.
const idsOf = (text) => (String(text).match(/[A-Z]+\d+[a-z]?/gi) || []).map((s) => s.toUpperCase().replace(/^([A-Z]+)0+(?=\d)/, '$1'));

// The unit ids on every Unit: (or Units:) line of a spawn; [] when there is no such line or it names no id.
function unitsOf(prompt) {
	return [...new Set(lineValues(prompt, 'units?').flatMap(idsOf))];
}

// The counted check rounds per unit id in the repo's kit-check-rounds.log: rows with round "check" that are not denied and
// carry the same plan key. A spawn with no plan counts only rows with no plan; a row with no plan (written before rows carried
// one) counts for every plan. A missing log is zero rounds. A log that cannot be read, or a line that is not a check record, throws.
function roundCounts(common, plan, cwd) {
	const counts = new Map();
	const file = path.join(common, ROUNDS);
	if (!fs.existsSync(file)) return counts;
	for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
		if (!line.trim()) continue;
		const row = JSON.parse(line);
		if (!row || typeof row !== 'object') throw new Error('a log line is not a record');
		if (row.round !== 'check' || row.denied === true) continue;
		if (plan === null ? row.plan != null : row.plan != null && planKey(row.plan, cwd) !== plan) continue;
		if (!Array.isArray(row.units)) throw new Error('a check row names no units list');
		for (const id of new Set(row.units.flatMap(idsOf))) counts.set(id, (counts.get(id) || 0) + 1);
	}
	return counts;
}

// The round cap for a checker spawn. A spawn with a Plan: line whose Unit: line is missing or names no id, or a unit with
// ROUND_LIMIT counted rounds already, is refused (under the round-cap hold's enforce mode). A bare checker with no Plan: line
// is not refused for its missing id. Every checked spawn appends a check row (with its Plan: value) to the repo's
// kit-check-rounds.log, denied when refused here or by an earlier gate (prior). Fail-closed: an error in this check, a common
// folder git cannot read included, refuses with "hook error: lead review" whatever the hold says, and appends its cause to
// kit-guard-open.log.
function roundGate(cwd, type, model, prompt, prior) {
	const units = unitsOf(prompt);
	let common = null;
	try {
		const hold = holdMode('round-cap', true);
		const plan = planKey(lineValue(prompt, 'plan'), cwd);
		common = commonDir(cwd);
		if (common === null) throw new Error(`git cannot read the common folder of ${cwd}`);
		const counts = roundCounts(common, plan, cwd);
		const capped = units.find((u) => (counts.get(u) || 0) >= ROUND_LIMIT);
		const why = units.length === 0 && plan !== null
			? 'a checker spawn names no unit: its Unit: line must name a unit id, such as Unit: U17'
			: capped !== undefined ? `a third check round on ${capped} is refused: what is still open goes to the next patch list; CI is the gate.` : null;
		const refuse = why !== null && hold.mode === 'enforce';
		appendRound(common, { type, model, want: null, round: 'check', units, plan, ...(refuse || prior ? { denied: true } : {}) }, hold);
		return refuse ? deny(why) : null;
	} catch (err) {
		return hookError(cwd, common, err);
	}
}

// The fail-closed answer: appends one row {at, hook, cause} to kit-guard-open.log (common folder given, else looked up) and
// refuses with "hook error: lead review". A failure to write the row does not lift the refusal.
function hookError(cwd, common, err) {
	const cause = String((err && err.message) || err);
	try {
		const dir = common || commonDir(cwd);
		if (dir) fs.appendFileSync(path.join(dir, OPEN), `${JSON.stringify({ at: new Date().toISOString(), hook: 'agent-model', cause })}\n`);
	} catch {
		/* the open log itself failed: the refusal still stands */
	}
	return deny(`hook error: lead review (${cause})`);
}

// The fail-open note: one row {at, hook, cause} in kit-guard-open.log; a failure to write it is swallowed (the call passes).
function openRow(cwd, cause) {
	try {
		const common = commonDir(cwd);
		if (common) fs.appendFileSync(path.join(common, OPEN), `${JSON.stringify({ at: new Date().toISOString(), hook: 'agent-model', cause })}\n`);
	} catch {
		/* the open log itself failed: the call still passes */
	}
}

// Appends one row to the repo's kit-agent-model.log; nothing when the folder is not a repo.
function logRow(cwd, row, hold) {
	const common = commonDir(cwd);
	if (common) fs.appendFileSync(path.join(common, LOG), `${JSON.stringify({ at: new Date().toISOString(), hook: 'agent-model', mode: hold.mode, ...(hold.missing ? { holdModeMissing: true } : {}), ...row })}\n`);
}

// Appends one check row to the repo's kit-check-rounds.log (the git common folder), in the shape logRow writes.
function appendRound(common, row, hold) {
	fs.appendFileSync(path.join(common, ROUNDS), `${JSON.stringify({ at: new Date().toISOString(), hook: 'agent-model', mode: hold.mode, ...(hold.missing ? { holdModeMissing: true } : {}), ...row })}\n`);
}

// K364 (U18): warm agents. A fresh tester or builder spawn is held while an open agent of its lane and table role is under
// the limit, and a SendMessage to an agent at or over it is held. Both follow the warm-agents hold's enforce mode. The open
// agents and the limit come from warm.mjs beside this folder's kit-tools. An error lets the call through and logs one row to
// kit-guard-open.log (S7).
const WARM_ROLES = new Map([['tester', 'tester'], ['test-writer', 'tester'], ['builder', 'builder'], ['implementer', 'builder']]);

// The table role of a spawn: its subagent_type (plugin prefix dropped), else its brief's Role: line; null when neither is one.
function warmRole(type, prompt) {
	const bare = String(type).split(':').pop().trim().toLowerCase();
	if (WARM_ROLES.has(bare)) return WARM_ROLES.get(bare);
	return WARM_ROLES.get(roleOf(prompt)) || null;
}

// The Lane: line of a spawn's prompt, trimmed; null when there is none.
function laneOf(prompt) {
	return lineValue(prompt, 'lane') || null;
}

// Runs decide(open, limit) for a call with a transcript: open() lists the session's agents, read only when asked. Its refusal
// is kept under the warm-agents hold's enforce mode; under log the call passes and a row naming warm goes to
// kit-agent-model.log. Fail-open: any error passes the call and logs one row to kit-guard-open.log (S7).
function warmGate(cwd, input, decide) {
	try {
		if (!input || !input.transcript_path) return null;
		const hold = holdMode('warm-agents');
		const warm = require('../kit-tools/warm.mjs');
		const dir = path.join(String(input.transcript_path).replace(/\.jsonl$/, ''), 'subagents');
		const refusal = decide(() => warm.openAgents(dir), warm.WARM_LIMIT);
		if (refusal && hold.mode !== 'enforce') {
			const call = input.tool_input && typeof input.tool_input === 'object' ? input.tool_input : {};
			logRow(cwd, { type: String(call.subagent_type == null ? '' : call.subagent_type), model: null, want: null, why: `warm-agents would hold: ${refusal.hookSpecificOutput.permissionDecisionReason}` }, hold);
		}
		return refusal && hold.mode === 'enforce' ? refusal : null;
	} catch (err) {
		openRow(cwd, String((err && err.message) || err));
		return null;
	}
}

// The warm check for a fresh spawn: held while an open agent of its lane and table role is under the limit.
function warmSpawn(cwd, input, type, prompt) {
	const role = warmRole(type, prompt);
	const lane = laneOf(prompt);
	if (!role || !lane) return null;
	return warmGate(cwd, input, (open, limit) => {
		const held = open().find((a) => a.lane === lane && WARM_ROLES.get(String(a.role).trim().toLowerCase()) === role && a.tokens < limit);
		return held ? deny(`a ${role} of lane ${lane} is open (agent ${held.id}, ${held.tokens} tokens, under ${limit}): continue it with SendMessage`) : null;
	});
}

// The warm check for a SendMessage: held when its target is at or over the limit.
function warmMessage(cwd, input) {
	const to = String((input.tool_input && input.tool_input.to) || '');
	return warmGate(cwd, input, (open, limit) => {
		const agent = open().find((a) => a.id === to);
		return agent && agent.tokens >= limit ? deny(`agent ${agent.id} is at ${agent.tokens} tokens, over ${limit}: reset it (spawn a fresh one and log the reset with warm.mjs reset)`) : null;
	});
}

// K369 (U24): closeout. In a repo whose HEAD commit holds docs/builds/<VERSION>.closeout.json (VERSION read from HEAD), a checker
// spawn is refused with the defer command, and a tester or writer spawn whose brief has no Ticket: line naming an id in the
// file's tickets is refused. Only HEAD counts, so a file in the working tree does not. A file that cannot be read, or has no
// tickets array, refuses such a spawn with "hook error: lead review" and logs its cause to kit-guard-open.log. A repo with no
// commit, or no closeout file in HEAD, changes nothing.
const CLOSEOUT_DIR = 'docs/builds';

// One git run in a folder: its status and stdout, launched as gitLine launches git. A git that could not run or timed out
// (no status) throws, so the closeout gate refuses.
function gitRun(cwd, args) {
	const r = spawnSync('git', ['-C', cwd, '-c', 'core.fsmonitor=false', ...args], {
		encoding: 'utf8',
		timeout: 3000,
		windowsHide: true,
		cwd: path.dirname(process.execPath),
		env: { ...process.env, NoDefaultCurrentDirectoryInExePath: '1', LC_ALL: 'C' },
	});
	if (r.status === null) throw new Error(`git ${args[0]} did not run${r.error ? `: ${r.error.message}` : ''}`);
	return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

// The tickets of the closeout file in HEAD: null when there is no commit (rev-parse status 1), the folder is in no git
// repository, or there is no such file; it throws on any other git failure, and when the file is there but cannot be read or
// has no tickets array.
function closeoutTickets(cwd) {
	const head = gitRun(cwd, ['rev-parse', '--verify', '-q', 'HEAD']);
	if (head.status === 1 || (head.status === 128 && /not a git repository \(or any of the parent directories\)/.test(head.stderr))) return null;
	if (head.status !== 0) throw new Error(`git rev-parse HEAD exited ${head.status}`);
	const present = gitRun(cwd, ['ls-tree', '--full-tree', '--name-only', 'HEAD', '--', 'VERSION']);
	if (present.status !== 0) throw new Error('git cannot list HEAD for VERSION');
	if (present.stdout.trim() !== 'VERSION') return null;
	const version = gitRun(cwd, ['show', 'HEAD:VERSION']);
	if (version.status !== 0) throw new Error('VERSION in HEAD cannot be read');
	const rel = `${CLOSEOUT_DIR}/${version.stdout.trim()}.closeout.json`;
	const listed = gitRun(cwd, ['ls-tree', '--full-tree', '--name-only', 'HEAD', '--', rel]);
	if (listed.status !== 0) throw new Error(`git cannot list HEAD for ${rel}`);
	if (listed.stdout.trim() !== rel) return null;
	const shown = gitRun(cwd, ['show', `HEAD:${rel}`]);
	if (shown.status !== 0) throw new Error(`${rel} in HEAD cannot be read`);
	const data = JSON.parse(shown.stdout);
	if (!data || typeof data !== 'object' || !Array.isArray(data.tickets)) throw new Error(`${rel} has no tickets array`);
	return data.tickets;
}

// True when the spawn's Ticket: line names an id the closeout tickets name (ids read as idsOf reads them).
function ticketNamed(prompt, tickets) {
	const known = new Set(idsOf(tickets.join(' ')));
	return lineValues(prompt, 'ticket').flatMap(idsOf).some((id) => known.has(id));
}

// The role a spawn runs as for the closeout check: listRole's tester or writer, plus test-writer (the table's tester role,
// as WARM_ROLES reads it), by subagent_type or, for a general agent, by its Role: line. Null for every other spawn.
function closeoutRole(type, prompt) {
	const role = listRole(type, prompt);
	if (role) return role;
	const bare = String(type).split(':').pop().toLowerCase();
	if (bare === 'test-writer') return 'test-writer';
	return (bare === 'general-purpose' || bare === '') && roleNamed(prompt, ['test-writer']) ? 'test-writer' : null;
}

// The closeout check for a checker, tester or writer spawn. Any other spawn passes without a read of the repo. Fail-closed: any
// error inside it, a git that did not run and the log-row append included, refuses with "hook error: lead review" and logs it.
function closeoutGate(cwd, type, prompt) {
	const checkerCall = isChecker(type, prompt);
	const role = checkerCall ? null : closeoutRole(type, prompt);
	if (!checkerCall && !role) return null;
	try {
		const hold = holdMode('closeout-spawn', true);
		const tickets = closeoutTickets(cwd);
		if (tickets === null) return null;
		const why = checkerCall
			? 'a checker spawn in closeout: record the deferral with node user/kit-tools/closeout.mjs defer "<text>" instead'
			: ticketNamed(prompt, tickets) ? null : `a ${role} spawn in closeout has no Ticket: line naming an id in the closeout tickets`;
		if (why === null) return null;
		logRow(cwd, { type: role || type, model: null, want: null, why }, hold);
		return hold.mode === 'enforce' ? deny(why) : null;
	} catch (err) {
		return hookError(cwd, null, err);
	}
}

// The hook's answer for one Agent call: a deny when the hold reads enforce and the model is of another family, else nothing.
// An error anywhere in it on a checker spawn refuses with "hook error: lead review" (fail-closed, one kit-guard-open.log row);
// on any other spawn the call passes and a row says it passed unchecked (fail-open).
function check(input) {
	let refuse = null;
	let cwd = process.cwd();
	let checkerSpawn = false;
	let closed = null;
	try {
		const call = input && input.tool_input && typeof input.tool_input === 'object' ? input.tool_input : {};
		const type = call.subagent_type == null ? '' : String(call.subagent_type);
		const model = call.model == null || call.model === '' ? null : String(call.model);
		cwd = String((input && input.cwd) || process.cwd());
		if (input && input.tool_name === 'SendMessage') return warmMessage(cwd, input);
		const prompt = call.prompt == null ? '' : String(call.prompt);
		checkerSpawn = isChecker(type, prompt);
		// The closeout check (K369) runs before any log write below, so a log that cannot be written does not let a tester or
		// writer through in closeout. It comes first in precedence: a checker in closeout is refused, a tester or writer names
		// a ticket in the closeout list, and the same spawn gets the same refusal on every try, even past the round cap.
		closed = closeoutGate(cwd, type, prompt);
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
			const list = isShare(prompt) ? undefined : gitLine(wt, ['--path-format=absolute', '--git-path', LIST]);
			if (list === undefined) {
				openRow(cwd, `the Worktree: path ${lineValue(prompt, 'worktree')} is a network share: git is not run on it, so its list is not checked and the spawn passes`);
			} else if (list === null) {
				logRow(cwd, { type: role, model, want: null, why: `worktree ${wt} cannot be read by git, so its list is not checked and the spawn passes` }, gate);
			} else if (!fs.existsSync(list)) {
				const why = `a ${role} spawn names worktree ${wt}, which has no ${LIST}`;
				logRow(cwd, { type: role, model, want: null, why }, gate);
				if (gate.mode === 'enforce') refuse = deny(`${why}. Run ${LIST_COMMAND} <test files> from that worktree, then spawn.`);
			}
		}
		// The round cap: a checker spawn on a unit with two counted check rounds already is refused (K366). roundGate still
		// runs for every checker, so its check rows are written as before.
		const capped = checkerSpawn ? roundGate(cwd, type, model, prompt, closed || refuse) : null;
		refuse = closed || capped || refuse;
		// The warm check (K364): a fresh tester or builder spawn while an open one of its lane is under the limit.
		refuse = refuse || warmSpawn(cwd, input, type, prompt);
	} catch (err) {
		if (checkerSpawn) return hookError(cwd, null, err);
		if (closed) return closed;
		/* any other call passes; the row says it passed unchecked */
		try {
			logRow(cwd, { type: '', model: null, want: null, why: 'hook error: the call passes unchecked' }, holdMode('agent-model'));
		} catch {
			/* the log itself failed: nothing more to do */
		}
	}
	return refuse;
}

module.exports = { check, GUARD_PATHS };
