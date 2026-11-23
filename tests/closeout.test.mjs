// K369 (patch 1.51.1): after the sweep a new test needs a ticket. closeout.mjs check reads the closeout file and the
// range after its one commit; build-record.mjs runs it for a record with a sweep. Each test builds a small git repo
// and runs the tools by path; a missing closeout.mjs gives a failing status here, never a crash.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import kitTemp from '../project/.claude/kit-temp.cjs';
import { changelog } from '../scripts/build-record.mjs';

kitTemp.sessionRoot();
const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLOSEOUT = path.join(KIT, 'user', 'kit-tools', 'closeout.mjs');
const BUILD_RECORD = path.join(KIT, 'scripts', 'build-record.mjs');
const VERSION = '1.2.0';
const DEFER = 'node user/kit-tools/closeout.mjs defer';

const git = (root, ...args) => {
	const r = spawnSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd: root, encoding: 'utf8' });
	assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
	return r.stdout.trim();
};
const commit = (root, msg) => { git(root, 'add', '-A'); git(root, 'commit', '-q', '-m', msg); };
const write = (root, rel, text) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); };
const testFile = (names) => `import { test } from './harness.mjs';\n\n${names.map((n) => `// why: catches ${n} in a fixture file\ntest('${n}', () => {});\n`).join('\n')}`;

const run = (script, args, root, extra = {}) => {
	if (!fs.existsSync(script)) return { status: 127, stdout: '', stderr: `${path.basename(script)} is missing` };
	const env = { ...process.env, ...extra };
	delete env.KIT_RECORD_ROOT;
	const r = spawnSync(process.execPath, [script, ...args], { cwd: root, encoding: 'utf8', env });
	return { status: r.status, stdout: r.stdout, stderr: r.stderr };
};
const check = (root, extra) => run(CLOSEOUT, ['check', '--root', root], root, extra);
const buildRecordCheck = (root) => {
	const env = { ...process.env, KIT_RECORD_ROOT: root };
	const r = spawnSync(process.execPath, [BUILD_RECORD, 'check'], { cwd: root, encoding: 'utf8', env });
	return { status: r.status, stdout: r.stdout, stderr: r.stderr };
};

const finding = (id, severity, extra = {}) => ({ id, severity, security: false, owner: false, ...extra });
const defaultCloseout = (head) => ({
	version: VERSION, head,
	findings: [finding('F1', 'high'), finding('F2', 'medium', { security: true }), finding('F3', 'low')],
	tickets: ['F1', 'F2'],
});
const record = (sha) => ({
	version: VERSION, date: '2026-11-12', level: 'minor', area: 'Test value', title: 'feat: tests say why they are kept',
	headline: 'Every test names what it guards.',
	items: [{ id: 'T1', kind: 'changed', text: 'Each test carries a why line.', evidence: 'tests/x.test.mjs', where: 'tests', before: 'no reason', after: 'a why line' }],
	decisions: [{ decision: 'One record', why: 'the changelog and the body never differ' }],
	verification: ['Every test passed in CI.'],
	sweep: {
		tier: 'Feature', commit: sha,
		dimensions: ['Privacy', 'Supply chain', 'Legal', 'Code security', 'Gaps, scaling, test value', 'Alignment'].map((name) => ({ name, result: 'clean' })),
		findings: { critical: 0, high: 1, medium: 1, low: 1 },
		fixes: [
			{ id: 'F1', finding: 'F1', severity: 'high', text: 'one high, fixed here', commit: sha, test: 'tests/a.test.mjs::old one' },
			{ id: 'F3', finding: 'F3', severity: 'low', text: 'one low, a parser edge', commit: sha, test: 'no test: no real input' },
		],
	},
	tests: { before: 10, after: 12 },
});
let rowNo = 0;
const row = (finding, tests = [], severity = 'high', files) => ({ id: `R${++rowNo}`, kind: 'fixed', text: `A fix for ${finding}.`, evidence: 'commit', finding, severity, ...(tests.length ? { tests } : {}), ...(files ? { files } : {}) });
const closeoutOf = (findings, tickets) => (head) => ({ version: VERSION, head, findings, tickets });

/** A repo: base commit, the one closeout commit, then the range's changes, then the build record. */
function mk({ before, between, after, rows = [], closeout, mutate } = {}) {
	const root = kitTemp.makeTemp('closeout-');
	git(root, 'init', '-q');
	write(root, 'VERSION', `${VERSION}\n`);
	write(root, 'tests/a.test.mjs', testFile(['old one']));
	write(root, 'scripts/old.mjs', '// old\n');
	commit(root, 'base');
	if (before) before(root);
	const sha = git(root, 'rev-parse', 'HEAD');
	if (between) between(root);
	if (closeout !== null) {
		const body = closeout === undefined ? defaultCloseout(sha) : typeof closeout === 'function' ? closeout(sha) : closeout;
		write(root, `docs/builds/${VERSION}.closeout.json`, typeof body === 'string' ? body : `${JSON.stringify(body, null, 2)}\n`);
		commit(root, 'closeout');
	}
	if (after) after(root);
	const rec = record(sha);
	rec.items.push(...rows);
	if (mutate) mutate(rec, sha);
	write(root, `docs/builds/${VERSION}.json`, `${JSON.stringify(rec, null, 2)}\n`);
	write(root, 'CHANGELOG.md', `${changelog(rec)}\n`);
	commit(root, 'record');
	return root;
}
const addTests = (...names) => (root) => { write(root, 'tests/a.test.mjs', testFile(['old one', ...names])); commit(root, 'add tests'); };
const logLines = (root) => {
	const common = path.resolve(root, git(root, 'rev-parse', '--git-common-dir'));
	const file = path.join(common, 'kit-guard-open.log');
	return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
};

// why: catches a build record with a sweep and no closeout file fails (K369 S1)
test('a build record with a sweep and no closeout file fails', () => {
	const whole = buildRecordCheck(mk());
	assert.equal(whole.status, 0, whole.stderr);
	const none = buildRecordCheck(mk({ closeout: null }));
	assert.equal(none.status, 1, none.stdout);
	assert.match(none.stderr, /closeout/i);
	// no sweep and no closeout file: nothing is owed, so closeout check passes
	const noSweep = check(mk({ closeout: null, mutate: (rec) => { delete rec.sweep; } }));
	assert.equal(noSweep.status, 0, noSweep.stderr);
	assert.equal(noSweep.stderr, '');
});

// why: catches a ticketed test passes, and a second test on the same ticket fails (K369 S2)
test('a ticketed test passes, and a second test on the same ticket fails', () => {
	const one = check(mk({ after: addTests('new one'), rows: [row('F1', ['tests/a.test.mjs::new one'])] }));
	assert.equal(one.status, 0, one.stderr);
	assert.equal(one.stderr, '');
	const own = check(mk({ after: addTests('new one', 'new two'), rows: [row('F1', ['tests/a.test.mjs::new one']), row('F2', ['tests/a.test.mjs::new two'], 'medium')] }));
	assert.equal(own.status, 0, own.stderr);
	const twice = check(mk({ after: addTests('new one', 'new two'), rows: [row('F1', ['tests/a.test.mjs::new one']), row('F1', ['tests/a.test.mjs::new two'])] }));
	assert.equal(twice.status, 1);
	assert.match(twice.stderr, /F1/);
	// one row naming two new tests fails: each new test needs its own ticket
	const both = check(mk({ after: addTests('new one', 'new two'), rows: [row('F1', ['tests/a.test.mjs::new one', 'tests/a.test.mjs::new two'])] }));
	assert.equal(both.status, 1);
	assert.match(both.stderr, /F1/);
	// one test in two rows fails
	const split = check(mk({ after: addTests('new one'), rows: [row('F1', ['tests/a.test.mjs::new one']), row('F2', ['tests/a.test.mjs::new one'], 'medium')] }));
	assert.equal(split.status, 1);
	assert.ok(split.stderr.includes('tests/a.test.mjs::new one'), split.stderr);
	// the flags decide: an owner finding listed passes, an unflagged medium that is not listed fails
	const flags = [finding('F1', 'high'), finding('F4', 'low', { owner: true }), finding('F5', 'medium')];
	const owned = check(mk({ closeout: closeoutOf(flags, ['F1', 'F4']), after: addTests('owned'), rows: [row('F4', ['tests/a.test.mjs::owned'], 'low')] }));
	assert.equal(owned.status, 0, owned.stderr);
	const plain = check(mk({ closeout: closeoutOf(flags, ['F1', 'F4']), after: addTests('unflagged'), rows: [row('F5', ['tests/a.test.mjs::unflagged'], 'medium')] }));
	assert.equal(plain.status, 1);
	assert.ok(plain.stderr.includes('tests/a.test.mjs::unflagged'), plain.stderr);
	// a tickets list that disagrees with the flags is a fault naming the id, whichever way it disagrees
	const unlisted = check(mk({ closeout: closeoutOf([finding('F1', 'high'), finding('F2', 'medium', { security: true })], ['F1']) }));
	assert.equal(unlisted.status, 1);
	assert.match(unlisted.stderr, /F2/);
	const overlisted = check(mk({ closeout: closeoutOf([finding('F1', 'high'), finding('F3', 'low')], ['F1', 'F3']) }));
	assert.equal(overlisted.status, 1);
	assert.match(overlisted.stderr, /F3/);
	// ticket checks read the record's items rows: a sweep.fixes row naming the test is no ticket for it
	const wrongArray = check(mk({ after: addTests('new one'), mutate: (rec) => { rec.sweep.fixes[0].test = 'tests/a.test.mjs::new one'; } }));
	assert.equal(wrongArray.status, 1);
	assert.ok(wrongArray.stderr.includes('tests/a.test.mjs::new one'), wrongArray.stderr);
	// a fix row naming a finding the closeout file does not list is a fault naming that finding
	const ghost = check(mk({ after: addTests('ghost'), rows: [row('F9', ['tests/a.test.mjs::ghost'])] }));
	assert.equal(ghost.status, 1);
	assert.match(ghost.stderr, /F9/);
});

// why: catches a ticketless test fails naming the file and the defer command (K369 S2)
test('a ticketless test fails naming the file and the defer command', () => {
	const bare = check(mk({ after: addTests('orphan') }));
	assert.equal(bare.status, 1);
	assert.ok(bare.stderr.includes('tests/a.test.mjs::orphan'), bare.stderr);
	assert.ok(bare.stderr.includes(DEFER), bare.stderr);
	// F3 is a low finding with no security or owner flag: it is no ticket
	const low = check(mk({ after: addTests('orphan'), rows: [row('F3', ['tests/a.test.mjs::orphan'], 'low')] }));
	assert.equal(low.status, 1);
	assert.ok(low.stderr.includes('tests/a.test.mjs::orphan'), low.stderr);
	assert.ok(bare.stderr.includes('remove the test and defer it'), bare.stderr);
	// a test made in a top-level for loop, or by a one-line forEach, is counted too
	const looped = check(mk({ after: (root) => { write(root, 'tests/loop.test.mjs', "import { test } from './harness.mjs';\n\nfor (const n of ['x', 'y']) {\n\t// why: catches looped tests each need their own ticket\n\ttest(`looped ${n}`, () => {});\n}\n"); commit(root, 'loop'); } }));
	assert.equal(looped.status, 1);
	assert.ok(looped.stderr.includes('tests/loop.test.mjs'), looped.stderr);
	const each = check(mk({ after: (root) => { write(root, 'tests/each.test.mjs', "import { test } from './harness.mjs';\n\n['x', 'y'].forEach((n) => test(`each ${n}`, () => {}));\n"); commit(root, 'each'); } }));
	assert.equal(each.status, 1);
	assert.ok(each.stderr.includes('tests/each.test.mjs'), each.stderr);
	// a ticketless failure is logged too: one row for the run
	const root = mk({ after: addTests('orphan') });
	assert.equal(check(root).status, 1);
	const logged = logLines(root);
	assert.equal(logged.length, 1);
	assert.equal(logged[0].hook, 'closeout');
	assert.ok(typeof logged[0].cause === 'string' && logged[0].cause.length > 0);
});

// why: catches a new script, hook or CI file no ticket's fix names fails (K369 S3)
test("a new script, hook or CI file no ticket's fix names fails", () => {
	const edits = check(mk({ after: (root) => { write(root, 'scripts/old.mjs', '// old, edited\n'); write(root, 'docs/note.md', 'a note\n'); commit(root, 'edit'); } }));
	assert.equal(edits.status, 0, edits.stderr);
	const added = check(mk({ after: (root) => {
		write(root, 'scripts/new-tool.mjs', '// new\n');
		write(root, 'user/kit-hooks/new-hook.cjs', '// new\n');
		write(root, '.github/workflows/new-job.yml', 'name: x\n');
		commit(root, 'add files');
	} }));
	assert.equal(added.status, 1);
	// a ticket's fix row that names the file lets it in; the same file on a non-ticket row fails
	const hook = (root) => { write(root, 'user/kit-hooks/new-hook.cjs', '// new\n'); commit(root, 'add hook'); };
	const named = check(mk({ after: hook, rows: [row('F1', [], 'high', ['user/kit-hooks/new-hook.cjs'])] }));
	assert.equal(named.status, 0, named.stderr);
	const lowRow = check(mk({ after: hook, rows: [row('F3', [], 'low', ['user/kit-hooks/new-hook.cjs'])] }));
	assert.equal(lowRow.status, 1);
	assert.ok(lowRow.stderr.includes('user/kit-hooks/new-hook.cjs'), lowRow.stderr);
	// guard files under project/.claude and user/skills need a ticket's row as well
	const guards = check(mk({ after: (root) => { write(root, 'project/.claude/new-guard.cjs', '// new\n'); write(root, 'user/skills/pre-pr-sweep/new-step.mjs', '// new\n'); commit(root, 'add guards'); } }));
	assert.equal(guards.status, 1);
	for (const f of ['project/.claude/new-guard.cjs', 'user/skills/pre-pr-sweep/new-step.mjs']) assert.ok(guards.stderr.includes(f), `${f} not named: ${guards.stderr}`);
	for (const f of ['scripts/new-tool.mjs', 'user/kit-hooks/new-hook.cjs', '.github/workflows/new-job.yml']) assert.ok(added.stderr.includes(f), `${f} not named: ${added.stderr}`);
	// control: a new doc under project/.claude or user/skills is no script, so it needs no ticket
	const docs = check(mk({ after: (root) => {
		write(root, 'user/skills/new-skill/SKILL.md', '# new\n');
		write(root, 'project/.claude/rules/new-rule.md', '# new\n');
		write(root, 'user/skills/agent-team-build/templates/x-brief.md', '# new\n');
		commit(root, 'add docs');
	} }));
	assert.equal(docs.status, 0, docs.stderr);
});

// why: catches a second commit on the closeout file fails (K369 S4)
test('a second commit on the closeout file fails', () => {
	const once = check(mk());
	assert.equal(once.status, 0, once.stderr);
	const twice = check(mk({ after: (root) => {
		const file = `docs/builds/${VERSION}.closeout.json`;
		const body = JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
		body.tickets.push('F3');
		write(root, file, `${JSON.stringify(body, null, 2)}\n`);
		commit(root, 'closeout again');
	} }));
	assert.equal(twice.status, 1);
	assert.ok(twice.stderr.includes(`${VERSION}.closeout.json`), twice.stderr);
	// a second commit that only reformats the same JSON is still a second commit
	const reformat = check(mk({ after: (root) => {
		const file = path.join(root, 'docs', 'builds', `${VERSION}.closeout.json`);
		fs.writeFileSync(file, JSON.stringify(JSON.parse(fs.readFileSync(file, 'utf8'))));
		commit(root, 'closeout reformatted');
	} }));
	assert.equal(reformat.status, 1);
	assert.match(reformat.stderr, /2 commits/);
	// the version must be the one in VERSION, and the head a commit that resolves
	const version = check(mk({ closeout: (head) => ({ ...defaultCloseout(head), version: '9.9.9' }) }));
	assert.equal(version.status, 1);
	assert.match(version.stderr, /9\.9\.9/);
	const noHead = check(mk({ closeout: (head) => ({ ...defaultCloseout(head), head: 'not-a-commit' }) }));
	assert.equal(noHead.status, 1);
	assert.match(noHead.stderr, /not-a-commit/);
	// a 7-character head that resolves to the same commit as the full sha passes
	const short = check(mk({ closeout: (head) => defaultCloseout(head.slice(0, 7)) }));
	assert.equal(short.status, 0, short.stderr);
	// nothing may land between the swept head and the closeout commit: its parent must be the head
	const between = mk({ between: (root) => { write(root, 'tests/a.test.mjs', testFile(['old one', 'sneaked in'])); commit(root, 'between'); } });
	const gap = check(between);
	assert.equal(gap.status, 1);
	const closeoutAt = git(between, 'log', '--format=%H', '--', `docs/builds/${VERSION}.closeout.json`);
	const parent = git(between, 'rev-parse', `${closeoutAt}^`);
	const head = JSON.parse(fs.readFileSync(path.join(between, 'docs', 'builds', `${VERSION}.closeout.json`), 'utf8')).head;
	assert.ok(gap.stderr.includes(parent.slice(0, 7)) && gap.stderr.includes(head.slice(0, 7)), `names parent and head: ${gap.stderr}`);
});

// why: catches 89 high fix rows on 6 high findings fails (K369 S5)
test('89 high fix rows on 6 high findings fails', () => {
	const ids = [1, 2, 3, 4, 5, 6].map((n) => `H${n}`);
	const closeout = (head) => ({ version: VERSION, head, findings: ids.map((id) => finding(id, 'high')), tickets: ids });
	const rows = (n) => (rec, sha) => {
		rec.sweep.findings = { critical: 0, high: 6, medium: 0, low: 0 };
		rec.sweep.fixes = Array.from({ length: n }, (_, i) => ({ id: `X${i}`, finding: ids[i % 6], severity: 'high', text: `fix number ${i} of the parser`, commit: sha, test: 'tests/a.test.mjs::old one' }));
	};
	const six = buildRecordCheck(mk({ closeout, mutate: rows(6) }));
	assert.equal(six.status, 0, six.stderr);
	const many = buildRecordCheck(mk({ closeout, mutate: rows(89) }));
	assert.equal(many.status, 1);
	assert.match(many.stderr, /89/);
	assert.match(many.stderr, /\b6\b/);
	// the margin is 0: one row over fails
	const seven = buildRecordCheck(mk({ closeout, mutate: rows(7) }));
	assert.equal(seven.status, 1);
	assert.match(seven.stderr, /\b7\b/);
	// a critical row beyond the critical findings fails, though the total of high and critical rows is met
	const crit = closeoutOf([finding('C1', 'critical'), finding('H1', 'high')], ['C1', 'H1']);
	const fix = (id, of, severity, sha) => ({ id, finding: of, severity, text: `fix ${id} of the parser`, commit: sha, test: 'tests/a.test.mjs::old one' });
	const mixed = (second) => (rec, sha) => { rec.sweep.findings = { critical: 1, high: 1, medium: 0, low: 0 }; rec.sweep.fixes = [fix('X1', 'C1', 'critical', sha), second(sha)]; };
	const fits = buildRecordCheck(mk({ closeout: crit, mutate: mixed((sha) => fix('X2', 'H1', 'high', sha)) }));
	assert.equal(fits.status, 0, fits.stderr);
	const twoCrit = buildRecordCheck(mk({ closeout: crit, mutate: mixed((sha) => fix('X2', 'C1', 'critical', sha)) }));
	assert.equal(twoCrit.status, 1);
	assert.match(twoCrit.stderr, /critical/i);
});

// why: catches a fix row whose severity differs from its finding's severity fails (K369 S5)
test("a fix row whose severity differs from its finding's severity fails", () => {
	const same = buildRecordCheck(mk());
	assert.equal(same.status, 0, same.stderr);
	// F3 is low in the closeout file; the fix row calls it medium
	const differs = buildRecordCheck(mk({ mutate: (rec) => { rec.sweep.fixes[1].severity = 'medium'; } }));
	assert.equal(differs.status, 1);
	assert.match(differs.stderr, /F3/);
	assert.match(differs.stderr, /severity/i);
	// a high finding whose row says medium: an accepted line holds the high count, so only the severity is wrong
	const lowered = buildRecordCheck(mk({ mutate: (rec) => { rec.sweep.fixes[0].severity = 'medium'; rec.sweep.accepted = ['high: F1 is accepted by the owner']; } }));
	assert.equal(lowered.status, 1);
	assert.match(lowered.stderr, /F1/);
	assert.match(lowered.stderr, /severity/i);
	// a fix row whose finding is missing, or is no finding the closeout file lists, fails
	const missing = buildRecordCheck(mk({ mutate: (rec) => { delete rec.sweep.fixes[1].finding; } }));
	assert.equal(missing.status, 1);
	assert.match(missing.stderr, /F3 names no finding/);
	const unlisted = buildRecordCheck(mk({ mutate: (rec) => { rec.sweep.fixes[1].finding = 'F8'; } }));
	assert.equal(unlisted.status, 1);
	assert.match(unlisted.stderr, /F3 names no finding/);
});

// why: catches a test added by rename, or in a new test file, is still counted (K369 S6)
test('a test added by rename, or in a new test file, is still counted', () => {
	const moved = check(mk({ after: (root) => { git(root, 'mv', 'tests/a.test.mjs', 'tests/c.test.mjs'); commit(root, 'rename file'); } }));
	assert.equal(moved.status, 1);
	assert.ok(moved.stderr.includes('tests/c.test.mjs::old one'), moved.stderr);
	const fresh = check(mk({ after: (root) => { write(root, 'tests/b.test.mjs', testFile(['in new file'])); commit(root, 'new file'); } }));
	assert.equal(fresh.status, 1);
	assert.ok(fresh.stderr.includes('tests/b.test.mjs::in new file'), fresh.stderr);
	// control: a rename inside the file that carries test-check's tag is the test that was there
	const tagged = check(mk({ after: (root) => {
		write(root, 'tests/a.test.mjs', `import { test } from './harness.mjs';\n\n// why: catches older one in a fixture file\n// renamed from: old one\ntest('older one', () => {});\n`);
		commit(root, 'rename test');
	} }));
	assert.equal(tagged.status, 0, tagged.stderr);
	// a test committed before the closeout commit was there already: it does not count
	const early = check(mk({ before: (root) => { write(root, 'tests/a.test.mjs', testFile(['old one', 'early one'])); commit(root, 'early test'); } }));
	assert.equal(early.status, 0, early.stderr);
	// a renamed-from tag exempts only a name the closeout commit had and HEAD has lost
	const never = check(mk({ after: (root) => { write(root, 'tests/a.test.mjs', `${testFile(['old one'])}\n// why: catches fresh one in a fixture file\n// renamed from: never here\ntest('fresh one', () => {});\n`); commit(root, 'tag a stranger'); } }));
	assert.equal(never.status, 1);
	assert.ok(never.stderr.includes('tests/a.test.mjs::fresh one'), never.stderr);
	const copy = check(mk({ after: (root) => { write(root, 'tests/a.test.mjs', `${testFile(['old one'])}\n// why: catches a copy in a fixture file\n// renamed from: old one\ntest('a copy', () => {});\n`); commit(root, 'tag a copy'); } }));
	assert.equal(copy.status, 1);
	assert.ok(copy.stderr.includes('tests/a.test.mjs::a copy'), copy.stderr);
	// HEAD a merge of main: the range ends at the PR head, so a test main gained is never charged to the patch
	const merged = mk({ after: addTests('orphan') });
	const pr = git(merged, 'rev-parse', 'HEAD');
	git(merged, 'switch', '-q', '-c', 'side', git(merged, 'rev-list', '--max-parents=0', 'HEAD'));
	write(merged, 'tests/m.test.mjs', testFile(['main gained']));
	commit(merged, 'main moves on');
	const prBase = git(merged, 'rev-parse', 'HEAD');
	git(merged, 'merge', '-q', '--no-ff', '-m', 'merge', pr);
	const viaMerge = check(merged, { PR_BASE: prBase });
	assert.equal(viaMerge.status, 1);
	assert.ok(viaMerge.stderr.includes('tests/a.test.mjs::orphan'), viaMerge.stderr);
	assert.ok(!viaMerge.stderr.includes('m.test.mjs'), viaMerge.stderr);
});

// why: catches defer appends one JSON line to the next-patch file and prints "written, carry on" (K369 S8)
test('defer appends one JSON line to the next-patch file and prints "written, carry on"', () => {
	const root = mk({ closeout: null });
	const env = { ...process.env, KIT_RECORD_ROOT: root };
	const go = (text) => (fs.existsSync(CLOSEOUT) ? spawnSync(process.execPath, [CLOSEOUT, 'defer', text], { cwd: root, encoding: 'utf8', env }) : { status: 127, stdout: '', stderr: 'missing' });
	const file = path.join(root, 'docs', 'builds', `${VERSION}.next.jsonl`);
	const first = go('carry the parser edge over');
	assert.equal(first.status, 0, first.stderr);
	assert.ok(first.stdout.includes('written, carry on'), first.stdout);
	const lines = () => fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
	assert.equal(lines().length, 1);
	const one = JSON.parse(lines()[0]);
	assert.equal(one.text, 'carry the parser edge over');
	assert.ok(!Number.isNaN(Date.parse(one.at)), `at is not a date: ${one.at}`);
	assert.equal(go('a second one').status, 0);
	assert.equal(lines().length, 2);
	assert.equal(JSON.parse(lines()[0]).text, 'carry the parser edge over');
	assert.equal(first.stdout.trim(), 'written, carry on');
	// --root names the repo when the working folder is another one and no env names it
	const elsewhere = kitTemp.makeTemp('closeout-cwd-');
	const bare = { ...process.env };
	delete bare.KIT_RECORD_ROOT;
	const rooted = fs.existsSync(CLOSEOUT) ? spawnSync(process.execPath, [CLOSEOUT, 'defer', 'by root flag', '--root', root], { cwd: elsewhere, encoding: 'utf8', env: bare }) : { status: 127, stdout: '', stderr: 'missing' };
	assert.equal(rooted.status, 0, rooted.stderr);
	assert.equal(rooted.stdout.trim(), 'written, carry on');
	assert.equal(lines().length, 3);
	assert.equal(JSON.parse(lines()[2]).text, 'by root flag');
});

// why: catches the same range twice gives the same verdict (K369 S6)
test('the same range twice gives the same verdict', () => {
	const bad = mk({ after: addTests('orphan', 'second orphan') });
	const a = check(bad);
	const b = check(bad);
	assert.equal(a.status, 1);
	assert.ok(a.stderr.includes('tests/a.test.mjs::orphan'), a.stderr);
	assert.deepEqual(b, a);
	const good = mk({ after: addTests('new one'), rows: [row('F1', ['tests/a.test.mjs::new one'])] });
	const c = check(good);
	const d = check(good);
	assert.equal(c.status, 0, c.stderr);
	assert.deepEqual(d, c);
});

// why: catches an unreadable closeout file or a shallow clone fails, logged (K369 S7)
test('an unreadable closeout file or a shallow clone fails, logged', () => {
	const clean = mk();
	assert.equal(check(clean).status, 0);
	assert.equal(logLines(clean).length, 0);
	const garbled = mk({ closeout: '{ not json' });
	const bad = check(garbled);
	assert.equal(bad.status, 1);
	assert.match(bad.stderr, /closeout/i);
	const logged = logLines(garbled);
	assert.equal(logged.length, 1);
	assert.equal(logged[0].hook, 'closeout');
	assert.ok(typeof logged[0].cause === 'string' && logged[0].cause.length > 0);
	assert.ok(!Number.isNaN(Date.parse(logged[0].at)));
	const dest = path.join(kitTemp.makeTemp('closeout-shallow-'), 'clone');
	const cloned = spawnSync('git', ['clone', '-q', '--depth', '1', pathToFileURL(clean).href, dest], { encoding: 'utf8' });
	assert.equal(cloned.status, 0, cloned.stderr);
	assert.equal(git(dest, 'rev-parse', '--is-shallow-repository'), 'true');
	const shallow = check(dest);
	assert.equal(shallow.status, 1);
	assert.match(shallow.stderr, /shallow/i);
	const shallowLog = logLines(dest);
	assert.equal(shallowLog.length, 1);
	assert.equal(shallowLog[0].hook, 'closeout');
	// a PR_BASE that names no commit here fails, logged, and never falls back to HEAD
	const noBase = mk();
	const lost = check(noBase, { PR_BASE: 'origin/nope' });
	assert.equal(lost.status, 1);
	assert.match(lost.stderr, /PR_BASE origin\/nope is no commit here/);
	assert.equal(logLines(noBase).length, 1);
	// build-record runs closeout on check only: its changelog command writes no closeout log row
	const unclosed = mk({ closeout: null });
	const log = spawnSync(process.execPath, [BUILD_RECORD, 'changelog'], { cwd: unclosed, encoding: 'utf8', env: { ...process.env, KIT_RECORD_ROOT: unclosed } });
	assert.equal(log.status, 0, log.stderr);
	assert.ok(log.stdout.startsWith(`## ${VERSION}`), log.stdout);
	assert.equal(logLines(unclosed).length, 0);
});
