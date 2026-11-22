// E36 and K341 (build 24): one model table per step. kit.config.json names the model and effort of each step; the role
// files, script constants and frontmatter a step runs on must agree with it, and a never-drop step must stay on or above
// its floor. Model lines were set by hand per file, and nothing checked that. Usage: node model-table.mjs check [kitDir]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The rank of a model family: opus 3, sonnet 2, haiku 1; anything else (none, unknown, missing) 0.
export function rank(model) {
	const m = String(model ?? '').toLowerCase();
	if (m.includes('opus')) return 3;
	if (m.includes('sonnet')) return 2;
	if (m.includes('haiku')) return 1;
	return 0;
}

// The text of a file under the kit folder, or null when it cannot be read.
function readText(dir, rel) {
	try {
		return fs.readFileSync(path.join(dir, rel), 'utf8');
	} catch {
		return null;
	}
}

// The model and effort lines of a role file's frontmatter: the lines between its first two --- lines.
function frontmatter(text) {
	const lines = text.split(/\r?\n/);
	const out = {};
	if (lines[0].trim() !== '---') return out;
	const end = lines.indexOf('---', 1);
	for (const line of end < 0 ? [] : lines.slice(1, end)) {
		const m = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line.trim());
		if (m) out[m[1]] = m[2].trim();
	}
	return out;
}

const nonEmpty = (v) => typeof v === 'string' && v.trim() !== '';

// The faults of a kit's table: one string per fault, each naming its step, role, file or constant. Never throws on a
// missing file; a missing file is a fault.
export function tableFaults(config, dir) {
	const steps = config?.steps && typeof config.steps === 'object' ? config.steps : null;
	const roles = config?.roles && typeof config.roles === 'object' ? config.roles : {};
	if (!steps) return ['kit.config.json has no steps object'];
	const faults = [];
	const used = new Set();

	for (const [name, s] of Object.entries(steps)) {
		const where = (msg) => `step ${name}: ${msg}`;
		if (!s || typeof s !== 'object') {
			faults.push(where('the step is not an object'));
			continue;
		}
		if (!nonEmpty(s.model)) faults.push(where('model key missing'));
		if (!nonEmpty(s.effort)) faults.push(where('effort key missing'));
		if (!nonEmpty(s.enforcer)) {
			faults.push(where('enforcer key missing'));
		} else {
			const colon = s.enforcer.indexOf(':');
			const kind = colon < 0 ? s.enforcer : s.enforcer.slice(0, colon);
			const arg = colon < 0 ? '' : s.enforcer.slice(colon + 1);
			if (kind === 'role') {
				used.add(arg);
				const r = Object.hasOwn(roles, arg) ? roles[arg] : null;
				if (!r || typeof r !== 'object') {
					faults.push(where(`role "${arg}" is not in roles`));
				} else {
					if (r.model !== s.model) faults.push(where(`model ${s.model} differs from roles.${arg}.model ${r.model}`));
					if (r.effort !== s.effort) faults.push(where(`effort ${s.effort} differs from roles.${arg}.effort ${r.effort}`));
				}
				const rel = `user/agents/${arg}.md`;
				const text = readText(dir, rel);
				if (text === null) {
					faults.push(where(`role file ${rel} is missing`));
				} else {
					const fm = frontmatter(text);
					if (fm.model !== s.model) faults.push(where(`${rel} model ${fm.model} differs from ${s.model}`));
					if (fm.effort !== s.effort) faults.push(where(`${rel} effort ${fm.effort} differs from ${s.effort}`));
				}
			} else if (kind === 'file') {
				const text = readText(dir, arg);
				if (text === null) {
					faults.push(where(`file ${arg} is missing`));
				} else {
					const fm = frontmatter(text);
					if (fm.model !== s.model) faults.push(where(`${arg} model ${fm.model} differs from ${s.model}`));
					if (fm.effort !== s.effort) faults.push(where(`${arg} effort ${fm.effort} differs from ${s.effort}`));
				}
			} else if (kind === 'const') {
				const hash = arg.indexOf('#');
				const rel = hash < 0 ? arg : arg.slice(0, hash);
				const constName = hash < 0 ? '' : arg.slice(hash + 1);
				const text = readText(dir, rel);
				if (text === null) {
					faults.push(where(`file ${rel} is missing`));
				} else if (!constName) {
					faults.push(where(`enforcer "${s.enforcer}" names no constant after #`));
				} else {
					// Exact lines only: the two forms of the const line, with the table's model in quotes.
					const want = [`const ${constName} = '${s.model}';`, `export const ${constName} = '${s.model}';`];
					const lines = text.split(/\r?\n/);
					if (!lines.some((l) => want.includes(l))) faults.push(where(`${rel} has no const ${constName} = '${s.model}'`));
				}
			} else if (kind !== 'script' && kind !== 'lead' && kind !== 'settings') {
				faults.push(where(`enforcer "${s.enforcer}" is not a known form`));
			}
		}

		if (s.floor !== undefined) {
			if (typeof s.enforcer === 'string' && s.enforcer.startsWith('script:')) {
				faults.push(where('never-drop floor on a script step the check cannot read'));
			} else if (rank(s.model) < rank(s.floor)) {
				faults.push(where(`never-drop floor ${s.floor} is above its model ${s.model}`));
			}
		}
		if (s.stepUp !== undefined && rank(s.stepUp) !== rank(s.model) + 1) {
			faults.push(where(`stepUp ${s.stepUp} is not one rank above model ${s.model}`));
		}
	}

	for (const role of Object.keys(roles)) {
		if (!used.has(role)) faults.push(`role ${role}: no step runs it`);
	}
	return faults;
}

// The check command: exit 0 for a sound table, 1 with each fault on stderr, 2 when the config cannot be read.
function main(argv) {
	const [cmd, dirArg] = argv;
	if (cmd !== 'check') {
		console.error('Usage: node model-table.mjs check [kitDir]');
		return 2;
	}
	const dir = path.resolve(dirArg ?? '.');
	const file = path.join(dir, 'kit.config.json');
	let config;
	try {
		config = JSON.parse(fs.readFileSync(file, 'utf8'));
	} catch (e) {
		console.error(`Cannot read ${file}: ${e.message}`);
		return 2;
	}
	if (!config || typeof config !== 'object') {
		console.error(`Cannot read ${file}: not a JSON object`);
		return 2;
	}
	const faults = tableFaults(config, dir);
	if (faults.length) {
		for (const f of faults) console.error(f);
		return 1;
	}
	console.log(`model table ok: ${Object.keys(config.steps ?? {}).length} steps, ${Object.keys(config.roles ?? {}).length} roles`);
	return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	process.exitCode = main(process.argv.slice(2));
}
