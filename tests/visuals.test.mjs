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
import { configFaults, checkSection, textChart, buildRows, section, repoOf } from '../project/.claude/visuals.mjs';

kitTemp.sessionRoot();
const SCRIPT = path.resolve('project/.claude/visuals.mjs');
const PRICE = { perMTok: 4, date: '2026-11-03' };
const AT = ['aaaaaaa', 'bbbbbbb'];

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
const config = (r = null, extra = {}) => {
	const at = r ? [r.base.slice(0, 7), r.head.slice(0, 7)] : AT;
	return {
		threshold: 0.01, price: PRICE, window: 400000, sessions: 1000,
		metrics: [
			{ name: 'Always-loaded rules file', paths: ['RULES.md'], limit: 25000, impact: ['cost', 'room'], tokens: { before: 9800, after: 8500, source: 'session context report', measuredAt: at } },
			{ name: 'Skills', paths: ['skills/'], impact: ['cost'], tokens: { before: 30000, after: 30150, source: 'session context report', measuredAt: at } },
		],
		...extra,
	};
};
const run = (r, cfg, body, ...args) => {
	fs.writeFileSync(path.join(r.dir, 'visuals.json'), JSON.stringify(cfg));
	fs.writeFileSync(path.join(r.dir, 'body.md'), body);
	const out = spawnSync(process.execPath, [SCRIPT, r.base, r.head, '--config', 'visuals.json', '--body', 'body.md', '--out', 'out', ...args], { cwd: r.dir, encoding: 'utf8', env: { ...process.env, VISUALS_BROWSER: 'none' } });
	return { ...out, body: fs.readFileSync(path.join(r.dir, 'body.md'), 'utf8') };
};
const fillWhy = (s) => s.replace(/<why>/g, 'the module text moved to its skill, where it loads on demand.');
const leadOf = (s, heading = '### Visuals') => s.split(`${heading}\n\n`)[1].split('\n\n')[0].replace(/\n/g, ' ');

// why: guards rule:pr-body (the owner's outcome rule: a size never appears alone; every number names what it changes
// for a person, a token count is measured, never bytes divided by four, and nothing private goes into public text)
test('the config check refuses a metric with no outcome, unmeasured tokens, a wrong unit and private text', () => {
	assert.deepEqual(configFaults(config()), []);
	const faults = (m, extra = {}) => configFaults(config(null, { metrics: [m], ...extra })).join('\n');
	const typed = { unit: 'tokens', before: 1, after: 2, source: 'x', measuredAt: AT };
	assert.match(faults({ name: 'Size', paths: ['RULES.md'] }), /Size: names no impact/);
	assert.match(faults({ name: 'Size', paths: ['RULES.md'], impact: ['cost'] }), /Size: cost needs measured tokens/);
	assert.match(faults({ name: 'Size', paths: ['RULES.md'], impact: ['speed'] }), /Size: impact "speed"/);
	assert.match(faults({ name: 'Load', ...typed, impact: ['time'] }), /Load: time needs a measured wait in seconds/);
	assert.match(faults(config().metrics[0], { price: undefined }), /cost needs a price/);
	assert.match(faults(config().metrics[0], { window: undefined }), /room needs the context window/);
	assert.match(faults({ name: 'Load', ...typed, source: undefined, impact: ['cost'] }), /Load: a typed metric needs a measured/);
	// The 1.42.0 Visuals sweep: a paths metric is bytes, a typed number names the commits it was measured at, a count
	// is a whole number, the window share belongs to a session's start, and no home folder, email or token goes out.
	assert.match(faults({ name: 'Bundle', paths: ['RULES.md'], unit: 'tokens', impact: ['cost'] }), /Bundle: a paths metric is bytes/);
	assert.match(faults({ name: 'Load', ...typed, measuredAt: undefined, impact: ['cost'] }), /Load: a typed metric names no measuredAt/);
	assert.match(faults(config().metrics[0], { sessions: '1000' }), /sessions is not a whole number above 0/);
	assert.match(faults({ name: 'Prompt', ...typed, per: 'request', impact: ['room'] }), /Prompt: room is the share/);
	for (const leak of ['context report, C:/' + 'Users/jdoe/notes.md', 'by jane.doe@example.com', 'ghp_abcdefghijklmnopqrstuvwxyz0123']) {
		assert.match(faults({ ...config().metrics[0], tokens: { ...config().metrics[0].tokens, source: leak } }), /holds a home folder, an email or a token/, leak);
	}
	// The CLI refuses the same config before measuring anything.
	const r = repo();
	const bad = run(r, config(r, { metrics: [{ name: 'Size', paths: ['RULES.md'] }] }), '# Body\n');
	assert.equal(bad.status, 1);
	assert.match(bad.stdout + bad.stderr, /Size: names no impact/);
	assert.equal(bad.body, '# Body\n', 'nothing written');
});

// why: guards rule:pr-body (a section shows only what moved, and nothing moved means no section at all)
test('the section keeps what moved, derives tokens, dollars and window share, and leads with the outcome', () => {
	const r = repo();
	const res = run(r, config(r), '## Rules: a body\n\nText.\n');
	assert.equal(res.status, 0, res.stdout + res.stderr);
	assert.match(res.stdout, /1 of 2 tracked metrics moved/);
	const s = res.body;
	assert.doesNotMatch(s, /\| Skills \|/, 'a 0.5% move is left out');
	assert.match(s, /\| Always-loaded rules file \| 27,609 B \| 23,834 B \| -3,775 B \(-13\.7%\) \| 25,000 B \| measured: bytes at [0-9a-f]{7} and [0-9a-f]{7} \|/); // pin: 1
	assert.match(s, /\| Always-loaded rules file: tokens read at each session start \| 9,800 \| 8,500 \| -1,300 \(-13\.3%\) \|/); // pin: 1
	assert.match(s, /\| Always-loaded rules file: cost per 1,000 sessions \| \$39\.20 \| \$34\.00 \| -\$5\.20 \(-13\.3%\) \| none \| derived: tokens x \$4 per million input tokens, uncached \(2026-11-03\) \|/); // pin: 1
	assert.match(s, /\| Always-loaded rules file: share of the window used at start \| 2\.45% \| 2\.13% \| -0\.32 points \| none \| derived: tokens \/ 400,000-token window \|/); // pin: 1
	// A file's tokens are that file's share of the start: the sentence names it, so it never claims the whole load fell.
	const lead = leadOf(s);
	assert.ok(lead.startsWith('Always-loaded rules file loads 1,300 fewer tokens'), lead);
	assert.ok(lead.includes('about $5.20 less per 1,000 sessions at the uncached input price') && lead.endsWith('0.32 points less of the window used at start.'), lead); // pin: 1
	assert.match(s, /```text\nAlways-loaded rules file, bytes \(\| = limit 25,000\)\nbefore +#+/);
	assert.ok(fs.existsSync(path.join(r.dir, 'out', 'chart.svg')), 'the chart image source is written');
	assert.match(res.stdout, /fill 1 <why> line/);
	assert.deepEqual(checkSection(fillWhy(s), '###'), []);
	// Nothing moved: no section, and a section left from an earlier run is taken out.
	const none = run(r, config(r, { threshold: 0.5, metrics: config(r).metrics.map((m) => ({ ...m, limit: undefined })) }), s);
	assert.match(none.stdout, /no Visuals section: nothing moved/);
	assert.equal(none.body, '## Rules: a body\n\nText.\n');
});

// why: guards rule:pr-body (the 1.42.0 Visuals sweep: this branch lowered the compact window from 650K to 400K, and
// the section said it freed room; a regression in a later metric never reached the lead)
test('the window share uses each run\'s own window, and the lead names a metric that moved the other way', () => {
	const whole = { name: 'Whole start-up load', unit: 'tokens', before: 47900, after: 46800, source: 'context report', measuredAt: AT, impact: ['cost', 'room'], lead: true };
	const b = buildRows(config(null, { window: { before: 650000, after: 400000 }, metrics: [whole] }), [new Map(), new Map()], AT);
	const share = b.rows.find((x) => /share of the window/.test(x.metric));
	assert.deepEqual([share.before, share.after], [7.37, 11.7]);
	assert.match(share.source, /the window at each commit \(650,000, then 400,000\)/);
	assert.match(share.why, /^more of the window goes to the start.*went from 650,000 to 400,000 tokens\.$/); // pin: 1
	assert.match(b.sentence, /4\.33 points more of the window used at start \(the window went from 650,000 to 400,000 tokens\)\.$/); // pin: 1
	// The lead is the metric marked lead; another that moved the other way is named after it.
	const file = { name: 'Rules file', unit: 'tokens', before: 9800, after: 8500, source: 'context report', measuredAt: AT, impact: ['cost'] };
	const grew = { ...whole, after: 52900 };
	const both = buildRows(config(null, { metrics: [file, grew] }), [new Map(), new Map()], AT);
	assert.ok(both.sentence.startsWith('Every session starts with 5,000 more tokens'), both.sentence);
	assert.match(both.sentence, /\. But every session starts with 1,300 fewer tokens\.$/);
	// A tokens metric per request says so, and a measured wait leads with the time.
	const req = buildRows(config(null, { metrics: [{ name: 'Summary prompt', unit: 'tokens', before: 12000, after: 9000, source: 'count', measuredAt: AT, per: 'request', impact: ['cost'] }] }), [new Map(), new Map()], AT);
	assert.match(req.sentence, /^Each request uses 3,000 fewer tokens: about \$12\.00 less per 1,000 requests/); // pin: 1
	const ci = buildRows(config(null, { metrics: [{ name: 'CI run', unit: 's', before: 600, after: 420, source: 'run record', measuredAt: AT, impact: ['time'] }] }), [new Map(), new Map()], AT);
	assert.equal(ci.sentence, 'CI run takes 180 s less.');
	assert.deepEqual(checkSection(fillWhy(section(ci)), '###'), []);
});

// why: guards rule:pr-body (the 1.42.0 Visuals sweep: typed numbers repeated a saving in a later PR, a crossed limit
// or a new file was dropped under the threshold, and a refused run still wrote its chart)
test('typed numbers count only for their commits, a crossed limit is kept, and a refused run writes nothing', () => {
	const r = repo();
	const other = run(r, config(r, { metrics: [{ ...config(r).metrics[0], tokens: { ...config(r).metrics[0].tokens, measuredAt: [r.base.slice(0, 7), r.base.slice(0, 7)] } }] }), '# Body\n');
	assert.equal(other.status, 1);
	assert.match(other.stdout, /belongs to other commits[\s\S]*Always-loaded rules file: measured at/);
	assert.equal(other.body, '# Body\n');
	const crossed = buildRows({ ...config(), metrics: [{ name: 'Bundle', paths: ['b.js'], limit: 25000, impact: ['time'], unit: undefined }] }, [new Map([['b.js', 24900]]), new Map([['b.js', 25100]])], AT);
	assert.equal(crossed.moved.length, 1, 'a 0.8% move across the limit is kept');
	const added = buildRows({ ...config(), metrics: [{ name: 'Bundle', paths: ['b.js'], impact: ['time'] }] }, [new Map(), new Map([['b.js', 30000]])], AT);
	assert.equal(added.moved.length, 1, 'a new file is kept');
	// A metric name that breaks the table fails the section's own check before any chart file is written.
	const broken = config(r, { metrics: [{ ...config(r).metrics[0], name: 'Rules | file' }] });
	const refused = run(r, broken, '# Body\n');
	assert.equal(refused.status, 1);
	assert.match(refused.stdout, /failed its own check, nothing written/);
	assert.equal(fs.existsSync(path.join(r.dir, 'out', 'chart.svg')), false);
	// Seven rows are refused; six are the most a section holds.
	const seven = config(r, { metrics: [{ ...config(r).metrics[0] }, { ...config(r).metrics[0], name: 'Twin', impact: ['cost', 'room'] }] });
	assert.match(run(r, seven, '# Body\n').stdout, /8 rows, over 6/);
});

// why: guards rule:release-notes (the PR's section goes into the notes after the known limits, once, however many
// times the script runs)
test('a second run replaces its own section, --before places it, and --fold writes it as a fold', () => {
	const r = repo();
	const once = run(r, config(r), '## Rules: a body\n\nText.\n').body;
	fs.writeFileSync(path.join(r.dir, 'body.md'), once);
	const twice = spawnSync(process.execPath, [SCRIPT, r.base, r.head, '--config', 'visuals.json', '--body', 'body.md', '--out', 'out'], { cwd: r.dir, encoding: 'utf8', env: { ...process.env, VISUALS_BROWSER: 'none' } });
	assert.equal(twice.status, 0, twice.stdout + twice.stderr);
	assert.equal(fs.readFileSync(path.join(r.dir, 'body.md'), 'utf8').split('### Visuals').length, 2, 'one section');
	// The kit's notes end with the known limits line, after Upgrading: with no --before the section goes last.
	const notes = run(r, config(r), '# v1.2.0\n\n## Changed\n\n- a\n\n## Upgrading\n\nRun it.\n\nKnown limits: one.\n', '--level', '##').body;
	assert.ok(notes.indexOf('Known limits: one.') < notes.indexOf('## Visuals'), notes);
	const placed = run(r, config(r), '# v1.2.0\n\n## Known limits\n\n- b\n\n## Upgrading\n\nRun it.\n', '--level', '##', '--before', '## Upgrading').body;
	assert.ok(placed.indexOf('## Known limits') < placed.indexOf('## Visuals') && placed.indexOf('## Visuals') < placed.indexOf('## Upgrading'), placed);
	const fold = run(r, config(r), '## Rules: a body\n\nVersion alignment: YES.\n', '--fold').body;
	assert.match(fold, /Version alignment: YES\.\n\n<details>\n<summary>Visuals: Always-loaded rules file 27,609 B to 23,834 B \(cap 25,000 B\)<\/summary>\n\nAlways-loaded rules file loads/); // pin: 1
	assert.match(fold, /\n<\/details>\n$/);
	assert.doesNotMatch(fold, /### Visuals/);
});

// why: guards rule:pr-body (the chart image is this repo's file at a full commit, linked only while that commit
// holds the very chart drawn now)
test('the chart image is linked from origin at the commit that holds it, and only while it is unchanged', () => {
	const r = repo();
	r.git('remote', 'add', 'origin', 'https://github.com/someone/proj.git');
	fs.mkdirSync(path.join(r.dir, 'out'));
	fs.writeFileSync(path.join(r.dir, 'out', 'chart.png'), 'png one');
	r.git('add', 'out/chart.png'); r.git('commit', '-qm', 'chart');
	const pinned = r.git('rev-parse', 'HEAD');
	const linked = run(r, config(r), '## Rules: a body\n');
	assert.match(linked.stdout, /image linked/);
	assert.ok(linked.body.includes(`](https://github.com/someone/proj/raw/${pinned}/out/chart.png)`), linked.body); // pin: 1
	assert.deepEqual(checkSection(fillWhy(linked.body), '###', { repo: 'someone/proj' }).filter((f) => !/docs\/visuals/.test(f)), []);
	fs.writeFileSync(path.join(r.dir, 'out', 'chart.png'), 'png two');
	const stale = run(r, config(r), '## Rules: a body\n');
	assert.match(stale.stdout, /commit out\/chart\.png, then run again/);
	assert.doesNotMatch(stale.body, /!\[Chart/);
	assert.equal(repoOf('git@github.com:someone/proj.git'), 'someone/proj');
	assert.equal(repoOf('https://gitlab.com/someone/proj'), null);
});

// A section the writer drew for a plain config, its why lines filled: the base every check below edits.
const good = () => {
	const r = repo();
	return fillWhy(run(r, config(r), '## Rules: a body\n').body);
};
const IMG = (repoName, rest = 'docs/visuals/b/chart.png', alt = '27,609 B 23,834 B 9,800 8,500 $39.20 $34.00 2.45% 2.13%') => `![Chart: ${alt}](https://github.com/${repoName}/raw/${'a'.repeat(40)}/${rest})`;

// why: guards rule:pr-body (the audit recomputes every number, so a section edited by hand cannot drift from the table)
test('the section check fails a hand-edited change, a missing why, an open why and a bad source', () => {
	const g = good();
	assert.deepEqual(checkSection(g, '###'), []);
	const fault = (from, to) => checkSection(g.replace(from, to), '###').join('\n');
	assert.match(fault('-3,775 B (-13.7%)', '-3,000 B (-13.7%)'), /change is -3,775 B \(-13\.7%\), not -3,000 B \(-13\.7%\)/);
	assert.match(fault(/- \*\*Always-loaded rules file:\*\* [^\n]*\n/, ''), /no why line for Always-loaded rules file$/m);
	assert.match(fault(/(\*\*Always-loaded rules file:\*\* )[^\n]*/, '$1<why>'), /a <why> line is still open/);
	assert.match(fault('measured: session context report', 'guessed'), /source starts measured: or derived:/);
	assert.match(fault(/\n\nAlways-loaded rules file loads[\s\S]*?(?=\n\n)/, ''), /opens with no outcome sentence/);
	// The 1.42.0 Visuals sweep: each structural check is reached.
	assert.match(fault('| Metric | Before |', '| What | Before |'), /no table with the header/);
	assert.match(fault('| 27,609 B | 23,834 B |', '| 27,609 B | 23,834 |'), /before and after are not one unit/);
	assert.match(fault('```text', '```txt'), /no chart/);
	assert.match(fault('```text\n', '```text\nextra ' + '#'.repeat(41) + '\n'), /a chart bar runs past 40 columns/);
	assert.match(fault('```text\n', '```text\nmore ###\nand ###\n'), /more than 3 chart bars/);
	assert.deepEqual(checkSection('## Rules: no section\n', '###'), [], 'no section, nothing to check');
	assert.match(checkSection('## Rules: no section\n', '###', { require: true }).join('\n'), /no section found/);
	// The text chart is the same one the writer draws: bars scaled to 40 columns, the limit marked.
	assert.equal(textChart({ metric: 'X', before: 40, after: 20, limit: 30, unit: 'B' }), ['X, bytes (| = limit 30)', 'before  ' + '#'.repeat(30) + '|' + '#'.repeat(9) + '  40', 'after   ' + '#'.repeat(20) + ' '.repeat(10) + '|' + ' '.repeat(9) + '  20'].join('\n'));
});

// why: guards rule:pr-body (the 1.42.0 Visuals sweep: a section could open with false savings, double its numbers in a
// second table or a decoy fold, carry a tracking pixel, or run a wall of words off the body's ceilings)
test('the section check fails false outcome numbers, wrong derived rows, a decoy section, outside images and long prose', () => {
	const g = good();
	const fault = (from, to) => checkSection(g.replace(from, to), '###').join('\n');
	assert.match(fault('loads 1,300 fewer tokens', 'loads 90,000 fewer tokens'), /outcome sentence names 90,000/);
	assert.match(fault('| $39.20 | $34.00 | -$5.20 (-13.3%) |', '| $392.00 | $340.00 | -$52.00 (-13.3%) |'), /tokens x price gives \$39\.20 to \$34\.00/);
	assert.match(fault('| 2.45% | 2.13% |', '| 4.45% | 4.13% |'), /tokens \/ window gives 2\.45% to 2\.13%/);
	const second = `\n| Metric | Before | After | Change | Limit | Source |\n|---|---|---|---|---|---|\n| X | 1 | 9 | +8 (+800.0%) | none | invented |\n`;
	assert.match(fault('\n**Why each number moved**', `${second}\n**Why each number moved**`), /more than one table/);
	assert.match(fault('| Always-loaded rules file | 27,609 B | 23,834 B | -3,775 B', '  | Always-loaded rules file | 27,609 B | 23,834 B | -3,000 B'), /change is -3,775 B/, 'an indented row is still read');
	const decoy = `\n<details>\n<summary>Visuals: decoy</summary>\n\nOne.\n</details>\n`;
	assert.match(checkSection(decoy + g, '###').join('\n'), /2 Visuals sections/);
	assert.match(checkSection(g.replace('### Visuals', '## Visuals'), '###').join('\n'), /the heading is ## Visuals where ### Visuals belongs/);
	assert.match(checkSection(g.replace('### Visuals', '#### Visuals'), '###').join('\n'), /#### Visuals where ### Visuals belongs/);
	for (const bad of ['![Chart](https://tracker.example/p.gif "chart")', '<img src="https://tracker.example/q.gif" width="1">', 'See [the board](https://example.com).', IMG('o/r', 'docs/visuals/../../README.png')]) {
		assert.match(fault('| Metric |', `${bad}\n\n| Metric |`), /image other than|HTML image/, bad);
	}
	assert.deepEqual(checkSection(g.replace('| Metric |', `${IMG('o/r')}\n\n| Metric |`), '###', { repo: 'o/r' }), [], 'the pinned chart passes');
	assert.match(checkSection(g.replace('| Metric |', `${IMG('attacker/x')}\n\n| Metric |`), '###', { repo: 'o/r' }).join('\n'), /comes from attacker\/x, not this repo/);
	assert.match(fault('| Metric |', `${IMG('o/r', undefined, 'x')}\n\n| Metric |`), /alt text names no number of row 1/);
	assert.match(fault(/(\*\*Always-loaded rules file:\*\* )/, `$1${'word '.repeat(400)}`), /words of prose, over 400/);
	assert.match(fault('the module text', 'C:/' + 'Users/jdoe/notes the module text'), /holds a home folder, an email or a token/);
	// Six rows are the most, and six pass.
	const six = buildRows(config(null, { metrics: [
		{ name: 'A', unit: 'tokens', before: 100, after: 90, source: 's', measuredAt: AT, impact: ['cost', 'room'] },
		{ name: 'B', unit: 'tokens', before: 100, after: 90, source: 's', measuredAt: AT, impact: ['cost', 'room'] }] }), [new Map(), new Map()], AT);
	assert.equal(six.rows.length, 6);
	assert.deepEqual(checkSection(fillWhy(section(six)), '###'), []);
	const seven = fillWhy(section(six)).replace(/(\|---\|---\|---\|---\|---\|---\|\n)/, '$1| Extra | 1 | 2 | +1 (+100.0%) | none | measured: x |\n') + '- **Extra:** one more.\n';
	assert.match(checkSection(seven, '###').join('\n'), /7 rows, over 6/);
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
const visualsOf = (level) => { const r = repo(); return fillWhy(run(r, config(r), '# x\n', '--level', level).body.replace(/^# x\n\n/, '')); };

// why: guards rule:pr-body (the Visuals section is the one optional fifth section, after Review; its numbers are
// checked; it does not count against the word ceilings; and a file named in it is a name, not a word)
test('the Standard PR audit takes a checked Visuals section after Review, and refuses one out of place or edited by hand', () => {
	const body = standard();
	const std = (text) => audit('project/.claude/pr-body-audit.mjs', text, TITLE);
	assert.equal(std(body).status, 0, std(body).stdout);
	const vis = visualsOf('###');
	const ok = std(`${body.trimEnd()}\n\n${vis}`);
	assert.equal(ok.status, 0, ok.stdout);
	assert.match(ok.stdout, /PASS +Visuals: numbers, chart and why lines check out/); // pin: 1
	assert.match(std(body.replace('### Review', `${vis}\n### Review`)).stdout, /FAIL +the four ### sections, in order/);
	assert.match(std(`${body.trimEnd()}\n\n${vis.replace('-3,775 B (-13.7%)', '-3,000 B (-13.7%)')}`).stdout, /FAIL +Visuals: numbers, chart and why lines check out +Visuals: row 1/); // pin: 1
	// A file name is read as a name; the bare word, or tool words joined by a slash, still fail (the Visuals sweep).
	assert.doesNotMatch(std(body.replace('### Summary', 'The always-loaded file `AGENTS.md` and AGENTS.md shrank.\n\n### Summary')).stdout, /FAIL +no mechanism or AI words/);
	for (const line of ['The agents shrank.', 'Made with Claude/Opus and an AI/LLM pass.', 'Generated with Claude/Code.']) {
		assert.match(std(body.replace('### Summary', `${line}\n\n### Summary`)).stdout, /FAIL +no mechanism or AI words/, line);
	}
	// A code span that quotes a command is code (K115); a span of one bare word is still that word.
	assert.doesNotMatch(std(body.replace('### Summary', 'Run `node run-agents.mjs --all` first.\n\n### Summary')).stdout, /FAIL +no mechanism or AI words/);
	assert.match(std(body.replace('### Summary', 'Ask the `agents` first.\n\n### Summary')).stdout, /FAIL +no mechanism or AI words/);
	// Words after the section, or a second Visuals fold, are not off the ceilings; an image line elsewhere keeps the limit.
	const wall = Array.from({ length: 120 }, () => 'plain words fill this line to make a wall of text').join('\n');
	assert.match(std(`${body.trimEnd()}\n\n${vis}\n${wall}\n`).stdout, /FAIL +(size|Visuals)/);
	assert.match(std(body.replace('### Summary', `![x](https://tracker.example/p.gif) ${'and this sentence keeps going '.repeat(8)}\n\n### Summary`)).stdout, /FAIL +every prose line <= 110/);
	// A Lean body never carries one: the number goes in its gate line.
	const lean = fs.readFileSync(path.resolve('user/skills/pr-body/examples/lean.md'), 'utf8');
	const leanTitle = lean.split('\n')[0].replace(/^## /, '').replace(/^[A-Za-z ]+: /, 'feat: ');
	const leanAudit = (text) => audit('project/.claude/pr-body-audit-lean.mjs', text, leanTitle);
	assert.equal(leanAudit(lean).status, 0, leanAudit(lean).stdout);
	for (const extra of [vis, '<details>\n<summary> Visuals: x</summary>\n\nOne.\n</details>\n', '#### Visuals\n\nOne.\n']) {
		assert.match(leanAudit(`${lean.trimEnd()}\n\n${extra}`).stdout, /FAIL +no Visuals section in a Lean body/, extra.slice(0, 30));
	}
});

// why: guards rule:release-notes (the notes carry the PR's section after the known limits, checked the same way, at
// whatever level or in whatever form it was written)
test('the release audit checks a Visuals section in the notes, in any form', () => {
	const notes = (vis) => `# v1.2.0\n\nOne line.\n\n## Changed\n\n- The rules load faster.\n\n## Upgrading\n\nRun it.\n\nKnown limits: none.\n\n${vis}`;
	const vis = visualsOf('##');
	const rel = (text) => audit('user/skills/release-notes/audit.mjs', text, '1.2.0');
	const ok = rel(notes(vis));
	assert.equal(ok.status, 0, ok.stdout);
	const open = rel(notes(vis.replace(/(\*\*Always-loaded rules file:\*\* )[^\n]*/, '$1<why>')));
	assert.equal(open.status, 1);
	assert.match(open.stdout, /Visuals: a <why> line is still open/);
	assert.match(rel(notes(vis.replace('## Visuals', '### Visuals'))).stdout, /### Visuals where ## Visuals belongs/);
	assert.match(rel(notes(`<details>\n<summary>Visuals: x</summary>\n\n${vis.replace('## Visuals\n\n', '').replace(/(\*\*Always-loaded rules file:\*\* )[^\n]*/, '$1<why>')}</details>\n`)).stdout, /a <why> line is still open/);
});
