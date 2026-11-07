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
export function versionBumpCheck(body, cwd = process.cwd()) {
	const git = (...a) => spawnSync('git', ['-C', cwd, ...a], { encoding: 'utf8' });
	const top = git('rev-parse', '--show-toplevel');
	if (top.status !== 0) return { ok: true, detail: 'not a git repository' };
	const root = top.stdout.trim();
	let cfg = DEFAULTS;
	try { cfg = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(path.join(root, '.kit', 'version-bump.json'), 'utf8')) }; } catch { /* the defaults */ }
	if (!fs.existsSync(path.join(root, cfg.versionFile))) return { ok: true, detail: `no ${cfg.versionFile}` };
	const base = [process.env.PR_BASE, 'origin/main', 'main', 'origin/master', 'master'].filter(Boolean)
		.find((b) => git('rev-parse', '-q', '--verify', `${b}^{commit}`).status === 0);
	if (!base) return { ok: false, detail: 'no base branch found: set PR_BASE' };
	const range = `${base}...HEAD`;
	const shipped = git('diff', '--name-only', range).stdout.split('\n').filter(Boolean)
		.filter((p) => cfg.shipped.some((s) => p.startsWith(s)) && !cfg.exclude.some((x) => p.includes(x)));
	if (!shipped.length) return { ok: true, detail: 'no shipped file changed' };
	const bumped = git('diff', range, '--', cfg.versionFile).stdout.split('\n').some((l) => l.startsWith('+') && /"version"\s*:/.test(l));
	if (bumped) return { ok: true, detail: `${shipped.length} shipped file(s); version bumped` };
	const saysNone = /no user-facing change/i.test(body);
	return {
		ok: saysNone,
		detail: saysNone
			? `${shipped.length} shipped file(s); the body says no user-facing change`
			: `${shipped.length} shipped file(s) (${shipped[0]}...) and no version bump: bump ${cfg.versionFile} or say "No user-facing change"`,
	};
}
