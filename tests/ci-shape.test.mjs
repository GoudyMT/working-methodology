// K44 (1.36.0, the owner's option A 2026-11-13): a project gets the fast CI shape as templates and a report-only check.
// On 2026-11-13 AI Essentials ran its whole CI twice per PR push (push and pull_request, no branch filter) with no
// stale-run cancel (workbench results/fast-ci-standard/RESULT.md section 3); the check names exactly those gaps.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import kitTemp from '../project/.claude/kit-temp.cjs';

kitTemp.sessionRoot();
const SCRIPT = path.resolve('project/.claude/ci-shape.mjs');
const run = (dir, ...a) => spawnSync(process.execPath, [SCRIPT, ...a], { cwd: dir, encoding: 'utf8' });
const project = (files) => {
	const dir = kitTemp.makeTemp('ci-shape-');
	for (const [rel, text] of Object.entries(files)) {
		fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
		fs.writeFileSync(path.join(dir, rel), text);
	}
	return dir;
};
// The shape AI Essentials had on 2026-11-13: both triggers with no branch filter, one long job, no cancel.
const DOUBLED = `name: CI
on:
  push:
  pull_request:
jobs:
  gate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm test
`;

// why: guards the owner's pick of K44 option A, 2026-11-13: the shape reaches every project as templates and a report
test('the CI shape check names the doubled runs, the missing cancel and the missing summary check, and only reports', () => {
	const dir = project({ '.github/workflows/ci.yml': DOUBLED });
	const r = run(dir);
	assert.equal(r.status, 0, 'report only: it never fails a run');
	assert.match(r.stdout, /ci\.yml: MISSING triggers: push and pull_request both run on a PR branch push/);
	assert.match(r.stdout, /ci\.yml: MISSING stale runs: no concurrency group with cancel-in-progress/);
	assert.match(r.stdout, /ci\.yml: MISSING one required check: no summary job that needs the others and runs always\(\)/);
	assert.match(r.stdout, /^CI shape: 3 gap\(s\) in 1 workflow\(s\)/m);
	const json = JSON.parse(run(dir, '--json').stdout);
	assert.equal(json.workflows[0].gaps.length, 3);
});

// why: guards the owner's pick of K44 option A, 2026-11-13: a template a project starts from meets the shape
test('each shipped CI template meets the shape, and a project with no workflow is told where to start', () => {
	for (const stack of ['node', 'python']) {
		const text = fs.readFileSync(path.resolve(`project/_Templates/ci-${stack}.yml`), 'utf8');
		const r = run(project({ '.github/workflows/ci.yml': text }));
		assert.equal(r.status, 0);
		assert.match(r.stdout, /^CI shape: 0 gap\(s\) in 1 workflow\(s\)/m, `${stack}: ${r.stdout}`);
		// K72: a project whose repo tracks its settings fails CI when they turn every hook off.
		assert.match(text, /disableAllHooks/, `${stack} template checks the settings`);
	}
	const none = run(project({ 'README.md': 'x\n' }));
	assert.equal(none.status, 0);
	assert.match(none.stdout, /no workflow in \.github\/workflows: start from _Templates\/ci-<stack>\.yml/);
});
