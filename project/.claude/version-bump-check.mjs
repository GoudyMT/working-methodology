import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// A PR that changes shipped code must bump the version (the release after the merge needs it) or say in its body
// "No user-facing change". Without the bump, no release can be cut for the change. Both PR-body audits run it.
//
// Which files ship and where the version lives are per project, in .kit/version-bump.json:
//   { "shipped": ["src/", "static/"], "exclude": [".test.", "src/lib/ci/"], "versionFile": "package.json" }
// With no such file, a project with a package.json ships src/, tests excluded. Outside git, or with no version
// file, there is nothing to check. PR_BASE names the base; else origin/main, main, origin/master or master.
const DEFAULTS = { shipped: ['src/'], exclude: ['.test.', '.spec.'], versionFile: 'package.json' };

/**
 * Whether a PR body may go out for the branch's change, as one audit row.
 *
 * Args:
 *     body: the PR body
 *     cwd: a folder inside the repo
 *
 * Returns:
 *     { ok, detail }
 */
// A program the repo's own git config names (core.fsmonitor, an external diff, a textconv) never runs here: the guard
// runs these audits inside a hook (the K61 sweep).
// Nothing is fetched either: a partial clone fetches a missing object through a transport the config names.
const GIT_SAFE = ['-c', 'core.fsmonitor=false', '-c', 'diff.external=', '-c', 'protocol.allow=never',
	...['ext', 'file', 'ssh', 'git', 'http', 'https'].flatMap((p) => ['-c', `protocol.${p}.allow=never`])];
const GIT_ENV = { ...process.env, GIT_NO_LAZY_FETCH: '1' };

// K184: the small (Lean) body is for a chore, docs, config, a bump or a one-line change. What the diff touches may only
// raise a body to the full (Standard) one: an added source file, a CI, git hook or .claude file (gate code, as the
// sweep's floor reads it), or more than SMALL_LINES changed lines of code. Docs, records, tests and dependency files
// are not the change the format follows.
const SMALL_LINES = 20;
// Only a test folder at the repo root is test code whole; deeper, a file is a test by its name (a src/test/ folder of
// server code is source). A .txt is a build or data file unless a dependency list below names it.
const NOT_CODE = /\.(md|rst)$|^docs\/.*\.(json|png|svg|jpe?g|gif|csv)$|^(VERSION|CHANGELOG\.md)$|^(tests?|__tests__)\/|\.(test|spec)\.[a-z]+$|(^|\/)(package(-lock)?\.json|pnpm-lock\.yaml|yarn\.lock|requirements[^/]*\.txt|poetry\.lock|Cargo\.lock|go\.sum|Gemfile\.lock)$/i;
const GATE = /(^|\/)\.(github|githooks|claude)\//;

/** Whether the branch's diff is a small change a Lean body may describe, as one audit row. */
export function leanFitCheck(cwd = process.cwd()) {
	const git = (...a) => spawnSync('git', ['-C', cwd, ...GIT_SAFE, ...a], { encoding: 'utf8', env: GIT_ENV });
	if (git('rev-parse', '--show-toplevel').status !== 0) return { ok: true, detail: 'not a git repository' };
	// A branch with no commit yet has no diff to raise the body (and no PR to open).
	if (git('rev-parse', '-q', '--verify', 'HEAD^{commit}').status !== 0) return { ok: true, detail: 'no commit yet' };
	const base = [process.env.PR_BASE, 'origin/main', 'main', 'origin/master', 'master'].filter(Boolean)
		.find((b) => git('rev-parse', '-q', '--verify', `${b}^{commit}`).status === 0);
	if (!base) return { ok: false, detail: 'no base branch found: set PR_BASE' };
	const range = `${base}...HEAD`;
	// -z: git prints a path with a non-ASCII byte C-quoted, which no path pattern below would match. A diff git cannot
	// make (no merge base: a shallow clone, an orphan branch, an unrelated base) has no lines to count, so it fails.
	const numstat = git('diff', '--no-ext-diff', '--no-textconv', '--no-renames', '--numstat', '-z', range);
	const names = git('diff', '--no-ext-diff', '--no-renames', '--name-only', '-z', '--diff-filter=A', range);
	if (numstat.status !== 0 || names.status !== 0) return { ok: false, detail: `git could not diff ${range} (no merge base?): set PR_BASE to a base this branch shares history with` };
	const rows = numstat.stdout.split('\0').filter(Boolean).map((r) => { const [a, d, ...p] = r.split('\t'); return [a, d, p.join('\t')]; });
	const added = names.stdout.split('\0').filter(Boolean);
	const gate = rows.map((r) => r[2]).find((p) => GATE.test(p));
	if (gate) return { ok: false, detail: `${gate} is CI, hook or guard code: write the Standard body` };
	const source = added.find((p) => !NOT_CODE.test(p));
	if (source) return { ok: false, detail: `added source file ${source}: write the Standard body` };
	// A binary has no line count (git prints "-"), and a changed one is not a small change.
	const binary = rows.find((r) => r[0] === '-' && !NOT_CODE.test(r[2]));
	if (binary) return { ok: false, detail: `changed binary file ${binary[2]}: write the Standard body` };
	const lines =rows.filter((r) => !NOT_CODE.test(r[2])).reduce((n, r) => n + (Number(r[0]) || 0) + (Number(r[1]) || 0), 0);
	if (lines > SMALL_LINES) return { ok: false, detail: `${lines} changed lines of code, over ${SMALL_LINES}: write the Standard body` };
	return { ok: true, detail: `${lines} changed lines of code, no added source or gate file` };
}

export function versionBumpCheck(body, cwd = process.cwd()) {
	const git = (...a) => spawnSync('git', ['-C', cwd, ...GIT_SAFE, ...a], { encoding: 'utf8', env: GIT_ENV });
	const top = git('rev-parse', '--show-toplevel');
	if (top.status !== 0) return { ok: true, detail: 'not a git repository' };
	const root = top.stdout.trim();
	let cfg = DEFAULTS;
	// The build 17 sweep: judging a PR (PR_BASE set), the settings are the base's, so a PR cannot loosen its own check.
	const shown = process.env.PR_BASE ? git('show', `${process.env.PR_BASE}:.kit/version-bump.json`) : null;
	try { cfg = { ...DEFAULTS, ...JSON.parse(shown ? (shown.status === 0 ? shown.stdout : '{}') : fs.readFileSync(path.join(root, '.kit', 'version-bump.json'), 'utf8')) }; } catch { /* the defaults */ }
	if (!fs.existsSync(path.join(root, cfg.versionFile))) return { ok: true, detail: `no ${cfg.versionFile}` };
	const base = [process.env.PR_BASE, 'origin/main', 'main', 'origin/master', 'master'].filter(Boolean)
		.find((b) => git('rev-parse', '-q', '--verify', `${b}^{commit}`).status === 0);
	if (!base) return { ok: false, detail: 'no base branch found: set PR_BASE' };
	const range = `${base}...HEAD`;
	const shipped = git('diff', '--no-ext-diff', '--no-textconv', '--name-only', range).stdout.split('\n').filter(Boolean)
		.filter((p) => cfg.shipped.some((s) => p.startsWith(s)) && !cfg.exclude.some((x) => p.includes(x)));
	if (!shipped.length) return { ok: true, detail: 'no shipped file changed' };
	const bumped = git('diff', '--no-ext-diff', '--no-textconv', range, '--', cfg.versionFile).stdout.split('\n').some((l) => l.startsWith('+') && /"version"\s*:/.test(l));
	if (bumped) return { ok: true, detail: `${shipped.length} shipped file(s); version bumped` };
	const saysNone = /no user-facing change/i.test(body);
	return {
		ok: saysNone,
		detail: saysNone
			? `${shipped.length} shipped file(s); the body says no user-facing change`
			: `${shipped.length} shipped file(s) (${shipped[0]}...) and no version bump: bump ${cfg.versionFile} or say "No user-facing change"`,
	};
}
