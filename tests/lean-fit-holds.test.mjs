// The small-PR-body check (leanFitCheck): a big, binary or guard-file change must never pass as a small body, however
// git prints its path or fails. Each case builds a throwaway repo with a main branch and one feature commit.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import kitTemp from '../project/.claude/kit-temp.cjs';
import * as bump from '../project/.claude/version-bump-check.mjs';

kitTemp.sessionRoot();
delete process.env.PR_BASE;

const git = (dir, ...a) => spawnSync('git', ['-C', dir, '-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { encoding: 'utf8' });
const put = (dir, files) => {
	for (const [f, text] of Object.entries(files)) {
		fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
		fs.writeFileSync(path.join(dir, f), text);
	}
};
const commit = (dir, msg) => { git(dir, 'add', '-A'); assert.equal(git(dir, 'commit', '-qm', msg, '--no-verify').status, 0, `commit ${msg}`); };
// A main branch holding `base`, then a feature branch whose one commit writes `change`.
function repo(base, change) {
	const dir = kitTemp.makeTemp('lean-');
	git(dir, 'init', '-q', '-b', 'main');
	put(dir, { 'README.md': 'x\n', ...base });
	commit(dir, 'base');
	git(dir, 'checkout', '-q', '-b', 'feat/x');
	put(dir, change);
	commit(dir, 'change');
	return dir;
}
const lines = (n) => `${Array.from({ length: n }, (_, i) => `line ${i}`).join('\n')}\n`;
const lean = (dir) => {
	assert.equal(typeof bump.leanFitCheck, 'function', 'version-bump-check.mjs exports leanFitCheck');
	return bump.leanFitCheck(dir);
};

// why: catches a base with no merge base (an orphan or shallow branch) passing as "0 changed lines"
test('a branch with no merge base against the base fails the small-body check', () => {
	const dir = kitTemp.makeTemp('lean-');
	git(dir, 'init', '-q', '-b', 'main');
	put(dir, { 'README.md': 'x\n' });
	commit(dir, 'base');
	git(dir, 'checkout', '-q', '--orphan', 'orph');
	git(dir, 'rm', '-rfq', '.');
	put(dir, { '.claude/guard.cjs': 'x\n', 'src/big.ts': lines(60) });
	commit(dir, 'orphan');
	const r = lean(dir);
	assert.equal(r.ok, false, r.detail);
	assert.match(r.detail, /merge base/);
});

// why: catches a CI file whose name git prints C-quoted (non-ASCII) slipping past the gate-path check
test('a one-line change to a CI workflow with a non-ASCII name fails the small-body check', () => {
	const name = '.github/workflows/release-é.yml';
	const dir = repo({ [name]: 'a: 1\n' }, { [name]: 'a: 2\n' });
	const r = lean(dir);
	assert.equal(r.ok, false, r.detail);
	assert.match(r.detail, /CI, hook or guard code/);
});

// why: catches a changed binary counted as 0 lines of code
test('a changed binary file that is not docs fails the small-body check', () => {
	const dir = repo({ 'src/core.wasm': Buffer.from([0, 1, 2, 3]) }, { 'src/core.wasm': Buffer.from([0, 9, 9, 9, 0, 7]) });
	const r = lean(dir);
	assert.equal(r.ok, false, r.detail);
	assert.match(r.detail, /core\.wasm/);
});

// why: catches a source folder named test, or a build .txt, exempted as if it were test code or docs
test('only root test folders, test-named files and docs are exempt from the line count', () => {
	const server = repo({}, { 'src/test/server.js': lines(200) });
	assert.equal(lean(server).ok, false, 'a src/test folder is source');
	const cmake = repo({ 'CMakeLists.txt': lines(5) }, { 'CMakeLists.txt': lines(40) });
	assert.equal(lean(cmake).ok, false, 'a build .txt is code');
	const tests = repo({}, { 'tests/x.test.mjs': lines(200), 'tests/helper.mjs': lines(50), 'docs/notes.md': lines(200) });
	const r = lean(tests);
	assert.equal(r.ok, true, r.detail);
});

// why: guards the small-body check's pass path: a short change to source still fits a small body
test('a short source change with no gate file passes the small-body check', () => {
	const dir = repo({ 'src/a.ts': lines(5) }, { 'src/a.ts': lines(8) });
	assert.equal(lean(dir).ok, true);
});
