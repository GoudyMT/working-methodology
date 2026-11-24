// T8 (build 14): which rule a script, hook, test or workflow holds, read from the code, so the rules diet (T9) can see
// the prose no script holds, and a stale map fails CI instead of steering the cut.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import kitTemp from '../project/.claude/kit-temp.cjs';

kitTemp.sessionRoot();
const MAP = path.resolve('scripts/rule-map.mjs');
const put = (dir, f, text) => { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), text); };

// why: guards rule:test-value (a stale map would steer which rule prose is cut)
test('the rule map lists what holds each rule, names the rules nothing holds, and check fails on a stale map', () => {
	const dir = kitTemp.makeTemp('rule-map-');
	put(dir, 'project/standards/INDEX.md', '| Id | Rule | File |\n|---|---|---|\n| outward-acts | x | y |\n| test-value | x | y |\n| plain-words | x | y |\n');
	put(dir, 'project/.claude/guard.cjs', '// rule:outward-acts\n');
	put(dir, 'scripts/test-check.mjs', '// the bar (rule:test-value)\n');
	put(dir, 'tests/a.test.mjs', '// why: guards rule:test-value\n// rule:outward-acts\n');
	put(dir, '.github/workflows/ci.yml', '# rule:outward-acts\n');
	put(dir, 'rules/x.md', 'rule:plain-words in prose does not hold it\n');
	const git = (...a) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: dir, encoding: 'utf8' });
	git('init', '-q', '-b', 'main'); git('add', '.'); git('commit', '-qm', 'x');
	// An untracked file is not in CI's checkout, so it never counts (the build 14 sweep).
	put(dir, 'tests/wip.test.mjs', '// rule:plain-words\n');
	const run = (...a) => spawnSync(process.execPath, [MAP, ...a], { cwd: dir, encoding: 'utf8' });
	let r = run('write');
	assert.equal(r.status, 0, r.stdout + r.stderr);
	const map = JSON.parse(fs.readFileSync(path.join(dir, 'docs', 'rule-map.json'), 'utf8'));
	assert.deepEqual(map.rules['outward-acts'], { guards: ['project/.claude/guard.cjs'], scripts: [], tests: ['tests/a.test.mjs'], workflows: ['.github/workflows/ci.yml'] });
	assert.deepEqual(map.rules['test-value'].scripts, ['scripts/test-check.mjs']);
	assert.deepEqual(map.prose, ['plain-words']);
	assert.match(r.stdout, /3 rules: 2 held by code, 1 by prose only/);
	// K170 (the S1 replay of 1.40.0): the plan said it prints the rules no script names; only the count was printed.
	assert.match(r.stdout, /^Prose only: plain-words$/m, r.stdout);
	assert.equal(run('check').status, 0);
	put(dir, 'scripts/plain.mjs', '// rule:plain-words\n');
	git('add', 'scripts/plain.mjs');
	r = run('check');
	assert.equal(r.status, 1);
	assert.match(r.stderr, /rule-map\.json is stale.*rule-map\.mjs write/);
	// CI's gate holds the map fresh, with the base commit's copy of the check (K135, build 18). pin: 1 (GitHub runs these lines)
	const gate = fs.readFileSync(path.resolve('.github/workflows/ci.yml'), 'utf8');
	assert.match(gate, /- name: Rule map is fresh\n\s+id: rmap\n\s+if: \$\{\{ !cancelled\(\) \}\}\n\s+shell: bash\n\s+run: \|\n\s+M="\$RUNNER_TEMP\/base\/scripts\/rule-map\.mjs";[^\n]*\n\s+node "\$M" check\n/);
});
