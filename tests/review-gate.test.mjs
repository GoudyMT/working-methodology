// K310 (U6): the test-review gate. A test-reviewer's hand-back names finding statuses from a fixed five, the tester's fix
// hand-back marks each finding `fixed`, and `handoff.mjs check --review <unit>` passes a unit only when every review
// finding has a fixed line. Nothing here calls a model: every hand-back is written by the test into a temp folder.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import kitTemp from '../project/.claude/kit-temp.cjs';

kitTemp.sessionRoot();
const CLI = fileURLToPath(new URL('../user/kit-tools/handoff.mjs', import.meta.url));
const ROLE_FILE = fileURLToPath(new URL('../user/agents/test-reviewer.md', import.meta.url));
const SKILL_FILE = fileURLToPath(new URL('../user/skills/test-reviewer-rules/SKILL.md', import.meta.url));
const CONFIG_FILE = fileURLToPath(new URL('../kit.config.json', import.meta.url));
const STATUSES = ['wrong-test', 'uncovered', 'passes-on-base', 'vague', 'open'];
const REVIEW_ROLE = '{"role":"test-reviewer","commit":"abc1234"}';
const FIX_ROLE = '{"role":"tester","commit":"abc1234"}';
const INTENT = '{"note":"intent: yes, the builder waits for the review in the gate","writer":"test-reviewer"}';

const cli = (args, opts = {}) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', ...opts });
const tempDir = () => kitTemp.makeTemp('review-gate-');
const read = (file) => fs.readFileSync(file, 'utf8');
const finding = (id, status, over = {}) => JSON.stringify({ id, severity: 'medium', status, where: 'tests/x.test.mjs:1', claim: 'a test that passes on base', proof: 'the run', fix: 'tighten it', ...over });
// A whole hand-back as the lead saves it: prose, the RECORD: line, then the role line and the lines after it.
const handBack = (roleLine, ...lines) => ['Prose the subagent wrote, with severity: high in it.', 'RECORD:', roleLine, ...lines].join('\n') + '\n';

// Writes U1.review.jsonl (and U1.fix.jsonl when given) into a fresh folder and returns the folder.
function gateDir({ review, fix } = {}) {
	const dir = tempDir();
	if (review !== undefined) fs.writeFileSync(path.join(dir, 'U1.review.jsonl'), review);
	if (fix !== undefined) fs.writeFileSync(path.join(dir, 'U1.fix.jsonl'), fix);
	return dir;
}
const runReview = (dir, unit = 'U1') => cli(['check', '--review', unit, '--dir', dir]);

// why: catches a review finding with one of the five statuses being refused by the reviewer's own check.
for (const status of STATUSES) {
	test(`U6 spec 1: a test-reviewer finding with status ${status} passes check --role test-reviewer`, () => {
		const dir = tempDir();
		const file = path.join(dir, 'record.txt');
		fs.writeFileSync(file, handBack(REVIEW_ROLE, finding('R1', status), INTENT));
		const r = cli(['check', file, '--role', 'test-reviewer']);
		assert.equal(r.status, 0, r.stderr || r.stdout);
	});
}

// why: catches a status outside the five slipping into a reviewer's record unchecked and reaching the ledger.
test('U6 spec 1: a test-reviewer finding with status red is an error naming red and line 2', () => {
	const dir = tempDir();
	const file = path.join(dir, 'record.txt');
	fs.writeFileSync(file, handBack(REVIEW_ROLE, finding('R1', 'red'), INTENT));
	const r = cli(['check', file, '--role', 'test-reviewer']);
	assert.equal(r.status, 1, r.stdout);
	assert.match(r.stderr, /^line 2: .*`status`.*red/m, r.stderr);
});

// why: catches a tester fix line with status fixed refused by the tester's check, which would block every fix record.
test('U6 spec 1: a tester fix line with status fixed passes check --role tester', () => {
	const dir = tempDir();
	const file = path.join(dir, 'fix.txt');
	fs.writeFileSync(file, handBack(FIX_ROLE, finding('R1', 'fixed')));
	const r = cli(['check', file, '--role', 'tester']);
	assert.equal(r.status, 0, r.stderr || r.stdout);
});

// why: catches the role file leaving out one of the five statuses, so a reviewer never learns to use it.
test('U6 spec 3: test-reviewer.md body names all five statuses', () => {
	const body = read(ROLE_FILE).split(/^---$/m)[2] ?? '';
	for (const status of STATUSES) assert.ok(body.includes(`\`${status}\``), `missing \`${status}\` in the body`);
});

// why: catches a reviewer role that can edit or run commands, which would let a review change the code it reviews.
test('U6 spec 3: kit.config.json roles.test-reviewer.tools is exactly Read, Grep and Glob', () => {
	const config = JSON.parse(read(CONFIG_FILE));
	assert.deepEqual(config.roles['test-reviewer'].tools, ['Read', 'Grep', 'Glob']);
});

// why: catches the role file's frontmatter tools drifting from the config entry the table checker holds it to.
test('U6 spec 3: the test-reviewer frontmatter tools line names Read, Grep and Glob and no write or shell tool', () => {
	const front = read(ROLE_FILE).split(/\r?\n/).slice(1, read(ROLE_FILE).split(/\r?\n/).indexOf('---', 1));
	const toolsLine = front.find((l) => l.startsWith('tools:')) ?? '';
	assert.deepEqual(toolsLine.replace('tools:', '').split(',').map((s) => s.trim()), ['Read', 'Grep', 'Glob']);
});

// why: catches the reviewer's intent question missing from the role file, so a run record never says what the review was for.
test('U6 spec 4: the test-reviewer role file names the intent: note line', () => {
	assert.match(read(ROLE_FILE), /\{"note":"intent:[^"]*","writer":"test-reviewer"\}/);
});

// why: catches the rules skill leaving out the intent: note line, so a brief that preloads only the skill loses the question.
test('U6 spec 4: the test-reviewer rules skill names the intent: note line', () => {
	assert.match(read(SKILL_FILE), /intent:/);
});

// why: catches a clean review failing the gate when it has no findings and the reviewer's intent note is its only line.
test('U6 spec 2: a review with no findings passes check --review alone (exit 0)', () => {
	const dir = gateDir({ review: handBack(REVIEW_ROLE, INTENT) });
	const r = runReview(dir);
	assert.equal(r.status, 0, r.stderr || r.stdout);
});

// why: catches a review whose every finding has a fixed line being refused, which would block a fixed unit forever.
test('U6 spec 2: every review finding with a fixed line passes check --review (exit 0)', () => {
	const dir = gateDir({
		review: handBack(REVIEW_ROLE, finding('R1', 'vague'), finding('R2', 'uncovered'), INTENT),
		fix: handBack(FIX_ROLE, finding('R1', 'fixed'), finding('R2', 'fixed')),
	});
	const r = runReview(dir);
	assert.equal(r.status, 0, r.stderr || r.stdout);
});

// why: catches one unfixed finding passing the gate because the other finding was fixed.
test('U6 spec 2: a review finding with no fixed line is exit 1 and names its id', () => {
	const dir = gateDir({
		review: handBack(REVIEW_ROLE, finding('R1', 'vague'), finding('R2', 'uncovered'), INTENT),
		fix: handBack(FIX_ROLE, finding('R1', 'fixed')),
	});
	const r = runReview(dir);
	assert.equal(r.status, 1, r.stdout);
	assert.match(r.stderr, /R2/, r.stderr);
	assert.doesNotMatch(r.stderr, /R1/, r.stderr);
});

// why: catches a missing fix record passing the gate when no finding was ever fixed.
test('U6 spec 2: with no fix record, every review finding is named and the gate is exit 1', () => {
	const dir = gateDir({ review: handBack(REVIEW_ROLE, finding('R1', 'open'), finding('R2', 'vague'), INTENT) });
	const r = runReview(dir);
	assert.equal(r.status, 1, r.stdout);
	assert.match(r.stderr, /R1/, r.stderr);
	assert.match(r.stderr, /R2/, r.stderr);
});

// why: catches a fix line that says open instead of fixed counting as done, which lets an unfixed finding pass.
test('U6 spec 2: a fix line for R1 with status open does not count as fixed (exit 1)', () => {
	const dir = gateDir({
		review: handBack(REVIEW_ROLE, finding('R1', 'wrong-test'), INTENT),
		fix: handBack(FIX_ROLE, finding('R1', 'open')),
	});
	const r = runReview(dir);
	assert.equal(r.status, 1, r.stdout);
	assert.match(r.stderr, /R1/, r.stderr);
});

// why: catches a fix line for a different id being counted against this finding, which passes an unfixed finding.
test('U6 spec 2: a fixed line for R2 does not satisfy review finding R1 (exit 1)', () => {
	const dir = gateDir({
		review: handBack(REVIEW_ROLE, finding('R1', 'passes-on-base'), INTENT),
		fix: handBack(FIX_ROLE, finding('R2', 'fixed')),
	});
	const r = runReview(dir);
	assert.equal(r.status, 1, r.stdout);
	assert.match(r.stderr, /R1/, r.stderr);
});

// why: catches a missing review record passing the gate silently, so a builder runs with no test review at all.
test('U6 spec 2: no review record is exit 1 saying no review for U1', () => {
	const dir = gateDir({});
	const r = runReview(dir);
	assert.equal(r.status, 1, r.stdout);
	assert.match(r.stderr, /no review for U1/, r.stderr);
});

// why: catches a review record with a broken finding line passing the gate with that finding quietly dropped.
test('U6 spec 2: a review record with a line that is not JSON is exit 1', () => {
	const dir = gateDir({ review: handBack(REVIEW_ROLE, 'this is not json', INTENT) });
	const r = runReview(dir);
	assert.equal(r.status, 1, r.stdout);
	assert.match(r.stderr, /^line 2: /m, r.stderr);
});

// why: catches a unit name with a path separator reaching the filesystem, which would read a file outside the folder.
for (const unit of ['a/b', 'a\\b']) {
	test(`U6 spec 2: a unit name with a path separator (${unit}) is exit 2 naming the unit`, () => {
		const dir = gateDir({ review: handBack(REVIEW_ROLE, INTENT) });
		const r = runReview(dir, unit);
		assert.equal(r.status, 2, r.stdout + r.stderr);
		assert.match(r.stderr, /unit/i, r.stderr);
	});
}

// why: catches a unit name of .. reading the folder above the review folder, which is outside the kit's records.
test('U6 spec 2: a unit name of .. is exit 2 naming the unit', () => {
	const dir = gateDir({ review: handBack(REVIEW_ROLE, INTENT) });
	const r = runReview(dir, '..');
	assert.equal(r.status, 2, r.stdout + r.stderr);
	assert.match(r.stderr, /unit/i, r.stderr);
});

// why: catches an unreadable review file being treated as no review, which hides a broken hand-back as a missing one.
test('U6 spec 2: a review path that cannot be read is exit 2 saying cannot read', () => {
	const dir = tempDir();
	fs.mkdirSync(path.join(dir, 'U1.review.jsonl'));
	const r = runReview(dir);
	assert.equal(r.status, 2, r.stdout + r.stderr);
	assert.match(r.stderr, /cannot read/, r.stderr);
});

// why: catches an unreadable fix file passing the gate as if no fix record existed, which hides the read failure.
test('U6 spec 2: a fix path that cannot be read is exit 2 saying cannot read', () => {
	const dir = gateDir({ review: handBack(REVIEW_ROLE, finding('R1', 'vague'), INTENT) });
	fs.mkdirSync(path.join(dir, 'U1.fix.jsonl'));
	const r = runReview(dir);
	assert.equal(r.status, 2, r.stdout + r.stderr);
	assert.match(r.stderr, /cannot read/, r.stderr);
});

// why: catches the default folder being somewhere other than kit-reviews under the git common dir, so a review is never found.
test('U6 spec 2: with no --dir, the review is read from kit-reviews under the git common dir', () => {
	const repo = tempDir();
	const init = spawnSync('git', ['init', '-q'], { cwd: repo, encoding: 'utf8' });
	assert.equal(init.status, 0, init.stderr);
	const folder = path.join(repo, '.git', 'kit-reviews');
	fs.mkdirSync(folder, { recursive: true });
	fs.writeFileSync(path.join(folder, 'U1.review.jsonl'), handBack(REVIEW_ROLE, INTENT));
	const r = cli(['check', '--review', 'U1'], { cwd: repo });
	assert.equal(r.status, 0, r.stderr || r.stdout);
});
