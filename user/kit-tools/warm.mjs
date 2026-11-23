// K364 (patch 1.51.1, U18): warm agents. agent-model.cjs loads this file (../kit-tools/warm.mjs in the install layout) to read
// an agent's context size and the open agents of a session; it is also the CLI that logs a reset:
//   node user/kit-tools/warm.mjs reset --agent <id> --role <role> --tokens <n> --reason <text> --log <file>
// The size is read the way call-cap.cjs reads a transcript: each assistant message id once (its last line), and the last
// message in order sets the size, as input + cache read + cache creation + output tokens.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// An agent at or over this many context tokens is over the limit: it is reset, not messaged or continued.
export const WARM_LIMIT = 150000;

const SIZE_FIELDS = ['input_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens', 'output_tokens'];

// The context size of a transcript: the last assistant message's usage. Throws on a file that cannot be read.
export function contextSize(file) {
	const calls = new Map();
	for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
		if (!line.trim()) continue;
		let m;
		try { m = JSON.parse(line).message; } catch { continue; }
		if (m && m.role === 'assistant' && m.usage && m.id) calls.set(m.id, m.usage);
	}
	const last = [...calls.values()].pop();
	return last ? SIZE_FIELDS.reduce((t, k) => t + (Number(last[k]) || 0), 0) : 0;
}

// The first value of a labelled brief line, read as lineValues in agent-model.cjs reads it (this file is its own module, so
// it copies the rule): case-insensitive, a list marker and emphasis around the label allowed, edge emphasis dropped; null
// when there is no such line.
function lineValue(text, label) {
	const re = new RegExp(`^[ \\t]*(?:[-*+][ \\t]+)?[*_\`]*(?:${label})[*_\`]*[ \\t]*:[*_\`]*[ \\t]*(.*)$`, 'im');
	const m = re.exec(text);
	return m ? m[1].trim().replace(/^[*`]+|[*`]+$/g, '').trim() : null;
}

// The Role: and Lane: lines of an agent's brief (its first user message); a role is its first word after markup, lower-cased
// (as roleOf in agent-model.cjs reads it); null when a line is missing.
function briefOf(file) {
	for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
		if (!line.trim()) continue;
		let m;
		try { m = JSON.parse(line).message; } catch { continue; }
		if (!m || m.role !== 'user') continue;
		const text = typeof m.content === 'string' ? m.content : Array.isArray(m.content) ? m.content.map((b) => (b && typeof b.text === 'string' ? b.text : '')).join('\n') : '';
		const role = lineValue(text, 'role');
		const word = role === null ? null : /^[*_`\s]*([a-z][\w-]*)/i.exec(role);
		return { role: word ? word[1].toLowerCase() : null, lane: lineValue(text, 'lane') || null };
	}
	return { role: null, lane: null };
}

// The agentType in agent-<id>.meta.json beside a transcript, a plugin prefix dropped and lower-cased; '' when the file is
// missing, unreadable or names none.
function typeOf(file) {
	try {
		const t = JSON.parse(fs.readFileSync(file.replace(/\.jsonl$/, '.meta.json'), 'utf8')).agentType;
		return typeof t === 'string' ? t.split(':').pop().trim().toLowerCase() : '';
	} catch {
		return '';
	}
}

// The agents of a session's subagents folder: one {id, role, lane, tokens, file} per agent-*.jsonl. A folder that is not
// there has no agents. A file that cannot be read throws, so the caller fails open (K364 S7).
export function openAgents(dir) {
	let names;
	try {
		names = fs.readdirSync(dir);
	} catch (err) {
		if (err && err.code === 'ENOENT') return [];
		throw err;
	}
	return names.filter((n) => /^agent-.+\.jsonl$/.test(n)).sort().map((n) => {
		const file = path.join(dir, n);
		const { role, lane } = briefOf(file);
		const type = typeOf(file);
		// A typed agent is its type (as warmRole reads a spawn); a general agent or an untyped one is its Role: line.
		const typed = type && type !== 'general-purpose' ? type : null;
		return { id: n.slice('agent-'.length, -'.jsonl'.length), role: typed || role, lane, tokens: contextSize(file), file };
	});
}

// The reset flags, each with its value; null when one is missing or has no value.
const FLAGS = ['--agent', '--role', '--tokens', '--reason', '--log'];
function flagsOf(args) {
	const out = {};
	for (const f of FLAGS) {
		const i = args.indexOf(f);
		const v = i >= 0 ? args[i + 1] : undefined;
		if (v === undefined || v.startsWith('--')) return null;
		out[f.slice(2)] = v;
	}
	return out;
}

// Logs one reset: appends {kind, agent, role, tokens, reason, at} to --log and prints the row. Exit 2 on a bad call.
function main(argv) {
	const flags = argv[0] === 'reset' ? flagsOf(argv.slice(1)) : null;
	const tokens = flags ? Number(flags.tokens) : NaN;
	if (!flags || !Number.isFinite(tokens)) {
		process.stderr.write('usage: node user/kit-tools/warm.mjs reset --agent <id> --role <role> --tokens <n> --reason <text> --log <file>\n');
		process.exitCode = 2;
		return;
	}
	const row = { kind: 'reset', agent: flags.agent, role: flags.role, tokens, reason: flags.reason, at: new Date().toISOString() };
	fs.appendFileSync(flags.log, `${JSON.stringify(row)}\n`);
	process.stdout.write(`${JSON.stringify(row)}\n`);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) main(process.argv.slice(2));
