// T15 D5 (the owner's lock, 2026-11-12): one build record writes the changelog entry and the PR body, so the two never
// tell different stories, and a record that is not whole cannot write either.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import kitTemp from '../project/.claude/kit-temp.cjs';
import { problems, changelog, prBody, checkRepo } from '../scripts/build-record.mjs';

kitTemp.sessionRoot();
const record = () => ({
	version: '1.2.0', date: '2026-11-12', level: 'minor', area: 'Tests', title: 'feat: tests say why they are kept',
	headline: 'Every test names what it guards.',
	items: [
		{ id: 'T1', kind: 'changed', text: 'Each test carries a why line.', evidence: 'tests/x.test.mjs', where: 'tests', before: 'no reason', after: 'a why line' },
		{ id: 'S1', kind: 'security', text: 'A PR cannot choose its own map.', evidence: 'commit abc1234' },
		{ id: 'T2', kind: 'added', text: 'A test check.', evidence: 'scripts/test-check.mjs' },
	],
	decisions: [{ decision: 'One record', why: 'the changelog and the body never differ' }],
	verification: ['Every test passed in CI.'],
	sweep: { tier: 'Feature', commit: 'abc1234', dimensions: [{ name: 'Code security', result: 'clean' }], findings: { critical: 0, high: 1, medium: 2, low: 0 }, fixed: ['one high, fixed here'] },
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
	assert.equal(body.split('\n')[0], '## Tests: tests say why they are kept');
	assert.ok(body.includes('| tests | no reason | a why line |'), body);
	assert.ok(!body.includes('| A PR cannot'), 'an item with no where got a summary row');
	assert.match(body, /\*\*High and critical findings:\*\* 1, each fixed here[\s\S]*one high, fixed here/);
	assert.match(body, /Tests: 10 before, 8 after/);
});

// why: guards rule:release-notes: CI holds a PR that moves VERSION to its record. pin: 1 (GitHub reads these lines)
test('CI checks the build record on every PR that moves VERSION', () => {
	const ci = fs.readFileSync(path.resolve('.github/workflows/ci.yml'), 'utf8');
	const step = ci.split('- name: Build record\n')[1].split('- name:')[0];
	assert.match(step, /if git diff --quiet "\$PR_BASE" HEAD -- VERSION; then .*; else node scripts\/build-record\.mjs check; fi/); // pin: 1
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