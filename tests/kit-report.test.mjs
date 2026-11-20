// E1 (build 21): the report channel. The scrub is what keeps a report about the kit and never about the project, so
// each of its refusals carries a planted bug; send, the owner's read before an issue, intake into the list and the
// hear-back are each run the way a project and the kit's workbench run them.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import kitTemp from '../project/.claude/kit-temp.cjs';
import { scrub, knownWords } from '../project/.claude/report-scrub.mjs';
import { send, release, status, intake, waiting, unheard, issueRoute } from '../project/.claude/kit-report.mjs';
import { problems } from '../scripts/build-record.mjs';

kitTemp.sessionRoot();
const KIT = path.resolve('.');
const STATE = path.join(KIT, 'project', '.claude', 'state.mjs');
const CLEAN = { id: 'R-20261120-0a1b2c3d', kind: 'report', kit_version: '1.47.0', area: 'guards', severity: 'low', title: 'The dash check holds a read beside true', project: '0123456789ab', created: '2026-11-20T18:00:00.000Z', kit_file: '.claude/owner-proof.cjs', kit_line: 40, note: 'Seen twice in one session; the reason named the guard files.' };

// One project folder named by words the scrub must find, with a git remote and user of its own, and a Claude folder.
function setup() {
	const root = kitTemp.makeTemp('report-');
	const projectDir = path.join(root, 'orbitwhale-shop');
	const home = path.join(root, 'home');
	fs.mkdirSync(path.join(projectDir, '.kit'), { recursive: true });
	fs.mkdirSync(home);
	const g = (...a) => spawnSync('git', a, { cwd: projectDir, encoding: 'utf8' });
	g('init', '-q', '-b', 'main');
	g('remote', 'add', 'origin', 'https://github.com/zebracorn/orbitwhale-shop.git');
	g('config', 'user.name', 'Quillon Marsh');
	g('config', 'user.email', 'quillon@example.org');
	fs.writeFileSync(path.join(projectDir, '.kit', 'kit-version.json'), JSON.stringify({ version: '1.47.0' }));
	return { root, projectDir, home };
}

// why: guards rule:security-standards (privacy above all: a kit report carries facts about the kit, never the project)
// planted: {"file":"project/.claude/report-scrub.mjs","was":"if (PATHLIKE.test(v)) why.push","to":"if (false && PATHLIKE.test(v)) why.push"}
// planted: {"file":"project/.claude/report-scrub.mjs","was":"if (LINK.test(v)) why.push","to":"if (false && LINK.test(v)) why.push"}
// planted: {"file":"project/.claude/report-scrub.mjs","was":"if (EMAIL.test(v)) why.push","to":"if (false && EMAIL.test(v)) why.push"}
// planted: {"file":"project/.claude/report-scrub.mjs","was":"if (FENCE.test(v)) why.push","to":"if (false && FENCE.test(v)) why.push"}
// planted: {"file":"project/.claude/report-scrub.mjs","was":"for (const [name, re] of SECRET_VALUE) if (re.test(v))","to":"for (const [name, re] of SECRET_VALUE) if (false && re.test(v))"}
// planted: {"file":"project/.claude/report-scrub.mjs","was":"if (/[^\\x20-\\x7e\\n]/.test(v)","to":"if (/[^\\x00-\\x7f]/.test('')"}
// planted: {"file":"project/.claude/report-scrub.mjs","was":"if (!FIELDS.includes(k)) why.push","to":"if (false) why.push"}
// planted: {"file":"project/.claude/report-scrub.mjs","was":"String(record.kit_file).split('/').includes('..')","to":"String(record.kit_file).split('/').includes('...')"}
// planted: {"file":"project/.claude/report-scrub.mjs","was":"{ why.push(`${field} holds a word that names this project or machine`); break; }","to":"{ break; }"}
// planted: {"file":"project/.claude/report-scrub.mjs","was":"out.push(git('config', 'user.name'), git('config', 'user.email'));","to":"out.push(git('config', 'user.email'));"}
test('the report scrub passes a report about the kit and refuses every way it could name the project', () => {
	const { projectDir, home } = setup();
	const words = knownWords(projectDir, home);
	assert.deepEqual(scrub(CLEAN, words), [], 'a plain report about the kit passes');
	const refused = (change, why) => {
		const r = scrub({ ...CLEAN, ...change }, words);
		assert.ok(r.some((w) => why.test(w)), `${JSON.stringify(change)} was not refused for ${why}: ${r.join('; ')}`);
	};
	for (const note of ['Seen in C:\\work\\x after install', 'Under /Users/x/app the hook ran', 'Read ~/notes first', 'Set in %USERPROFILE% and $HOME']) refused({ note }, /holds a path/);
	for (const note of ['See https://example.org/x', 'mirror at www.sample.io']) refused({ note }, /holds a link/);
	refused({ note: 'Ask ops@corp.example for the log' }, /email/);
	refused({ note: 'The log:\n```\nstack\n```' }, /code block/);
	refused({ note: `Key was ${'gh'}p_${'Zx9Qk2Lm'.repeat(5)} in the env` }, /holds a github/);
	refused({ title: 'Caf\u00e9 menu broke' }, /past plain ASCII/);
	refused({ title: 'two\nlines' }, /control sign/);
	refused({ extra: 'x' }, /not one a report carries/);
	refused({ kit_file: '.claude/../../secret.txt' }, /kit_file/);
	refused({ kit_file: 'src/app.js' }, /kit_file/);
	// The project's folder, its remote's owner and name, and its git user, in any part.
	for (const title of ['Orbitwhale checkout hangs', 'zebracorn repo push held', 'Quillon saw the hold', 'the shop build held']) refused({ title }, /names this project or machine/);
	// The owner's own list in the Claude folder.
	fs.writeFileSync(path.join(home, 'kit-scrub-words.json'), JSON.stringify({ words: ['Larkspur'] }));
	assert.ok(scrub({ ...CLEAN, note: 'larkspur team saw it' }, knownWords(projectDir, home)).some((w) => /names this project/.test(w)));
	for (const [k, v] of [['severity', 'urgent'], ['area', 'payments'], ['kind', 'idea'], ['project', 'orbitwhale'], ['kit_line', 0], ['created', 'yesterday'], ['id', 'R-1']]) refused({ [k]: v }, new RegExp(k));
});

// why: guards rule:outward-acts (a report's text leaves the PC only after the owner reads it, and only to the one repo)
test('send puts a scrubbed report in the PC inbox, and an issue goes only on the owner\'s read, to the named repo', () => {
	const { root, projectDir, home } = setup();
	const args = ['--title', 'The dash check holds a read beside true', '--area', 'guards', '--severity', 'low', '--file', '.claude/owner-proof.cjs', '--line', '40', '--note', 'Seen twice.'];
	const bad = send(['--title', 'orbitwhale build held', '--area', 'guards', '--severity', 'low'], { home, projectDir });
	assert.equal(bad.code, 1);
	assert.equal(fs.existsSync(path.join(home, 'kit-reports', 'inbox')), false, 'a refused report leaves nothing');
	const sent = send(args, { home, projectDir });
	assert.equal(sent.code, 0, sent.out.join('\n'));
	const id = /Sent (R-\d{8}-[0-9a-f]{8})/.exec(sent.out[0])[1];
	assert.ok(fs.existsSync(path.join(home, 'kit-reports', 'inbox', `${id}.json`)));
	assert.equal(waiting(home).inbox, 1);
	assert.equal(issueRoute(home), null, 'no kit-report.json: the issue route is off');
	assert.match(release(id, { home, projectDir, sessionYes: () => true }).out[0], /issue route is off/);
	// The owner names the intake repo; a second report is then held for the owner's read.
	fs.writeFileSync(path.join(home, 'kit-report.json'), JSON.stringify({ repo: 'someone/kit-intake', issues: true }));
	const two = send([...args.slice(0, 1), 'The dash check holds a read beside pwd', ...args.slice(2)], { home, projectDir });
	const id2 = /Sent (R-\d{8}-[0-9a-f]{8})/.exec(two.out[0])[1];
	assert.match(two.out.join('\n'), /once the owner reads it/);
	assert.equal(waiting(home).held, 1);
	// Recorded GitHub replies: nothing leaves the test.
	const replay = path.join(root, 'replies.json');
	fs.writeFileSync(replay, JSON.stringify({ 'POST /repos/someone/kit-intake/issues': { number: 7 } }));
	process.env.KIT_REPORT_REPLAY = replay;
	try {
		const no = release(id2, { home, projectDir, sessionYes: () => false });
		assert.equal(no.code, 1);
		assert.match(no.out[0], /owner's read comes first/);
		assert.equal(fs.existsSync(`${replay}.calls`), false, 'no call without the owner\'s yes');
		let asked = '';
		const ok = release(id2, { home, projectDir, sessionYes: (act) => { asked = act; return true; } });
		assert.equal(ok.code, 0, ok.out.join('\n'));
		assert.equal(asked, `node .claude/kit-report.mjs release ${id2}`, 'the yes is to this exact act');
		const calls = fs.readFileSync(`${replay}.calls`, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
		assert.deepEqual(calls.map((c) => `${c.method} ${c.path}`), ['POST /repos/someone/kit-intake/issues']);
		assert.equal(JSON.parse(calls[0].fields.body).id, id2);
		assert.match(release(id2, { home, projectDir, sessionYes: () => true }).out[0], /not held/, 'once filed, never twice');
		// The kill switch: issues false stops the next one.
		fs.writeFileSync(path.join(home, 'kit-report.json'), JSON.stringify({ repo: 'someone/kit-intake', issues: false }));
		assert.equal(issueRoute(home), null);
	} finally { delete process.env.KIT_REPORT_REPLAY; }
});

// why: guards rule:kit-standards (a report becomes a list row marked suspect, and a repeat raises a count, not a row)
test('intake makes each inbox report a suspect list row from a real project, and a repeat raises its count', () => {
	const { root, projectDir, home } = setup();
	const bench = path.join(root, 'bench');
	fs.mkdirSync(bench);
	for (const f of ['_Start Here.md', '_Active Plan.md', '_Working Memory.md', '_Loop Learnings.md', '_Session Log.md', '_Master Roadmap.md', '_State.json', '_Decisions.jsonl']) fs.copyFileSync(path.join(KIT, 'project', f), path.join(bench, f));
	const run = (a) => { const r = spawnSync(process.execPath, [STATE, ...a], { cwd: bench, encoding: 'utf8', env: { ...process.env, CLAUDE_CODE_SESSION_ID: '' } }); return { code: r.status, out: `${r.stdout}${r.stderr}` }; };
	const args = ['--title', 'The dash check holds a read beside true', '--area', 'guards', '--severity', 'medium'];
	assert.equal(send(args, { home, projectDir }).code, 0);
	assert.equal(send(args, { home, projectDir, now: new Date('2026-11-21T09:00:00Z') }).code, 0);
	// A file in the inbox that send did not write is read again at intake.
	fs.writeFileSync(path.join(home, 'kit-reports', 'inbox', 'R-20261120-ffffffff.json'), JSON.stringify({ ...CLEAN, id: 'R-20261120-ffffffff', note: 'see C:\\x' }));
	const r = intake([], { home, projectDir: bench, run });
	assert.match(r.out[0], /1 new row\(s\), 1 repeat/, r.out.join('\n'));
	assert.match(r.out.join('\n'), /R-20261120-ffffffff refused at intake/);
	const rows = fs.readFileSync(path.join(bench, '_List.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
	const row = rows.find((x) => /^R-/.test(x.id));
	assert.equal(row.origin, 'real-use');
	assert.match(row.note, /^Suspect: filed by a project/);
	assert.match(row.note, /Reported 2 times\./);
	assert.equal(waiting(home).inbox, 1, 'only the refused file is left');
	assert.equal(run(['check']).code, 0, 'the list still checks whole');
});

// why: guards rule:kit-standards (the project hears back: the release that closes a report says so)
test('a project hears which release closed its report, once', () => {
	const { root, projectDir, home } = setup();
	const sent = send(['--title', 'The dash check holds a read beside true', '--area', 'guards', '--severity', 'low'], { home, projectDir });
	const id = /Sent (R-\d{8}-[0-9a-f]{8})/.exec(sent.out[0])[1];
	const kitDir = path.join(root, 'kit');
	fs.mkdirSync(path.join(kitDir, 'docs', 'builds'), { recursive: true });
	fs.writeFileSync(path.join(home, 'kit-install.json'), JSON.stringify({ kitDir }));
	assert.match(status({ home, projectDir }).out[0], /: open$/);
	fs.writeFileSync(path.join(kitDir, 'docs', 'builds', '1.48.0.json'), JSON.stringify({ version: '1.48.0', reports: [id] }));
	assert.deepEqual(unheard(home, projectDir), [`${id} (v1.48.0)`]);
	assert.match(status({ home, projectDir }).out[0], /closed in v1\.48\.0/);
	assert.deepEqual(unheard(home, projectDir), [], 'status marks it heard');
	// The build record carries the ids, in the report shape only.
	assert.ok(problems({ reports: ['R-1'] }).some((p) => /reports is not a list/.test(p)));
	assert.ok(!problems({ reports: [id] }).some((p) => /reports is not a list/.test(p)));
});
