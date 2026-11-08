// The project's agent confirmation phrase (rule:agent-canary), for the audits that keep it out of outward text.
// It lives on one line of the rules every brief carries, in the file the rule index names for
// rule:agent-team-adapter (else standards/agent-teams.md); this reads it from the main checkout, so a worktree
// finds it. The canary hook reads it the same way.
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

// Letters and digits only (any script), space-padded: markdown or hyphens inside the phrase still match, a longer word does not.
const words = (s) => ` ${String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()} `;

export function canaryPhrase(cwd = process.cwd(), base = process.env.PR_BASE) {
	const common = spawnSync('git', ['-C', cwd, 'rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' });
	if (common.status !== 0) return null;
	const root = path.dirname(common.stdout.trim());
	// Judging a PR (PR_BASE set, in CI and by the merge gate), the phrase is read from the base: a branch that edits
	// its rules cannot change the phrase its own body is checked against.
	const read = base
		? (rel) => { const r = spawnSync('git', ['-C', cwd, 'show', `${base}:${rel}`], { encoding: 'utf8' }); return r.status === 0 ? r.stdout : null; }
		: (rel) => (existsSync(path.join(root, rel)) ? readFileSync(path.join(root, rel), 'utf8') : null);
	let file = 'standards/agent-teams.md';
	const row = (read('standards/INDEX.md') || '').match(/^\|\s*agent-team-adapter\s*\|[^|\n]*\|\s*`([^`]+)`/m);
	if (row) file = row[1];
	const m = (read(file) || '').match(/^\s*Confirmation phrase: .* with: (.+?)\s*$/m);
	return m && words(m[1]).trim() ? m[1] : null;
}

/** True when the text carries the phrase, in any case, spacing or markdown. */
export function carriesPhrase(text, cwd, base) {
	const phrase = canaryPhrase(cwd, base);
	return Boolean(phrase) && words(text).includes(words(phrase));
}
