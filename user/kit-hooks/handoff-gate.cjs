// The hand-back gate (log only). On SubagentHandback, a message whose RECORD: block fails the record check (kit-tools/
// handoff.mjs) is logged to <git common dir>/kit-guard-open.log, one JSON line with the check's errors, so the lead can
// see why a record was not counted. It never prints a decision, never refuses and never throws: a hand-back always
// reaches the lead. A message with no RECORD: line is not this gate's to log.
// The check runs as its own program, from node's own folder, so this hook process loads only its own folder.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

// git as test-scope.cjs runs it: the repo's own config may name a program git runs (fsmonitor), so that is off.
const git = (cwd, ...a) => spawnSync('git', ['-C', cwd, '-c', 'core.fsmonitor=false', ...a], { encoding: 'utf8', timeout: 3000, cwd: path.dirname(process.execPath) });

function run(input) {
	const message = String((input.tool_input || {}).message || '');
	if (!message.split(/\r?\n/).some((l) => l.trim() === 'RECORD:')) return;
	const cwd = input.cwd || process.cwd();
	const common = git(cwd, 'rev-parse', '--path-format=absolute', '--git-common-dir');
	if (common.status !== 0) return;
	const checker = path.join(__dirname, '..', 'kit-tools', 'handoff.mjs');
	if (!fs.existsSync(checker)) return;
	const r = spawnSync(process.execPath, [checker, 'check', '-'], { input: message, encoding: 'utf8', timeout: 5000, cwd: path.dirname(process.execPath) });
	if (r.status !== 1) return;
	const errors = String(r.stderr || '').split(/\r?\n/).filter(Boolean);
	fs.appendFileSync(path.join(common.stdout.trim(), 'kit-guard-open.log'), `${JSON.stringify({ at: new Date().toISOString(), hook: 'handoff-gate', errors })}\n`);
}

// canary.cjs calls run() from the role files' hand-back hook, so a role's hook table keeps one entry per matcher.
if (require.main === module) {
	try { run(JSON.parse(fs.readFileSync(0, 'utf8') || '{}')); } catch { /* a log that fails never blocks the hand-back */ }
	process.exitCode = 0;
}

module.exports = { run };
