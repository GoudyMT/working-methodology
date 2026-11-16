// T8 (build 14): a batch plan's units table is read as a graph, so two units that may run at once and share a file are
// found by a script, not by the pair table the lead and then the checker write by hand.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import kitTemp from '../project/.claude/kit-temp.cjs';

kitTemp.sessionRoot();
const GRAPH = path.resolve('project/.claude/plan-graph.mjs');
const row = (id, files, runs) => `| ${id} | t | ${files} | x | x | ${runs} | builder |`;
const plan = (rows) => ['# Batch plan - x', '', '## Units', '', '| Id | Title | Files (exact; mark new files) | Tests to write first, and the failure each must show | Done when | Runs | Built by |', '|---|---|---|---|---|---|---|', ...rows, '', '## Collision list', ''].join('\n');
const check = (rows) => {
	const dir = kitTemp.makeTemp('plan-graph-');
	spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
	const f = path.join(dir, 'plan.md');
	fs.writeFileSync(f, plan(rows));
	return { dir, ...spawnSync(process.execPath, [GRAPH, f], { cwd: dir, encoding: 'utf8' }) };
};

// why: guards rule:multi-agent-discipline (units that run at once never share a file)
test('the plan graph names parallel units that share a file, and passes units kept apart by order or by running alone', () => {
	const r = check([
		row('U1', '`src/a.mjs`, `src/b.mjs` (new)', 'parallel'),
		row('U2', '`src/b.mjs`', 'parallel'),
		row('U3', '`src/a.mjs`', 'after U1'),
		row('U4', '`src/a.mjs`', 'alone'),
		row('U5', '`src/c.mjs`', 'after U9'),
		row('U6', '`src/d.mjs`', 'after U7'),
		row('U7', '`src/d.mjs`', 'after U6'),
	]);
	assert.equal(r.status, 1, r.stdout + r.stderr);
	assert.match(r.stdout, /U1 and U2 may run at once and both touch src\/b\.mjs/);
	assert.doesNotMatch(r.stdout, /U1 and U3|U3 and U1/, 'an ordered pair was named');
	assert.doesNotMatch(r.stdout, /U4/, 'a unit that runs alone was named');
	assert.match(r.stdout, /U5 runs after U9, which is not a unit/);
	assert.match(r.stdout, /a cycle: U6, U7/);
	assert.ok(fs.existsSync(path.join(r.dir, '.git', 'kit-plan-graph.jsonl')), 'no trace for the use check');
	const ok = check([row('U1', '`src/a.mjs`', 'parallel'), row('U2', '`src/b.mjs`', 'parallel'), row('U3', '`src/a.mjs`, `src/b.mjs`', 'after U1, U2')]);
	assert.equal(ok.status, 0, ok.stdout + ok.stderr);
	assert.match(ok.stdout, /3 units, no shared file between units that may run at once/);
	assert.equal(check([]).status, 2, 'a plan with no units table');
});

// The build 14 sweep (role 5): an escaped pipe shifted the columns, a file outside backticks, a folder, a ./ prefix or
// another letter case was dropped or missed, a side table under Units was read as units, and "after" took any word
// starting with u. Each now finds the clash, or names what it could not read.
// why: guards rule:multi-agent-discipline (units that run at once never share a file)
test('the plan graph reads escaped pipes, folders, paths in any case and order words, and stops at the units table', () => {
	const one = (rows, tail = []) => {
		const dir = kitTemp.makeTemp('plan-graph-');
		spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
		fs.writeFileSync(path.join(dir, 'plan.md'), plan(rows).replace('\n## Collision list', `${tail.join('\n')}\n## Collision list`));
		return spawnSync(process.execPath, [GRAPH, path.join(dir, 'plan.md')], { cwd: dir, encoding: 'utf8' }).stdout;
	};
	assert.match(one(['| U1 | a \\| b | `src/a.js` | x | x | parallel | builder |', row('U2', '`src/a.js`', 'parallel')]), /U1 and U2 may run at once and both touch src\/a\.js/);
	assert.match(one([row('U1', '`src/`', 'parallel'), row('U2', '`./Src/A.js`', 'parallel')]), /U1 and U2 may run at once/);
	assert.match(one([row('U1', '`src/a.js`', 'parallel'), row('U2', 'src/a.js', 'parallel')]), /U2 names no file in backticks/);
	assert.doesNotMatch(one([row('U1', '`x.js`', 'parallel'), row('U2', '`x.js`', 'after U1 (uses its types), until review')]), /fault/);
	assert.match(one([row('A1', '`x.js`', 'parallel'), row('A2', '`x.js`', 'after A1')]), /2 units, no shared file/);
	assert.match(one([row('U1', '`x.js`', 'parallel'), row('U2', '`y.js`', 'after all others')]), /U2 runs after no unit it names/);
	assert.match(one(['| :-- | :-: | --- | --- | --- | --- | --- |', '| **U1** | t | `x.js` | x | x | parallel | builder |', row('U2', '`x.js`', 'after U1')]), /2 units, no shared file/);
	assert.match(one([row('U1', '`x.js`', 'parallel'), row('U2', '`x.js`', 'after U1')], ['', '### Ports (checked by hand)', '', '| Unit | Port |', '|---|---|', '| U2 | 3000 |', '']), /2 units, no shared file/);
});

// The build 14 sweep: in a git worktree the plan graph writes its trace to the common git folder, and the use check,
// reading .git as a folder, said no plan was ever checked there.
// why: guards rule:multi-agent-discipline (the use check tells the owner the part is used)
test('the use check finds a plan checked in a worktree', () => {
	const dir = kitTemp.makeTemp('plan-graph-wt-');
	const git = (cwd, ...a) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd, encoding: 'utf8' });
	git(dir, 'init', '-q', '-b', 'main');
	fs.writeFileSync(path.join(dir, 'x.md'), 'x\n');
	git(dir, 'add', '.'); git(dir, 'commit', '-qm', 'x');
	const wt = path.join(dir, 'wt');
	git(dir, 'worktree', 'add', '-q', wt);
	fs.writeFileSync(path.join(wt, 'plan.md'), plan([row('U1', '`a.js`', 'parallel')]));
	spawnSync(process.execPath, [GRAPH, path.join(wt, 'plan.md')], { cwd: wt, encoding: 'utf8' });
	const r = spawnSync(process.execPath, [path.resolve('project/.claude/use-check.mjs'), '--json'], { cwd: wt, encoding: 'utf8' });
	const part = JSON.parse(r.stdout).parts.find((p) => p.name === 'plan graph');
	assert.equal(part.used.ok, true, JSON.stringify(part));
});
