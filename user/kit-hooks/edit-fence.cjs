// The builder's edit fence (rule:agent-role-table): a PreToolUse hook on Edit and Write in the builder role file.
// A builder works in its own git worktree; an edit outside it would land in someone else's checkout. When the
// worktree has a unit file list (one path per line, relative to the worktree) at `git rev-parse --git-path
// kit-unit-files.txt`, edits are also kept to that list. That path is inside the worktree's own git folder, so the
// list is never committed and binds only its own worktree. Exit 2 blocks the tool call and tells the builder why; a crash in the fence answers by its tier (K375, below),
// and the checker and the lead's integration still review the unit.
const fs = require('fs');
const path = require('path');
const safeSpawn = require('./safe-spawn.cjs');
const { isTestFile, tests, whyFault } = require('./why-rule.cjs');

// K375 (U10): a crash in this hook obeys its tier. hook-error.cjs decides (a deny under high); with the helper missing the
// call is refused and one row is written, found with fs reads only (no child process, so a stubbed or planted git cannot
// stop the row). `where` is the call's cwd, set once the input is read; the process cwd stands in for an unread input.
const HOOK = 'edit-fence';
let where = process.cwd();

// The git common dir of `where`, from fs reads only: a folder's .git is the common dir; a "gitdir:" file names a worktree's
// folder, whose commondir file names the common one. Null when `where` is in no repo.
function commonDirFs(from) {
	let dir = path.resolve(String(from));
	for (;;) {
		const dotGit = path.join(dir, '.git');
		if (fs.existsSync(dotGit)) {
			if (fs.statSync(dotGit).isDirectory()) return dotGit;
			const m = /^gitdir:\s*(.+)$/m.exec(fs.readFileSync(dotGit, 'utf8'));
			if (!m) return null;
			const gitdir = path.resolve(dir, m[1].trim());
			try { return path.resolve(gitdir, fs.readFileSync(path.join(gitdir, 'commondir'), 'utf8').trim()); } catch { return gitdir; }
		}
		const up = path.dirname(dir);
		if (up === dir) return null;
		dir = up;
	}
}

// The refusal for stderr when this hook's crash is a deny, or null when its tier lets the call through.
function failed(error) {
	let helper = null;
	try { helper = require('./hook-error.cjs'); } catch { helper = null; }
	if (helper) {
		const answer = helper.onError(HOOK, error, where);
		return answer ? answer.hookSpecificOutput.permissionDecisionReason : null;
	}
	try {
		const dir = commonDirFs(where);
		if (dir) fs.appendFileSync(path.join(dir, 'kit-guard-open.log'), `${JSON.stringify({ kind: 'hook-error', id: 'hook-error', hook: `${HOOK}.cjs`, error: `hook-error.cjs is missing: ${String((error && error.message) || error).split('\n')[0]}`, at: new Date().toISOString() })}\n`);
	} catch { /* the refusal stands without its row */ }
	return 'hook error: lead review: hook-error.cjs is missing';
}

// Roles whose edits need the lead's file list (their role bodies say so); a builder without one edits its worktree as before.
// A plugin role is named kit:builder, so a role matches by its last name after a colon, as sweep-guard matches it.
const LISTED_ROLE = /(^|:)(tester|writer)$/i;
const BUILDER_ROLE = /(^|:)builder$/i;
// U4 (build 24): the unit list's name. A builder edits neither a test file (why-rule.cjs's isTestFile) nor the list,
// whatever list there is.
const LIST = 'kit-unit-files.txt';

// The real path, through any symlink or junction: git reports the worktree's real path, so the target must be
// compared the same way. A file not yet written resolves through its nearest existing folder.
function real(p) {
	const rest = [];
	while (!fs.existsSync(p) && path.dirname(p) !== p) { rest.unshift(path.basename(p)); p = path.dirname(p); }
	return path.join(fs.realpathSync.native(p), ...rest);
}

// One spelling for a path inside the worktree: forward slashes, no leading ./, and no case on Windows.
const norm = (p) => {
	const s = p.trim().replace(/\\/g, '/').replace(/^(\.\/)+/, '');
	return process.platform === 'win32' ? s.toLowerCase() : s;
};

// The text a write leaves in its file: Write's content, or the file with each Edit applied in turn. Null when an edit
// cannot be applied (its old_string is absent or empty, or the content is not text), so the test cannot be parsed.
function resultOf(tool, input, old) {
	const apply = (text, e) => (text !== null && e && typeof e.old_string === 'string' && typeof e.new_string === 'string' && e.old_string && text.includes(e.old_string)
		? (e.replace_all ? text.split(e.old_string).join(e.new_string) : text.replace(e.old_string, () => e.new_string)) : null);
	if (tool === 'Write') return typeof input.content === 'string' ? input.content : null;
	if (tool === 'Edit') return apply(old, input);
	if (tool === 'MultiEdit') return Array.isArray(input.edits) ? input.edits.reduce(apply, old) : null;
	return undefined;
}

// K368 S1-S5: a test file's write must give each new test( a why line whyFault passes, and a write this check cannot
// parse is refused and logged. Returns the refusal for stderr, or null to let the write through.
function whyRefusal(tool, input, rel, abs, root) {
	const old = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : '';
	const next = resultOf(tool, input, old);
	if (next === undefined) return null;
	if (next === null) {
		try {
			const common = safeSpawn.gitRead(root, ['rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' });
			if (common.status === 0) fs.appendFileSync(path.join(common.stdout.trim(), 'kit-guard-open.log'), `${JSON.stringify({ at: new Date().toISOString(), hook: 'edit-fence', file: rel, tool, reason: 'unparsable' })}\n`);
		} catch { /* the refusal stands without its log row */ }
		return `Blocked: ${rel} is an unparsable test file: the ${tool} cannot be applied to it, so its tests cannot be checked. Stop and report it.`;
	}
	const oldTests = tests(old);
	const nextTests = tests(next);
	const faults = [];
	// U21 C3: a name that newly repeats is refused outright, whatever its why, since the check reads only the last test of a name.
	for (const name of nextTests.twice) {
		if (!oldTests.twice.has(name)) faults.push(`test "${name}": two tests in this file share the name: the check reads only the last, so give each its own`);
	}
	for (const [name, body] of nextTests) {
		// Judged: a new name, a name that newly repeats, and a test whose old why passed and whose new one does not. A legacy
		// test that never had a passing why stays editable.
		const fresh = !oldTests.has(name) || (nextTests.twice.has(name) && !oldTests.twice.has(name));
		const regressed = oldTests.has(name) && !whyFault(oldTests.get(name)) && whyFault(body);
		if (!fresh && !regressed) continue;
		const fault = whyFault(body);
		if (fault) faults.push(`test "${name}": ${fault}`);
	}
	return faults.length ? `Blocked: ${rel} cannot be saved as written. ${faults.join('; ')}. Give each test its own name and a usable why line above it, or report it if you cannot.` : null;
}

function main() {
	const input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
	where = input.cwd || where;
	const file = input.tool_input && (input.tool_input.file_path || input.tool_input.notebook_path);
	if (!file) return 0;
	const cwd = input.cwd || process.cwd();
	// git from node's own folder, never the worktree (build 23).
	const top = safeSpawn.gitRead(cwd, ['rev-parse', '--show-toplevel'], { encoding: 'utf8' });
	if (top.status !== 0) {
		// No git top level means no file list to check a tester or writer against: stop it, as with a missing list.
		if (LISTED_ROLE.test(String(input.agent_type))) {
			process.stderr.write(`Blocked: ${input.agent_type} edit has no git worktree to check its file list against. Stop and report it.\n`);
			return 2;
		}
		return 0;
	}
	const root = real(path.resolve(top.stdout.trim()));
	const target = real(path.resolve(cwd, file));
	const rel = path.relative(root, target);
	if (rel.startsWith('..') || path.isAbsolute(rel)) {
		process.stderr.write(`Blocked: ${target} is outside this builder's worktree (${root}). Edit only files of your unit, in your worktree.\n`);
		return 2;
	}
	if (BUILDER_ROLE.test(String(input.agent_type)) && (isTestFile(rel) || path.basename(rel) === LIST)) {
		process.stderr.write(`Blocked: ${rel} is a test file or the unit list, which a builder does not edit. Report it to the lead instead of editing it.\n`);
		return 2;
	}
	const gitPath = safeSpawn.gitRead(root, ['rev-parse', '--path-format=absolute', '--git-path', LIST], { encoding: 'utf8' });
	const listFile = gitPath.status === 0 ? gitPath.stdout.trim() : '';
	if (listFile && fs.existsSync(listFile)) {
		const allowed = fs.readFileSync(listFile, 'utf8').split(/\r?\n/).map(norm).filter((p) => p && !p.startsWith('#'));
		if (!allowed.includes(norm(rel))) {
			process.stderr.write(`Blocked: ${rel} is not in this unit's file list (git rev-parse --git-path kit-unit-files.txt). Report it to the lead instead of editing it.\n`);
			return 2;
		}
	} else if (LISTED_ROLE.test(String(input.agent_type))) {
		// A tester or writer edits only what the lead listed, so with no list it stops (a builder keeps its worktree edits).
		process.stderr.write(`Blocked: ${input.agent_type} has no file list. The lead writes kit-unit-files.txt before the unit starts; stop and report it.\n`);
		return 2;
	}
	if (isTestFile(rel)) {
		const refusal = whyRefusal(input.tool_name, input.tool_input || {}, rel, target, root);
		if (refusal) { process.stderr.write(`${refusal}\n`); return 2; }
	}
	return 0;
}

// A crash obeys the tier: under high a deny is exit 2 with its reason on stderr, so an unchecked edit never gets through.
try {
	process.exitCode = main();
} catch (error) {
	const reason = failed(error);
	if (reason) {
		process.stderr.write(`${reason}\n`);
		process.exitCode = 2;
	} else {
		process.exitCode = 0;
	}
}
