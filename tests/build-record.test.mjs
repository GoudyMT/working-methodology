// T15 D5 (the owner's lock, 2026-11-12): one build record writes the changelog entry and the PR body, so the two never
// tell different stories, and a record that is not whole cannot write either.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import kitTemp from '../project/.claude/kit-temp.cjs';
import { problems, changelog, prBody, notes, checkRepo } from '../scripts/build-record.mjs';

kitTemp.sessionRoot();
const record = () => ({
	version: '1.2.0', date: '2026-11-12', level: 'minor', area: 'Test value', title: 'feat: tests say why they are kept',
	headline: 'Every test names what it guards.',
	items: [
		{ id: 'T1', kind: 'changed', text: 'Each test carries a why line.', evidence: 'tests/x.test.mjs', where: 'tests', before: 'no reason', after: 'a why line' },
		{ id: 'S1', kind: 'security', text: 'A PR cannot choose its own map.', evidence: 'commit abc1234' },
		{ id: 'T2', kind: 'added', text: 'A test check.', evidence: 'scripts/test-check.mjs' },
	],
	decisions: [{ decision: 'One record', why: 'the changelog and the body never differ' }],
	verification: ['Every test passed in CI.'],
	sweep: { tier: 'Feature', commit: 'abc1234', dimensions: [{ name: 'Code security', result: 'clean' }], findings: { critical: 0, high: 1, medium: 2, low: 0 },
		fixes: [{ id: 'F1', severity: 'high', text: 'one high, fixed here', commit: 'abc1234', test: 'tests/x.test.mjs::a' }, { id: 'F2', severity: 'low', text: 'one low, a parser edge', commit: 'abc1235', test: 'no test: no real input' }] },
	tests: { before: 10, after: 8 },
});

// why: guards rule:pr-body (outward text is ASCII, its title is type: subject within 72 characters, and every item
// shows its evidence): a record that breaks one cannot write the changelog or the body.
test('a build record that is not whole names each gap, and an ASCII-clean whole one has none', () => {
	assert.deepEqual(problems(record()), []);
	const bad = record();
	bad.items[0].kind = 'tweaked';
	delete bad.items[1].evidence;
	bad.title = 'Tests say why';
	bad.headline = `Every test ${String.fromCharCode(0x2014)} names it.`;
	delete bad.sweep.findings.low;
	const found = problems(bad).join('\n');
	for (const gap of [/item 1 kind "tweaked"/, /item 2 \(S1\) has no evidence/, /title is not "type: subject"/, /non-ASCII character \(code 8212\)/, /no low count/]) assert.match(found, gap);
});

// why: catches a changelog and a PR body that drift from the record they are written from.
test('the record writes the changelog in kind order and the PR body with its summary row and review', () => {
	const log = changelog(record());
	assert.equal(log.split('\n')[0], '## 1.2.0 - 2026-11-12');
	assert.ok(log.indexOf('### Added') < log.indexOf('### Changed') && log.indexOf('### Changed') < log.indexOf('### Security'), log);
	const body = prBody(record());
	// pin: 1 (the H1 the PR-body audit reads as <Area>: <title subject>)
	assert.equal(body.split('\n')[0], '## Test value: tests say why they are kept');
	assert.ok(body.includes('| tests | no reason | a why line |'), body);
	assert.ok(!body.includes('| A PR cannot'), 'an item with no where got a summary row');
	assert.match(body, /\*\*High and critical findings:\*\* 1, each fixed here[\s\S]*one high, fixed here/);
	assert.match(body, /Tests: 10 before, 8 after/);
});

// why: guards rule:release-notes: CI holds a PR that moves VERSION to its record. pin: 1 (GitHub reads these lines)
test('CI checks the build record on every PR that moves VERSION', () => {
	const ci = fs.readFileSync(path.resolve('.github/workflows/ci.yml'), 'utf8');
	const step = ci.split('- name: Build record\n')[1].split('- name:')[0];
	// The build 17 sweep: the base commit's copy of the record check runs, reading this PR's tree.
	assert.match(step, /if git diff --quiet "\$PR_BASE" HEAD -- VERSION; then .*; else KIT_RECORD_ROOT=\. node "\$B" check; fi/); // pin: 1
	assert.match(step, /B="\$RUNNER_TEMP\/base\/scripts\/build-record\.mjs"/);
	// The build 14 sweep: a PR that left VERSION alone had no fix ledger read, so a guard fix could ship with no row. A
	// change install reads now owes the bump, by the base's own rule.
	// pin: 1 (GitHub runs these lines)
	assert.match(step, /git show "\$PR_BASE:scripts\/pr-scope\.mjs" > "\$RUNNER_TEMP\/pr-scope\.mjs"/);
	assert.match(step, /node "\$RUNNER_TEMP\/pr-scope\.mjs" --install "\$PR_BASE"[^\n]*install=false[^\n]*exit 1/);
	// K105: the same PR's fix ledger is read by the test check, which states each named test's verdict.
	const check = ci.split('- name: Test check\n')[1].split('- name:')[0];
	assert.match(check, /if ! git diff --quiet "\$BASE_SHA" HEAD -- VERSION; then record=\(--record "docs\/builds\/\$\(tr -d '\\r\\n' < VERSION\)\.json"\); fi/); // pin: 1
	// K128 (build 17): the base commit's copy of the check runs.
	assert.match(check, /test-check\.mjs" "\$BASE_SHA" [^\n]*"\$\{record\[@\]\}"/);
	// K24 (the owner, 2026-11-17): the check is a gate, so a finding fails the job.
	assert.match(check, /test-check\.mjs" "\$BASE_SHA" --strict /);
});

// why: guards rule:release-notes (the changelog a release ships is the one its record writes, for the version it names).
test('the repo check fails when VERSION, the record and the top changelog entry disagree', () => {
	const dir = kitTemp.makeTemp('record-');
	fs.mkdirSync(path.join(dir, 'docs', 'builds'), { recursive: true });
	fs.writeFileSync(path.join(dir, 'VERSION'), '1.2.0\n');
	fs.writeFileSync(path.join(dir, 'docs', 'builds', '1.2.0.json'), JSON.stringify(record()));
	fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), `# Changelog\n\n${changelog(record())}\n## 1.1.0 - 2026-11-01\n\nOld.\n`);
	assert.deepEqual(checkRepo(dir).problems, []);
	fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), `# Changelog\n\n${changelog(record()).replace('A test check.', 'A check.')}`);
	assert.match(checkRepo(dir).problems.join('\n'), /top CHANGELOG\.md entry.*record writes/);
	fs.writeFileSync(path.join(dir, 'VERSION'), '1.3.0\n');
	assert.match(checkRepo(dir).problems.join('\n'), /cannot read docs[\\/]builds[\\/]1\.3\.0\.json/);
});

// why: guards rule:pr-body. K15, the 1.27.0 build: the body the record wrote failed the PR body audit (line length,
// AI words, too many verification bullets, a dimension missing), so it was fitted by hand. Now a record either names
// what the audit would fail, or writes a body that passes it.
test('a whole record writes a PR body that passes the audit, and one that would fail names why', () => {
	const real = problems(JSON.parse(fs.readFileSync(path.resolve('docs/builds/1.27.0.json'), 'utf8'))).join('\n');
	for (const gap of [/mechanism or AI word/, /spaced dash/, /over 240 characters/, /verification has more than 3/]) assert.match(real, gap);
	const rec = record();
	rec.headline = `${'Every kit test now names the rule it guards, and the ones that guarded nothing new are gone. '.repeat(3)}`.trim();
	rec.items[0].text = 'Each test carries a why line naming the rule it guards, read by a script that holds new tests to the same bar. '.repeat(2).trim();
	rec.verification = ['Every test passed in CI on Linux and Windows, and the install check passed on both.', 'The mutation check ran.', 'The planted cases held.'];
	rec.sweep.dimensions = [{ name: 'Code security', result: 'clean' }];
	assert.deepEqual(problems(rec), []);
	const dir = kitTemp.makeTemp('recbody-');
	const f = path.join(dir, 'body.md');
	fs.writeFileSync(f, prBody(rec));
	const r = spawnSync(process.execPath, [path.resolve('project/.claude/pr-body-audit.mjs'), f, rec.title, '31'], { encoding: 'utf8', cwd: dir });
	assert.equal(r.status, 0, r.stdout.split('\n').filter((l) => l.startsWith('FAIL')).join('\n'));
});
// why: guards the owner's pick of E14, 2026-11-15; catches release notes drafted by hand that drift from the record (E14, 1.35.0): the notes are written from the
// same record, split by reach, and pass the release-notes audit as written.
test('the record writes release notes that split what projects get from what stays in the kit, and pass the audit', () => {
	const rec = record();
	rec.alignment = 'v1.2.0 is the test value step.';
	rec.items[2].reach = 'kit';
	rec.upgrading = 'Run install user first, then install project in each project.';
	rec.limits = 'A test with no why line still runs.';
	const text = notes(rec);
	const lines = text.split('\n');
	assert.equal(lines[0], '# Methodology Kit v1.2.0');
	assert.ok(text.indexOf('## What changed for projects') < text.indexOf('- Each test carries a why line.'), text);
	assert.ok(text.indexOf('## What changed in the kit itself') < text.indexOf('- A test check.'), text);
	assert.ok(text.indexOf('- A test check.') > text.indexOf('- A PR cannot choose its own map.'), 'a kit-only item is not listed for projects');
	assert.match(text, /^A minor release\. v1\.2\.0 is the test value step\.$/m);
	assert.match(text, /^## Upgrading\n\nRun install user first/m);
	assert.match(text, /^Known limits: .*no why line/m);
	const file = path.join(kitTemp.makeTemp('notes-'), 'notes.md');
	fs.writeFileSync(file, text);
	const audit = spawnSync(process.execPath, [path.resolve('user/skills/release-notes/audit.mjs'), file, '1.2.0'], { encoding: 'utf8', cwd: path.dirname(file) });
	assert.equal(audit.status, 0, audit.stdout + audit.stderr);
	const kitOnly = record();
	kitOnly.items.forEach((it) => { it.reach = 'kit'; });
	assert.doesNotMatch(notes(kitOnly), /What changed for projects/);
	const bad = record();
	bad.items[0].reach = 'everyone';
	assert.match(problems(bad).join('\n'), /reach "everyone"/);
});

// K109 (1.40.0 verify): an item with no reach was filed under projects, so the kit-only why-line format reached the
// 1.40.0 notes as a project change. From 1.41.0 each item says its reach; older records need not (1.40.0's why-line row was set by hand).
// why: catches a build record item filed under projects by a missing reach (K109)
test('from 1.41.0 every record item states its reach, projects or kit', () => {
	const rec = record();
	rec.version = '1.41.0';
	rec.items.forEach((it) => { it.reach = 'projects'; });
	assert.deepEqual(problems(rec), []);
	delete rec.items[2].reach;
	assert.match(problems(rec).join('\n'), /item 3 \(T2\) names no reach/);
	assert.deepEqual(problems(record()), [], 'a record before 1.41.0 may leave reach out');
	rec.version = '2.0.0';
	assert.match(problems(rec).join('\n'), /names no reach/, 'the series to 2.0.0 keeps the rule');
});

// K139 (build 18, seen on PR 53): a record with no item naming a where wrote a Summary of a header and no rows, and
// both the record check and the PR body audit passed it.
// why: catches a PR body whose Summary table is empty passing the record check and the PR body audit
test('from 1.44.0 a record needs a Where row, and the PR body audit refuses a Summary with no rows', () => {
	const rec = record();
	rec.version = '1.44.0';
	rec.items.forEach((it) => { it.reach = 'kit'; });
	assert.deepEqual(problems(rec), []);
	delete rec.items[0].where;
	assert.match(problems(rec).join('\n'), /no item names a where/);
	const old = record();
	delete old.items[0].where;
	assert.deepEqual(problems(old), [], 'a record before 1.44.0 keeps its old rule');
	const dir = kitTemp.makeTemp('recsummary-');
	const f = path.join(dir, 'body.md');
	fs.writeFileSync(f, prBody(old));
	for (const audit of ['project/.claude/pr-body-audit.mjs', 'user/kit-tools/audits/pr-body-audit.mjs']) {
		const r = spawnSync(process.execPath, [path.resolve(audit), f, old.title, '31'], { encoding: 'utf8', cwd: dir });
		assert.match(r.stdout, /FAIL\s+Summary is a before \/ after table/, audit);
	}
	// The build 18 sweep: a body with CRLF line ends and a space after a row's last bar still has its rows.
	fs.writeFileSync(f, prBody(rec.version ? record() : old).replace(/\|\n/g, '| \n').replace(/\n/g, '\r\n'));
	for (const audit of ['project/.claude/pr-body-audit.mjs', 'user/kit-tools/audits/pr-body-audit.mjs']) {
		const r = spawnSync(process.execPath, [path.resolve(audit), f, old.title, '31'], { encoding: 'utf8', cwd: dir });
		assert.match(r.stdout, /PASS\s+Summary is a before \/ after table/, audit);
	}
});

// K96 (build 12, reproduced on the 1.37.0 draft): the record check reads a dash only in prose, outside code spans, so
// it passed a line quoting `approve.mjs --tap "<act>"`, and the notes audit then failed that draft on its double
// hyphen; the live line was reworded by hand. A flag in code is code, in the notes as in the record; prose is still held.
// why: catches release notes the record writes that the notes audit then refuses
test('a record line that quotes a command with a --flag writes notes the audit passes; a prose double hyphen still fails', () => {
	const rec = record();
	rec.items[0].text = 'A tap check, `approve.mjs --tap "<act>"`, reads a Yes before the owner is handed a command.';
	assert.deepEqual(problems(rec), []);
	const dir = kitTemp.makeTemp('notes-');
	const audit = (text) => { const f = path.join(dir, 'notes.md'); fs.writeFileSync(f, text); return spawnSync(process.execPath, [path.resolve('user/skills/release-notes/audit.mjs'), f, '1.2.0'], { encoding: 'utf8', cwd: dir }); };
	const r = audit(notes(rec));
	assert.equal(r.status, 0, r.stdout + r.stderr);
	assert.equal(audit(`${notes(rec)}\n\n\`\`\`bash\nnode scripts/kit.mjs install project --dry-run\n\`\`\`\n`).status, 0, 'a flag in a code block failed');
	assert.match(audit(`${notes(rec)}\nUpgrading is quick -- run install.\n`).stdout, /double hyphen/);
	assert.match(audit(`${notes(rec)}\nRun \`install\` -- then check.\n`).stdout, /double hyphen/);
	// The sweep: read as CommonMark reads fences and spans, so no line turns the rest of the notes into code.
	const dashes = (tail) => (audit(`${notes(rec)}\n${tail}`).stdout.match(/double hyphen/g) || []).length;
	assert.equal(dashes('```x``` names the key -- in prose.\n\nLater prose -- another dash.\n'), 2, 'an inline span read as a fence');
	assert.equal(dashes('~~~md\n```js\n~~~\n\nLater prose -- a dash.\n'), 1, 'a backtick line closed a tilde fence');
	assert.equal(dashes('````md\n```js\n````\n\nLater prose -- a dash.\n'), 1, 'a shorter fence closed a longer one');
	assert.equal(dashes('Text.\n\n    ```\n\nLater prose -- a dash.\n'), 1, 'an indented block read as a fence');
	assert.equal(dashes('Press the ` key -- then the `` key.\n'), 1, 'runs of two lengths read as a span');
	assert.equal(dashes('~~~\nnode x --flag\n~~~\n'), 0, 'a flag in a tilde fence');
});

// K102 (build 13, reproduced on the installed 1.38.0 audit): the record check reads its tool words outside code
// spans, but the notes audit read them everywhere, so a line naming `.claude/loop-state.json` passed the record and
// failed the notes as "AI or tool reference"; the 1.38.0 line was reworded by hand. Same class as K96.
// why: catches release notes the record writes that the notes audit then refuses on a path in code
test('a record line that names a .claude path in code writes notes the audit passes; a tool word in prose still fails', () => {
	const rec = record();
	rec.items[0].text = 'The loop keeps its state in `.claude/loop-state.json`, beside the bounds file.';
	assert.deepEqual(problems(rec), []);
	const dir = kitTemp.makeTemp('notes-');
	const audit = (text) => { const f = path.join(dir, 'notes.md'); fs.writeFileSync(f, text); return spawnSync(process.execPath, [path.resolve('user/skills/release-notes/audit.mjs'), f, '1.2.0'], { encoding: 'utf8', cwd: dir }); };
	const r = audit(notes(rec));
	assert.equal(r.status, 0, r.stdout + r.stderr);
	assert.equal(audit(`${notes(rec)}\n\n\`\`\`bash\nnode ~/.claude/kit-tools/use-check.mjs\n\`\`\`\n`).status, 0, 'a .claude path in a code block failed');
	const tools = (tail) => (audit(`${notes(rec)}\n${tail}`).stdout.match(/AI or tool reference/g) || []).length;
	assert.equal(tools('Claude wrote the loop.\n'), 1, 'a tool word in prose passed');
	assert.equal(tools('Run `install` with Claude beside it.\n'), 1, 'a tool word beside a span passed');
	assert.equal(tools('This was drafted by an agent.\n'), 1, 'how-it-was-made phrasing passed');
	assert.equal(tools('```x``` names it; Claude helped.\n'), 1, 'an inline span read as a fence hid prose');
	// The build 13 sweep: K102 lets a path through, not a tool name: the page shows code too, so a tool named in a span or
	// a fence still fails, and a span wrapped onto the next line hides no prose.
	assert.equal(tools('This release was made with `Claude Code`.\n'), 1, 'a tool name in a span');
	assert.equal(tools('Every change here was `generated by AI`.\n'), 1, 'how it was made, in a span');
	assert.equal(tools('```\nGenerated with Claude Code\n```\n'), 1, 'a tool name in a fence');
	assert.equal(tools('Paths read as code, such as `docs/builds/x.json\nand .kit/y.json`; Claude wrote it, see `kit.mjs`.\n'), 1, 'prose after a wrapped span');
	assert.equal(tools('Run `node ~/.claude/kit-tools/use-check.mjs` or open .claude/bounds.json.\n'), 0, 'paths, in code and in prose');
	assert.equal(tools('Status flags a `claude` command older than 2.1.325.\n'), 0, 'a program name in code (the 1.36.0 notes)');
	assert.equal(tools('Status flags a claude command older than 2.1.325.\n'), 1, 'the same word in prose');
	const dashes = (tail) => (audit(`${notes(rec)}\n${tail}`).stdout.match(/double hyphen/g) || []).length;
	assert.equal(dashes('See `docs/builds/x.json\nand y.json` -- then `kit.mjs`.\n'), 1, 'a dash after a wrapped span');
});

// The build 13 sweep: the PR body audit now reads the tier at the start of the review line, and a record could write a
// tier it fails ("Deep sweep"), against the record's promise that it cannot write a body the audit fails.
// why: catches a build record whose PR body the audit would refuse on its sweep tier
test('a record names a sweep tier the PR body audit reads, with modifiers only in a parenthesis', () => {
	for (const tier of ['Feature', 'Fix (security-sensitive)', 'Triage']) {
		const rec = record();
		rec.sweep.tier = tier;
		assert.deepEqual(problems(rec), [], tier);
	}
	for (const tier of ['Deep sweep', 'Light check', 'Feature, security-sensitive']) {
		const rec = record();
		rec.sweep.tier = tier;
		assert.match(problems(rec).join('\n'), /sweep tier/, tier);
	}
});

// why: guards the owner's pick of E14, 2026-11-15: the notes command prints the draft, and its upgrading and limits
// lines are held to the same prose rules as the rest of the record.
test('build-record notes prints the draft, and the upgrading and limits lines are audited as prose', () => {
	const bad = record();
	bad.limits = 'Written with Claude -- fast.';
	assert.match(problems(bad).join('\n'), /mechanism or AI word|spaced dash/);
	const dir = kitTemp.makeTemp('notes-cli-');
	fs.mkdirSync(path.join(dir, 'docs', 'builds'), { recursive: true });
	const rec = record();
	fs.writeFileSync(path.join(dir, 'docs', 'builds', 'r.json'), JSON.stringify(rec));
	const r = spawnSync(process.execPath, [path.resolve('scripts/build-record.mjs'), 'notes', path.join(dir, 'docs', 'builds', 'r.json')], { encoding: 'utf8' });
	assert.equal(r.status, 0, r.stderr);
	assert.equal(r.stdout, notes(rec));
	assert.match(r.stdout, /^## Upgrading\n\nRun `install user` first/m, 'the default upgrading line');
});

// K105 (build 13, PR 49): the PR said each finding had a test that fails first, and nothing checked it; six low or
// medium parser edges got tests only because every fix needed one. The fix ledger is now rows in the record: a high,
// critical, security or owner-rule fix names its test, a low or medium may say no real input shows it, and the body's
// fix line is written from the rows, never typed.
// why: guards rule:test-value
test('the fix ledger needs a test for a high, critical, security or owner fix, and the body counts it from the rows', () => {
	assert.deepEqual(problems(record()), []);
	const body = prBody(record());
	assert.match(body, /one high, fixed here\..*abc1234, with a named test\./);
	const gap = (edit) => { const r = record(); edit(r); return problems(r).join('\n'); };
	assert.match(gap((r) => { r.sweep.fixes[0].test = 'no test: no real input'; }), /fix F1 \(high\) names no test/);
	assert.match(gap((r) => { r.sweep.fixes[1].security = true; }), /fix F2 \(low, security\) names no test/);
	assert.match(gap((r) => { r.sweep.fixes[1].test = 'none'; }), /fix F2 test "none".*not a test key.*"no test: no real input"/);
	assert.match(gap((r) => { r.verification = ['Each sweep finding has a test that fails first.']; }), /fix-test claim.*written from sweep\.fixes/);
	assert.match(gap((r) => { delete r.sweep.fixes; }), /sweep has no fixes list/);
	assert.match(gap((r) => { r.sweep.fixes = []; }), /1 high or critical finding\(s\).*0 high or critical fix row/);
});

// The build 14 sweep: an accepted line of any severity hid a high fix row, a flag typed as a string read as false, a
// guard-file fix could be typed medium with no test, the body named test keys the PR body audit then failed, and a
// line about the auto-fix push read as a typed fix-test claim.
// why: guards rule:test-value
test('the fix ledger counts only accepted highs, takes flags as booleans, and writes body lines the audit passes', () => {
	const gap = (edit) => { const r = record(); edit(r); return problems(r).join('\n'); };
	assert.match(gap((r) => { r.sweep.fixes[0].severity = 'medium'; r.sweep.fixes[0].test = 'no test: no real input'; r.sweep.accepted = ['A low wording nit, accepted by the owner']; }), /1 high or critical finding\(s\).*0 high or critical fix row/);
	assert.equal(gap((r) => { r.sweep.fixes.shift(); r.sweep.accepted = ['High: the probe log keeps a path; accepted by the owner']; }), '');
	assert.match(gap((r) => { r.sweep.fixes[1].security = 'true'; }), /fix F2 security is not true or false/);
	assert.match(gap((r) => { r.sweep.fixes[0].text = 'x'.repeat(220); }), /fix F1 writes a body line over 240 characters/);
	assert.match(gap((r) => { r.sweep.fixes[1].text = 'the checker brief was wrong'; }), /mechanism or AI word/);
	assert.equal(gap((r) => { r.verification = ['CI is green; the auto-fix run re-ran the covering tests and pushed once.']; }), '');
	const body = prBody(record());
	assert.doesNotMatch(body, /tests\/x\.test\.mjs::a/, 'the body names a test key the audit reads as prose');
	assert.match(body, /Fix tests:\*\* 1 names? a test.*CI's test check.*1 with no test: no real input/);
});

// why: guards rule:test-value (the build 14 sweep: a fix row's commit was never read, so a guard fix typed as medium
// shipped with no test).
test('the repo check reads each fix commit and names a guard file fixed with no test', () => {
	const dir = kitTemp.makeTemp('record-git-');
	const git = (...a) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: dir, encoding: 'utf8' });
	git('init', '-q', '-b', 'main');
	fs.mkdirSync(path.join(dir, 'project', '.claude'), { recursive: true });
	fs.writeFileSync(path.join(dir, 'project', '.claude', 'guard.cjs'), 'x\n');
	git('add', '.'); git('commit', '-qm', 'guard');
	const sha = git('rev-parse', 'HEAD').stdout.trim();
	const rec = record();
	rec.sweep.fixes[1].commit = sha.slice(0, 7);
	rec.sweep.fixes[0].commit = 'deadbee';
	fs.mkdirSync(path.join(dir, 'docs', 'builds'), { recursive: true });
	fs.writeFileSync(path.join(dir, 'VERSION'), '1.2.0\n');
	fs.writeFileSync(path.join(dir, 'docs', 'builds', '1.2.0.json'), JSON.stringify(rec));
	fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), `# Changelog\n\n${changelog(rec)}`);
	const found = checkRepo(dir).problems.join('\n');
	assert.match(found, /fix F2 changes project\/\.claude\/guard\.cjs.*a guard or gate file.*mark it security and name its test/);
	assert.match(found, /fix F1 commit deadbee is not a commit here/);
});

// The build 14 sweep: the body's fix lines were written from the record, but a hand edit after that was read by no
// check. CI's body job now holds them to the record when VERSION moves.
// why: guards rule:pr-body
test('the body check holds the fix lines of a published body to the record', () => {
	const dir = kitTemp.makeTemp('record-body-');
	fs.mkdirSync(path.join(dir, 'docs', 'builds'), { recursive: true });
	fs.writeFileSync(path.join(dir, 'VERSION'), '1.2.0\n');
	fs.writeFileSync(path.join(dir, 'docs', 'builds', '1.2.0.json'), JSON.stringify(record()));
	fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), `# Changelog\n\n${changelog(record())}`);
	const body = path.join(dir, 'body.md');
	const run = () => spawnSync(process.execPath, [path.resolve('scripts/build-record.mjs'), 'body', body], { cwd: dir, encoding: 'utf8', env: { ...process.env, KIT_RECORD_ROOT: dir } });
	fs.writeFileSync(body, prBody(record()).replace(/\n/g, '\r\n'));
	assert.equal(run().status, 0, run().stdout + run().stderr);
	fs.writeFileSync(body, prBody(record()).replace('1 with no test', '0 with no test'));
	const r = run();
	assert.equal(r.status, 1);
	assert.match(r.stderr, /fix lines differ.*build record/);
	// pin: 1 (GitHub runs these lines)
	const job = fs.readFileSync(path.resolve('.github/workflows/pr-body.yml'), 'utf8');
	assert.match(job, /fetch-depth: 0/);
	// K128 (build 17): the base commit's copy matches the body, reading this PR's record.
	assert.match(job, /if git diff --quiet "origin\/\$BASE_REF" HEAD -- VERSION; then [^\n]*; else B="\$RUNNER_TEMP\/base\/scripts\/build-record\.mjs"; [^\n]*KIT_RECORD_ROOT=\. node "\$B" body "\$RUNNER_TEMP\/pr-body\.md"; fi/); // pin: 1
});

// K125 (the owner, 2026-11-17): the build's PR body and its release notes carry the same Visuals section, written once
// in the record by the Visuals script; the record check runs the section's own checks, and CI holds the body's copy to
// the record as it holds the fix lines.
const VISUALS = {
	summary: 'Visuals: the always-loaded rules file 27,609 B to 23,834 B (cap 25,000 B)',
	fold: true,
	body: ['Rules file loads 1,300 fewer tokens at each session start: about $5.20 less per 1,000 sessions at the uncached', 'input price.', '', '```text', 'Rules file, bytes (| = limit 25,000)',
		`before  ${'#'.repeat(36)}|###  27,609`, `after   ${'#'.repeat(35)} |     23,834`, '```', '', '| Metric | Before | After | Change | Limit | Source |', '|---|---|---|---|---|---|',
		'| Rules file | 27,609 B | 23,834 B | -3,775 B (-13.7%) | 25,000 B | measured: bytes at 83ab095 and 1a2b3c4 |',
		'| Rules file: tokens read at each session start | 9,800 | 8,500 | -1,300 (-13.3%) | none | measured: session context report |',
		'| Rules file: cost per 1,000 sessions | $39.20 | $34.00 | -$5.20 (-13.3%) | none | derived: tokens x $4 per million input tokens, uncached (2026-11-03) |',
		'', '**Why each number moved**', '', '- **Rules file:** module text moved to the skills that use it.', '- **Rules file: tokens read at each session start:** follows from the size.',
		'- **Rules file: cost per 1,000 sessions:** follows from the tokens it loads.'].join('\n'),
};
// why: guards rule:pr-body and rule:release-notes
test('a record with Visuals writes them into the PR body and after the notes known limits, checked, and CI holds the copy', () => {
	const rec = { ...record(), limits: 'One known limit.', visuals: VISUALS };
	assert.deepEqual(problems(rec), []);
	const body = prBody(rec);
	assert.match(body, /Version alignment: YES\.[^\n]*\n\n<details>\n<summary>Visuals: the always-loaded rules file 27,609 B to 23,834 B \(cap 25,000 B\)<\/summary>\n\nRules file loads/); // pin: 1
	assert.ok(body.includes(`before  ${'#'.repeat(36)}|###  27,609`), 'the chart is not wrapped');
	const std = path.join(kitTemp.makeTemp('vis-body-'), 'body.md');
	fs.writeFileSync(std, body);
	const audit = spawnSync(process.execPath, [path.resolve('project/.claude/pr-body-audit.mjs'), std, rec.title], { encoding: 'utf8', cwd: path.dirname(std) });
	assert.match(audit.stdout, /PASS +Visuals: numbers, chart and why lines check out +checked/); // pin: 1
	const text = notes(rec);
	assert.ok(text.indexOf('Known limits:') < text.indexOf('## Visuals\n\nRules file loads'), text);
	const file = path.join(kitTemp.makeTemp('vis-notes-'), 'notes.md');
	fs.writeFileSync(file, text);
	const release = spawnSync(process.execPath, [path.resolve('user/skills/release-notes/audit.mjs'), file, '1.2.0'], { encoding: 'utf8', cwd: path.dirname(file) });
	assert.equal(release.status, 0, release.stdout);
	assert.match(problems({ ...rec, visuals: { ...VISUALS, body: VISUALS.body.replace('-3,775 B', '-3,000 B') } }).join('\n'), /Visuals: row 1 \(Rules file\): change is -3,775 B/);
	assert.match(problems({ ...rec, visuals: { ...VISUALS, summary: 'Rules file shrank' } }).join('\n'), /visuals summary is one line/);
	// The Visuals sweep: a summary with a line break hid the fold from every check; a section as visuals.mjs prints it, heading
	// and all, is taken as is; fold false writes the fifth section; fold must be true or false.
	assert.match(problems({ ...rec, visuals: { ...VISUALS, summary: 'Visuals: x\ny', body: 'anything | not checked\n- **x:** <why>' } }).join('\n'), /visuals summary is one line/);
	assert.deepEqual(problems({ ...rec, visuals: { ...VISUALS, body: `<details>\n<summary>Visuals: x</summary>\n\n${VISUALS.body}\n</details>` } }), []);
	assert.deepEqual(problems({ ...rec, visuals: { ...VISUALS, body: `### Visuals\n\n${VISUALS.body}` } }), []);
	const open = { ...rec, visuals: { ...VISUALS, fold: false } };
	assert.match(prBody(open), /Version alignment: YES\.[^\n]*\n\n### Visuals\n\nRules file loads/);
	assert.match(problems({ ...rec, visuals: { ...VISUALS, fold: 'yes' } }).join('\n'), /fold true or false/);
	assert.match(problems({ ...rec, visuals: { ...VISUALS, body: 'Rules file loads less.' } }).join('\n'), /no table with the header/);
	// CI: a body whose Visuals differ from the record's is named, as a fix line is.
	const dir = kitTemp.makeTemp('record-vis-');
	fs.mkdirSync(path.join(dir, 'docs', 'builds'), { recursive: true });
	fs.writeFileSync(path.join(dir, 'VERSION'), '1.2.0\n');
	fs.writeFileSync(path.join(dir, 'docs', 'builds', '1.2.0.json'), JSON.stringify(rec));
	fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), `# Changelog\n\n${changelog(rec)}`);
	const run = (b) => { fs.writeFileSync(path.join(dir, 'body.md'), b); return spawnSync(process.execPath, [path.resolve('scripts/build-record.mjs'), 'body', path.join(dir, 'body.md')], { cwd: dir, encoding: 'utf8', env: { ...process.env, KIT_RECORD_ROOT: dir } }); };
	assert.equal(run(body).status, 0, run(body).stderr);
	const edited = run(body.replace('$5.20 less per 1,000', '$9.99 less per 1,000'));
	assert.equal(edited.status, 1);
	assert.match(edited.stderr, /Visuals section differs from the build record/);
	// A hand edit deep in the section (a table row, a why line) is caught too, not only in its first lines.
	assert.equal(run(body.replace('| 9,800 | 8,500 |', '| 9,900 | 8,500 |')).status, 1, 'a table row edited by hand');
	assert.equal(run(body.replace('follows from the tokens it loads.', 'follows from nothing.')).status, 1, 'a why line edited by hand');
});
