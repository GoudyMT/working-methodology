'use strict';
// E36 (build 24): the agent model hook. An Agent or Task call names a subagent_type, and that role's file in the Claude
// config folder names the model the role runs on. This logs a line to kit-agent-model.log in the repo's git common folder
// when the role has no file, or when the call names a model of another family than the role file. Its hold (U9, in
// holds.json) is log: every call runs as it would have. Set to enforce, the same mismatch is refused. The git launch stays
// inline: the guard loads this file from the Claude folder, beside hold-mode.cjs.
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
// file alone) logs as it did before the holds, so it is never refused for a missing file.
function holdMode(id) {
	try {
		return require('./hold-mode.cjs').mode(id);
	} catch {
		return 'log';
	}
}

function check(input) {
	try {
		const call = input && input.tool_input && typeof input.tool_input === 'object' ? input.tool_input : {};
		const type = call.subagent_type == null ? '' : String(call.subagent_type);
		const model = call.model == null || call.model === '' ? null : String(call.model);
		const want = roleModel(type);
		let why = null;
		if (want === undefined) why = type ? `no role file for ${type}` : 'no subagent_type named';
		else if (want === null) return null;
		else if (model && family(model) !== family(want)) why = `the call names ${model}, the role file ${type} names ${want}`;
		if (why) {
			const common = commonDir(String((input && input.cwd) || process.cwd()));
			if (common) {
				const row = { at: new Date().toISOString(), hook: 'agent-model', type, model, want: want === undefined ? null : want, why };
				fs.appendFileSync(path.join(common, LOG), `${JSON.stringify(row)}\n`);
			}
		}
		if (why && holdMode('agent-model') === 'enforce') {
			return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: `Held by the agent-model hold (enforce): ${why}.` } };
		}
	} catch {
		/* a hook that fails never stops a call */
	}
	return null;
}

module.exports = { check };
