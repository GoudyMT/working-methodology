// Joins the coverage map parts that `node scripts/test-run.mjs --map --slice <i>/<n>` writes (tests/.map-part-<i>.json)
// into the whole suite's map, tests/.map.json. Run from the repo root:
//   node scripts/map-merge.mjs <part> [part...]
// Exit 0 when the map is written; 1 when the parts are of different commits, or one test is in two parts with different
// entries (nothing written); 2 on bad use or a part that is not a map. A map of mixed commits would name lines that do not
// match the code, so the check runs on every part before anything is written.
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const MAP_FILE = 'tests/.map.json';

export function main(args) {
	if (args.length === 0) {
		process.stderr.write('map-merge: usage: node scripts/map-merge.mjs <part> [part...]\n');
		return 2;
	}
	const parts = [];
	for (const file of args) {
		let part = null;
		try { part = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* unreadable or not JSON: refused below */ }
		if (!part || typeof part.sha !== 'string' || !part.tests || typeof part.tests !== 'object') {
			process.stderr.write(`map-merge: ${file} is not a map part\n`);
			return 2;
		}
		parts.push({ file, part });
	}
	const sha = parts[0].part.sha;
	for (const { file, part } of parts) {
		if (part.sha !== sha) {
			process.stderr.write(`map-merge: ${file} is of ${part.sha.slice(0, 12)}, but ${parts[0].file} is of ${sha.slice(0, 12)}; parts must share one commit\n`);
			return 1;
		}
	}
	// A test sits in one slice only, so a key in two parts must carry the same entry in both; the one kept is then whole.
	const tests = new Map();
	for (const { file, part } of parts) {
		for (const [key, entry] of Object.entries(part.tests)) {
			if (!tests.has(key)) tests.set(key, entry);
			else if (JSON.stringify(tests.get(key)) !== JSON.stringify(entry)) {
				process.stderr.write(`map-merge: ${key} is in two parts with different entries (${file}); nothing written\n`);
				return 1;
			}
		}
	}
	fs.writeFileSync(MAP_FILE, JSON.stringify({ sha, made: new Date().toISOString(), tests: Object.fromEntries(tests) }));
	process.stdout.write(`map-merge: map of ${tests.size} test(s) at ${sha.slice(0, 12)} in ${MAP_FILE}\n`);
	return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
	process.exitCode = main(process.argv.slice(2));
}
