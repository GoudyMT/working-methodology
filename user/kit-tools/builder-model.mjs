#!/usr/bin/env node
// The builder's model for a unit (build 24). The builder step's model and stepUp are read from kit.config.json beside
// the kit, so no model name is written into this script. The builder starts on the table's model; one red rerun steps
// it up once, to stepUp, and further reruns keep that step (never a second step up).
//   node user/kit-tools/builder-model.mjs <unit> [--reruns <n>]
// Prints "builder: <model> (default)" with no rerun, or "builder: <stepUp> (step-up: red rerun)" with one or more.
// Exit 0 with the line. Exit 2 for bad arguments, or a config with no builder step, with nothing on stdout.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CONFIG = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'kit.config.json');

// "claude-haiku-5-5" reads as "haiku". A name without that prefix and suffix is printed as it is.
const short = (model) => model.replace(/^claude-/, '').replace(/-5-5$/, '');

function usage(msg) {
	process.stderr.write(`builder-model: ${msg}\nusage: builder-model.mjs <unit> [--reruns <n>]\n`);
	return 2;
}

function main(argv) {
	const pos = [];
	let reruns = 0;
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === '--reruns') {
			const value = argv[++i];
			if (!/^\d+$/.test(value || '')) return usage('--reruns takes a whole number');
			reruns = Number(value);
		} else if (argv[i].startsWith('--')) {
			return usage(`unknown option ${argv[i]}`);
		} else {
			pos.push(argv[i]);
		}
	}
	if (pos.length !== 1) return usage('one unit id is required');
	let step;
	try {
		step = JSON.parse(fs.readFileSync(CONFIG, 'utf8')).steps?.builder;
	} catch (e) {
		return usage(`cannot read ${CONFIG}: ${e.message}`);
	}
	if (!step || typeof step.model !== 'string') return usage('kit.config.json has no steps.builder.model');
	if (reruns >= 1) {
		if (typeof step.stepUp !== 'string') return usage('kit.config.json has no steps.builder.stepUp');
		process.stdout.write(`builder: ${short(step.stepUp)} (step-up: red rerun)\n`);
	} else {
		process.stdout.write(`builder: ${short(step.model)} (default)\n`);
	}
	return 0;
}

process.exitCode = main(process.argv.slice(2));
