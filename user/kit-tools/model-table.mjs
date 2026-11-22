// E36 and K341 (build 24): one model table per step. kit.config.json names the model and effort of each step; the role
// files, script constants and frontmatter a step runs on must agree with it, and a never-drop step must stay on or above
// its floor. Model lines were set by hand per file, and nothing checked that. Usage: node model-table.mjs check [kitDir]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const STEP_KEYS = new Set(['model', 'effort', 'enforcer', 'floor', 'stepUp', 'neverDrop']);

// The rank of a model family: opus 3, sonnet 2, haiku 1; anything else (none, unknown, missing) 0.
export function rank(model) {
	const m = String(model ?? '').toLowerCase();
	if (m.includes('opus')) return 3;
	if (m.includes('sonnet')) return 2;
	if (m.includes('haiku')) return 1;
	return 0;
}

// The generation of a model id: the numbers after its family, e.g. claude-opus-5-4 -> [5, 4].
function generation(model) {
	const m = /-(\d+(?:-\d+)*)$/.exec(String(model ?? '').toLowerCase());
	return m ? m[1].split('-').map(Number) : [];
}

// A model meets a floor when its family ranks higher, or its family is the same and its generation is at least as
// high, part by part. A floor that names no known family is never met.
export function meetsFloor(model, floor) {
	if (rank(floor) === 0) return false;
	if (rank(model) !== rank(floor)) return rank(model) > rank(floor);
	const a = generation(model);
	const b = generation(floor);
	for (let i = 0; i < Math.max(a.length, b.length); i++) {
		const x = a[i] ?? 0;
		const y = b[i] ?? 0;
		if (x !== y) return x > y;
	}
	return true;
}

// The text of a file under the kit folder, or null when it cannot be read.
function readText(dir, rel) {
	try {
		return fs.readFileSync(path.join(dir, rel), 'utf8');
	} catch {
		return null;
	}
}

// The frontmatter of a file: its unindented `key: value` lines between the first two --- lines, and each key that
// appears twice at top level. An indented line is another key's value, never a field.
function frontmatter(text) {
	const lines = text.split(/\r?\n/);
	const fields = {};
	const dups = [];
	if (lines[0].trim() !== '---') return { fields, dups };
	const end = lines.indexOf('---', 1);
	for (const line of end < 0 ? [] : lines.slice(1, end)) {
		const m = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
		if (!m) continue;
		if (Object.hasOwn(fields, m[1])) dups.push(m[1]);
		fields[m[1]] = m[2].trim();
	}
	return { fields, dups };
}

// The code of a JS file with its comments and template-literal spans blanked to spaces (line breaks kept), so a line
// inside them never reads as a top-level definition.
function codeOnly(text) {
	const blank = (s) => s.replace(/[^\n]/g, ' ');
	let out = '';
	let i = 0;
	while (i < text.length) {
		const c = text[i];
		const d = text[i + 1];
		let end = i + 1;
		if (c === '/' && d === '/') {
			const e = text.indexOf('\n', i);
			end = e < 0 ? text.length : e;
			out += blank(text.slice(i, end));
		} else if (c === '/' && d === '*') {
			const e = text.indexOf('*/', i + 2);
			end = e < 0 ? text.length : e + 2;
			out += blank(text.slice(i, end));
		} else if (c === '`' || c === '"' || c === "'") {
			let j = i + 1;
			while (j < text.length && text[j] !== c && (c === '`' || text[j] !== '\n')) j += text[j] === '\\' ? 2 : 1;
			end = Math.min(j + 1, text.length);
			out += c === '`' ? blank(text.slice(i, end)) : text.slice(i, end);
		} else {
			out += c;
		}
		i = end;
	}
	return out;
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The faults of a kit's table: one string per fault, each naming its step, role, file or constant. Never throws on a
// missing file; a missing file is a fault.
export function tableFaults(config, dir) {
	const steps = config?.steps && typeof config.steps === 'object' ? config.steps : null;
	const roles = config?.roles && typeof config.roles === 'object' ? config.roles : {};
	if (!steps) return ['kit.config.json has no steps object'];
	const faults = [];
	const used = new Set();

	// A role file (or a file step): its model and effort, its duplicate keys, and the role's access lists when given.
	const checkFile = (where, rel, s, access, role) => {
		const text = readText(dir, rel);
		if (text === null) {
			faults.push(where(`file ${rel} is missing`));
			return;
		}
		const { fields, dups } = frontmatter(text);
		for (const k of dups) faults.push(where(`${rel} has two top-level ${k} lines`));
		if (fields.model !== s.model) faults.push(where(`${rel} model ${fields.model} differs from ${s.model}`));
		if (fields.effort !== s.effort) faults.push(where(`${rel} effort ${fields.effort} differs from ${s.effort}`));
		if (!access) return;
		if (Array.isArray(access.tools) && fields.tools !== access.tools.join(', ')) {
			faults.push(where(`${rel} tools ${fields.tools ?? 'none'} differs from roles.${role}.tools`));
		}
		if (Array.isArray(access.denied)) {
			if (access.denied.length && fields.disallowedTools !== access.denied.join(', ')) {
				faults.push(where(`${rel} disallowedTools ${fields.disallowedTools ?? 'none'} differs from roles.${role}.denied`));
			}
			if (!access.denied.length && fields.disallowedTools !== undefined) {
				faults.push(where(`${rel} has a disallowedTools line but roles.${role}.denied is empty`));
			}
		}
		if (Array.isArray(access.rules)) {
			const want = access.rules.length ? `${role}-rules` : undefined;
			if (fields.skills !== want) faults.push(where(`${rel} skills ${fields.skills ?? 'none'} differs from roles.${role}.rules`));
		}
	};

	for (const [name, s] of Object.entries(steps)) {
		const where = (msg) => `step ${name}: ${msg}`;
		if (!s || typeof s !== 'object' || Array.isArray(s)) {
			faults.push(where('the step is not an object'));
			continue;
		}
		for (const k of Object.keys(s)) {
			if (!STEP_KEYS.has(k)) faults.push(where(`key ${k} is not one of ${[...STEP_KEYS].join(', ')}`));
		}
		if (!nonEmpty(s.model)) faults.push(where('model key missing'));
		if (!nonEmpty(s.effort)) faults.push(where('effort key missing'));
		const isScript = typeof s.enforcer === 'string' && s.enforcer.startsWith('script:');
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
					for (const key of ['tools', 'denied', 'rules']) {
						if (!Array.isArray(r[key])) faults.push(where(`roles.${arg} has no ${key} list`));
					}
				}
				checkFile(where, `user/agents/${arg}.md`, s, r && typeof r === 'object' ? r : null, arg);
			} else if (kind === 'file') {
				checkFile(where, arg, s, null, '');
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
					// Real top-level lines only: comments and template spans are blanked before the match.
					const code = codeOnly(text).split(/\r?\n/);
					const defs = code.filter((l) => new RegExp(`^(export )?const ${esc(constName)}(?![\\w$])`).test(l));
					const ok = [`const ${constName} = '${s.model}';`, `export const ${constName} = '${s.model}';`];
					if (defs.length > 1) faults.push(where(`${rel} defines const ${constName} ${defs.length} times`));
					else if (!code.some((l) => ok.includes(l))) faults.push(where(`${rel} has no const ${constName} = '${s.model}'`));
				}
			} else if (kind === 'script') {
				if (readText(dir, arg) === null) faults.push(where(`script ${arg} is missing`));
			} else if (kind === 'lead' || kind === 'settings') {
				if (colon >= 0) faults.push(where(`enforcer "${s.enforcer}": ${kind} takes no argument`));
			} else {
				faults.push(where(`enforcer "${s.enforcer}" is not a known form`));
			}
		}

		if (s.floor !== undefined) {
			if (isScript) faults.push(where('never-drop floor on a script step the check cannot read'));
			else if (!meetsFloor(s.model, s.floor)) faults.push(where(`never-drop floor ${s.floor} is not met by model ${s.model}`));
		}
		if (s.neverDrop !== undefined && s.neverDrop !== true) {
			faults.push(where(`never-drop flag must be true or absent, not ${JSON.stringify(s.neverDrop)}`));
		} else if (s.neverDrop === true && s.floor === undefined && !isScript) {
			faults.push(where('never-drop flag on a model step needs a floor'));
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

function nonEmpty(v) {
	return typeof v === 'string' && v.trim() !== '';
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

// Run as the script, by its real path: a junction or symlink to this file still runs the check.
function isMain() {
	try {
		return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
	} catch {
		return false;
	}
}
if (isMain()) process.exitCode = main(process.argv.slice(2));
