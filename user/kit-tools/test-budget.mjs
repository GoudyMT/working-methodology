#!/usr/bin/env node
// The test budget a batch plan sets for a unit (U19). A unit's category is the highest category of any of its files,
// in this order: guard (Risk high, or a file on GUARD_PATHS), logic (the default: a file the adapter's testCategories
// map does not name), glue, data, docs. A plan row's Category can raise the computed category, never lower it. Each
// category sets a ceiling on the unit's test lines. The map is the testCategories key of kit.config.json: a glob per
// path, where "*" matches within one name.
//   node user/kit-tools/test-budget.mjs --files a,b [--risk high] [--map <kit.config.json>] [--category <name>]
// Exit 0 with the line "category: <name> (ceiling <n>; <reason>)". Exit 1 with a "fault:" line when --category is lower
// than the computed one. Exit 2 for bad arguments or an unreadable map, with nothing on stdout.
// plan-check.mjs imports budget, filesOf, readMap and the two tables from here.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { GUARD_PATHS } from './tester-model.mjs';

export const ORDER = ['guard', 'logic', 'glue', 'data', 'docs'];
export const CEILING = { guard: 25, logic: 15, glue: 6, data: 2, docs: 3 };

// A problem with an input the script cannot read or a value it does not know. main() turns it into exit 2.
export class InputError extends Error {}

const rank = (c) => ORDER.indexOf(c);
const norm = (p) => p.trim().replace(/\\/g, '/').replace(/^(\.\/)+/, '').toLowerCase();
const globRe = (glob) => new RegExp(`^${glob.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')}$`);

// The GUARD_PATHS entry a path matches, read as tester-model.mjs reads the list: a name ending "/" is a folder anywhere
// in the path, a name with "*" is a file-name glob, any other name is an exact file name. Undefined when none matches.
const guardOf = (file) => {
	const base = file.split('/').pop();
	return GUARD_PATHS.find((g) => (g.endsWith('/') ? `/${file}`.includes(`/${g}`) : g.includes('*') ? globRe(g).test(base) : base === g));
};

// A file's category and its reason: a guard path wins; else the highest category of the map's globs it matches; else logic.
const categoryOf = (file, map) => {
	const f = norm(file);
	const g = guardOf(f);
	if (g) return ['guard', `${f} is on the guard path ${g}`];
	const hits = Object.entries(map).filter(([glob]) => globRe(norm(glob)).test(f)).map(([, c]) => c);
	if (!hits.length) return ['logic', `${f} is not in testCategories`];
	const top = hits.reduce((a, b) => (rank(b) < rank(a) ? b : a));
	return [top, `${f} is ${top} in testCategories`];
};

/**
 * The paths a Files cell names: its backticked paths, or else its comma-separated names.
 *
 * Args:
 *     cell: the cell's text.
 *
 * Returns:
 *     The paths, in the order the cell gives them.
 */
export const filesOf = (cell) => {
	const ticked = [...String(cell).matchAll(/`([^`]+)`/g)].map((m) => m[1]);
	return (ticked.length ? ticked : String(cell).split(',')).map((p) => p.trim()).filter(Boolean);
};

/**
 * The testCategories map of a kit.config.json: its keys are globs, its values categories. No key means no map.
 *
 * Args:
 *     file: the kit.config.json path.
 *
 * Returns:
 *     The map, an object from glob to category. Throws InputError when the file cannot be read or names a bad category.
 */
export function readMap(file) {
	let json;
	try {
		json = JSON.parse(fs.readFileSync(file, 'utf8'));
	} catch (e) {
		throw new InputError(`cannot read the map ${file}: ${e.code || e.message}`);
	}
	const map = json && typeof json.testCategories === 'object' && json.testCategories !== null ? json.testCategories : {};
	for (const [glob, c] of Object.entries(map)) {
		if (!ORDER.includes(c)) throw new InputError(`the map gives ${glob} the category "${c}", which is not one of ${ORDER.join(', ')}`);
	}
	return map;
}

/**
 * A unit's test budget from its files and Risk.
 *
 * Args:
 *     files: the unit's paths.
 *     risk: the Risk cell; "high" makes the unit guard.
 *     map: the testCategories map (see readMap).
 *     given: the plan row's Category, or null. It may raise the computed category, never lower it.
 *
 * Returns:
 *     { computed, category, ceiling, reason, lower }: the category the files earn, the category to use (the given one
 *     when it raises), its ceiling, why, and lower = true when the given category is below the computed one.
 */
export function budget(files, { risk = '', map = {}, given = null } = {}) {
	if (given !== null && !ORDER.includes(given)) throw new InputError(`"${given}" is not a category (${ORDER.join(', ')})`);
	const picks = files.map((f) => categoryOf(f, map));
	if (risk.trim().toLowerCase() === 'high') picks.push(['guard', 'Risk is high']);
	if (!picks.length) picks.push(['logic', 'no file is named']);
	const [computed, why] = picks.reduce((a, b) => (rank(b[0]) < rank(a[0]) ? b : a));
	if (given !== null && rank(given) > rank(computed)) return { computed, category: computed, ceiling: CEILING[computed], reason: why, lower: true };
	const raised = given !== null && rank(given) < rank(computed);
	const category = raised ? given : computed;
	return { computed, category, ceiling: CEILING[category], reason: raised ? `raised from ${computed} by the plan row` : why, lower: false };
}

const FLAGS = { '--files': 'files', '--risk': 'risk', '--map': 'map', '--category': 'category' };

// The flags as name -> value; --files is required. Null for a bad or missing argument.
function parseArgs(argv) {
	const o = {};
	for (let i = 0; i < argv.length; i += 2) {
		const key = FLAGS[argv[i]];
		if (!key || argv[i + 1] === undefined) return null;
		o[key] = argv[i + 1];
	}
	return o.files ? o : null;
}

function main(argv) {
	const args = parseArgs(argv);
	if (!args) {
		process.stderr.write('test-budget: usage: node test-budget.mjs --files a,b [--risk high] [--map <kit.config.json>] [--category <name>]\n');
		return 2;
	}
	try {
		const map = args.map === undefined ? {} : readMap(args.map);
		const files = args.files.split(',').map((p) => p.trim()).filter(Boolean);
		const r = budget(files, { risk: args.risk || '', map, given: args.category === undefined ? null : args.category });
		if (r.lower) {
			process.stdout.write(`fault: category ${args.category} is below the computed ${r.computed} (${r.reason}); a plan row may raise a category, never lower it\n`);
			return 1;
		}
		process.stdout.write(`category: ${r.category} (ceiling ${r.ceiling}; ${r.reason})\n`);
		return 0;
	} catch (e) {
		if (!(e instanceof InputError)) throw e;
		process.stderr.write(`test-budget: ${e.message}\n`);
		return 2;
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
	process.exitCode = main(process.argv.slice(2));
}
