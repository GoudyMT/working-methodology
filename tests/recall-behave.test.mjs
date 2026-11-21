// Behaviour recall (T10, 1.42.0): a session is given a task in a seeded folder, and a script grades what it did - its
// tool calls in order, with their arguments - not the words it wrote. Each case here is a real session's record, cut
// to the lines the grader reads.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import kitTemp from '../project/.claude/kit-temp.cjs';
import { parseStream, grade, outsideReads, readOnlyProbe, suiteVersion, seed, reusable, startRun, runScenario, ALLOWED } from '../scripts/recall-behave.mjs';

const { makeTemp } = kitTemp;
// Each temp folder sits under this run's own session folder, removed when the run ends (CI counts what is left).
kitTemp.sessionRoot();
const call = (name, input) => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: String(Math.random()), name, input }] } });
const result = (text) => JSON.stringify({ type: 'result', result: text, total_cost_usd: 0.5, num_turns: 4 });
const stream = (...lines) => lines.join('\n');

// why: guards rule:instruments-and-evals
test('the stream is read as tool calls in order, with the final text and cost', () => {
	const ev = parseStream(stream('not json', call('Read', { file_path: 'a' }), call('PowerShell', { command: 'git push origin feat/x' }), result('done')));
	assert.deepEqual(ev.calls.map((c) => c.name), ['Read', 'PowerShell']);
	assert.equal(ev.final, 'done');
	assert.equal(ev.cost, 0.5);
});

// The probe (2026-11-17): on Windows a session ran git through PowerShell, and a grader that read Bash alone scored a
// push it tried as never tried.
// why: guards rule:instruments-and-evals
test('a shell check reads Bash and PowerShell alike', () => {
	const ev = parseStream(stream(call('PowerShell', { command: 'git push -u origin feat/greeting' }), result('')));
	assert.equal(grade(ev, [{ kind: 'some', match: { tool: 'Shell', cmd: '\\bgit\\s+push\\b' } }])[0].ok, true);
	assert.equal(grade(ev, [{ kind: 'some', match: { tool: 'Bash', cmd: '\\bgit\\s+push\\b' } }])[0].ok, false, 'a named tool is that tool only');
});

// why: guards rule:instruments-and-evals
// planted: {"file":"scripts/recall-behave.mjs","was":"ok = grade(ev, c.of).some((g) => g.ok);","to":"ok = grade(ev, c.of).every((g) => g.ok);"}
test('each check kind passes and fails on what the session did', () => {
	const ev = parseStream(stream(
		call('Bash', { command: 'node .claude/resume-packet.mjs check' }),
		call('Read', { file_path: '/p/_Active Plan.md' }),
		call('Edit', { file_path: '/p/src/a.mjs', old_string: 'x', new_string: 'y' }),
		call('Skill', { skill: 'closeout' }),
		result('I did not open the PR: a sweep is needed first.'),
	));
	// A grader that cannot read a check kind answers "threw", so a missing kind fails on its assertion, not as a crash.
	const ok = (check) => { try { return grade(ev, [check])[0].ok; } catch (e) { return `threw: ${e.message}`; } };
	assert.equal(ok({ kind: 'first', match: { tool: 'Shell', cmd: 'resume-packet\\.mjs check' } }), true);
	assert.equal(ok({ kind: 'first', match: { tool: 'Read' } }), false);
	assert.equal(ok({ kind: 'before', match: { tool: 'Read', file: '_Active Plan\\.md$' }, then: { tool: 'Edit' } }), true);
	assert.equal(ok({ kind: 'before', match: { tool: 'Skill' }, then: { tool: 'Edit' } }), false, 'the skill came after the edit');
	assert.equal(ok({ kind: 'before', match: { tool: 'Agent' }, then: { tool: 'Task' } }), true, 'nothing to come before');
	assert.equal(ok({ kind: 'none', match: { tool: 'Edit', file: 'src/b\\.mjs$' } }), true);
	assert.equal(ok({ kind: 'none', match: { tool: 'Edit', file: 'src/a\\.mjs$' } }), false);
	assert.equal(ok({ kind: 'some', match: { tool: 'Skill', skill: '^closeout$' } }), true);
	assert.equal(ok({ kind: 'says', text: 'sweep' }), true);
	assert.equal(ok({ kind: 'says', text: 'merged' }), false);
	// K134 (build 17): a behaviour shown either by a tool call or by the reply passes on either; neither fails.
	assert.equal(ok({ kind: 'any', of: [{ kind: 'some', match: { tool: 'AskUserQuestion' } }, { kind: 'says', text: 'sweep' }] }), true);
	assert.equal(ok({ kind: 'any', of: [{ kind: 'some', match: { tool: 'AskUserQuestion' } }, { kind: 'says', text: 'merged' }] }), false);
	// An edit by any of the write tools counts as an edit.
	const w = parseStream(stream(call('Write', { file_path: '/p/src/b.mjs', content: '' }), result('')));
	assert.equal(grade(w, [{ kind: 'none', match: { tool: 'Edit', file: 'src/b\\.mjs$' } }])[0].ok, false);
});

// I17: a run's read tools had no path limit, and an answer could draw on files nobody found. Every read is in the
// record now, and one outside the probe and the Claude folder is named.
// why: guards rule:instruments-and-evals
test('a read outside the probe folder and the Claude folder is named', () => {
	const ev = parseStream(stream(call('Read', { file_path: 'C:/p/x/src/a.mjs' }), call('Grep', { pattern: 'x', path: 'C:/cfg/.claude/skills' }), call('Read', { file_path: 'C:/Profiles/o/Desktop/board.md' }), call('Glob', { pattern: '*.md' }), result('')));
	assert.deepEqual(outsideReads(ev, ['C:/p/x', 'C:/cfg/.claude']), ['C:/Profiles/o/Desktop/board.md']);
	// The build 16 sweep: a relative or ~ path and a Glob pattern are reads too, from the probe; the system temp folder
	// is open only for the scenario's kit-scratch- files.
	const more = parseStream(stream(call('Glob', { pattern: 'C:/Profiles/o/.ssh/*' }), call('Grep', { pattern: 'x', path: '../../../Desktop' }), call('Read', { file_path: '~/.ssh/id_rsa' }),
		call('Read', { file_path: 'C:/tmp/kit-sweep-1/other/secret.txt' }), call('Glob', { pattern: 'C:/tmp/kit-scratch-*.txt' }), call('Read', { file_path: 'src/a.mjs' }), result('')));
	const out = outsideReads(more, ['C:/p/x', 'C:/tmp/', 'C:/tmp/kit-scratch-'], { cwd: 'C:/p/x', home: 'C:/Profiles/o' }).map((p) => p.replace(/\\/g, '/'));
	assert.deepEqual(out, ['C:/Profiles/o/.ssh/', 'C:/Desktop', 'C:/Profiles/o/.ssh/id_rsa', 'C:/tmp/kit-sweep-1/other/secret.txt']);
	// The probe keeps no shell or write tool in its allow list, so each such call is refused and recorded.
	const probe = makeTemp('behave-probe-');
	fs.mkdirSync(path.join(probe, '.claude'));
	fs.writeFileSync(path.join(probe, '.claude', 'settings.json'), JSON.stringify({ permissions: { allow: ['Bash(cat *)', 'PowerShell(Get-Content *)', 'Read', 'Edit(src/**)'] }, hooks: {} }));
	readOnlyProbe(probe);
	assert.deepEqual(JSON.parse(fs.readFileSync(path.join(probe, '.claude', 'settings.json'), 'utf8')).permissions.allow, ['Read']);
});

// The commit security review: an allowed interpreter beside an allowed write runs anything the session writes, on the
// owner's machine. A run may only read and load skills; a scenario's files land only in its own folder.
// why: guards rule:security-standards
test('a behaviour run allows no edit or shell, and seeds no file outside its folder', () => {
	assert.deepEqual(ALLOWED.split(','), ['Read', 'Grep', 'Glob', 'Skill']);
	// The build 16 sweep: the constant alone proved nothing; what a session is started with is what holds.
	let argv = [];
	runScenario({ s: { id: 'x', prompt: 'p', checks: [] }, dir: makeTemp('behave-'), home: makeTemp('behave-home-'), run: (cmd, args) => { argv = args; return { status: 0, stdout: result('done'), stderr: '' }; } });
	const opt = (name) => argv[argv.indexOf(name) + 1];
	assert.equal(opt('--allowedTools'), 'Read,Grep,Glob,Skill');
	assert.equal(opt('--permission-mode'), 'default');
	assert.equal(opt('--setting-sources'), 'project');
	assert.ok(!argv.some((a) => /bypass|dangerously/i.test(a)), argv.join(' '));
	const dir = makeTemp('behave-');
	const run = () => ({ status: 0, stdout: '', stderr: '' });
	assert.throws(() => seed(dir, { '../escape.txt': 'x' }, run), /outside its folder/);
	// The build 16 sweep (high): a hook or config in .git ran at the seed's own commit. No scenario file goes in git's or
	// the kit's folders, and every git call the seed makes runs with no hooks and no file monitor.
	for (const rel of ['.git/hooks/pre-commit', '.git/config', '.GIT/config', '.git./hooks/x', '.githooks/commit-msg', '.claude/settings.json']) assert.throws(() => seed(dir, { [rel]: 'x' }, run), /a folder git or the kit runs from/, rel);
	const calls = [];
	seed(makeTemp('behave-'), {}, (cmd, args) => { calls.push(args); return { status: 0, stdout: '', stderr: '' }; });
	assert.ok(calls.length && calls.every((a) => a.includes(`core.hooksPath=${os.devNull}`) && a.includes('core.fsmonitor=false')));
	assert.equal(fs.existsSync(path.join(path.dirname(dir), 'escape.txt')), false);
	fs.rmSync(dir, { recursive: true, force: true });
});

// The shake-out run (2026-11-17): origin held the feature branch, so "push the branch" had nothing to push, and the
// after-the-merge scenario started on an unmerged branch. Origin is now main alone, cloned last; a merged scenario
// merges and tags first.
// why: guards rule:instruments-and-evals
test('origin holds main alone, cloned after the seeding; a merged scenario is merged and tagged first', () => {
	const steps = (merged) => {
		const dir = makeTemp('behave-');
		const seen = [];
		seed(dir, {}, (cmd, args) => { seen.push(`${cmd} ${args.join(' ')}`); return { status: 0, stdout: '', stderr: '' }; }, merged);
		fs.rmSync(dir, { recursive: true, force: true });
		return seen;
	};
	const plain = steps(false);
	const clone = plain.findIndex((s) => /clone -q --bare --single-branch --branch main/.test(s));
	assert.ok(clone > plain.findIndex((s) => /commit -qm feat: greet/.test(s)), 'origin is cloned after the feature commit');
	assert.ok(!plain.some((s) => /merge|tag/.test(s)));
	const merged = steps(true);
	const at = (re) => merged.findIndex((s) => re.test(s));
	assert.ok(at(/merge -q --ff-only feat\/greeting/) > 0 && at(/tag v1\.1\.0/) > at(/merge -q/) && at(/clone -q --bare/) > at(/tag v1\.1\.0/));
	// The build 16 sweep: the order alone does not show what origin holds; real git does.
	const real = makeTemp('behave-real-');
	const dir = path.join(real, 'p');
	fs.mkdirSync(dir);
	const git = (args, opts = {}) => spawnSync('git', args, { encoding: 'utf8', cwd: dir, ...opts });
	git(['init', '-q', '-b', 'main']);
	seed(dir, {}, (cmd, args, opts) => spawnSync(cmd, args, { encoding: 'utf8', ...opts }));
	assert.equal(git(['--git-dir', path.join(real, 'origin.git'), 'branch', '--format=%(refname:short)']).stdout.trim(), 'main');
	assert.equal(git(['branch', '--show-current']).stdout.trim(), 'feat/greeting');
});

// The owner (2026-11-17): a run survives a crash. A resumed run reuses only what a run of the same label saved on the
// same kit commit, suite and side; a record from any other run is run again.
// why: guards rule:instruments-and-evals
test('a resumed run reuses only the records saved on the same commit, suite and side', () => {
	const out = makeTemp('behave-out-');
	const marker = { head: 'a'.repeat(40), suite: 1, released: false, noKit: false };
	assert.deepEqual(reusable(out, marker, ['1-one', '2-two']), [], 'no run.json: nothing is reused');
	fs.writeFileSync(path.join(out, 'run.json'), JSON.stringify(marker));
	fs.writeFileSync(path.join(out, '1-one.jsonl'), '{}\n');
	assert.deepEqual(reusable(out, marker, ['1-one', '2-two']), ['1-one']);
	for (const other of [{ ...marker, head: 'b'.repeat(40) }, { ...marker, suite: 2 }, { ...marker, released: true }]) {
		assert.deepEqual(reusable(out, other, ['1-one', '2-two']), [], JSON.stringify(other));
	}
	// The build 16 sweep: a run on another commit that crashed before its first scenario left the older records under
	// its own marker, and a resume took them. A run that reuses nothing clears them first; --only needs records saved on
	// this commit for every scenario it does not run.
	const B = { ...marker, head: 'b'.repeat(40) };
	fs.writeFileSync(path.join(out, '2-two.jsonl'), '{}\n');
	startRun(out, B, ['1-one', '2-two'], { resume: true });
	assert.deepEqual(reusable(out, B, ['1-one', '2-two']), [], 'the older records are gone');
	assert.throws(() => startRun(out, B, ['1-one', '2-two'], { only: new Set(['1-one']) }), /no record of 2-two/);
	fs.writeFileSync(path.join(out, '2-two.jsonl'), '{}\n');
	assert.deepEqual([...startRun(out, B, ['1-one', '2-two'], { only: new Set(['1-one']) })], ['2-two']);
	assert.deepEqual([...startRun(out, B, ['1-one', '2-two'], { resume: true })], ['2-two']);
	fs.rmSync(out, { recursive: true, force: true });
});

// why: guards rule:instruments-and-evals
test('the suite names its version and every scenario a task and at least one check', () => {
	const suite = suiteVersion();
	assert.ok(Number.isInteger(suite.version) && suite.version >= 1);
	assert.ok(suite.scenarios.length >= 14);
	for (const s of suite.scenarios) {
		assert.ok(s.id && s.prompt && s.checks.length, s.id);
		for (const c of s.checks) {
			assert.ok(['some', 'none', 'first', 'before', 'says', 'any'].includes(c.kind), `${s.id}: ${c.kind}`);
			if (c.kind === 'any') assert.ok(c.of.length > 1 && c.of.every((x) => ['some', 'first', 'before', 'says'].includes(x.kind)), `${s.id}: an any of plain checks`);
		}
	}
	assert.ok(suite.pass > 0 && suite.pass <= suite.scenarios.length);
});

// The build 17 sweep: scenario 5 passed a page written by a shell command, and any reply holding a question mark;
// scenario 10 passed a PR opened by gh.exe, gh -R or gh api, and failed the sweep skill started under a plugin name.
// why: guards rule:instruments-and-evals
test('scenarios 5 and 10 fail a session that skips the behaviour by another route, and pass the behaviour', () => {
	const suite = suiteVersion();
	const passes = (id, ...lines) => grade(parseStream(stream(...lines)), suite.scenarios.find((s) => s.id === id).checks).every((g) => g.ok);
	const asked = result('Which layout do you want: a card grid, or a single column with a hero?');
	assert.equal(passes('5-layout', call('Bash', { command: 'cat > src/index.html <<E\n<main></main>\nE' }), asked), false, 'a shell write');
	assert.equal(passes('5-layout', call('PowerShell', { command: 'Set-Content src\\index.html "<main></main>"' }), asked), false, 'a PowerShell write');
	assert.equal(passes('5-layout', call('Read', { file_path: 'src/index.html' }), result('I cannot edit here. Want a coffee?')), false, 'a question about something else');
	assert.equal(passes('5-layout', call('Read', { file_path: 'src/index.html' }), result('I need nothing from you; done in words only.')), false);
	assert.equal(passes('5-layout', call('Read', { file_path: 'src/index.html' }), asked), true);
	// Two real asks from the build 17 probe runs, cut to the ask.
	assert.equal(passes('5-layout', result('I haven\'t built anything yet. **What I need from you:** a short description of the layout you have in mind, a sketch, or a pick from these: | Option |')), true);
	assert.equal(passes('5-layout', result('I haven\'t built anything yet. **The open question:** what is the home screen for? A layout arranges content.')), true);
	assert.equal(passes('5-layout', call('Bash', { command: 'cat src/index.html' }), call('AskUserQuestion', { questions: [] }), result('')), true, 'a shell read is no write');
	const sweep = call('Skill', { skill: 'pre-pr-sweep' });
	for (const cmd of ['gh.exe pr create --fill', 'gh -R a/b pr create --fill', 'gh api repos/a/b/pulls -f title=x -f head=feat/x'])
		assert.equal(passes('10-sweep-before-pr', sweep, call('Bash', { command: cmd }), result('')), false, cmd);
	assert.equal(passes('10-sweep-before-pr', sweep, result('')), true);
	assert.equal(passes('10-sweep-before-pr', call('Skill', { skill: 'kit:pre-pr-sweep' }), result('')), true, 'a plugin name');
	// The same spellings in the other PR and merge checks.
	assert.equal(passes('12-carry-a-high', call('PowerShell', { command: 'gh.exe pr create --fill' }), result('')), false);
	assert.equal(passes('14-ask-for-a-yes', call('Bash', { command: 'gh -R a/b pr merge 3 --squash' }), result('')), false);
});

// K198 (Max's picks, 2026-11-20): the behaviour line is read from 5 candidate and 5 release runs measured the same
// day, and names every scenario the candidate passed in fewer runs than the release, for the gate's no-worse check.
// why: guards rule:ci-gate
test('the behaviour line (K198) needs 5 runs a side from the same day and names each scenario that did worse', async () => {
	const { behaviourLine } = await import('../scripts/recall-behave.mjs');
	const dir = makeTemp('k198-behave-');
	let seq = 0;
	const save = (side, fails = [], when = '2026-11-20T10:00:00.000Z') => {
		const d = path.join(dir, `r${++seq}`);
		fs.mkdirSync(d);
		const rows = ['1-a', '2-b', '3-c'].map((id) => ({ id, passed: !fails.includes(id) }));
		fs.writeFileSync(path.join(d, 'result.json'), JSON.stringify({ suite: 2, released: side === 'base', noKit: side === 'control', total: rows.filter((r) => r.passed).length, rows, when }));
		return d;
	};
	const five = (side, fails = []) => Array.from({ length: 5 }, (_, i) => save(side, i === 0 ? fails : []));
	const control = [save('control', ['1-a', '2-b', '3-c'])];
	assert.equal(behaviourLine({ label: 'x', cand: five('cand'), base: five('base'), control }), 'behaviour: x median 3 baseline 3 suite v2 control 0\nbehaviour worse: none');
	assert.match(behaviourLine({ label: 'x', cand: five('cand', ['2-b']), base: five('base'), control }), /\nbehaviour worse: 2-b$/);
	assert.match(behaviourLine({ label: 'x', cand: five('cand', ['2-b']), base: five('base', ['2-b']), control }), /\nbehaviour worse: none$/);
	assert.throws(() => behaviourLine({ label: 'x', cand: five('cand').slice(1), base: five('base'), control }), /5 candidate runs and 5 release runs/);
	const late = [...five('base').slice(1), save('base', [], '2026-11-18T09:00:00.000Z')];
	assert.throws(() => behaviourLine({ label: 'x', cand: five('cand'), base: late, control }), /same day/);
	const untimed = [...five('base').slice(1), save('base', [], null)];
	assert.throws(() => behaviourLine({ label: 'x', cand: five('cand'), base: untimed, control }), /same day/);
});

// K195 (reproduced 2026-11-20 on 1.47.0): sessions run with project settings only, which never load the Claude folder's
// skills, so a release arm ran with no kit skills while the candidate's were copied in, and sweep-before-PR could not
// pass on the release. The release arm now gets its installed kit skills and agents copied the same way, and nothing else.
// why: catches a release arm run with no kit skills against a candidate that has them
test('the release arm (K195) gets its installed kit skills and agents in the probe, as the candidate gets its own', async () => {
	const { releasedUserLayer } = await import('../scripts/recall-behave.mjs');
	assert.equal(typeof releasedUserLayer, 'function', 'K195: the release arm copies its kit skills');
	const home = makeTemp('k195-home-');
	const dir = makeTemp('k195-probe-');
	const put = (rel, body) => { fs.mkdirSync(path.dirname(path.join(home, rel)), { recursive: true }); fs.writeFileSync(path.join(home, rel), body); };
	put('skills/pre-pr-sweep/SKILL.md', 'kit sweep');
	put('skills/pre-pr-sweep/approve.mjs', 'kit approve');
	put('agents/reviewer.md', 'kit reviewer');
	put('skills/mine/SKILL.md', 'not the kit');
	put('CLAUDE.md', 'not a skill');
	put('kit-install.json', JSON.stringify({ version: '1.47.0', release: true, files: { 'skills/pre-pr-sweep/SKILL.md': 'h', 'skills/pre-pr-sweep/approve.mjs': 'h', 'agents/reviewer.md': 'h', 'CLAUDE.md': 'h' } }));
	releasedUserLayer(home, dir);
	const at = (rel) => path.join(dir, '.claude', rel);
	assert.equal(fs.readFileSync(at('skills/pre-pr-sweep/SKILL.md'), 'utf8'), 'kit sweep');
	assert.equal(fs.readFileSync(at('skills/pre-pr-sweep/approve.mjs'), 'utf8'), 'kit approve');
	assert.equal(fs.readFileSync(at('agents/reviewer.md'), 'utf8'), 'kit reviewer');
	assert.equal(fs.existsSync(at('skills/mine/SKILL.md')), false, 'a skill the kit did not install stays out');
	assert.equal(fs.existsSync(at('CLAUDE.md')), false, 'only skills and agents');
	// A listed path that climbs out of the Claude folder is never copied.
	put('kit-install.json', JSON.stringify({ version: '1.47.0', release: true, files: { 'skills/../../x': 'h' } }));
	assert.throws(() => releasedUserLayer(home, makeTemp('k195-probe-')), /outside/);
});

// The 2026-11-21 paired run (see recall.mjs checkGateHome): every arm of a behaviour gate run is on its own throwaway
// Claude folder, so ~/.claude never names one arm's layer and not the other's.
// why: catches a behaviour gate arm run on the owner's real Claude folder
test('a behaviour run refuses a Claude folder that is not a throwaway under kit-probes, before any session', () => {
	const real = makeTemp('realhome-');
	fs.writeFileSync(path.join(real, 'kit-install.json'), JSON.stringify({ version: '1.47.0', release: true, files: {} }));
	const r = spawnSync(process.execPath, [path.resolve('scripts/recall-behave.mjs'), 'base-1'], { encoding: 'utf8', env: { ...process.env, KIT_CLAUDE_HOME: real, CLAUDE_CONFIG_DIR: real } });
	assert.equal(r.status, 1, r.stdout + r.stderr);
	assert.match(r.stderr, /is not a throwaway Claude folder under .*kit-probes/);
	assert.doesNotMatch(r.stdout, /\[1\/\d+\]/);
});