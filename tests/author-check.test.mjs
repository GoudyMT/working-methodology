// The owner's rule (2026-11-21): no AI reference anywhere in a commit. The commit-msg hook refused an AI trailer in the
// message (name-check.mjs), but a commit whose author or committer was named for an AI tool went through: git records
// that name in the history for good. The hook now also checks who the commit is by, as git will record it (git var,
// which reads --author, the GIT_AUTHOR_* and GIT_COMMITTER_* variables and the config). Each case commits through
// git itself, so the hook runs as git runs it.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import kitTemp from '../project/.claude/kit-temp.cjs';
import { install } from '../scripts/kit.mjs';

kitTemp.sessionRoot();
const KIT = path.resolve('.');
const ENV = { ...process.env };
for (const k of ['CLAUDECODE', 'AI_AGENT', 'KIT_PUSH_APPROVED', 'CLAUDE_CONFIG_DIR', 'KIT_CLAUDE_HOME', 'CLAUDE_PROJECT_DIR', 'GIT_DIR', 'GIT_INDEX_FILE',
	'GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL']) delete ENV[k];
const ID = ['-c', 'user.name=Max Owner', '-c', 'user.email=max@example.com', '-c', 'commit.gpgsign=false'];
const git = (cwd, args, env = {}) => spawnSync('git', [...ID, ...args], { cwd, encoding: 'utf8', env: { ...ENV, ...env } });
const commit = (dir, { author, env } = {}) => git(dir, ['commit', '-q', '--allow-empty', '-m', 'chore: an empty commit', ...(author ? ['--author', author] : [])], env);

// A project with the kit's commit-msg hook and its name check, the hooks path set as install sets it.
function hooked() {
	const dir = kitTemp.makeTemp('author-');
	fs.mkdirSync(path.join(dir, '.githooks'));
	fs.mkdirSync(path.join(dir, '.claude'));
	fs.copyFileSync(path.join(KIT, 'project', '.githooks', 'commit-msg'), path.join(dir, '.githooks', 'commit-msg'));
	fs.chmodSync(path.join(dir, '.githooks', 'commit-msg'), 0o755);
	for (const f of ['name-check.mjs', 'safe-spawn.cjs'].filter((x) => fs.existsSync(path.join(KIT, 'project', '.claude', x)))) fs.copyFileSync(path.join(KIT, 'project', '.claude', f), path.join(dir, '.claude', f));
	git(dir, ['init', '-q', '-b', 'main']);
	git(dir, ['config', 'core.hooksPath', '.githooks']);
	return dir;
}
const count = (dir) => Number(git(dir, ['rev-list', '--count', '--all']).stdout.trim() || 0);

// why: catches a commit recorded under an AI tool's name as author or committer
test('the commit-msg hook refuses a commit by an AI author or committer, and passes a person', () => {
	const dir = hooked();
	const refused = [
		['author Claude', { author: 'Claude <noreply@anthropic.com>' }],
		['author claude, a person\'s email', { author: 'claude <max@example.com>' }],
		['author GitHub Copilot', { author: 'GitHub Copilot <198982749+Copilot@users.noreply.github.com>' }],
		['an anthropic.com email', { author: 'Max Owner <max@anthropic.com>' }],
		['an openai.com email', { author: 'Max Owner <bot@mail.openai.com>' }],
		['committer Claude', { env: { GIT_COMMITTER_NAME: 'Claude', GIT_COMMITTER_EMAIL: 'noreply@anthropic.com' } }],
		['committer named in the environment only', { env: { GIT_COMMITTER_NAME: 'Claude Code' } }],
		['author named in the environment', { env: { GIT_AUTHOR_NAME: 'Copilot', GIT_AUTHOR_EMAIL: 'x@example.com' } }],
	];
	for (const [what, o] of refused) {
		const r = commit(dir, o);
		assert.equal(r.status, 1, `${what} is refused: ${r.stderr}`);
		assert.match(r.stderr, /name-check: the (author|committer) .* names an AI tool/, what);
	}
	assert.equal(count(dir), 0, 'nothing was committed');
	// A person, including one whose name or email holds those letters inside a longer word, commits.
	const people = ['Max Owner <max@example.com>', 'Claudia Marsh <claudia@example.com>', 'Claudette Roy <croy@example.com>',
		'Jean-Claudeau Prix <jcp@example.com>', 'Ana Copilotto <ana@example.com>', 'Sam Lee <sam@anthropics.example.org>', 'Ola Nordmann <ola@notopenai.com>'];
	for (const author of people) {
		const r = commit(dir, { author });
		assert.equal(r.status, 0, `${author}: ${r.stderr}`);
	}
	assert.equal(count(dir), people.length);
});

// The build 23a sweep of K243: the check missed a tool name glued to a word, a digit or a lookalike letter, other makers'
// tools and domains; a person named Claude could never commit; the refusal named only git config, which cannot change
// a replayed author; and a refused author hid a refused message.
// why: guards rule:commit-message-format (who a commit is by: no AI tool however it is spelled, and every repair named)
test('the author check reads a tool name however it is spelled, names each repair, and passes an allowed person', () => {
	const dir = hooked();
	const refused = ['ClaudeCode <x@example.com>', 'claude2 <x@example.com>', 'claudebot <x@example.com>', '\uFF23\uFF4C\uFF41\uFF55\uFF44\uFF45 <x@example.com>',
		'\u0421laude <x@example.com>', 'Cl\u200Baude <x@example.com>', 'Bot <bot@claude.ai>', 'Gemini <x@example.com>', 'Codex <x@example.com>',
		'Cursor Agent <cursoragent@cursor.com>'].map((a) => JSON.parse(`"${a}"`));
	for (const author of refused) {
		const r = commit(dir, { author });
		assert.equal(r.status, 1, `${author} is refused: ${r.stderr}`);
		assert.match(r.stderr, /--reset-author/, 'the repair for a replayed author is named');
		assert.match(r.stderr, /kit\.allowedIdent/, 'the owner\'s allow list is named');
	}
	// A person named Claude commits once the owner lists that exact identity in the repo's own git config.
	const claude = 'Claude Dupont <claude.dupont@example.fr>';
	assert.equal(commit(dir, { author: claude }).status, 1, 'refused until listed');
	git(dir, ['config', '--add', 'kit.allowedIdent', claude]);
	assert.equal(commit(dir, { author: claude }).status, 0, 'the listed person commits');
	assert.equal(commit(dir, { author: 'Claude Dupont <other@example.fr>' }).status, 1, 'only the exact identity');
	// A refused author and a refused message are both named in one go.
	const both = git(dir, ['commit', '-q', '--allow-empty', '-m', 'an untyped message', '--author', 'Claude <noreply@anthropic.com>']);
	assert.equal(both.status, 1);
	assert.match(both.stderr, /names an AI tool/);
	assert.match(both.stderr, /type: subject|"type: subject"|one of/);
});

// why: guards rule:commit-message-format (an installed project whose commits skip the kit's commit-msg hook)
test('install wires the hooks path, so a commit by an AI author is refused in an installed project', () => {
	const root = kitTemp.makeTemp('author-install-');
	const home = path.join(root, '.claude');
	const proj = path.join(root, 'app');
	fs.mkdirSync(proj);
	git(proj, ['init', '-q', '-b', 'main']);
	fs.writeFileSync(path.join(proj, 'README.md'), 'app\n');
	install({ kit: KIT, home, target: 'user' });
	install({ kit: KIT, home, target: 'project', projectDir: proj });
	const hooksPath = git(proj, ['config', 'core.hooksPath']).stdout.trim();
	assert.ok(hooksPath, 'install set core.hooksPath');
	assert.ok(fs.existsSync(path.join(hooksPath, 'commit-msg')), `the hooks path ${hooksPath} holds a commit-msg hook`);
	const bot = commit(proj, { author: 'Claude <noreply@anthropic.com>' });
	assert.equal(bot.status, 1, bot.stderr);
	assert.match(bot.stderr, /names an AI tool/);
	const person = commit(proj, { author: 'Max Owner <max@example.com>' });
	assert.equal(person.status, 0, person.stderr + person.stdout);
});
