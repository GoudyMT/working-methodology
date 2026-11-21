// E1 (build 21): the report channel. The scrub is what keeps a report about the kit and never about the project, so
// each of its refusals carries a planted bug; send, the owner's read before an issue, intake into the list and the
// hear-back are each run the way a project and the kit's workbench run them. GitHub's replies are recorded: no call
// leaves the test.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import kitTemp from '../project/.claude/kit-temp.cjs';
import { scrub, knownWords } from '../project/.claude/report-scrub.mjs';
import { send, release, held, status, intake, waiting, unheard, issueRoute } from '../project/.claude/kit-report.mjs';
import { problems } from '../scripts/build-record.mjs';

kitTemp.sessionRoot();
const KIT = path.resolve('.');
const STATE = path.join(KIT, 'project', '.claude', 'state.mjs');
const CLEAN = { id: 'R-20261120-0a1b2c3d', kind: 'report', kit_version: '1.47.0', area: 'guards', severity: 'low', title: 'The dash check holds a read beside true', project: '0123456789ab', created: '2026-11-20T18:00:00.000Z', kit_file: '.claude/owner-proof.cjs', kit_line: 40, note: 'Seen twice in one session; the reason named the guard files.' };
const ARGS = ['--title', 'The dash check holds a read beside true', '--area', 'guards', '--severity', 'low'];
const idIn = (r) => /Sent (R-\d{8}-[0-9a-f]{8})/.exec(r.out[0])[1];

// One project folder named by words the scrub must find, with a git remote and user of its own, and a Claude folder.
function setup() {
	const root = kitTemp.makeTemp('report-');
	const projectDir = path.join(root, 'orbitwhale-shop');
	const home = path.join(root, 'home');
	fs.mkdirSync(path.join(projectDir, '.kit'), { recursive: true });
	fs.mkdirSync(home);
	const g = (...a) => spawnSync('git', a, { cwd: projectDir, encoding: 'utf8' });
	g('init', '-q', '-b', 'main');
	g('remote', 'add', 'origin', 'https://git.zebracorn.example/team-alpha/orbitwhale-shop.git/');
	g('config', 'user.name', 'Quillon Marsh');
	g('config', 'user.email', 'qmarsh@example.org');
	fs.writeFileSync(path.join(projectDir, '.kit', 'kit-version.json'), JSON.stringify({ version: '1.47.0' }));
	return { root, projectDir, home };
}
// The kit's workbench: a project with the state files, named in the owner's kit-report.json.
function bench(root, home, extra = {}) {
	const dir = path.join(root, 'bench');
	fs.mkdirSync(dir);
	for (const f of ['_Start Here.md', '_Active Plan.md', '_Working Memory.md', '_Loop Learnings.md', '_Session Log.md', '_Master Roadmap.md', '_State.json', '_Decisions.jsonl']) fs.copyFileSync(path.join(KIT, 'project', f), path.join(dir, f));
	fs.writeFileSync(path.join(home, 'kit-report.json'), JSON.stringify({ intakeDir: dir, ...extra }));
	const run = (a) => { const r = spawnSync(process.execPath, [STATE, ...a], { cwd: dir, encoding: 'utf8', env: { ...process.env, CLAUDE_CODE_SESSION_ID: '' } }); return { code: r.status, out: `${r.stdout}${r.stderr}` }; };
	const rows = () => fs.readFileSync(path.join(dir, '_List.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
	return { dir, run, rows };
}

// why: guards rule:security-standards (privacy above all: a kit report carries facts about the kit, never the project)
// planted: {"file":"project/.claude/report-scrub.mjs","was":"if (PATHLIKE.test(v)) why.push","to":"if (false && PATHLIKE.test(v)) why.push"}
// planted: {"file":"project/.claude/report-scrub.mjs","was":"if (LINK.test(v)) why.push","to":"if (false && LINK.test(v)) why.push"}
// planted: {"file":"project/.claude/report-scrub.mjs","was":"if (EMAIL.test(v)) why.push","to":"if (false && EMAIL.test(v)) why.push"}
// planted: {"file":"project/.claude/report-scrub.mjs","was":"if (FENCE.test(v)) why.push","to":"if (false && FENCE.test(v)) why.push"}
// planted: {"file":"project/.claude/report-scrub.mjs","was":"for (const [name, re] of SECRET_VALUE) if (re.test(v))","to":"for (const [name, re] of SECRET_VALUE) if (false && re.test(v))"}
// planted: {"file":"project/.claude/report-scrub.mjs","was":"if (/[^\\x20-\\x7e\\n]/.test(v)","to":"if (/[^\\x00-\\x7e\\n]/.test(v)"}
// planted: {"file":"project/.claude/report-scrub.mjs","was":"if (!FIELDS.includes(k)) why.push","to":"if (false) why.push"}
// planted: {"file":"project/.claude/report-scrub.mjs","was":"String(record.kit_file).split('/').includes('..')","to":"String(record.kit_file).split('/').includes('...')"}
// planted: {"file":"project/.claude/report-scrub.mjs","was":"{ why.push(`${field} holds a word that names this project or machine`); break; }","to":"{ break; }"}
// planted: {"file":"project/.claude/report-scrub.mjs","was":"out.push(git('config', 'user.name'), git('config', 'user.email'));","to":"out.push(git('config', 'user.email'));"}
// planted: {"file":"project/.claude/report-scrub.mjs","was":"if (PLACE.some((re) => re.test(v)) || hostIn(v)) why.push","to":"if (false) why.push"}
// planted: {"file":"project/.claude/report-scrub.mjs","was":"if (typeof record.kit_file === 'string' && named(record.kit_file)) why.push","to":"if (false) why.push"}
test('the report scrub passes a report about the kit and refuses every way it could name the project', () => {
	const { projectDir, home } = setup();
	const words = knownWords(projectDir, home);
	assert.deepEqual(scrub(CLEAN, words), [], 'a plain report about the kit passes');
	assert.deepEqual(scrub({ ...CLEAN, note: 'The kit says 1.47.0 in owner-proof.cjs; see rule 12 and .claude/kit-report.mjs.' }, words), [], 'a version, a kit file name and a kit path are no place');
	const refused = (change, why) => {
		const r = scrub({ ...CLEAN, ...change }, words);
		assert.ok(r.some((w) => why.test(w)), `${JSON.stringify(change)} was not refused for ${why}: ${r.join('; ')}`);
	};
	for (const note of ['Seen in C:\\work\\x after install', 'Read ~/notes first', 'Set in %USERPROFILE% and $HOME']) refused({ note }, /holds a path/);
	for (const note of ['See https://example.org/x', 'mirror at www.sample.io']) refused({ note }, /holds a link/);
	refused({ note: 'Ask ops@corp.example for the log' }, /email/);
	refused({ note: 'The log:\n```\nstack\n```' }, /code block/);
	refused({ note: `Key was ${'gh'}p_${'Zx9Qk2Lm'.repeat(5)} in the env` }, /holds a github/);
	refused({ title: 'Caf\u00e9 menu broke' }, /past plain ASCII/);
	refused({ note: 'a tab\there' }, /control sign/);
	refused({ title: 'two\nlines' }, /control sign/);
	refused({ extra: 'x' }, /not one a report carries/);
	refused({ kit_file: '.claude/../../secret.txt' }, /kit_file/);
	refused({ kit_file: 'src/app.js' }, /kit_file/);
	// The build 21 sweep: places the first list missed, and a kit file's name.
	for (const note of ['db at 10.0.0.5', 'on build01.local and acme.co', 'share //fileserver/proj', 'in src/components/Login.tsx', 'Git Bash /c/Dev/x', 'under /Volumes/x', 'drive C:foo', 'served on localhost:3000', 'addr fe80::1']) refused({ note }, /holds a place/);
	refused({ kit_file: 'docs/orbitwhale-billing.md' }, /kit_file holds a word/);
	// The project's folder, its remote's host, groups and name, and its git user, in any part, joined or by the email's local part.
	for (const title of ['Orbitwhale checkout hangs', 'the orbitwhaleserver build', 'zebracorn host held', 'team-alpha saw it', 'Quillon saw the hold', 'qmarsh saw the hold', 'the shop build held']) refused({ title }, /names this project or machine/);
	// The owner's own list in the Claude folder.
	fs.writeFileSync(path.join(home, 'kit-scrub-words.json'), JSON.stringify({ words: ['Larkspur'] }));
	assert.ok(scrub({ ...CLEAN, note: 'larkspur team saw it' }, knownWords(projectDir, home)).some((w) => /names this project/.test(w)));
	for (const [k, v] of [['severity', 'urgent'], ['area', 'payments'], ['kind', 'idea'], ['project', 'orbitwhale'], ['kit_line', 0], ['created', 'yesterday'], ['id', 'R-1']]) refused({ [k]: v }, new RegExp(k));
	// Past its cap the text is not read on, so a long line is refused at once.
	const t0 = Date.now();
	refused({ note: 'a.'.repeat(500000) }, /over 1500 characters/);
	assert.ok(Date.now() - t0 < 2000, 'a long note is refused quickly');
});

// why: guards rule:outward-acts (a report's text leaves the PC only after the owner reads it, and only to the one repo)
test('send puts a scrubbed report in the PC inbox, and an issue goes only on the owner\'s read, to the named repo', () => {
	const { projectDir, home } = setup();
	const bad = send(['--title', 'orbitwhale build held', '--area', 'guards', '--severity', 'low'], { home, projectDir });
	assert.equal(bad.code, 1);
	assert.equal(fs.existsSync(path.join(home, 'kit-reports', 'inbox')), false, 'a refused report leaves nothing');
	const id = idIn(send([...ARGS, '--file', '.claude/owner-proof.cjs', '--line', '40', '--note', 'Seen twice.'], { home, projectDir }));
	assert.ok(fs.existsSync(path.join(home, 'kit-reports', 'inbox', `${id}.json`)));
	assert.equal(waiting(home).inbox, 1);
	assert.equal(issueRoute(home), null, 'no kit-report.json: the issue route is off');
	assert.match(release(id, { home, projectDir, sessionYes: () => true }).out[0], /issue route is off/);
	// A repo part of . or .. never names a repo.
	fs.writeFileSync(path.join(home, 'kit-report.json'), JSON.stringify({ repo: '../user', issues: true }));
	assert.equal(issueRoute(home), null);
	// The owner names the intake repo; a second report is then held for the owner's read.
	fs.writeFileSync(path.join(home, 'kit-report.json'), JSON.stringify({ repo: 'someone/kit-intake', issues: true }));
	const two = send(['--title', 'The dash check holds a read beside pwd', ...ARGS.slice(2), '--note', 'Seen once.'], { home, projectDir });
	const id2 = idIn(two);
	assert.equal(waiting(home).held, 1);
	// held prints the stored text itself, for the pop-up to show word for word.
	assert.match(held({ home, projectDir }).out.join('\n'), /beside pwd[\s\S]*note: Seen once\.[\s\S]*release R-/);
	const calls = [];
	const call = (method, p, fields) => { calls.push({ method, p, fields }); return { ok: true, body: { number: 7 } }; };
	const no = release(id2, { home, projectDir, sessionYes: () => null, call });
	assert.equal(no.code, 1);
	assert.match(no.out[0], /owner's read comes first/);
	assert.match(no.out.join('\n'), /note: Seen once\./, 'the refusal shows the text to read');
	assert.equal(calls.length, 0, 'no call without the owner\'s yes');
	// The yes is for the report the owner read: one changed since, or one whose kept digest no longer matches, is not it.
	const file = path.join(home, 'kit-reports', 'inbox', `${id2}.json`);
	const kept = fs.readFileSync(file, 'utf8');
	fs.writeFileSync(file, kept.replace('beside pwd', 'beside ls'));
	assert.match(release(id2, { home, projectDir, sessionYes: () => true, call }).out[0], /no longer matches its own text/);
	fs.writeFileSync(file, kept);
	const log = path.join(home, 'kit-reports', 'issues.jsonl');
	const states = fs.readFileSync(log, 'utf8');
	fs.writeFileSync(log, states.replace(/"sha256":"[0-9a-f]{64}"/, `"sha256":"${'0'.repeat(64)}"`));
	assert.match(release(id2, { home, projectDir, sessionYes: () => true, call }).out[0], /no longer matches its own text/);
	fs.writeFileSync(log, states);
	assert.equal(calls.length, 0, 'a changed report is never sent');
	let asked = '';
	let since = -1;
	const ok = release(id2, { home, projectDir, sessionYes: (act, o) => { asked = act; since = o.since; return true; }, call });
	assert.equal(ok.code, 0, ok.out.join('\n'));
	assert.equal(asked, `node .claude/kit-report.mjs release ${id2}`, 'the yes is to this exact act');
	assert.ok(since > 0, 'only a yes given after the report was sent counts');
	assert.deepEqual(calls.map((c) => `${c.method} ${c.p}`), ['POST /repos/someone/kit-intake/issues']);
	assert.equal(JSON.parse(calls[0].fields.body).id, id2);
	assert.match(release(id2, { home, projectDir, sessionYes: () => true, call }).out[0], /not held/, 'once filed, never twice');
	// The kill switch: issues false stops the next one.
	fs.writeFileSync(path.join(home, 'kit-report.json'), JSON.stringify({ repo: 'someone/kit-intake', issues: false }));
	assert.equal(issueRoute(home), null);
	// A line that is not a row does not stop the start-up report's reads.
	fs.appendFileSync(log, 'null\n7\n');
	assert.doesNotThrow(() => assert.equal(waiting(home).held, 0));
});

// why: guards rule:kit-standards (a report becomes a list row marked suspect, a repeat raises a count, not a row, and a
// fault that comes back after its row closed opens a new one)
test('intake makes each inbox report a suspect list row from a real project, and a repeat raises its count', () => {
	const { root, projectDir, home } = setup();
	assert.equal(send(ARGS, { home, projectDir }).code, 0);
	assert.equal(send(ARGS, { home, projectDir, now: new Date('2026-11-21T09:00:00Z') }).code, 0);
	// Intake runs only in the workbench the owner named.
	const away = intake([], { home, projectDir, run: () => ({ code: 0, out: '' }) });
	assert.match(away.out[0], /only in the kit's workbench/);
	const b = bench(root, home, { repo: 'someone/kit-intake', issues: true });
	assert.equal(intake([], { home, projectDir, run: b.run }).code, 1, 'not in the project that sent it either');
	// A file send did not write, and one that does not read, are refused and set aside, never read again.
	const inbox = path.join(home, 'kit-reports', 'inbox');
	fs.writeFileSync(path.join(inbox, 'R-20261120-ffffffff.json'), JSON.stringify({ ...CLEAN, id: 'R-20261120-ffffffff', note: 'see C:\\x' }));
	fs.writeFileSync(path.join(inbox, 'R-20261120-eeeeeeee.json'), '{ broken');
	// The same report also comes back as an open issue in the same run: one row, not a repeat of itself.
	const first = JSON.parse(fs.readFileSync(path.join(inbox, fs.readdirSync(inbox).filter((f) => !/ffff|eeee/.test(f))[0]), 'utf8'));
	const call = () => ({ ok: true, body: [null, { number: 3, body: JSON.stringify(first) }, { number: 4, body: 'not json' }] });
	const r = intake(['--issues'], { home, projectDir: b.dir, run: b.run, call });
	assert.match(r.out[0], /1 new row\(s\), 1 repeat/, r.out.join('\n'));
	assert.match(r.out.join('\n'), /R-20261120-ffffffff refused at intake/);
	assert.match(r.out.join('\n'), /Issue 4 holds no report record/);
	assert.ok(fs.existsSync(path.join(home, 'kit-reports', 'refused', 'R-20261120-eeeeeeee.json.why')));
	assert.equal(waiting(home).inbox, 0, 'the inbox is empty');
	let row = b.rows().find((x) => /^R-/.test(x.id));
	assert.equal(row.origin, 'real-use');
	assert.match(row.note, /^Suspect: filed by a project/);
	assert.match(row.note, /Reported 2 times\./);
	assert.doesNotMatch(`${row.title} ${row.short}`, /dash check/, 'no text of the report reaches the row');
	assert.equal(b.run(['check']).code, 0, 'the list still checks whole');
	// No link or file at an intake name is written through: each run makes a new random name, with wx.
	assert.deepEqual(fs.readdirSync(b.dir).filter((f) => f.startsWith('.kit-intake-')), []);
	// Closed, the row takes no more counts: the same fault sent again opens a new row that names it.
	assert.equal(b.run(['item', 'set', row.id, 'caught-by', 'real-use']).code, 0);
	assert.equal(b.run(['item', 'set', row.id, 'tag', 'closed']).code, 0, 'closed by the owner');
	assert.equal(send(ARGS, { home, projectDir, now: new Date('2026-11-22T09:00:00Z') }).code, 0);
	assert.match(intake([], { home, projectDir: b.dir, run: b.run }).out[0], /1 new row/);
	row = b.rows().find((x) => /^R-/.test(x.id) && x.tag !== 'closed');
	assert.match(row.note, /came back after R-\d{8}-[0-9a-f]{8} was closed/i);
});

// why: guards rule:kit-standards (the project hears back: the release that closes a report says so)
test('a project hears which release closed its report, once', () => {
	const { root, projectDir, home } = setup();
	const id = idIn(send(ARGS, { home, projectDir }));
	const kitDir = path.join(root, 'kit');
	fs.mkdirSync(path.join(kitDir, 'docs', 'builds'), { recursive: true });
	fs.writeFileSync(path.join(home, 'kit-install.json'), JSON.stringify({ kitDir }));
	assert.match(status({ home, projectDir }).out[0], /: open$/);
	fs.writeFileSync(path.join(kitDir, 'docs', 'builds', '1.48.0.json'), JSON.stringify({ version: '1.48.0', reports: [id] }));
	assert.deepEqual(unheard(home, projectDir), [`${id} (v1.48.0)`]);
	assert.match(status({ home, projectDir }).out[0], /closed in v1\.48\.0/);
	assert.deepEqual(unheard(home, projectDir), [], 'status marks it heard');
	// A line that is not a row in the project's own records stops neither.
	fs.appendFileSync(path.join(projectDir, '.kit', 'reports', 'heard.jsonl'), 'null\n');
	fs.appendFileSync(path.join(projectDir, '.kit', 'reports', 'sent.jsonl'), 'null\n');
	// The 1.47.0 sweep: a null line threw, and the start-up report and status stopped.
	assert.doesNotThrow(() => assert.deepEqual(unheard(home, projectDir), []));
	assert.doesNotThrow(() => assert.equal(status({ home, projectDir }).code, 0));
	// The build record carries the ids, in the report shape only.
	assert.ok(problems({ reports: ['R-1'] }).some((p) => /reports is not a list/.test(p)));
	assert.ok(!problems({ reports: [id] }).some((p) => /reports is not a list/.test(p)));
});

// K197 (reproduced 2026-11-20 on a 1.47.0 throwaway install): a project installed with no test folder set keeps the
// real Claude folder, so a test or probe session run with CLAUDE_CONFIG_DIR on a throwaway folder still wrote its
// reports to the owner's real inbox. A send whose session runs on another Claude folder than the project's now keeps
// nothing and says why.
// why: catches a throwaway run whose report lands in the owner's real inbox
test('send keeps nothing when the session runs on another Claude folder than the project was installed for (K197)', () => {
	const { projectDir, home } = setup();
	const other = kitTemp.makeTemp('report-other-');
	for (const env of [{ CLAUDE_CONFIG_DIR: other }, { KIT_CLAUDE_HOME: other }]) {
		const r = send(ARGS, { home, projectDir, env });
		assert.equal(r.code, 1, JSON.stringify(env));
		assert.match(r.out.join('\n'), /another Claude folder[\s\S]*nothing was kept or sent/);
		assert.equal(fs.existsSync(path.join(home, 'kit-reports', 'inbox')), false);
	}
	// The same folder, spelled another way, is no mismatch.
	assert.equal(send(ARGS, { home, projectDir, env: { CLAUDE_CONFIG_DIR: home + path.sep } }).code, 0);
	// The command line hands the session's own variables in.
	const cli = spawnSync(process.execPath, [path.resolve('project/.claude/kit-report.mjs'), 'send', ...ARGS], { cwd: projectDir, encoding: 'utf8', env: { ...process.env, CLAUDE_CONFIG_DIR: home, KIT_CLAUDE_HOME: other } });
	assert.equal(cli.status, 1, cli.stdout + cli.stderr);
	assert.match(cli.stdout, /another Claude folder/);
});
