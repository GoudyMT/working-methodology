// The test-scope check (K150, build 20; the owner's starred rule "locally run only the changed test, red then green,
// CI does the rest"). A prose rule slipped: build 19 reran about 170 unchanged tests after each fix. So a local test
// run is read here, on every Bash and PowerShell call, and allowed only when every test file it names is one the
// branch changed. The rest needs the owner's pop-up yes, which the one guard process reads (guard.cjs):
//   a run with no file (the whole suite), test-run.mjs --changed without --pick (it widens to every test the change
//   reaches), a test file the branch did not change, and the kit's CI-only checks.
// Allowed with no question: CI itself, no git repository, a detached HEAD exactly on a tag (a throwaway clone of a
// release, where a proof reproduces a bug with an unchanged test), and a repo with no remote-tracking ref, on its own
// base branch (nothing to compare with; logged). A folder argument is every test file under it, all of them changed. It is a cost guard, not a security gate: anything unexpected lets the
// call through, and says why in <git common dir>/kit-guard-open.log (one line, the cause, never the command).
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

// The build 20 sweep: the repo's own config may name a program git runs (fsmonitor), so git runs with that off and from
// a folder of its own, as guard-outward.cjs runs it.
const git = (cwd, ...a) => spawnSync('git', ['-C', cwd, '-c', 'core.fsmonitor=false', ...a], { encoding: 'utf8', timeout: 3000, cwd: path.dirname(process.execPath) });
const posix = (p) => String(p).split(path.sep).join('/');
const TEST_FILE = /(^|\/)(tests?|__tests__|spec)\/|\.(test|spec)\.[cm]?[jt]sx?$|(^|\/)test_[^/]*\.py$|_test\.(py|go)$/i;
// What a folder run counts: a file under a test folder named as a test (*.test.*, *.spec.*, or a .js/.mjs/.cjs/.ts file),
// a test named anywhere, and node's default names (*-test, *_test, test-*, test), which a hint never offers. A JSON
// fixture under tests/ is no test, so the folder alternative never reads every file there.
const FOLDER_TEST = new RegExp(`(^|/)(tests?|__tests__|spec)/.*(\\.(test|spec)\\.[^/]*|\\.[cm]?[jt]sx?)$|\\.(test|spec)\\.[cm]?[jt]sx?$|(^|/)test_[^/]*\\.py$|_test\\.(py|go)$|([-_]test|(^|/)test|(^|/)test-[^/]*)\\.[cm]?[jt]s$`, 'i');
// Options whose value is the next word, so it is never read as a file.
const VALUED = /^(--test-name-pattern|--test-skip-pattern|--test-reporter|--test-reporter-destination|--test-concurrency|--test-timeout|--import|--require|-r|--shards|--slice|--always|-k|-m|-p|--config|-c|--project|--testNamePattern|-t|--reporter|--rootdir|-n|--tb|--maxfail|--cov|--cov-report|--maxWorkers|-w|-run|-count|-timeout|--durations|--deselect|--ignore|--grep|-g|--timeout|--env|--environment|--testTimeout|--test-coverage-include|--test-coverage-exclude|--watch-path)$/;
// Options of a package manager or npx whose value is the next word (a folder, a package).
const PM_VALUED = /^(--prefix|-C|--dir|--cwd|--filter|-F|--workspace|-w|--package|-p)$/;

/** The simple commands of a line, split at ; && || | ( ) and new lines outside quotes, each as plain words. */
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
		if (';&|\n()'.includes(ch)) { end(); if (out[out.length - 1].length) out.push([]); continue; }
		word += ch;
	}
	end();
	// Text run as shell (bash -c "npm test") is read as commands of its own.
	return out.filter((c) => c.length).flatMap((c) => {
		const k = c.findIndex((w, j) => /^(-\w*c)$/.test(w) && j > 0 && /(^|\/)(ba|z|da|k)?sh(\.exe)?$/.test(c[0]));
		return k > 0 && c[k + 1] ? [c.slice(0, k), ...commands(c[k + 1])] : [c];
	});
}

/**
 * What one simple command runs, as a test run: null when it is not one; else { what, files } where files is the list
 * of test paths it names (empty: the whole suite), or { what, never } for a run that is always asked.
 */
function testRun(words) {
	let w = words.slice();
	while (w.length && /^[A-Za-z_]\w*=/.test(w[0])) w.shift();
	// A runner's prefix and its options (npx --yes, npx -p x); the build 20 sweep found these spellings passed.
	for (;;) {
		if (!w.length) return null;
		const p0 = path.basename(posix(w[0])).replace(/\.(exe|cmd)$/i, '').toLowerCase();
		if (!/^(env|npx|pnpx|bunx|exec|time|nice|command)$/.test(p0)) break;
		w.shift();
		while (w.length && (w[0].startsWith('-') || /^[A-Za-z_]\w*=/.test(w[0]))) w.splice(0, PM_VALUED.test(w[0]) ? 2 : 1);
	}
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
			// --pick only prints with --changed; alone it runs the whole suite (the build 20 sweep).
			if ((rest.includes('--pick') && rest.includes('--changed')) || rest.includes('--map')) return null;
			if (rest.includes('--pick')) return { what: 'test-run.mjs --pick without --changed runs the whole suite', never: true };
			return { what: 'test-run.mjs', files: files(rest) };
		}
		return null;
	}
	if (/^(npm|pnpm|yarn|bun)$/.test(prog)) {
		// The words that are not options (npm --prefix x -s run-script test): the first is the subcommand.
		const plain = [];
		for (let k = 0; k < args.length; k++) {
			if (args[k] === '--') { plain.push(...args.slice(k)); break; }
			if (args[k].startsWith('-')) { if (PM_VALUED.test(args[k])) k++; continue; }
			plain.push(args[k]);
		}
		const at = /^(run|run-script|exec|x)$/.test(plain[0] || '') ? 1 : 0;
		const sub = plain[at];
		if (!/^(test|t|tst)(:|$)/.test(sub || '') && !/^(jest|vitest|mocha)$/.test(sub || '')) return null;
		const dash = args.indexOf('--');
		return { what: `${prog} ${sub}`, files: files(dash < 0 ? plain.slice(at + 1) : args.slice(dash + 1)) };
	}
	if (/^(jest|vitest|mocha|pytest)$/.test(prog)) return { what: prog, files: files(args.filter((a) => a !== 'run')).map((f) => f.split('::')[0]) };
	if (/^python[0-9.]*$|^py$/.test(prog) && args[0] === '-m' && /^(pytest|unittest)$/.test(args[1] || '')) return { what: `python -m ${args[1]}`, files: files(args.slice(2)).map((f) => f.split('::')[0]) };
	// A go package is a folder: it is marked dir so the check reads it as one (a path resolve drops a trailing slash).
	if (prog === 'go' && args[0] === 'test') return { what: 'go test', files: files(args.slice(1)).filter((f) => !f.endsWith('...')).map((f) => `dir:${f.replace(/\/$/, '')}`) };
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
	// A detached HEAD passes only on a release tag (a throwaway clone of a release, the build 20 sweep): a detached
	// feature commit is read like a branch.
	if (git(cwd, 'symbolic-ref', '-q', 'HEAD').status !== 0 && git(cwd, 'describe', '--exact-match', '--tags', 'HEAD').status === 0) return null;
	let base = git(cwd, 'symbolic-ref', '-q', '--short', 'refs/remotes/origin/HEAD').stdout.trim();
	if (!base) base = ['origin/main', 'origin/master', 'main', 'master'].find((b) => git(cwd, 'rev-parse', '-q', '--verify', b).status === 0) || '';
	// A local base that is the branch itself (no remote, on main) leaves nothing to compare with: let the call through.
	if (base && !base.includes('/') && git(cwd, 'symbolic-ref', '-q', '--short', 'HEAD').stdout.trim() === base && !git(cwd, 'for-each-ref', 'refs/remotes').stdout.trim()) {
		logOpen(cwd, `no base to compare with: ${base} is the branch HEAD is on`);
		return null;
	}
	const mb = base ? git(cwd, 'merge-base', 'HEAD', base).stdout.trim() : '';
	const diff = mb ? git(cwd, 'diff', '--name-only', mb) : git(cwd, 'diff', '--name-only', 'HEAD');
	// Repo-relative, as the diff is, whatever folder the run starts in.
	const fresh = git(cwd, 'ls-files', '--full-name', '--others', '--exclude-standard', ':/');
	if (diff.status !== 0 || fresh.status !== 0) throw new Error('git diff failed');
	return new Set(`${diff.stdout}\n${fresh.stdout}`.split('\n').map((x) => x.trim()).filter(Boolean));
}

function check(input) {
	if (process.env.CI) return null;
	const command = input && input.tool_input && input.tool_input.command;
	if (typeof command !== 'string') return null;
	const cwd = String(input.cwd || process.cwd());
	// Each run with the folder a plain cd before it in the same line moved to, so its files are read from there.
	let here = cwd;
	const runs = [];
	for (const words of commands(command)) {
		if (/^(cd|pushd|Set-Location|sl)$/i.test(words[0]) && words[1] && !/[$`~]/.test(words[1])) { here = path.resolve(here, words[1]); continue; }
		const r = testRun(words);
		if (r) runs.push({ ...r, from: here });
	}
	if (!runs.length) return null;
	try {
		const top = git(cwd, 'rev-parse', '--show-toplevel');
		if (top.status !== 0) return null;
		const root = top.stdout.trim();
		const changed = changeSet(cwd);
		if (!changed) return null;
		const rel = (from, f) => posix(path.relative(root, path.resolve(from, f)));
		// A changed test that imports a test file the branch did not change runs that one too (the build 20 sweep).
		const reaches = (f) => {
			let text = '';
			try { text = fs.readFileSync(path.join(root, f), 'utf8'); } catch { return []; }
			const out = [];
			for (const m of text.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g)) {
				const t = posix(path.relative(root, path.resolve(path.dirname(path.join(root, f)), m[1])));
				if (TEST_FILE.test(t) && /\.(test|spec)\./.test(t)) out.push(t);
			}
			return out;
		};
		for (const r of runs) {
			let what = null;
			if (r.never) what = r.what;
			else if (!r.files.length) what = `${r.what} with no test file runs the whole suite`;
			else {
				// A word that is a folder on disk stands for every test file under it, tracked or not.
				const isDir = (f) => { try { return fs.statSync(path.resolve(r.from, f)).isDirectory(); } catch { return false; } };
				const folderOut = (f) => {
					// A folder outside the repo cannot be listed, and one holding the repo runs its sibling folders too: refuse every one.
					const at = rel(r.from, f);
					if (/^\.\.(\/|$)/.test(at) || path.isAbsolute(at)) return [`${posix(path.resolve(r.from, f)).replace(/\/$/, '')}/ (outside the repo)`];
					const ls = git(root, 'ls-files', '--cached', '--others', '--exclude-standard', '--', at || '.');
					if (ls.status !== 0) throw new Error('git ls-files failed');
					const tests = ls.stdout.split('\n').map((x) => x.trim()).filter((x) => x && FOLDER_TEST.test(x));
					const unchanged = tests.filter((x) => !changed.has(x));
					return tests.length ? unchanged : [`${rel(r.from, f)}/`];
				};
				const plain = r.files.map((f) => (f.startsWith('dir:') ? f.slice(4) : f));
				const named = plain.filter((f) => !isDir(f)).map((f) => rel(r.from, f));
				const all = [...named, ...named.flatMap(reaches)];
				const out = [...all.filter((f) => !changed.has(f)), ...plain.filter(isDir).flatMap(folderOut)];
				if (out.length) what = `${r.what} reaches ${out.slice(0, 3).join(', ')}, which this branch did not change`;
			}
			if (what) {
				const mine = [...changed].filter((f) => TEST_FILE.test(f)).slice(0, 3);
				const hint = mine.length ? ` Run only the tests you changed (${mine.join(', ')}); CI runs the rest after you push` : ' CI runs the suite after you push';
				return { kitWhat: `a local test run past the changed tests: ${what}.${hint}`, hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: `Owner's yes needed: a local test run past the changed tests (${what}).${hint}.` } };
			}
		}
		return null;
	} catch (e) {
		logOpen(cwd, String(e && e.message).slice(0, 120));
		return null;
	}
}

module.exports = { check, commands, testRun };
