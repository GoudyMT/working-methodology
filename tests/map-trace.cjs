'use strict';
// Loaded with --require into every process of a coverage-map run (scripts/test-run.mjs --map): records each file
// or folder a test reads, so a change to a rule, a template or a JSON file selects the tests that read it.
// It writes to <KIT_MAP_DIR>/<KIT_MAP_TEST>/reads-<pid>.txt, read at each call, so the harness can switch tests.
const fs = require('fs');
const path = require('path');
const { syncBuiltinESMExports } = require('module');
const { fileURLToPath } = require('url');

const append = fs.appendFileSync;
const where = (p) => {
	if (Buffer.isBuffer(p)) p = p.toString();
	if (p instanceof URL) p = fileURLToPath(p);
	return typeof p === 'string' ? path.resolve(p) : null;
};
function note(p, dir) {
	const dirName = process.env.KIT_MAP_DIR;
	const test = process.env.KIT_MAP_TEST;
	const abs = where(p);
	if (!dirName || !test || !abs) return;
	try {
		append(path.join(dirName, test, `reads-${process.pid}.txt`), abs + (dir ? path.sep : '') + '\n');
	} catch { /* the test's folder is gone (a test that ended): its reads no longer matter */ }
}
const wrap = (obj, name, dir = false) => {
	const orig = obj[name];
	obj[name] = function (p, ...rest) {
		note(p, dir);
		return orig.call(this, p, ...rest);
	};
};
for (const n of ['readFileSync', 'readFile', 'copyFileSync', 'copyFile', 'createReadStream']) wrap(fs, n);
for (const n of ['readdirSync', 'readdir', 'cpSync', 'cp']) wrap(fs, n, true);
wrap(fs.promises, 'readFile');
wrap(fs.promises, 'readdir', true);
wrap(fs.promises, 'cp', true);
syncBuiltinESMExports();
