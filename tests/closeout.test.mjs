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

const run = (script, args, root) => {
	if (!fs.existsSync(script)) return { status: 127, stdout: '', stderr: `${path.basename(script)} is missing` };
	const env = { ...process.env };
	delete env.KIT_RECORD_ROOT;
	const r = spawnSync(process.execPath, [script, ...args], { cwd: root, encoding: 'utf8', env });
	return { status: r.status, stdout: r.stdout, stderr: r.stderr };
};
const check = (root) => run(CLOSEOUT, ['check', '--root', root], root);
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
const row = (finding, tests, severity = 'high') => ({ id: `R-${finding}-${tests.length}-${tests[0].length}`, kind: 'fixed', text: `A fix for ${finding}.`, evidence: 'commit', finding, severity, tests });

/** A repo: base commit, the one closeout commit, then the range's changes, then the build record. */
function mk({ after, rows = [], closeout, mutate } = {}) {
	const root = kitTemp.makeTemp('closeout-');
	git(root, 'init', '-q');
	write(root, 'VERSION', `${VERSION}\n`);
	write(root, 'tests/a.test.mjs', testFile(['old one']));
	write(root, 'scripts/old.mjs', '// old\n');
	commit(root, 'base');
	const sha = git(root, 'rev-parse', 'HEAD');
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
	for (const f of ['scripts/new-tool.mjs', 'user/kit-hooks/new-hook.cjs', '.github/workflows/new-job.yml']) assert.ok(added.stderr.includes(f), `${f} not named: ${added.stderr}`);
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
});
