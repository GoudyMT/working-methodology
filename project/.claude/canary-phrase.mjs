// The project's agent confirmation phrase (rule:agent-canary), for the audits that keep it out of outward text.
// It lives on one line of the rules every brief carries; this reads it from the main checkout, so a worktree finds it.
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

export function canaryPhrase(cwd = process.cwd()) {
	const common = spawnSync('git', ['-C', cwd, 'rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' });
	if (common.status !== 0) return null;
	const root = path.dirname(common.stdout.trim());
	for (const f of ['standards/agent-teams.md', '.claude/rules/agent-teams.md', 'AGENTS.md']) {
		const p = path.join(root, f);
		if (!existsSync(p)) continue;
		const m = readFileSync(p, 'utf8').match(/^\s*Confirmation phrase: .* with: (.+?)\s*$/m);
		if (m) return m[1];
	}
	return null;
}

/** True when the text carries the phrase, in any case or spacing. */
export function carriesPhrase(text, cwd) {
	const phrase = canaryPhrase(cwd);
	return Boolean(phrase) && norm(text).includes(norm(phrase));
}
