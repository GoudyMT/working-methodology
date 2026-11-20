// The test-scope check (K150, build 20; the owner's starred rule "locally run only the changed test, red then green,
// CI does the rest"). A prose rule slipped: build 19 reran about 170 unchanged tests after each fix. So a local test
// run is read here, on every Bash and PowerShell call, and allowed only when every test file it names is one the
// branch changed. The rest needs the owner's pop-up yes, which the one guard process reads (guard.cjs):
//   a run with no file (the whole suite), test-run.mjs --changed without --pick (it widens to every test the change
//   reaches), a test file the branch did not change, and the kit's CI-only checks.
// Allowed with no question: CI itself, no git repository, a detached HEAD (a throwaway clone on a release tag, where a
// proof reproduces a bug with an unchanged test). It is a cost guard, not a security gate: anything unexpected lets the
// call through, and says why in <git common dir>/kit-guard-open.log (one line, the cause, never the command).
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const git = (cwd, ...a) => spawnSync('git', ['-C', cwd, ...a], { encoding: 'utf8', timeout: 3000 });
const posix = (p) => String(p).split(path.sep).join('/');
const TEST_FILE = /(^|\/)(tests?|__tests__|spec)\/|\.(test|spec)\.[cm]?[jt]sx?$|(^|\/)test_[^/]*\.py$|_test\.(py|go)$/i;
// Options whose value is the next word, so it is never read as a file.
const VALUED = /^(--test-name-pattern|--test-skip-pattern|--test-reporter|--test-reporter-destination|--test-concurrency|--test-timeout|--import|--require|-r|--shards|--slice|--always|-k|-m|-p|--config|-c|--project|--testNamePattern|-t|--reporter|--rootdir)$/;

/** The simple commands of a line, split at ; && || | and new lines outside quotes, each as plain words. */
function commands(text) {
	const out = [[]];
	let word = '';
	let q = null;
	const end = () => { if (word) out[out.length - 1].push(word); word = ''; };
	for (let i = 0; i < text.length; i++) {
		const ch = text[i];
		if (q) { if (ch === q) q = null; else word += ch; continue; }
		if (ch === '"' || ch === "'") { q = ch; continue; }
		if (ch === ' ' || ch === '\t') { end(); continue; }
		if (';&|\n'.includes(ch)) { end(); if (out[out.length - 1].length) out.push([]); continue; }
		word += ch;
	}
	end();
	return out.filter((c) => c.length);
}

/**
 * What one simple command runs, as a test run: null when it is not one; else { what, files } where files is the list
 * of test paths it names (empty: the whole suite), or { what, never } for a run that is always asked.
 */
function testRun(words) {
	let w = words.slice();
	while (w.length && /^[A-Za-z_]\w*=/.test(w[0])) w.shift();
	while (w.length && /^(env|npx|exec|time|nice|command)$/.test(w[0])) w.shift();
	if (!w.length) return null;
	const prog = path.basename(posix(w[0])).replace(/\.(exe|cmd)$/i, '').toLowerCase();
	const args = w.slice(1);
	const files = (list) => list.filter((a, k) => !a.startsWith('-') && !(k > 0 && VALUED.test(list[k - 1])) && !a.includes('='));
	if (prog === 'node') {
		const script = args.find((a) => !a.startsWith('-'));
		if (args.includes('--test')) return { what: 'node --test', files: files(args.filter((a) => a !== '--test')) };
		if (!script) return null;
		const base = path.basename(posix(script));
		if (/^(test-check|mutation-check|ci-install-check)\.mjs$/.test(base)) return { what: `${base} (a CI-only check)`, never: true };
		if (base === 'test-run.mjs') {
			const rest = args.slice(args.indexOf(script) + 1);
			if (rest.includes('--changed') && !rest.includes('--pick')) return { what: 'test-run.mjs --changed (it widens to every test the change reaches)', never: true };
			if (rest.includes('--pick') || rest.includes('--map')) return null;
			return { what: 'test-run.mjs', files: files(rest) };
		}
		return null;
	}
	if (/^(npm|pnpm|yarn|bun)$/.test(prog)) {
		const sub = args[0] === 'run' ? args[1] : args[0];
		if (!/^(test|t|tst)(:|$)/.test(sub || '') && !/^(jest|vitest|mocha)$/.test(sub || '')) return null;
		const dash = args.indexOf('--');
		return { what: `${prog} ${sub}`, files: dash < 0 ? files(args.slice(/^(jest|vitest|mocha)$/.test(sub) ? 1 : 2)) : files(args.slice(dash + 1)) };
	}
	if (/^(jest|vitest|mocha|pytest)$/.test(prog)) return { what: prog, files: files(args.filter((a) => a !== 'run')).map((f) => f.split('::')[0]) };
	if (/^python[0-9.]*$|^py$/.test(prog) && args[0] === '-m' && /^(pytest|unittest)$/.test(args[1] || '')) return { what: `python -m ${args[1]}`, files: files(args.slice(2)).map((f) => f.split('::')[0]) };
	if (prog === 'go' && args[0] === 'test') return { what: 'go test', files: files(args.slice(1)).filter((f) => !f.endsWith('...')).map((f) => `${f.replace(/\/$/, '')}/`) };
	if (/^(cargo|dotnet)$/.test(prog) && args[0] === 'test') return args.length > 1 ? null : { what: `${prog} test`, files: [] };
	return null;
}

function logOpen(cwd, cause) {
	try {
		const common = git(cwd, 'rev-parse', '--path-format=absolute', '--git-common-dir');
		if (common.status === 0) fs.appendFileSync(path.join(common.stdout.trim(), 'kit-guard-open.log'), `${JSON.stringify({ at: new Date().toISOString(), hook: 'test-scope', cause })}\n`);
	} catch { /* nothing more to do */ }
}

/** The test files the branch changed, repo-relative: the diff from the default branch's merge base, plus new files. */
function changeSet(cwd) {
	if (git(cwd, 'symbolic-ref', '-q', 'HEAD').status !== 0) return null;
	let base = git(cwd, 'symbolic-ref', '-q', '--short', 'refs/remotes/origin/HEAD').stdout.trim();
	if (!base) base = ['main', 'master', 'origin/main', 'origin/master'].find((b) => git(cwd, 'rev-parse', '-q', '--verify', b).status === 0) || '';
	const mb = base ? git(cwd, 'merge-base', 'HEAD', base).stdout.trim() : '';
	const diff = mb ? git(cwd, 'diff', '--name-only', mb) : git(cwd, 'diff', '--name-only', 'HEAD');
	const fresh = git(cwd, 'ls-files', '--others', '--exclude-standard');
	if (diff.status !== 0 || fresh.status !== 0) throw new Error('git diff failed');
	return new Set(`${diff.stdout}\n${fresh.stdout}`.split('\n').map((x) => x.trim()).filter(Boolean));
}

function check(input) {
	if (process.env.CI) return null;
	const command = input && input.tool_input && input.tool_input.command;
	if (typeof command !== 'string') return null;
	const runs = commands(command).map(testRun).filter(Boolean);
	if (!runs.length) return null;
	const cwd = String(input.cwd || process.cwd());
	try {
		const top = git(cwd, 'rev-parse', '--show-toplevel');
		if (top.status !== 0) return null;
		const root = top.stdout.trim();
		const changed = changeSet(cwd);
		if (!changed) return null;
		const rel = (f) => posix(path.relative(root, path.resolve(cwd, f)));
		for (const r of runs) {
			let what = null;
			if (r.never) what = r.what;
			else if (!r.files.length) what = `${r.what} with no test file runs the whole suite`;
			else {
				const out = r.files.map(rel).filter((f) => (f.endsWith('/') ? ![...changed].some((c) => c.startsWith(f) && TEST_FILE.test(c)) : !changed.has(f)));
				if (out.length) what = `${r.what} reaches ${out.slice(0, 3).join(', ')}, which this branch did not change`;
			}
			if (what) {
				const mine = [...changed].filter((f) => TEST_FILE.test(f)).slice(0, 3);
				const hint = mine.length ? ` Run only the tests you changed (${mine.join(', ')}); CI runs the rest after you push.` : ' CI runs the suite after you push.';
				return { kitWhat: `a local test run past the changed tests: ${what}`, hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: `Owner's yes needed: a local test run past the changed tests (${what}).${hint}` } };
			}
		}
		return null;
	} catch (e) {
		logOpen(cwd, String(e && e.message).slice(0, 120));
		return null;
	}
}

module.exports = { check, commands, testRun };
