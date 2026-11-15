// K61 (the owner, 2026-11-15): the steps that turn on merge on green, as one list install prints and later install
// work (T5) can apply. Each step is the owner's own act: Claude never writes the allow rules or the grant, and the
// repo settings are outward acts. Every line here was proven live first (a throwaway repo and headless sessions,
// 2026-11-15): a wrong allow rule either does nothing or allows too much.
//
// For each step: what to do, the exact lines to paste or run, and whether it is done ('done', 'to do', or
// 'not checked' when GitHub gave no answer or the repo is not on GitHub yet).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { grantsMerge } from '../user/kit-tools/merge-gate.mjs';

const ACTS = ['arm', 'disarm', 'autofix'];
export const GRANT_VALUE = 'merge through the merge gate; auto-fix push';
const posix = (p) => String(p).split(path.sep).join('/');

/**
 * The allow rules for the merge gate, in the spelling each shell tool runs it. The Bash tool runs it as
 * `node ~/.claude/kit-tools/merge-gate.mjs <act> <n>`; a rule in another spelling never matches that. The PowerShell
 * tool never auto-runs a command with $HOME in it, so its rules carry the full path, with forward slashes.
 *
 * Args:
 *     home: the Claude config folder
 *     userHome: the user's home folder (os.homedir() by default)
 *
 * Returns:
 *     { bash: [3 rules], powershell: [3 rules] }
 */
export function allowLines(home, userHome = os.homedir()) {
	const full = posix(path.resolve(home));
	const tilde = path.resolve(home).toLowerCase() === path.resolve(userHome, '.claude').toLowerCase() ? '~/.claude' : full;
	return {
		bash: ACTS.map((a) => `Bash(node ${tilde}/kit-tools/merge-gate.mjs ${a} *)`),
		powershell: ACTS.map((a) => `PowerShell(node ${full}/kit-tools/merge-gate.mjs ${a} *)`),
	};
}

// The GitHub owner/repo of origin, or null when origin is not a GitHub repo.
function githubRepo(projectDir) {
	const r = spawnSync('git', ['-C', projectDir, 'remote', 'get-url', 'origin'], { encoding: 'utf8', timeout: 5000 });
	const m = r.status === 0 && /github\.com[:/]([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(\.git)?\/?$/.exec(r.stdout.trim());
	return m ? `${m[1]}/${m[2]}` : null;
}

// Row A26's check name, the first item of its value, or null while it is still the template's.
function checkName(projectDir) {
	let text = '';
	try { text = fs.readFileSync(path.join(projectDir, 'standards', 'project-adapter.md'), 'utf8'); } catch { return null; }
	const row = text.split('\n').find((l) => /^\|\s*A26\s*\|/.test(l));
	const value = row ? row.split('|').slice(1, -1).pop().trim().replace(/`/g, '') : '';
	const name = value.split(';')[0].trim();
	return name && !/^<.*>$/.test(name) ? name : null;
}

/**
 * Each step of merge on green and whether it is done. With no project folder, only the allow step (install user).
 *
 * Args:
 *     home: the Claude config folder
 *     projectDir: the project folder, or undefined for the user layer
 *     userHome: the user's home folder
 *     gh: runs gh with an argument list in the project folder (injected by tests)
 *     protection: main's protection, 'protected' | 'unprotected' | null (kit.mjs mainProtection)
 *
 * Returns:
 *     { steps: [{ id, title, state, lines }] }
 */
export function mergeOnGreen({ home, projectDir, userHome = os.homedir(), gh, protection }) {
	const steps = [];
	const allow = allowLines(home, userHome);
	const wanted = [...allow.bash, ...allow.powershell];
	let have = null;
	try {
		const s = JSON.parse(fs.readFileSync(path.join(home, 'settings.json'), 'utf8'));
		have = Array.isArray(s && s.permissions && s.permissions.allow) ? s.permissions.allow : [];
	} catch { have = []; }
	steps.push({
		id: 'allow',
		title: `Let Claude run the merge gate's arm, disarm and autofix without asking, once per PC: add these six lines to "permissions": { "allow": [ ... ] } in ${posix(path.join(home, 'settings.json'))}. Claude never writes them.`,
		state: wanted.every((l) => have.includes(l)) ? 'done' : 'to do',
		lines: wanted.map((l, i) => `"${l}"${i < wanted.length - 1 ? ',' : ''}`),
	});
	const gate = allow.bash[0].replace(/^Bash\((.*) arm \*\)$/, '$1');
	if (!projectDir) return { steps, gate };

	const show = spawnSync('git', ['-C', projectDir, 'show', 'refs/remotes/origin/main:standards/project-adapter.md'], { encoding: 'utf8', timeout: 5000 });
	steps.push({
		id: 'grant',
		title: 'Grant merge on green in this project, once. The merge gate reads this grant only from main, and the file is a grant path, so you merge its PR yourself.',
		state: show.status === 0 && grantsMerge(show.stdout).granted ? 'done' : 'to do',
		lines: [
			`In standards/project-adapter.md, set row A27's value to: ${GRANT_VALUE}`,
			'In .kit/tracking.json, add "standards/project-adapter.md" to "track" (the kit\'s files stay out of git otherwise).',
			'git add -f standards/project-adapter.md, commit it on a branch and open its PR; you merge it.',
		],
	});

	const repo = githubRepo(projectDir);
	const slug = repo || '<owner>/<repo>';
	let repoState = 'not checked';
	if (repo && gh) {
		const r = gh(['api', 'repos/{owner}/{repo}']);
		let j = null;
		try { j = r && r.status === 0 ? JSON.parse(r.stdout) : null; } catch { j = null; }
		if (j && typeof j.allow_auto_merge === 'boolean' && typeof j.delete_branch_on_merge === 'boolean') {
			repoState = j.allow_auto_merge && j.delete_branch_on_merge ? 'done' : 'to do';
		}
	}
	steps.push({
		id: 'repo',
		title: 'Let GitHub merge a PR once its checks pass, and delete its branch after, once per repo:',
		state: repoState,
		lines: [`gh api -X PATCH repos/${slug} -F allow_auto_merge=true -F delete_branch_on_merge=true`],
	});

	const prot = repo && protection ? protection(projectDir) : null;
	const name = checkName(projectDir);
	steps.push({
		id: 'protect',
		title: 'Protect main with one required check that must be up to date, no force push and no delete, once per repo:',
		state: prot === 'protected' ? 'done' : prot === 'unprotected' ? 'to do' : 'not checked',
		lines: [
			`Copy .claude/kit/branch-protection.json to .kit/branch-protection.json and put ${name ? `"${name}"` : 'your CI check\'s name (row A26)'} in "contexts".`,
			`gh api -X PUT repos/${slug}/branches/main/protection --input .kit/branch-protection.json`,
		],
	});
	return { steps, gate };
}

/**
 * The merge-on-green block install prints: a count, then each step with its lines unless it is done.
 */
export function renderMergeOnGreen({ steps, gate = 'node ~/.claude/kit-tools/merge-gate.mjs' }) {
	const done = steps.filter((s) => s.state === 'done').length;
	const out = [`Merge on green: ${done} of ${steps.length} step${steps.length === 1 ? '' : 's'} done (rule:standing-grants). Each step is yours to take.`];
	steps.forEach((s, i) => {
		out.push(`    [${s.state}] ${i + 1}. ${s.title}`);
		if (s.state !== 'done') for (const l of s.lines) out.push(`        ${l}`);
	});
	out.push(steps.length === 1
		? '    The project steps print at install project.'
		: `    Then, on a PR whose gates passed: ${gate} check <PR> says GO.`);
	return out;
}
