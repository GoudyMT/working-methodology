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

function run(input) {
	const message = String((input.tool_input || {}).message || '');
	if (!message.split(/\r?\n/).some((l) => l.trim() === 'RECORD:')) return;
	const cwd = input.cwd || process.cwd();
	const common = git(cwd, 'rev-parse', '--path-format=absolute', '--git-common-dir');
	if (common.status !== 0) return;
	const checker = path.join(__dirname, '..', 'kit-tools', 'handoff.mjs');
	if (!fs.existsSync(checker)) return;
	const r = spawnSync(process.execPath, [checker, 'check', '-'], { input: message, encoding: 'utf8', timeout: 5000, cwd: path.dirname(process.execPath) });
	if (r.status !== 0 && r.status !== 1) return;
	const lines = String(r.stderr || '').split(/\r?\n/).filter(Boolean);
	const errors = r.status === 1 ? lines : [];
	if (recordIsCRLF(message)) errors.push('CRLF line endings in the RECORD: block: end each line with LF');
	const hold = holdMode();
	const log = path.join(common.stdout.trim(), 'kit-guard-open.log');
	const row = { at: new Date().toISOString(), hook: 'handoff-gate', mode: hold.mode, ...(hold.missing ? { holdModeMissing: true } : {}) };
	if (errors.length) {
		fs.appendFileSync(log, `${JSON.stringify({ ...row, errors })}\n`);
		if (hold.mode === 'enforce') {
			process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: `Your hand-back's RECORD: block is broken, so the lead cannot count it. Send it again with the record fixed: ${errors.join('; ')}.` } }));
		}
	} else if (lines.length) {
		fs.appendFileSync(log, `${JSON.stringify({ ...row, warnings: lines })}\n`);
	}
}

// canary.cjs calls run() from the role files' hand-back hook, so a role's hook table keeps one entry per matcher.
if (require.main === module) {
	try { run(JSON.parse(fs.readFileSync(0, 'utf8') || '{}')); } catch { /* a log that fails never blocks the hand-back */ }
	process.exitCode = 0;
}

module.exports = { run };
