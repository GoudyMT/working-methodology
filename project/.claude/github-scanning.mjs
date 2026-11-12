// GitHub's own secret scanning and push protection, a second net behind the first push check (N9, a 1.26.0
// carry-over). It only reports: GitHub may be out of reach, and the owner turns them on, not a tool.
import { spawnSync } from 'node:child_process';

// The owner/name of each GitHub remote, from `git remote -v`. A name that is not plain is left out, so it never
// reaches the API path.
export function githubRepos(remotesText) {
	const repos = new Set();
	for (const m of String(remotesText).matchAll(/(?:https:\/\/(?:[^@/\s]+@)?github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?(?=\s)/g)) {
		repos.add(`${m[1]}/${m[2]}`);
	}
	return [...repos];
}

const ask = (args) => spawnSync('gh', args, { encoding: 'utf8', timeout: 8000 });

/**
 * One note for each public GitHub repo whose secret scanning or push protection is not on, or that GitHub did not answer.
 *
 * Args:
 *     remotesText: the output of `git remote -v`
 *     gh: runs gh with its arguments, returns { status, stdout, stderr }
 *
 * Returns:
 *     the note lines, none when every public repo has both on
 */
export function scanningNotes(remotesText, gh = ask) {
	const notes = [];
	for (const repo of githubRepos(remotesText)) {
		const r = gh(['api', `repos/${repo}`, '--jq', '[.private, .security_and_analysis.secret_scanning.status, .security_and_analysis.secret_scanning_push_protection.status] | map(tostring) | join(" ")']);
		const [priv, scanning, protection] = String((r && r.stdout) || '').trim().split(' ');
		if (!r || r.status !== 0 || !/^(true|false)$/.test(priv || '')) {
			notes.push(`NOTE  GitHub did not say whether ${repo} has secret scanning and push protection on (${String((r && r.stderr) || '').trim().split('\n')[0] || 'no answer'}); check Settings > Code security before you push.`);
			continue;
		}
		if (priv === 'true') continue;
		if (scanning !== 'enabled' || protection !== 'enabled') {
			notes.push(`NOTE  ${repo} is public, with secret scanning ${scanning || 'unknown'} and push protection ${protection || 'unknown'}: turn both on in Settings > Code security before you push.`);
		}
	}
	return notes;
}
