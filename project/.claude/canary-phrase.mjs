// The project's agent confirmation phrase (rule:agent-canary), for the audits that keep it out of outward text.
// It lives on one line of the rules every brief carries, in the file the rule index names for
// rule:agent-team-adapter (else standards/agent-teams.md); this reads it from the main checkout, so a worktree
// finds it. The canary hook reads it the same way.
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

// Letters and digits only, space-padded: markdown or hyphens inside the phrase still match, a longer word does not.
const words = (s) => ` ${String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;

export function canaryPhrase(cwd = process.cwd()) {
	const common = spawnSync('git', ['-C', cwd, 'rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' });
	if (common.status !== 0) return null;
	const root = path.dirname(common.stdout.trim());
	let file = 'standards/agent-teams.md';
	const index = path.join(root, 'standards', 'INDEX.md');
	const row = existsSync(index) && readFileSync(index, 'utf8').match(/^\|\s*agent-team-adapter\s*\|[^|\n]*\|\s*`([^`]+)`/m);
	if (row) file = row[1];
	const p = path.join(root, file);
	const m = existsSync(p) && readFileSync(p, 'utf8').match(/^\s*Confirmation phrase: .* with: (.+?)\s*$/m);
	return m ? m[1] : null;
}

/** True when the text carries the phrase, in any case, spacing or markdown. */
export function carriesPhrase(text, cwd) {
	const phrase = canaryPhrase(cwd);
	return Boolean(phrase) && words(text).includes(words(phrase));
}
