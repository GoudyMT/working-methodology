// The hand-back gate. On SubagentHandback, a message whose RECORD: block fails the record check (kit-tools/handoff.mjs,
// or uses CRLF line endings) is logged to <git common dir>/kit-guard-open.log with the check's errors. A valid record's
// warnings (such as a missing clarity) are logged too. Its hold (holds.json, read through hold-mode.cjs) decides the
// refusal: under enforce a broken record gets the PreToolUse deny shape, so the lead sees it refused; under log, or with
// hold-mode.cjs missing, nothing is printed and the hand-back reaches the lead. A valid record prints nothing. A message
// with no RECORD: line is not this gate's to log.
// The check runs as its own program, from node's own folder, so this hook process loads only its own folder.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { isTestFile, tests, whyFault } = require('./why-rule.cjs');

// git as test-scope.cjs runs it: the repo's own config may name a program git runs (fsmonitor), so that is off.
const git = (cwd, ...a) => spawnSync('git', ['-C', cwd, '-c', 'core.fsmonitor=false', ...a], { encoding: 'utf8', timeout: 3000, cwd: path.dirname(process.execPath) });

// The hold's mode from hold-mode.cjs beside this file; a copy without it falls back to log and the row says so.
function holdMode() {
	try {
		return { mode: require('./hold-mode.cjs').mode('handoff-gate') };
	} catch {
		return { mode: 'log', missing: true };
	}
}

// True when a line of the message's last RECORD: block ends in a carriage return (CRLF line endings).
function recordIsCRLF(message) {
	const lines = message.split('\n');
	let at = -1;
	lines.forEach((l, i) => { if (l.trim() === 'RECORD:') at = i; });
	return at >= 0 && lines.slice(at).some((l) => l.endsWith('\r'));
}

// The RECORD's role line: the first JSON line after its RECORD: line, or null.
function roleLineOf(message) {
	const lines = message.split(/\r?\n/);
	const at = lines.findIndex((l) => l.trim() === 'RECORD:');
	for (const l of lines.slice(at + 1)) {
		if (!l.trim().startsWith('{')) continue;
		try { return JSON.parse(l); } catch { return null; }
	}
	return null;
}

// K368 S2: each test a role line's commit adds (a test file's test( that its first parent lacks) must be listed in the
// role line's tests with a why line whyFault passes, and must carry a passing why line at the commit itself. A why given
// as bare text is read with its "// why: " label. Returns the file::name keys that fail, or [] when the commit cannot be
// read: then no test is judged, and nothing else checks that commit.
function untestedKeys(cwd, role) {
	const sha = typeof role.commit === 'string' ? role.commit : '';
	if (!sha || git(cwd, 'rev-parse', '--verify', '-q', `${sha}^{commit}`).status !== 0) return [];
	const parent = git(cwd, 'rev-parse', '--verify', '-q', `${sha}^`);
	const base = parent.status === 0 ? parent.stdout.trim() : null;
	// quotePath off: a non-ASCII file name would come back quoted, and no show could read it (as kit.mjs reads it).
	const files = base ? git(cwd, '-c', 'core.quotePath=false', 'diff', '--name-only', base, sha) : git(cwd, '-c', 'core.quotePath=false', 'ls-tree', '-r', '--name-only', sha);
	const listed = Array.isArray(role.tests) ? role.tests : [];
	const missing = [];
	for (const file of String(files.stdout || '').split(/\r?\n/).filter((f) => f && isTestFile(f))) {
		const now = git(cwd, 'show', `${sha}:${file}`);
		if (now.status !== 0) continue;
		const was = base ? git(cwd, 'show', `${base}:${file}`) : null;
		const nowTests = tests(now.stdout);
		const had = new Set(was && was.status === 0 ? tests(was.stdout).keys() : []);
		for (const name of nowTests.keys()) {
			if (had.has(name)) continue;
			const entry = listed.find((t) => t && t.name === name);
			const raw = entry ? String(entry.why || '').trim() : '';
			const listedWhy = /^\/\/ why:/.test(raw) ? raw : `// why: ${raw}`;
			if (!entry || whyFault(listedWhy) || whyFault(nowTests.get(name))) missing.push(`${file}::${name}`);
		}
	}
	return missing;
}

// The decision for a hand-back: the PreToolUse deny object under enforce, else null. The caller decides what to print.
// A checker that exits other than 0 or 1 is logged as a row and passes the hand-back.
function run(input) {
	const message = String((input.tool_input || {}).message || '');
	if (!message.split(/\r?\n/).some((l) => l.trim() === 'RECORD:')) return null;
	const cwd = input.cwd || process.cwd();
	const common = git(cwd, 'rev-parse', '--path-format=absolute', '--git-common-dir');
	if (common.status !== 0) return null;
	const checker = path.join(__dirname, '..', 'kit-tools', 'handoff.mjs');
	if (!fs.existsSync(checker)) return null;
	const r = spawnSync(process.execPath, [checker, 'check', '-'], { input: message, encoding: 'utf8', timeout: 5000, cwd: path.dirname(process.execPath) });
	const hold = holdMode();
	const log = path.join(common.stdout.trim(), 'kit-guard-open.log');
	const row = { at: new Date().toISOString(), hook: 'handoff-gate', mode: hold.mode, ...(hold.missing ? { holdModeMissing: true } : {}) };
	if (r.status !== 0 && r.status !== 1) {
		fs.appendFileSync(log, `${JSON.stringify({ ...row, checkerExit: r.status === null ? String(r.signal) : r.status })}\n`);
		return null;
	}
	const lines = String(r.stderr || '').split(/\r?\n/).filter(Boolean);
	const errors = r.status === 1 ? lines : [];
	const missing = untestedKeys(cwd, roleLineOf(message) || {});
	if (missing.length) errors.push(`the role line's tests lack a why for each new test (list each as {name, why}): ${missing.join(', ')}`);
	if (recordIsCRLF(message)) errors.push('CRLF line endings in the RECORD: block: end each line with LF');
	if (errors.length) {
		fs.appendFileSync(log, `${JSON.stringify({ ...row, errors })}\n`);
		if (hold.mode === 'enforce') {
			return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: `Your hand-back's RECORD: block is broken, so the lead cannot count it. Send it again with the record fixed: ${errors.join('; ')}.` } };
		}
	} else if (lines.length) {
		fs.appendFileSync(log, `${JSON.stringify({ ...row, warnings: lines })}\n`);
	}
	return null;
}

// canary.cjs calls run() from the role files' hand-back hook, so a role's hook table keeps one entry per matcher. Run
// alone, this prints its decision.
if (require.main === module) {
	try {
		const out = run(JSON.parse(fs.readFileSync(0, 'utf8') || '{}'));
		if (out) process.stdout.write(JSON.stringify(out));
	} catch { /* a log that fails never blocks the hand-back */ }
	process.exitCode = 0;
}

module.exports = { run };
