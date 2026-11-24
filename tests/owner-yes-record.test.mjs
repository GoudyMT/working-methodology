// K367 (U26): the owner's yes record. The owner types a name in their own terminal and the writer leaves a JSON record
// (act, target with owner/repo, head, at) under <home>/kit-yes-spent/records/. guard-outward lets one merge through for
// it, once, while it is fresh, and only for the head it names. No network: the guard is run as a child process on a
// call's JSON, in a temp home and a temp repo from kit-temp.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import kitTemp from '../project/.claude/kit-temp.cjs';

const require = createRequire(import.meta.url);
kitTemp.sessionRoot();
const GUARD = path.resolve('project/.claude/guard-outward.cjs');
const WRITER = path.resolve('project/.claude/owner-yes.cjs');
const PROOF = path.resolve('project/.claude/owner-proof.cjs');
const OWNER_YES = require(WRITER);
const { FRESH_MS } = OWNER_YES;
const ENV = { ...process.env };
for (const k of ['CLAUDECODE', 'AI_AGENT', 'KIT_PUSH_APPROVED', 'CLAUDE_CONFIG_DIR', 'KIT_CLAUDE_HOME', 'CLAUDE_PROJECT_DIR', 'CLAUDE_CODE_SESSION_ID', 'CLAUDE_CODE_REMOTE', 'GIT_DIR', 'GIT_INDEX_FILE']) delete ENV[k];

// git by its full path, found on PATH: never by a bare name from a project folder.
const GIT = (process.env.PATH || '').split(path.delimiter).filter((d) => path.isAbsolute(d)).map((d) => path.join(d, process.platform === 'win32' ? 'git.exe' : 'git')).find((f) => fs.existsSync(f));

const HEAD = 'a'.repeat(40);
const OTHER_HEAD = 'b'.repeat(40);
const TARGET = 'owner/repo#12';
const SESSION = '11111111-2222-3333-4444-555555555555';

// A temp Claude home and a temp repo to run the guard in.
// origin: a URL for the repo's origin (config only, never fetched); tagOnOther: a local bare origin that already holds the
// tag v1.2.3 on a commit other than the recorded head, so the tag lookup answers without any network.
// With bare or tagOnOther the repo's raw origin url is the github form (rawUrl overrides it) and an insteadOf rewrite of that
// host's prefix (rewrite, with the url's own prefix as default) sends the tag lookup to a local bare folder: no network.
// local: the raw origin url is the bare folder's own path, with no rewrite.
function setup({ origin = '', tagOnOther = false, bare = false, originAt = '', rawUrl = '', rewrite = '', local = false, extraUrl = '' } = {}) {
	const home = kitTemp.makeTemp('yes-home-');
	const repo = kitTemp.makeTemp('yes-repo-');
	assert.ok(GIT, 'git was found on PATH');
	const g = (...a) => spawnSync(GIT, ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@example.com', ...a], { encoding: 'utf8' });
	spawnSync(GIT, ['init', '-q', '-b', 'main', repo], { encoding: 'utf8' });
	if (origin) g('remote', 'add', 'origin', origin);
	if (bare || tagOnOther) {
		// The remote's folder ends in owner/repo.git, so the repo it names reads from its URL like a github one.
		const base = kitTemp.makeTemp('yes-origin-');
		const rel = originAt || 'owner/repo.git';
		const remote = path.join(base, ...rel.split('/'));
		fs.mkdirSync(path.dirname(remote), { recursive: true });
		spawnSync(GIT, ['init', '-q', '-b', 'main', '--bare', remote], { encoding: 'utf8' });
		if (local) g('remote', 'add', 'origin', remote);
		else {
			const url = rawUrl || `https://github.com/${rel}`;
			g('remote', 'add', 'origin', url);
			g('config', `url.${base.split(path.sep).join('/')}/.insteadOf`, rewrite || url.slice(0, url.length - rel.length));
		}
		// extraUrl: a second raw url added to origin beside the first (git config --add).
		if (extraUrl) g('config', '--add', 'remote.origin.url', extraUrl);
		if (tagOnOther) {
			g('commit', '-q', '--allow-empty', '-m', 'other');
			g('tag', 'v1.2.3');
			g('push', '-q', 'origin', 'v1.2.3');
		}
	}
	return { home, repo };
}
// A fresh home, repo and record for one command: no earlier case can have spent the record it relies on.
function withRecord(over = {}, opts = {}) {
	const env = setup(opts);
	putRecord(env.home, over);
	return env;
}
const recordsDir = (home) => path.join(home, 'kit-yes-spent', 'records');
const idOf = (r) => crypto.createHash('sha256').update(`${r.act}|${r.target}|${r.head}|${r.at}`).digest('hex').slice(0, 16);
// The record file as the writer leaves it, written straight (the writer needs a person's terminal).
function putRecord(home, over = {}) {
	const r = { act: 'merge', target: TARGET, head: HEAD, at: Date.now(), ...over };
	fs.mkdirSync(recordsDir(home), { recursive: true });
	const id = idOf(r);
	fs.writeFileSync(path.join(recordsDir(home), `${id}.json`), JSON.stringify(r));
	return { ...r, id };
}
const MERGE = (head = HEAD, extra = '') => `gh pr merge 12 -R owner/repo ${extra}--match-head-commit ${head}`.replace('  ', ' ');
function guard({ home, repo }, command, { id = 'toolu_1', extraInput = {} } = {}) {
	const input = { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command }, cwd: repo, session_id: SESSION, tool_use_id: id, ...extraInput };
	const r = spawnSync(process.execPath, [GUARD], { input: JSON.stringify(input), encoding: 'utf8', cwd: repo, env: { ...ENV, CLAUDE_CONFIG_DIR: home, CLAUDE_PROJECT_DIR: repo }, timeout: 20000 });
	assert.equal(r.status, 0, `the guard ran: ${r.stderr}`);
	const out = r.stdout.trim() ? JSON.parse(r.stdout) : null;
	return { decision: out ? out.hookSpecificOutput.permissionDecision : 'pass', reason: out ? out.hookSpecificOutput.permissionDecisionReason : '' };
}
// owner-proof.cjs, the guard that holds kit-yes-spent: the verdict on one tool call, in a given home.
function proof({ home, repo }, tool_name, tool_input) {
	const r = spawnSync(process.execPath, [PROOF], { input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name, tool_input, cwd: repo }), encoding: 'utf8', cwd: repo, env: { ...ENV, CLAUDE_CONFIG_DIR: home, CLAUDE_PROJECT_DIR: repo }, timeout: 20000 });
	assert.equal(r.status, 0, `owner-proof ran: ${r.stderr}`);
	const out = r.stdout.trim() ? JSON.parse(r.stdout) : null;
	return out ? out.hookSpecificOutput.permissionDecision : 'pass';
}
const openLog = (repo) => {
	const common = spawnSync(GIT, ['-C', repo, 'rev-parse', '--git-common-dir'], { encoding: 'utf8' }).stdout.trim();
	const file = path.join(path.resolve(repo, common), 'kit-guard-open.log');
	return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
};

// why: catches a fresh owner record not lifting the hold on the one merge it names (K367 S1)
test('a yes record from the owner terminal lets the one merge it names through, and a merge with no record stays held', () => {
	const env = setup();
	assert.equal(guard(env, MERGE()).decision, 'deny', 'no record, no yes');
	const rec = putRecord(env.home);
	const r = guard(env, MERGE());
	assert.equal(r.decision, 'allow', `a fresh record for act, owner/repo#12 and head: ${r.reason}`);
	assert.match(r.reason, /record/i, 'the yes text says a record gave it');
	assert.ok(fs.existsSync(path.join(recordsDir(env.home), `${rec.id}.json`)), 'the record file is kept');
});

// why: catches an agent shell writing an owner yes record with no name typed at the terminal (K367 S2)
test('the writer refuses unless a name is typed at the terminal, so an agent shell cannot write a record', () => {
	const env = setup();
	const { home } = env;
	// An agent's own tool call cannot write the folder either: owner-proof holds kit-yes-spent (green already at c519fe57).
	const dir = recordsDir(home).split(path.sep).join('/');
	assert.equal(proof(env, 'Write', { file_path: `${dir}/x.json`, content: '{}' }), 'deny', 'a Write under the records folder');
	assert.equal(proof(env, 'Bash', { command: `echo {} > ${dir}/x.json` }), 'deny', 'a shell redirect into the records folder');
	assert.notEqual(proof(env, 'Write', { file_path: `${home.split(path.sep).join('/')}/other.txt`, content: 'x' }), 'deny', 'control: a Write elsewhere under the home');
	const r = spawnSync(process.execPath, [WRITER, '--record', 'merge', 'owner/repo#12', HEAD], { input: 'owner\n', encoding: 'utf8', env: { ...ENV, CLAUDE_CONFIG_DIR: home }, timeout: 20000 });
	assert.notEqual(r.status, 0, `the writer exits non-zero with stdin not a terminal; stdout: ${r.stdout}`);
	assert.match(r.stderr, /terminal|tty/i, 'the refusal names the terminal');
	assert.match(r.stderr, /stdin here is not one/, 'the refusal says stdin is not a terminal');
	// The writer takes only the acts guard-outward honours: merge, squash and release get as far as the terminal check.
	// Tag, delete and force keep the pre-push typed-name path: the writer refuses them, before any terminal, and says so.
	const asked = (act, target) => spawnSync(process.execPath, [WRITER, '--record', act, target, HEAD], { input: 'owner\n', encoding: 'utf8', env: { ...ENV, CLAUDE_CONFIG_DIR: home }, timeout: 20000 });
	for (const [act, target] of [['tag', 'owner/repo@v1.2.3'], ['delete', 'owner/repo#12'], ['force', 'owner/repo#12']]) {
		const x = asked(act, target);
		assert.notEqual(x.status, 0, `${act}: the writer refuses`);
		assert.match(x.stderr, /pre-push/i, `${act}: the refusal names the pre-push path`);
		assert.doesNotMatch(x.stderr, /stdin here is not one/, `${act}: refused for the act, not for the missing terminal`);
	}
	// A rebase gets no record either: the usage error names the three acts and the run never reaches the terminal check.
	const reb = asked('rebase', 'owner/repo#12');
	assert.notEqual(reb.status, 0, 'rebase: the writer refuses');
	assert.match(reb.stderr, /merge\|squash\|release/, 'rebase: the usage error names merge|squash|release');
	assert.doesNotMatch(reb.stderr, /stdin here is not one/, 'rebase: refused for the act, not for the missing terminal');
	for (const [act, target] of [['merge', 'owner/repo#12'], ['squash', 'owner/repo#12'], ['release', 'owner/repo@v1.2.3']]) {
		const x = asked(act, target);
		assert.match(x.stderr, /stdin here is not one/, `${act}: the writer accepts the act and stops only at the terminal`);
		assert.doesNotMatch(x.stderr, /pre-push/i, `${act}: no pre-push redirect`);
	}
	const files = fs.existsSync(recordsDir(home)) ? fs.readdirSync(recordsDir(home)) : [];
	assert.deepEqual(files, [], 'no record was written');
	// An AI shell marker in the writer's env is a refusal that names the marker (a real terminal cannot be faked here).
	for (const marker of ['CLAUDECODE', 'AI_AGENT']) {
		const m = spawnSync(process.execPath, [WRITER, '--record', 'merge', 'owner/repo#12', HEAD], { input: 'owner\n', encoding: 'utf8', env: { ...ENV, [marker]: '1', CLAUDE_CONFIG_DIR: home }, timeout: 20000 });
		assert.notEqual(m.status, 0, `${marker} set: the writer refuses`);
		assert.match(m.stderr, /CLAUDECODE|AI_AGENT|AI shell|agent/i, `${marker} set: the refusal names the AI shell marker, not only the missing terminal`);
	}
	// And the guard holds any shell or terminal-tool command that runs the writer.
	const writerCall = `node ${WRITER.split(path.sep).join('/')} --record merge ${TARGET} ${HEAD}`;
	assert.equal(guard(env, writerCall).decision, 'deny', 'a Bash call running owner-yes.cjs --record is held');
	assert.equal(guard(env, writerCall, { extraInput: { tool_name: 'mcp__terminal__run_in_terminal' } }).decision, 'deny', 'a terminal-tool call running owner-yes.cjs --record is held');
	// The shared maker: the writer's record and id, written where the writer would, are accepted by the guard.
	assert.equal(typeof OWNER_YES.recordOf, 'function', 'owner-yes.cjs exports recordOf(act, target, head, at)');
	const at = Date.now();
	const made = OWNER_YES.recordOf('merge', TARGET, HEAD, at);
	assert.deepEqual(made.record, { act: 'merge', target: TARGET, head: HEAD, at });
	assert.equal(made.id, idOf({ act: 'merge', target: TARGET, head: HEAD, at }), 'id = first 16 hex of sha256(act|target|head|at)');
	fs.mkdirSync(recordsDir(home), { recursive: true });
	fs.writeFileSync(path.join(recordsDir(home), `${made.id}.json`), JSON.stringify(made.record));
	assert.equal(guard(env, MERGE()).decision, 'allow', 'the guard accepts the maker\'s record');
	fs.rmSync(path.join(recordsDir(home), `${made.id}.json`));
	fs.rmSync(path.join(home, 'kit-yes-spent', made.id), { force: true });
});

// why: catches a merge with a record riding another head, no head pin, or --admin (K367 S3)
test('a merge with a record needs --match-head-commit equal to the record head, and --admin is refused', () => {
	const env = setup();
	putRecord(env.home);
	assert.equal(guard(env, MERGE(OTHER_HEAD)).decision, 'deny', 'a newer head than the record names');
	assert.equal(guard(env, 'gh pr merge 12 -R owner/repo').decision, 'deny', 'no --match-head-commit at all');
	assert.equal(guard(env, MERGE(HEAD, '--admin ')).decision, 'deny', '--admin on a good record');
	assert.equal(guard(env, `${MERGE(HEAD)} && gh pr merge 13 -R owner/repo --match-head-commit ${HEAD}`).decision, 'deny', 'a second merge riding the first in one command');
	assert.equal(guard(env, MERGE(HEAD.slice(0, 7))).decision, 'deny', 'a head prefix, not the whole sha');
	assert.equal(guard(env, MERGE(HEAD, '--admin=true ')).decision, 'deny', '--admin spelled with =');
	// A record covers one act: --rebase is its own act, and a merge with no -R takes no repo from origin.
	assert.notEqual(guard(env, `gh pr merge 12 -R owner/repo --rebase --match-head-commit ${HEAD}`).decision, 'allow', 'a merge record does not cover --rebase');
	const github = withRecord({}, { origin: 'https://github.com/owner/repo.git' });
	assert.notEqual(guard(github, `gh pr merge 12 --match-head-commit ${HEAD}`).decision, 'allow', 'a merge with no -R is not covered, though origin names owner/repo');
	// Any merge in a command needs the single-command head pin, the REST route too.
	assert.equal(guard(env, 'gh api -X PUT repos/owner/repo/pulls/12/merge').decision, 'deny', 'gh api PUT .../pulls/12/merge with a good record and no head pin');
	assert.equal(guard(env, `gh api -X PUT repos/owner/repo/pulls/12/merge -f sha=${HEAD}`).decision, 'deny', 'the REST merge is not covered by a record');
	assert.equal(guard(env, `gh pr merge 12 -R owner/repo --match-head-commit=${HEAD}`).decision, 'allow', 'the = spelling of the right head is the one allowed merge');
	putRecord(env.home, { at: Date.now() - 1000 });
	assert.equal(guard(env, MERGE(HEAD)).decision, 'allow', 'the record head with no --admin is allowed');
});

// why: catches a record used for a second merge because no spend marker was written (K367 S4)
test('a record is spent once: its wx marker under kit-yes-spent makes a second use refuse', () => {
	const env = setup();
	const rec = putRecord(env.home);
	assert.equal(guard(env, MERGE(), { id: 'toolu_1' }).decision, 'allow', 'the first use');
	const marker = path.join(env.home, 'kit-yes-spent', rec.id);
	assert.ok(fs.existsSync(marker), 'the spend marker is written under kit-yes-spent');
	assert.equal(guard(env, MERGE(), { id: 'toolu_2' }).decision, 'deny', 'a second call finds the marker');
	assert.equal(guard(env, MERGE(), { id: 'toolu_1' }).decision, 'allow', 'the same call asked again by the next guard still passes');
});

// why: catches a record older than FRESH_MS still working as an owner yes (K367 S4)
test('a record older than FRESH_MS is refused, and a fresh one beside it is not', () => {
	const env = setup();
	putRecord(env.home, { head: HEAD, at: Date.now() - FRESH_MS - 60000 });
	assert.equal(guard(env, MERGE(HEAD)).decision, 'deny', 'a record past FRESH_MS');
	putRecord(env.home, { head: OTHER_HEAD, at: Date.now() - 60000 });
	assert.equal(guard(env, MERGE(OTHER_HEAD)).decision, 'allow', 'a record a minute old');
});

// why: catches pop-up yeses read by meaning: two acts in one question, or a limited Yes label (K367 S5)
test('a pop-up yes still needs one act per question and the exact Yes label', () => {
	const env = setup();
	const dir = path.join(env.home, 'projects', env.repo.replace(/[^A-Za-z0-9]/g, '-'));
	fs.mkdirSync(dir, { recursive: true });
	const transcript = path.join(dir, `${SESSION}.jsonl`);
	const act = MERGE();
	const asked = (n, question, answer) => [
		{ type: 'assistant', timestamp: new Date(Date.now() - 5000).toISOString(), message: { content: [{ type: 'tool_use', id: `q${n}`, name: 'AskUserQuestion', input: { questions: [{ question, options: [{ label: 'Yes' }, { label: 'No' }] }] } }] } },
		{ type: 'user', timestamp: new Date(Date.now() - 4000).toISOString(), permissionDecision: { decision: 'accept', source: 'user' }, toolUseResult: { answers: { [question]: answer } }, message: { content: [{ type: 'tool_result', tool_use_id: `q${n}` }] } },
	];
	const run = (lines, id, command = act) => {
		fs.writeFileSync(transcript, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
		return guard(env, command, { id, extraInput: { transcript_path: transcript } }).decision;
	};
	assert.equal(run(asked(1, `Run \`${act}\` and \`gh pr merge 13 -R owner/repo\` in Bash?`, 'Yes'), 't1'), 'deny', 'one question quoting two acts');
	assert.equal(run(asked(2, `Run \`${act}\` in Bash?`, 'Yes, but only a dry run'), 't2'), 'deny', 'a Yes that limits itself');
	assert.equal(run(asked(3, `Run \`${act}\` in Bash?`, 'Yes'), 't3'), 'allow', 'one act, the exact Yes label');
	// A pop-up yes is for the exact act it quotes, and a merge is pinned to a head however the yes came (new at U26).
	// quote(n, run, quoted): the pop-up quotes one command, and a (possibly different) command is then run.
	const quote = (n, command, quoted = command) => run(asked(n, `Run \`${quoted}\` in Bash?`, 'Yes'), `t${n}`, command);
	const bare = 'gh pr merge 12 -R owner/repo';
	assert.equal(quote(4, bare), 'deny', 'a Yes quoting a merge with no head pin');
	assert.equal(quote(5, MERGE(OTHER_HEAD), MERGE(HEAD)), 'deny', 'a Yes quoting the merge at one head leaves the merge at another denied');
	assert.equal(quote(6, MERGE(HEAD), `gh pr merge 13 -R owner/repo --match-head-commit ${HEAD}`), 'deny', 'a Yes quoting PR 13 leaves PR 12 denied');
	assert.equal(quote(7, MERGE(HEAD, '--admin ')), 'deny', 'a Yes quoting a merge with --admin');
	assert.ok(fs.existsSync(recordsDir(env.home)) === false || fs.readdirSync(recordsDir(env.home)).length === 0, 'a pop-up yes leaves no record');
});

// why: catches a record for another act, target, repo or head being taken as the yes (K367 S3)
test('a record for another act, target, repo or head is refused, and the matching one is not', () => {
	const env = setup();
	putRecord(env.home, { act: 'tag' });
	putRecord(env.home, { target: 'owner/repo#13' });
	putRecord(env.home, { target: 'other/repo#12' });
	putRecord(env.home, { head: OTHER_HEAD });
	assert.equal(guard(env, MERGE(HEAD)).decision, 'deny', 'four records, none for this act, target, repo and head together');
	putRecord(env.home);
	assert.equal(guard(env, MERGE(HEAD)).decision, 'allow', 'the record that matches all four');
	// An act written two ways, or with signs a shell expands, is no act a record can name: each case has its own good record.
	const spelled = {
		'-R given twice': `gh pr merge 12 -R owner/repo --repo x/y --match-head-commit ${HEAD}`,
		'the head pin given twice': `gh pr merge 12 -R owner/repo --match-head-commit ${HEAD} --match-head-commit ${HEAD}`,
		'a Unicode space inside the act': `gh pr merge\u00a012 -R owner/repo --match-head-commit ${HEAD}`,
		'a ~ in the act': `gh pr merge 12 -R owner/repo --match-head-commit ${HEAD} --subject ~x`,
		'a % in the act': `gh pr merge 12 -R owner/repo --match-head-commit ${HEAD} --subject 100%`,
		'a * in the act': `gh pr merge 12 -R owner/repo --match-head-commit ${HEAD} --subject a*b`,
		'an option value starting with -': `gh pr merge 12 -R owner/repo --match-head-commit ${HEAD} --subject -x`,
	};
	for (const [what, command] of Object.entries(spelled)) assert.notEqual(guard(withRecord(), command).decision, 'allow', `${what} is no yes`);
	// A release record: target owner/repo@<tag>, head the tagged commit. It lifts that release and nothing else.
	// Its origin is a local bare folder with no tag (the remote tag lookup, `git ls-remote --tags origin v1.2.3` in the call's
	// repo, answers "absent" with no network).
	const rel = setup({ bare: true });
	const RELEASE = `gh release create v1.2.3 -R owner/repo --target ${HEAD}`;
	const relRecord = { act: 'release', target: 'owner/repo@v1.2.3', head: HEAD };
	assert.equal(guard(rel, RELEASE).decision, 'deny', 'no record, the release is held');
	putRecord(rel.home, relRecord);
	assert.equal(guard(rel, MERGE(HEAD)).decision, 'deny', 'a release record is no yes to a merge');
	assert.equal(guard(rel, RELEASE).decision, 'allow', 'the release the record names, the tag absent on the remote');
	// A release with notes or a body from a file, or free text, is no yes; a tag that exists on another commit is held.
	for (const extra of ['--notes-file x', '--notes hello', '--title hello']) {
		assert.notEqual(guard(withRecord(relRecord, { bare: true }), `${RELEASE} ${extra}`).decision, 'allow', `${extra} on a release record`);
	}
	assert.equal(guard(withRecord(relRecord, { tagOnOther: true }), RELEASE).decision, 'deny', 'a release whose tag already exists on another commit is held');
	assert.equal(guard(withRecord(relRecord), RELEASE).decision, 'deny', 'a release whose remote tag cannot be looked up is held');
});

// why: catches a spent record that is refused one way once and another way the next time (K367 S4)
test('the same act after the spend is refused the same way twice', () => {
	const env = setup();
	putRecord(env.home);
	assert.equal(guard(env, MERGE(), { id: 'toolu_1' }).decision, 'allow', 'the spend');
	const a = guard(env, MERGE(), { id: 'toolu_2' });
	const b = guard(env, MERGE(), { id: 'toolu_3' });
	assert.equal(a.decision, 'deny');
	assert.equal(b.decision, 'deny');
	assert.equal(a.reason, b.reason, 'the same refusal text both times');
});

// why: catches an unreadable record or a hook error letting a merge through unlogged (K367 S6)
test('an unreadable record refuses the merge and one row is logged in the git common kit-guard-open.log', () => {
	const env = setup();
	fs.mkdirSync(recordsDir(env.home), { recursive: true });
	fs.writeFileSync(path.join(recordsDir(env.home), 'deadbeefdeadbeef.json'), '{ not json');
	const r = guard(env, MERGE());
	assert.equal(r.decision, 'deny', 'an unreadable record is no yes');
	const rows = openLog(env.repo);
	assert.equal(rows.length, 1, 'one row in kit-guard-open.log');
	assert.equal(rows[0].hook, 'guard-outward');
	assert.ok(rows[0].cause && rows[0].at, 'the row names a cause and a time');
	assert.equal(guard(env, 'gh pr merge 12 -R owner/repo --match-head-commit', { extraInput: { tool_input: null } }).decision, 'deny', 'a call the guard cannot read is refused');

	// An unreadable file beside a good record: the act is refused, and the one row is logged all the same.
	const beside = setup();
	putRecord(beside.home);
	fs.writeFileSync(path.join(recordsDir(beside.home), 'deadbeefdeadbeef.json'), '{ not json');
	assert.equal(guard(beside, MERGE()).decision, 'deny', 'a good record does not rescue the act beside an unreadable one');
	assert.equal(openLog(beside.repo).length, 1, 'one row for that refusal');

	// A hook error: the records folder cannot be listed (it is a file), so the guard path throws; it refuses and logs one row.
	const broken = setup();
	fs.mkdirSync(path.join(broken.home, 'kit-yes-spent'), { recursive: true });
	fs.writeFileSync(recordsDir(broken.home), 'not a folder');
	assert.equal(guard(broken, MERGE()).decision, 'deny', 'a guard path that throws refuses');
	const errRows = openLog(broken.repo);
	assert.equal(errRows.length, 1, 'one row for the hook error');
	assert.equal(errRows[0].hook, 'guard-outward');
});

// why: catches a merge hidden behind another held act in one command riding a pop-up yes with no head pin (K367 S3)
test('a merge anywhere in a command needs the single-command head pin: a chained merge is held, the pinned merge alone with its record passes', () => {
	const env = setup();
	const dir = path.join(env.home, 'projects', env.repo.replace(/[^A-Za-z0-9]/g, '-'));
	fs.mkdirSync(dir, { recursive: true });
	const transcript = path.join(dir, `${SESSION}.jsonl`);
	let n = 0;
	// A pop-up Yes to one command, then that command run: the pop-up yes is the route that reaches only the merge-anywhere arm.
	const popUp = (command) => {
		n += 1;
		const question = `Run \`${command}\` in Bash?`;
		const lines = [
			{ type: 'assistant', timestamp: new Date(Date.now() - 5000).toISOString(), message: { content: [{ type: 'tool_use', id: `m${n}`, name: 'AskUserQuestion', input: { questions: [{ question, options: [{ label: 'Yes' }, { label: 'No' }] }] } }] } },
			{ type: 'user', timestamp: new Date(Date.now() - 4000).toISOString(), permissionDecision: { decision: 'accept', source: 'user' }, toolUseResult: { answers: { [question]: 'Yes' } }, message: { content: [{ type: 'tool_result', tool_use_id: `m${n}` }] } },
		];
		fs.writeFileSync(transcript, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
		return guard(env, command, { id: `c${n}`, extraInput: { transcript_path: transcript } }).decision;
	};
	const RELEASE = `gh release create v1.2.3 -R owner/repo --target ${HEAD}`;
	assert.equal(popUp(RELEASE), 'allow', 'control: a pop-up Yes to the release alone passes');
	assert.equal(popUp(`${RELEASE} && gh pr merge 12 -R owner/repo`), 'deny', 'a merge chained after a release, no head pin, whole chain quoted');
	assert.equal(popUp(`${RELEASE}; gh api -X PUT repos/owner/repo/pulls/12/merge`), 'deny', 'a REST merge chained after a release, the whole line quoted');
	assert.equal(popUp(`${RELEASE} && gh pr merge 12 -R owner/repo --match-head-commit ${HEAD}`), 'deny', 'even pinned, a merge inside a longer command is no yes');
	putRecord(env.home);
	assert.equal(guard(env, MERGE(HEAD)).decision, 'allow', 'the same merge alone, pinned, with its record');
});

// why: catches a repeated -R option parsing as one repo so a record matches a command that names it twice (K367 S3)
test('an option given twice, -R twice or -R with --repo, is no act and a record does not match it', () => {
	const rec = { target: 'a/b#12' };
	const twice = {
		'-R a/b -R a/b': `gh pr merge 12 -R a/b -R a/b --match-head-commit ${HEAD}`,
		'-R a/b --repo a/b': `gh pr merge 12 -R a/b --repo a/b --match-head-commit ${HEAD}`,
	};
	for (const [what, command] of Object.entries(twice)) assert.notEqual(guard(withRecord(rec), command).decision, 'allow', `${what} is no yes`);
	assert.equal(guard(withRecord(rec), `gh pr merge 12 -R a/b --match-head-commit ${HEAD}`).decision, 'allow', 'control: one -R a/b is the one allowed merge');
});

// A pop-up Yes to one command, asked in a transcript of its own, then the command run (the other route to an allow).
function popUpYes(command, n = 1) {
	const env = setup({ bare: true });
	const dir = path.join(env.home, 'projects', env.repo.replace(/[^A-Za-z0-9]/g, '-'));
	fs.mkdirSync(dir, { recursive: true });
	const transcript = path.join(dir, `${SESSION}.jsonl`);
	const question = `Run \`${command}\` in Bash?`;
	const lines = [
		{ type: 'assistant', timestamp: new Date(Date.now() - 5000).toISOString(), message: { content: [{ type: 'tool_use', id: `p${n}`, name: 'AskUserQuestion', input: { questions: [{ question, options: [{ label: 'Yes' }, { label: 'No' }] }] } }] } },
		{ type: 'user', timestamp: new Date(Date.now() - 4000).toISOString(), permissionDecision: { decision: 'accept', source: 'user' }, toolUseResult: { answers: { [question]: 'Yes' } }, message: { content: [{ type: 'tool_result', tool_use_id: `p${n}` }] } },
	];
	fs.writeFileSync(transcript, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
	return guard(env, command, { id: `u${n}`, extraInput: { transcript_path: transcript } }).decision;
}

// why: catches a record-approved merge carrying a body, subject, body file or author the owner never read (K367 S3)
test('a record-approved merge refuses -b, -t, -F and -A, so the parsed act is none and the merge stays held', () => {
	for (const extra of ['-b hello', '--body hello', '-t hello', '--subject hello', '-F notes.md', '--body-file notes.md', '-A someone']) {
		assert.notEqual(guard(withRecord(), `gh pr merge 12 -R owner/repo ${extra} --match-head-commit ${HEAD}`).decision, 'allow', `${extra} on a merge record`);
	}
	assert.equal(guard(withRecord(), MERGE(HEAD)).decision, 'allow', 'control: the plain pinned merge with its record');
});

// why: catches a record-approved merge that defers itself or deletes a branch, extra outward acts under one yes (K367 S3)
test('a record-approved merge refuses --auto, --disable-auto and --delete-branch, and --admin stays refused', () => {
	for (const extra of ['--auto', '--disable-auto', '-d', '--delete-branch', '--admin']) {
		assert.notEqual(guard(withRecord(), `gh pr merge 12 -R owner/repo ${extra} --match-head-commit ${HEAD}`).decision, 'allow', `${extra} on a merge record`);
	}
	assert.equal(guard(withRecord(), MERGE(HEAD)).decision, 'allow', 'control: the plain pinned merge with its record');
});

// why: catches a release record honoured for a repo that is not the one origin points at (K367 S3)
test('a release record is honoured only when origin names the same owner/repo as -R', () => {
	const rec = { act: 'release', target: 'owner/repo@v1.2.3', head: HEAD };
	const RELEASE = `gh release create v1.2.3 -R owner/repo --target ${HEAD}`;
	assert.equal(guard(withRecord(rec, { bare: true }), RELEASE).decision, 'allow', 'control: origin is owner/repo and the tag is absent');
	assert.equal(guard(withRecord(rec, { bare: true, originAt: 'other/place.git' }), RELEASE).decision, 'deny', 'origin is other/place with the tag absent there: held');
});

// why: catches a command that writes a yes record without the words owner-yes.cjs --record in plain sight (K367 S2)
test('a shell or terminal command that may write a record is held without the literal words', () => {
	const env = setup();
	const spelled = {
		'a glob over the writer name': 'node project/.claude/owner-y?s.cjs --record merge',
		'a glob star over the writer name': 'node project/.claude/owner-*.cjs --record merge',
		'a path built in a variable': 'W=project/.claude/owner-yes; node $W.cjs --record merge',
		'a record-shaped argument to any program': `node some-tool.js merge owner/repo#12 ${HEAD}`,
	};
	for (const [what, command] of Object.entries(spelled)) {
		assert.equal(guard(env, command).decision, 'deny', `${what}, in Bash`);
		assert.equal(guard(env, command, { extraInput: { tool_name: 'mcp__terminal__run_in_terminal' } }).decision, 'deny', `${what}, in the terminal tool`);
	}
});

// why: catches a merge spelled so the guard misses it, riding a pop-up yes with no head pin (K367 S3)
test('every spelling of a merge needs the head pin: gh.exe, global options before pr merge, and GraphQL merge mutations', () => {
	const mutation = (name) => `gh api graphql -f query='mutation { ${name}(input: {pullRequestId: "X"}) { clientMutationId } }'`;
	const spelled = {
		'gh.exe': 'gh.exe pr merge 12 -R owner/repo',
		'gh with -R before pr merge': 'gh -R owner/repo pr merge 12',
		'a chain with gh.exe': `gh release create v1.2.3 -R owner/repo --target ${HEAD} && gh.exe pr merge 12 -R owner/repo`,
		'mergePullRequest': mutation('mergePullRequest'),
		'enablePullRequestAutoMerge': mutation('enablePullRequestAutoMerge'),
		'enqueuePullRequest': mutation('enqueuePullRequest'),
		'a \\u escape in the mutation name': mutation('\\u006dergePullRequest'),
	};
	let n = 0;
	for (const [what, command] of Object.entries(spelled)) assert.notEqual(popUpYes(command, ++n), 'allow', `${what}: a pop-up Yes to the whole command is no yes without the head pin`);
});

// why: catches an escaped spelling of the record writer slipping past the guard that holds the plain words (K367 S2)
test('a command that runs the writer through backslashes, carets or backticks inside words is held like the plain words', () => {
	const env = setup();
	const spelled = {
		'a backslash inside the name': String.raw`node project/.claude/owner-y\es.cjs --record merge`,
		'a caret inside the option': 'node project/.claude/owner-yes.cjs --rec^ord merge',
		'doubled backticks inside the name': 'node project/.claude/own``er-yes.cjs --record merge',
		'a backslash inside the option': String.raw`node project/.claude/owner-yes.cjs --rec\ord merge`,
	};
	for (const [what, command] of Object.entries(spelled)) {
		assert.equal(guard(env, command).decision, 'deny', `${what}, in Bash`);
		assert.equal(guard(env, command, { extraInput: { tool_name: 'mcp__terminal__run_in_terminal' } }).decision, 'deny', `${what}, in the terminal tool`);
	}
});

// why: catches a merge spelled with options, backticks or escapes between its words, riding a release record (K367 S3)
test('a merge word anywhere in the call needs the head pin: options between pr and merge, backtick spans and escaped spellings', () => {
	const relRecord = { act: 'release', target: 'owner/repo@v1.2.3', head: HEAD };
	const RELEASE = `gh release create v1.2.3 -R owner/repo --target ${HEAD}`;
	// The release itself is a good act with its record; the merge rides in other text of the same call, which the guard reads.
	const withNote = (note) => guard(withRecord(relRecord, { bare: true }), RELEASE, { extraInput: { tool_input: { command: RELEASE, note } } }).decision;
	assert.equal(withNote('hello'), 'allow', 'control: the release with its record and harmless other text');
	const spelled = {
		'an option between pr and merge': 'gh pr --repo a/b merge 5',
		'a backtick span': 'echo `gh pr merge 5 -R a/b`',
		'a backslash inside merge': String.raw`gh pr mer\ge 5 -R a/b`,
		'a caret inside merge': 'gh pr mer^ge 5 -R a/b',
		'a backslash inside gh': String.raw`g\h pr merge 5 -R a/b`,
	};
	for (const [what, note] of Object.entries(spelled)) assert.equal(withNote(note), 'deny', `${what} is a merge with no head pin`);
});

// why: catches a release record honoured for an origin that is a local path, another host or another repo (K367 S3)
test('a release record needs origin raw url on github.com over https or ssh with exactly the -R owner/repo', () => {
	const rec = { act: 'release', target: 'owner/repo@v1.2.3', head: HEAD };
	const RELEASE = `gh release create v1.2.3 -R owner/repo --target ${HEAD}`;
	const at = (opts) => guard(withRecord(rec, opts), RELEASE).decision;
	assert.equal(at({ bare: true }), 'allow', 'control: https://github.com/owner/repo.git, tag absent');
	assert.equal(at({ bare: true, rawUrl: 'git@github.com:owner/repo.git', rewrite: 'git@github.com:' }), 'allow', 'control: the scp-style ssh form');
	assert.equal(at({ bare: true, rawUrl: 'ssh://git@github.com/owner/repo.git', rewrite: 'ssh://git@github.com/' }), 'allow', 'control: the ssh:// form');
	assert.equal(at({ bare: true, local: true }), 'deny', 'a local path origin');
	assert.equal(at({ bare: true, rawUrl: 'https://gitlab.com/owner/repo.git', rewrite: 'https://gitlab.com/' }), 'deny', 'another host with the same owner/repo');
	assert.equal(at({ bare: true, originAt: 'owner/repo-two.git' }), 'deny', 'github.com but another repo');
	// An origin with two raw urls is held even though the tag is absent, with the github url last (the order a single
	// `config --get` would read): the first url is another host's, rewritten to the local folder, the github one is added.
	assert.equal(at({ bare: true, rawUrl: 'https://gitlab.com/owner/repo.git', rewrite: 'https://gitlab.com/', extraUrl: 'https://github.com/owner/repo.git' }), 'deny', 'origin with two raw urls, github last');
});

// why: catches the record-shaped argument arm missing a plain owner/repo target for a delete or force (K367 S2)
test('a command carrying a delete or force record shape with a plain owner/repo target is held', () => {
	const env = setup();
	for (const act of ['delete', 'force']) {
		assert.equal(guard(env, `node some-tool.js ${act} owner/repo ${HEAD}`).decision, 'deny', `${act} owner/repo <head>, in Bash`);
		assert.equal(guard(env, `node some-tool.js ${act} owner/repo ${HEAD}`, { extraInput: { tool_name: 'mcp__terminal__run_in_terminal' } }).decision, 'deny', `${act} owner/repo <head>, in the terminal tool`);
	}
});

// why: catches the gh.exe spelling hiding a merge chained after another held act under a pop-up yes (K367 S3)
test('a merge spelled gh.exe and chained after another act needs the head pin', () => {
	const RELEASE = `gh release create v1.2.3 -R owner/repo --target ${HEAD}`;
	assert.equal(popUpYes(`${RELEASE} && gh.exe pr merge 12 -R owner/repo`, 1), 'deny', 'a Yes to the whole chain with gh.exe and no head pin');
	assert.equal(popUpYes(`${RELEASE}; GH.EXE pr merge 12 -R owner/repo`, 2), 'deny', 'the same in capitals');
});
