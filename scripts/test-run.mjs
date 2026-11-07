// The guarded test runner: the only way to run the full suite in the Cowork VM, and the way CI runs it.
//   node scripts/test-run.mjs [test files...]     (no files: every tests/*.test.mjs)
// 1. Refuses to start above 80% of the temp disk's inodes used (exit 2); warns above 50%.
// 2. Sweeps the roots of finished or killed runs, before and after.
// 3. Fails the run when the temp folder holds more entries after than before, and names them.
// A signal to the runner is passed to the tests, so each test file's own handler removes its root.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import kitTemp from '../project/.claude/kit-temp.cjs';

const { inodeUse, sweepStale } = kitTemp;
const HERE = path.dirname(fileURLToPath(import.meta.url));

export async function main(args) {
	const tmp = os.tmpdir();
	const use = inodeUse(tmp);
	if (use.level === 'refuse') {
		process.stderr.write(`test-run: ${use.text}: refuse to run above ${kitTemp.REFUSE_PCT}%. Clear old temp folders first.\n`);
		return 2;
	}
	if (use.level === 'warn') process.stderr.write(`test-run: warning, ${use.text}\n`);
	sweepStale(tmp);
	const before = new Set(fs.readdirSync(tmp));
	const tests = path.join(HERE, '..', 'tests');
	const files = args.length ? args : fs.readdirSync(tests).filter((f) => f.endsWith('.test.mjs')).map((f) => path.join(tests, f));
	const status = await new Promise((resolve) => {
		const child = spawn(process.execPath, ['--test', ...files], { stdio: 'inherit' });
		const pass = (sig) => () => child.kill(sig);
		const sigs = ['SIGINT', 'SIGTERM', 'SIGHUP'].map((s) => [s, pass(s)]);
		for (const [s, h] of sigs) process.on(s, h);
		child.on('close', (code, sig) => {
			for (const [s, h] of sigs) process.off(s, h);
			resolve(code ?? 128 + (os.constants.signals[sig] || 0));
		});
	});
	sweepStale(tmp);
	const added = fs.readdirSync(tmp).filter((n) => !before.has(n));
	if (added.length) {
		process.stderr.write(`test-run: temp growth: ${added.length} in ${tmp}:\n${added.map((n) => `  ${n}`).join('\n')}\n`);
		return status || 1;
	}
	process.stdout.write(`test-run: temp growth: 0 in ${tmp}\n`);
	return status;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
	process.exitCode = await main(process.argv.slice(2));
}
