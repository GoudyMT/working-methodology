// The kit's test() for every test file. node:test's own test(), plus four things the runner (scripts/test-run.mjs)
// switches on through the environment:
//   KIT_SHARD=i/n    register only every n-th test, from the i-th: n processes together run each test once
//   KIT_ONLY=<file>  register only the tests the JSON list names ("<test file>::<name>", or "<test file>::*")
//   KIT_MAP_DIR=dir  record, per test, the source lines it runs (here and in child processes) for the coverage map
//   KIT_RUN_AT=file  write each test's file and name there as it starts, so the runner can say where a shard is
// With none of them set it is node:test's test(), unchanged.
import { test as nodeTest } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import inspector from 'node:inspector';

const [SHARD, SHARDS] = (process.env.KIT_SHARD || '0/1').split('/').map(Number);
const ONLY = process.env.KIT_ONLY ? new Set(JSON.parse(fs.readFileSync(process.env.KIT_ONLY, 'utf8'))) : null;
const MAP = process.env.KIT_MAP_OFF ? '' : process.env.KIT_MAP_DIR || '';
const AT = process.env.KIT_RUN_AT || '';
// node --test runs each file in its own process, as `node <file>`. Both sides are read by the folder's real name: a
// short name (CI's RUNNER~1) or a junction would otherwise key the test outside the repo.
const real = (p) => { try { return fs.realpathSync.native(p); } catch { return p; } };
const FILE = path.relative(real(process.env.KIT_REPO || process.cwd()), real(process.argv[1] || '')).split(path.sep).join('/');

let count = 0;
let session = null;

// The in-thread inspector answers synchronously, so a test's coverage is taken the moment it ends.
function post(method, params = {}) {
	let out;
	session.post(method, params, (err, res) => {
		if (err) throw err;
		out = res;
	});
	if (out === undefined) throw new Error(`harness: ${method} did not answer synchronously`);
	return out;
}

if (MAP) {
	session = new inspector.Session();
	session.connect();
	post('Profiler.enable');
	post('Profiler.startPreciseCoverage', { callCount: true, detailed: true });
}

function mapped(name, idx, fn) {
	return async (t) => {
		const id = `${process.pid}-${idx}`;
		const dir = path.join(MAP, id);
		fs.mkdirSync(dir, { recursive: true });
		fs.appendFileSync(path.join(MAP, 'tests.jsonl'), JSON.stringify({ id, file: FILE, name }) + '\n');
		post('Profiler.takePreciseCoverage'); // resets the counts: what follows is this test's alone
		const saved = { cov: process.env.NODE_V8_COVERAGE, test: process.env.KIT_MAP_TEST };
		// A child process started by the test writes its coverage and its reads into the test's own folder.
		process.env.NODE_V8_COVERAGE = dir;
		process.env.KIT_MAP_TEST = id;
		try {
			return await fn(t);
		} finally {
			fs.writeFileSync(path.join(dir, 'inproc.json'), JSON.stringify(post('Profiler.takePreciseCoverage')));
			for (const [k, v] of [['NODE_V8_COVERAGE', saved.cov], ['KIT_MAP_TEST', saved.test]]) {
				if (v === undefined) delete process.env[k];
				else process.env[k] = v;
			}
		}
	};
}

// E31: CI runs the suite on Linux, where it is about 20 times faster, and only the tests marked { windows: true } on
// Windows (what the owner's machine alone shows: drive paths, Git for Windows' sh running the git hooks, junctions).
// KIT_WINDOWS_SLICE=1 registers only those; elsewhere than Windows they are registered as skipped.
const WINDOWS_SLICE = process.env.KIT_WINDOWS_SLICE === '1';
export function test(name, ...rest) {
	const opts = rest.length > 1 && rest[0] && typeof rest[0] === 'object' ? rest[0] : null;
	const windows = Boolean(opts && opts.windows);
	if (WINDOWS_SLICE && !windows) return undefined;
	if (opts) {
		const { windows: _w, ...own } = opts;
		rest[0] = windows && process.platform !== 'win32' ? { ...own, skip: 'Windows only: the Windows slice runs it' } : own;
	}
	const idx = count++;
	if (idx % SHARDS !== SHARD) return undefined;
	if (ONLY && !ONLY.has(`${FILE}::${name}`) && !ONLY.has(`${FILE}::*`)) return undefined;
	if (!MAP && !AT) return nodeTest(name, ...rest);
	let fn = rest.pop();
	if (MAP) fn = mapped(name, idx, fn);
	if (AT) {
		const inner = fn;
		fn = (t) => {
			fs.writeFileSync(AT, `${FILE} > ${name}`);
			return inner(t);
		};
	}
	return nodeTest(name, ...rest, fn);
}
