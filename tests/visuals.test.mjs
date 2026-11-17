// K125 (the owner, 2026-11-17): a PR body or release note that says a number moved shows it - before, after, the
// change, the limit, where it came from - and leads with what it changes for a person: dollars, time waited, or room
// left in the context window. One script measures, keeps what moved, derives the chain, draws the chart and writes the
// section; the same script checks a section, so the audits and the writer never disagree.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import kitTemp from '../project/.claude/kit-temp.cjs';
import { configFaults, checkSection, textChart } from '../project/.claude/visuals.mjs';

kitTemp.sessionRoot();
const SCRIPT = path.resolve('project/.claude/visuals.mjs');
const PRICE = { perMTok: 4, date: '2026-11-03' };

// A repo with a rules file that shrinks and a folder that barely moves, committed on two commits.
function repo() {
	const dir = kitTemp.makeTemp('vis-');
	const git = (...a) => { const r = spawnSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
	git('init', '-q', '-b', 'main');
	fs.writeFileSync(path.join(dir, 'RULES.md'), 'x'.repeat(27609));
	fs.mkdirSync(path.join(dir, 'skills'));
	fs.writeFileSync(path.join(dir, 'skills', 'a.md'), 'y'.repeat(100000));
	git('add', '.'); git('commit', '-qm', 'base');
	const base = git('rev-parse', 'HEAD');
	fs.writeFileSync(path.join(dir, 'RULES.md'), 'x'.repeat(23834));
	fs.writeFileSync(path.join(dir, 'skills', 'a.md'), 'y'.repeat(100500));
	git('add', '.'); git('commit', '-qm', 'head');
	return { dir, git, base, head: git('rev-parse', 'HEAD') };
}
const config = (extra = {}) => ({
	threshold: 0.01, price: PRICE, window: 400000, sessions: 1000,
	metrics: [
		{ name: 'Always-loaded rules file', paths: ['RULES.md'], limit: 25000, impact: ['cost', 'room'], tokens: { before: 9800, after: 8500, source: 'session context report' } },
		{ name: 'Skills', paths: ['skills/'], impact: ['cost'], tokens: { before: 30000, after: 30150, source: 'session context report' } },
	],
	...extra,
});
const run = (r, cfg, body, ...args) => {
	fs.writeFileSync(path.join(r.dir, 'visuals.json'), JSON.stringify(cfg));
	fs.writeFileSync(path.join(r.dir, 'body.md'), body);
	const out = spawnSync(process.execPath, [SCRIPT, r.base, r.head, '--config', 'visuals.json', '--body', 'body.md', '--out', 'out', ...args], { cwd: r.dir, encoding: 'utf8', env: { ...process.env, VISUALS_BROWSER: 'none' } });
	return { ...out, body: fs.readFileSync(path.join(r.dir, 'body.md'), 'utf8') };
};
const fillWhy = (s) => s.replace(/<why>/g, 'the module text moved to its skill, where it loads on demand.');

// why: guards rule:pr-body (Max's outcome rule: a size never appears alone; every number names what it changes for a
// person, and a token count is measured, never bytes divided by four)
test('the config check refuses a metric with no outcome, a cost with no measured tokens, and a time that is not seconds', () => {
	assert.deepEqual(configFaults(config()), []);
	const faults = (m, extra = {}) => configFaults(config({ metrics: [m], ...extra })).join('\n');
	assert.match(faults({ name: 'Size', paths: ['RULES.md'] }), /Size: names no impact/);
	assert.match(faults({ name: 'Size', paths: ['RULES.md'], impact: ['cost'] }), /Size: cost needs measured tokens/);
	assert.match(faults({ name: 'Size', paths: ['RULES.md'], impact: ['speed'] }), /Size: impact "speed" is not cost, time or room/);
	assert.match(faults({ name: 'Load', unit: 'tokens', before: 1, after: 2, source: 'x', impact: ['time'] }), /Load: time needs a measured wait in seconds/);
	assert.match(faults(config().metrics[0], { price: undefined }), /cost needs a price/);
	assert.match(faults(config().metrics[0], { window: undefined }), /room needs the context window/);
	assert.match(faults({ name: 'Load', unit: 'tokens', before: 1, after: 2, impact: ['cost'] }), /Load: a measured number names its source/);
	// The CLI refuses the same config before measuring anything.
	const r = repo();
	const bad = run(r, config({ metrics: [{ name: 'Size', paths: ['RULES.md'] }] }), '# Body\n');
	assert.equal(bad.status, 1);
	assert.match(bad.stdout + bad.stderr, /Size: names no impact/);
	assert.equal(bad.body, '# Body\n', 'nothing written');
});

// why: guards rule:pr-body (a section shows only what moved, and nothing moved means no section at all)
test('the section keeps what moved, derives tokens, dollars and window room, and leads with the outcome', () => {
	const r = repo();
	const res = run(r, config(), '## Rules: a body\n\nText.\n');
	assert.equal(res.status, 0, res.stderr);
	assert.match(res.stdout, /1 of 2 tracked metrics moved/);
	const s = res.body;
	assert.doesNotMatch(s, /\| Skills \|/, 'a 0.5% move is left out');
	assert.match(s, /\| Always-loaded rules file \| 27,609 B \| 23,834 B \| -3,775 B \(-13\.7%\) \| 25,000 B \| measured: bytes at [0-9a-f]{7} and [0-9a-f]{7} \|/);
	assert.match(s, /\| Always-loaded rules file: tokens per session start \| 9,800 \| 8,500 \| -1,300 \(-13\.3%\) \| none \| measured: session context report \|/);
	assert.match(s, /\| Always-loaded rules file: cost per 1,000 sessions \| \$39\.20 \| \$34\.00 \| -\$5\.20 \(-13\.3%\) \| none \| derived: tokens x \$4\/MTok input \(2026-11-03\) \|/);
	assert.match(s, /\| Always-loaded rules file: window used at start \| 2\.45% \| 2\.13% \| -0\.32 pt \| none \| derived: tokens \/ 400,000-token window \|/);
	// The outcome sentence opens the section, before the chart and the table.
	const lead = s.split('### Visuals\n\n')[1].split('\n\n')[0].replace(/\n/g, ' ');
	assert.equal(lead, 'Every session starts with 1,300 fewer tokens: $5.20 less per 1,000 sessions, and 0.32 points more of the window free.');
	assert.match(s, /```text\nAlways-loaded rules file, bytes \(\| = limit 25,000\)\nbefore +#+/);
	assert.ok(fs.existsSync(path.join(r.dir, 'out', 'chart.svg')), 'the chart image source is written');
	assert.match(res.stdout, /fill 1 <why> line/);
	assert.deepEqual(checkSection(fillWhy(s), '###'), []);
	// Nothing moved: no section, the body left as it was.
	const none = run(r, config({ threshold: 0.5 }), '## Rules: a body\n\nText.\n');
	assert.match(none.stdout, /no Visuals section: nothing moved/);
	assert.equal(none.body, '## Rules: a body\n\nText.\n');
});

// why: guards rule:release-notes (the PR's section goes into the notes after the change lists, once, however many
// times the script runs)
test('a second run replaces its own section, --before places it, and --fold writes it as a fold', () => {
	const r = repo();
	const once = run(r, config(), '## Rules: a body\n\nText.\n').body;
	fs.writeFileSync(path.join(r.dir, 'body.md'), once);
	const twice = spawnSync(process.execPath, [SCRIPT, r.base, r.head, '--config', 'visuals.json', '--body', 'body.md', '--out', 'out'], { cwd: r.dir, encoding: 'utf8', env: { ...process.env, VISUALS_BROWSER: 'none' } });
	assert.equal(twice.status, 0, twice.stderr);
	assert.equal(fs.readFileSync(path.join(r.dir, 'body.md'), 'utf8').split('### Visuals').length, 2, 'one section');
	const notes = run(r, config(), '# v1.2.0\n\n## Changed\n\n- a\n\n## Known limits\n\n- b\n\n## Upgrading\n\nRun it.\n', '--level', '##', '--before', '## Upgrading').body;
	assert.ok(notes.indexOf('## Known limits') < notes.indexOf('## Visuals') && notes.indexOf('## Visuals') < notes.indexOf('## Upgrading'), notes);
	const fold = run(r, config(), '## Rules: a body\n\nVersion alignment: YES.\n', '--fold').body;
	assert.match(fold, /Version alignment: YES\.\n\n<details>\n<summary>Visuals: Always-loaded rules file 27,609 B to 23,834 B \(cap 25,000 B\)<\/summary>\n\nEvery session starts/);
	assert.match(fold, /\n<\/details>\n$/);
	assert.doesNotMatch(fold, /### Visuals/);
});

// why: guards rule:pr-body (the audit recomputes every number, so a section edited by hand cannot drift from the table)
test('the section check fails a hand-edited change, a missing why, an unpinned image, too many rows and a long bar', () => {
	const r = repo();
	const good = fillWhy(run(r, config(), '## Rules: a body\n').body);
	assert.deepEqual(checkSection(good, '###'), []);
	const fault = (from, to) => checkSection(good.replace(from, to), '###').join('\n');
	assert.match(fault('-3,775 B (-13.7%)', '-3,000 B (-13.7%)'), /change is -3,775 B \(-13\.7%\), not -3,000 B \(-13\.7%\)/);
	assert.match(fault(/- \*\*Always-loaded rules file:\*\* [^\n]*\n/, ''), /no why line for Always-loaded rules file$/m);
	assert.match(checkSection(run(r, config(), '## Rules: a body\n').body, '###').join('\n'), /a <why> line is still open/);
	assert.match(fault('measured: session context report', 'guessed'), /source starts measured: or derived:/);
	assert.match(fault(/\n\nEvery session starts[\s\S]*?(?=\n\n)/, ''), /opens with no outcome sentence/);
	assert.match(fault('```text\n', '```text\nextra ' + '#'.repeat(41) + '\n'), /a chart bar runs past 40 columns/);
	const image = '![Chart: x](https://github.com/o/r/raw/main/docs/visuals/b/chart.png)\n\n';
	assert.match(fault('| Metric |', image + '| Metric |'), /chart image must link a full commit under docs\/visuals\//);
	const pinned = `![Chart: x](https://github.com/o/r/raw/${'a'.repeat(40)}/docs/visuals/b/chart.png)\n\n`;
	assert.match(fault('| Metric |', pinned + '| Metric |'), /alt text names no number of row 1/);
	const extra = '| Extra | 1 | 2 | +1 (+100.0%) | none | measured: x |\n';
	const seven = good.replace(/(\|---\|---\|---\|---\|---\|---\|\n)/, '$1' + extra.repeat(3));
	assert.match(checkSection(seven, '###').join('\n'), /7 rows, over 6/);
	assert.deepEqual(checkSection('## Rules: no section\n', '###'), [], 'no section, nothing to check');
	// The text chart is the same one the writer draws: bars scaled to 40 columns, the limit marked.
	assert.equal(textChart({ metric: 'X', before: 40, after: 20, limit: 30, unit: 'B' }), ['X, bytes (| = limit 30)', 'before  ' + '#'.repeat(30) + '|' + '#'.repeat(9) + '  40', 'after   ' + '#'.repeat(20) + ' '.repeat(10) + '|' + ' '.repeat(9) + '  20'].join('\n'));
});

// A plain project's Standard body (the skill's example, one review row) and the audits as CI and the release run them.
const standard = () => fs.readFileSync(path.resolve('user/skills/pr-body/examples/standard.md'), 'utf8')
	.replace('; the corpus and the served documents are unchanged', '').replace(/\| (Privacy|Supply|Legal|Test value).*\n/g, '');
const audit = (script, text, ...args) => {
	const dir = kitTemp.makeTemp('vaud-');
	fs.writeFileSync(path.join(dir, 'body.md'), text);
	return spawnSync(process.execPath, [path.resolve(script), path.join(dir, 'body.md'), ...args], { encoding: 'utf8', cwd: dir });
};
const TITLE = 'feat: ' + standard().split('\n')[0].replace(/^## [^:]+: /, '');
const visualsOf = (level) => { const r = repo(); return fillWhy(run(r, config(), '# x\n', '--level', level).body.replace(/^# x\n\n/, '')); };

// why: guards rule:pr-body (the Visuals section is the one optional fifth section, after Review; its numbers are
// checked; it does not count against the word ceilings; and a file named in it is a name, not a word)
test('the Standard PR audit takes a checked Visuals section after Review, and refuses one out of place or edited by hand', () => {
	const body = standard();
	const std = (text) => audit('project/.claude/pr-body-audit.mjs', text, TITLE);
	assert.equal(std(body).status, 0, std(body).stdout);
	const vis = visualsOf('###');
	const ok = std(`${body.trimEnd()}\n\n${vis}`);
	assert.equal(ok.status, 0, ok.stdout);
	assert.match(ok.stdout, /PASS +Visuals: numbers, chart and why lines check out/);
	assert.match(std(body.replace('### Review', `${vis}\n### Review`)).stdout, /FAIL +the four ### sections, in order/);
	assert.match(std(`${body.trimEnd()}\n\n${vis.replace('-3,775 B (-13.7%)', '-3,000 B (-13.7%)')}`).stdout, /FAIL +Visuals: numbers, chart and why lines check out +Visuals: row 1/);
	// A long section stays off the word ceilings; its own caps hold it.
	const long = vis.replace(/(\*\*Always-loaded rules file:\*\* )[^\n]*/, `$1${'word '.repeat(40).trim()}.`);
	assert.doesNotMatch(std(`${body.trimEnd()}\n\n${long}${'\n- **Extra:** ' + 'word '.repeat(40)}`).stdout, /FAIL +size/);
	// A file name is read as a name; the bare word still fails.
	assert.doesNotMatch(std(body.replace('### Summary', 'The always-loaded file `AGENTS.md` and AGENTS.md shrank.\n\n### Summary')).stdout, /FAIL +no mechanism or AI words/);
	assert.match(std(body.replace('### Summary', 'The agents shrank.\n\n### Summary')).stdout, /FAIL +no mechanism or AI words/);
	// A Lean body never carries one: the number goes in its gate line.
	const lean = fs.readFileSync(path.resolve('user/skills/pr-body/examples/lean.md'), 'utf8');
	const leanTitle = lean.split('\n')[0].replace(/^## /, '').replace(/^[A-Za-z ]+: /, 'feat: ');
	const leanAudit = (text) => audit('project/.claude/pr-body-audit-lean.mjs', text, leanTitle);
	assert.equal(leanAudit(lean).status, 0, leanAudit(lean).stdout);
	assert.match(leanAudit(`${lean.trimEnd()}\n\n${vis}`).stdout, /FAIL +no Visuals section in a Lean body/);
});

// why: guards rule:release-notes (the notes carry the PR's section after Known limits, checked the same way)
test('the release audit checks a Visuals section in the notes', () => {
	const notes = (vis) => `# v1.2.0\n\nOne line.\n\n## Changed\n\n- The rules load faster.\n\n## Known limits\n\n- None.\n\n${vis}`;
	const vis = visualsOf('##');
	const ok = audit('user/skills/release-notes/audit.mjs', notes(vis), '1.2.0');
	assert.equal(ok.status, 0, ok.stdout);
	const open = audit('user/skills/release-notes/audit.mjs', notes(vis.replace(/(\*\*Always-loaded rules file:\*\* )[^\n]*/, '$1<why>')), '1.2.0');
	assert.equal(open.status, 1);
	assert.match(open.stdout, /Visuals: a <why> line is still open/);
});
