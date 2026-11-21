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
import { safeGit, githubSlug } from './safe-git.mjs';
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
// K206: one spelling for a Claude folder, shared by the allow rules and the session-start line, so the two never drift:
// ~/.claude for the default folder (bash expands it), the full forward-slash path otherwise and for PowerShell.
export function homeSpelling(home, userHome = os.homedir()) {
	const full = posix(path.resolve(home));
	return { full, tilde: path.resolve(home).toLowerCase() === path.resolve(userHome, '.claude').toLowerCase() ? '~/.claude' : full };
}

export function allowLines(home, userHome = os.homedir()) {
	const { full, tilde } = homeSpelling(home, userHome);
	return {
		bash: ACTS.map((a) => `Bash(node ${tilde}/kit-tools/merge-gate.mjs ${a} *)`),
		powershell: ACTS.map((a) => `PowerShell(node ${full}/kit-tools/merge-gate.mjs ${a} *)`),
	};
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
 *     gh: runs gh with an argument list, from outside the project folder (safe-git.mjs safeGh; tests inject one)
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
		title: `Let Claude run the merge gate's arm, disarm and autofix without asking, once per PC: in ${posix(path.join(home, 'settings.json'))}, add these six lines to the "allow" list (paste the whole block if the file has none). Claude never writes them.`,
		state: wanted.every((l) => have.includes(l)) ? 'done' : 'to do',
		lines: ['"permissions": {', '  "allow": [', ...wanted.map((l, i) => `    "${l}"${i < wanted.length - 1 ? ',' : ''}`), '  ]', '}'],
	});
	const gate = allow.bash[0].replace(/^Bash\((.*) arm \*\)$/, '$1');
	const psGate = allow.powershell[0].replace(/^PowerShell\((.*) arm \*\)$/, '$1');
	if (!projectDir) return { steps, gate, psGate };

	const show = safeGit(projectDir, 'show', 'refs/remotes/origin/main:standards/project-adapter.md');
	const branch = 'docs/grant-merge-on-green';
	const subject = 'docs: grant merge on green through the merge gate';
	steps.push({
		id: 'grant',
		title: 'Grant merge on green in this project, once. Needs: the repo on GitHub with main pushed. The merge gate reads the grant only from main, and the file is a grant path, so you merge its PR yourself.',
		state: show.status === 0 && grantsMerge(show.stdout).granted ? 'done' : 'to do',
		lines: [
			`In standards/project-adapter.md, set the value of the grant row (A27) to: ${GRANT_VALUE}`,
			'In .kit/tracking.json, add "standards/project-adapter.md" to its "track" list, or create the file as:',
			'    { "track": ["standards/project-adapter.md"] }',
			'Then, from the project folder (the same in PowerShell and Bash):',
			`    git switch -c ${branch}`,
			'    git add -f standards/project-adapter.md .kit/tracking.json',
			`    git commit -m "${subject}"`,
			`    git push -u origin ${branch}`,
			'Ask Claude to open its PR (its body is audited), and merge it yourself. After you merge: git fetch origin',
		],
	});

	const repo = githubSlug(projectDir);
	const slug = repo || '<owner>/<repo>';
	// Why a step could not be checked, and how to check it again.
	const noRepo = 'the repo is not on GitHub yet: push the repo to GitHub first, then run install project again';
	const noAnswer = 'GitHub gave no answer: run gh auth login, then install project again. On the GitHub Free plan a private repo has no auto-merge or branch protection: make it public or use a paid plan';
	let repoState = 'not checked';
	if (repo && gh) {
		const r = gh(['api', `repos/${repo}`]);
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
		why: repo ? noAnswer : noRepo,
		lines: [`gh api -X PATCH repos/${slug} -F allow_auto_merge=true -F delete_branch_on_merge=true`],
	});

	const prot = repo && protection ? protection(projectDir) : null;
	const name = checkName(projectDir);
	steps.push({
		id: 'protect',
		title: 'Protect main with one required check that must be up to date, no force push and no delete, once per repo. Needs: a CI check that has run once on a PR, so GitHub knows its name. From the project folder:',
		state: prot === 'protected' ? 'done' : prot === 'unprotected' ? 'to do' : 'not checked',
		why: repo ? noAnswer : noRepo,
		lines: [
			'Bash:       cp .claude/kit/branch-protection.json .kit/branch-protection.json',
			'PowerShell: Copy-Item .claude/kit/branch-protection.json .kit/branch-protection.json',
			`Put ${name ? `"${name}"` : 'your CI job\'s name (the check name row A26 records)'} in its "contexts" list, then:`,
			`gh api -X PUT repos/${slug}/branches/main/protection --input .kit/branch-protection.json`,
		],
	});
	return { steps, gate, psGate };
}

/**
 * The merge-on-green block install prints: a count, then each step with its lines unless it is done.
 */
export function renderMergeOnGreen({ steps, gate = 'node ~/.claude/kit-tools/merge-gate.mjs', psGate = gate }) {
	const done = steps.filter((s) => s.state === 'done').length;
	const out = [`Merge on green: ${done} of ${steps.length} step${steps.length === 1 ? '' : 's'} done (rule:standing-grants). Each step is yours to take.`];
	steps.forEach((s, i) => {
		out.push(`    [${s.state}] ${i + 1}. ${s.title}`);
		if (s.state === 'not checked' && s.why) out.push(`        (not checked: ${s.why})`);
		if (s.state !== 'done') for (const l of s.lines) out.push(`        ${l}`);
	});
	if (steps.length === 1) out.push('    The project steps print at install project.');
	else out.push('    Then, on a PR whose gates passed, this says GO:', `        Bash:       ${gate} check <PR>`, `        PowerShell: ${psGate} check <PR>`);
	return out;
}
