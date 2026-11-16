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
