// Load guard: refuses to start the commit hook or the full gate while the CPU is busy, and names what is using it.
// Why: a starved machine times tests out and crashes runners, and those false failures cost more than the wait.
// Usage: node .claude/load-guard.cjs [--force] && <the check>. LOAD_GUARD_MAX sets the busy limit in percent
// (default 40, averaged over 3 s). --force is the owner's override: it skips the check.
// Exit 0 = quiet enough (prints nothing); exit 1 = busy (the reason goes to stderr).
const os = require('os');
const { spawnSync } = require('child_process');

const DEFAULT_MAX = 40;
const SAMPLE_MS = 3000;

/** Percent of CPU time spent busy across all cores over one sample window. */
async function busyPercent(ms = SAMPLE_MS) {
	const snap = () => os.cpus().reduce((t, c) => {
		const all = Object.values(c.times).reduce((a, b) => a + b, 0);
		return { idle: t.idle + c.times.idle, all: t.all + all };
	}, { idle: 0, all: 0 });
	const a = snap();
	await new Promise((r) => setTimeout(r, ms));
	const b = snap();
	const all = b.all - a.all;
	return all > 0 ? Math.round(100 * (1 - (b.idle - a.idle) / all)) : 0;
}

/** The processes with the most CPU time, by name - a hint for the owner, not an exact live reading. */
function topProcesses(n = 3) {
	const r = process.platform === 'win32'
		? spawnSync(require('node:path').join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoProfile', '-Command',
			`Get-Process | Sort-Object CPU -Descending | Select-Object -First ${n} -ExpandProperty ProcessName`], { encoding: 'utf8', timeout: 10000 })
		: spawnSync('ps', ['-eo', 'comm', '--sort=-pcpu', '--no-headers'], { encoding: 'utf8', timeout: 10000 });
	return (r.stdout || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean).slice(0, n);
}

/**
 * Decide whether the machine is quiet enough to run checks.
 *
 * Args:
 *     input: { busy: percent busy, threshold: the limit, top: process names using the CPU most }
 *
 * Returns:
 *     { ok, message } - message explains a refusal and names the processes
 */
function checkLoad({ busy, threshold, top }) {
	if (busy <= threshold) return { ok: true, message: '' };
	const who = top.length ? top.join(', ') : 'unknown';
	return { ok: false, message: `CPU is ${busy}% busy (limit ${threshold}%). Using it most: ${who}. Free the CPU or wait, then run again.` };
}

async function main() {
	if (process.argv.includes('--force')) return;
	const threshold = process.env.LOAD_GUARD_MAX !== undefined ? Number(process.env.LOAD_GUARD_MAX) : DEFAULT_MAX;
	const busy = await busyPercent();
	const r = checkLoad({ busy, threshold, top: busy > threshold ? topProcesses() : [] });
	if (!r.ok) {
		process.stderr.write(r.message + '\n');
		process.exitCode = 1;
	}
}

module.exports = { checkLoad, busyPercent, topProcesses, DEFAULT_MAX, SAMPLE_MS };
if (require.main === module) main();
