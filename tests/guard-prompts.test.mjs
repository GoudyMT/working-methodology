// Fewer prompts no one can answer (E27, 1.24.0): the 10 days before this build held 512 live guard asks, 76 of them
// inside subagents, where no one sees the ask and the agent waits; and about half of the main session's delete asks
// were on text a command only writes to a file (a here-document). Each case runs the shipped hook as Claude Code does.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// A folder outside the project and the session's own, as each platform writes one.
const OUT = process.platform === 'win32' ? 'C:/elsewhere/x' : '/elsewhere/x';
const hook = (file, command, extra = {}) => {
	const r = spawnSync(process.execPath, [path.resolve('project/.claude', file)], { input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command }, cwd: process.cwd(), ...extra }), encoding: 'utf8' });
	assert.equal(r.status, 0, `the guard crashed: ${r.stderr}`);
	return r.stdout ? JSON.parse(r.stdout).hookSpecificOutput.permissionDecision : 'pass';
};

test('a guard in a subagent refuses instead of asking, so the agent hands the act back and never waits on a prompt', () => {
	const sub = { agent_id: 'a1b2c3', agent_type: 'builder' };
	assert.equal(hook('guard-outward.cjs', 'git push origin main', sub), 'deny');
	assert.equal(hook('guard-delete.cjs', 'rm -rf ' + OUT, sub), 'deny');
	// The main session still asks the owner, and a plain command still passes in both.
	assert.equal(hook('guard-outward.cjs', 'git push origin main'), 'ask');
	assert.equal(hook('guard-delete.cjs', 'rm -rf ' + OUT), 'ask');
	assert.equal(hook('guard-outward.cjs', 'git status', sub), 'pass');
	assert.equal(hook('guard-delete.cjs', 'git status', sub), 'pass');
});

// N10: off a terminal, npm assumes yes, so `npx <name>` in an agent's shell fetched and ran any registry package.
test('the shipped project settings turn off npm and npx installing a missing package without a prompt', () => {
	const settings = JSON.parse(fs.readFileSync(path.resolve('project/.claude/settings.json'), 'utf8'));
	assert.equal(settings.env && settings.env.npm_config_yes, 'false');
});

test('the delete guard reads a quoted here-document written to a file as data, and every run body as a command', () => {
	// Markdown with backticks and a delete it only describes, written to a file: nothing runs.
	assert.equal(hook('guard-delete.cjs', "cat > notes.md <<'EOF'\nRun `rm -rf " + OUT + "` to clean up.\nEOF"), 'pass');
	assert.equal(hook('guard-delete.cjs', "cat <<'EOF' > notes.md\nrm -rf " + OUT + "\nEOF"), 'pass');
	// The same body fed to a shell, expanded by bash, or after the here-document ends, runs.
	assert.equal(hook('guard-delete.cjs', "cat <<'EOF' | bash\nrm -rf " + OUT + "\nEOF"), 'ask');
	assert.equal(hook('guard-delete.cjs', 'cat > notes.md <<EOF\n$(rm -rf ' + OUT + ')\nEOF'), 'ask');
	assert.equal(hook('guard-delete.cjs', "bash <<'EOF'\nrm -rf " + OUT + "\nEOF"), 'ask');
	assert.equal(hook('guard-delete.cjs', "cat > notes.md <<'EOF'\nx\nEOF\nrm -rf " + OUT + ""), 'ask');
	// A mark inside quotes starts no here-document, so the lines after it are commands.
	assert.equal(hook('guard-delete.cjs', `cat "a<<'X'"\nrm -rf ${OUT}\nX`), 'ask');
});
