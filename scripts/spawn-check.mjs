#!/usr/bin/env node
// The spawn check (build 23, K212-K214 and the class behind them; the owner's pick 2026-11-21: every site, no list of
// known-bad ones). On Windows a program named by its bare name (git, gh, ps, ...) is looked for in the folder the
// child starts in before PATH, so a git.exe or gh.exe left in a project runs in place of the real one. Every launch of
// a bare name in the files install copies (project/ and user/) must start from node's own folder
// (cwd: path.dirname(process.execPath), or a name the file sets to it), which the shared helper safe-spawn.cjs does.
//   node scripts/spawn-check.mjs [<kit root>] [--dirs project,user]
// Prints one line per launch it cannot show is safe, then the count. Exit 0 when there are none, 1 when there are, 2
// when it could not run. It reads code, not comments or the text inside strings; a call whose options it cannot read
// (an options object held in a variable) counts as unsafe, since it cannot tell.
// What it does not judge: a program named by a variable (merge-gate's realRun, watch.mjs's program(), the browser
// visuals.mjs finds), which those files resolve to a full path themselves; shell scripts (.sh, .ps1).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CALLS = ['spawnSync', 'execFileSync', 'execSync', 'spawn', 'execFile', 'exec'];
// Only these run a command line through a shell, so their first word is the program.
const SHELL_LINE = new Set(['execSync', 'exec']);
const EXTS = /\.(mjs|cjs|js)$/;

/**
 * The source with comments blanked and the inside of every string, template and regex literal blanked, so offsets
 * still match the original. A slash starts a regex after an operator, an opening bracket, a keyword or nothing.
 */
export function mask(src) {
	const out = src.split('');
	const blank = (from, to) => { for (let k = from; k < to; k++) if (out[k] !== '\n') out[k] = ' '; };
	let i = 0;
	let last = '';
	const n = src.length;
	const regexAllowed = () => {
		if (!last) return true;
		if (/[(,=:[!&|?{};+\-*%<>~^]/.test(last)) return true;
		return /^(return|typeof|case|do|else|in|of|new|delete|void|throw|yield|await)$/.test(last);
	};
	while (i < n) {
		const c = src[i];
		const d = src[i + 1];
		if (c === '/' && d === '/') { const e = src.indexOf('\n', i); const end = e < 0 ? n : e; blank(i, end); i = end; continue; }
		if (c === '/' && d === '*') { const e = src.indexOf('*/', i + 2); const end = e < 0 ? n : e + 2; blank(i, end); i = end; continue; }
		if (c === '"' || c === "'" || c === '`') {
			let j = i + 1;
			while (j < n && src[j] !== c) { if (src[j] === '\\') j++; else if (c !== '`' && src[j] === '\n') break; j++; }
			blank(i + 1, Math.min(j, n));
			i = j + 1;
			last = 'str';
			continue;
		}
		if (c === '/' && regexAllowed()) {
			let j = i + 1;
			let cls = false;
			while (j < n && src[j] !== '\n') {
				if (src[j] === '\\') { j += 2; continue; }
				if (src[j] === '[') cls = true;
				else if (src[j] === ']') cls = false;
				else if (src[j] === '/' && !cls) break;
				j++;
			}
			blank(i + 1, Math.min(j, n));
			i = j + 1;
			while (i < n && /[a-z]/i.test(src[i])) i++;
			last = 're';
			continue;
		}
		if (/\s/.test(c)) { i++; continue; }
		if (/[\w$]/.test(c)) {
			let j = i;
			while (j < n && /[\w$]/.test(src[j])) j++;
			last = src.slice(i, j);
			i = j;
			continue;
		}
		last = c;
		i++;
	}
	return out.join('');
}

// The literal at src[at] (a quote), or null when none starts there. A template with a ${...} in it counts only up to it.
function literalAt(src, at) {
	const q = src[at];
	if (q !== '"' && q !== "'" && q !== '`') return null;
	let j = at + 1;
	let text = '';
	while (j < src.length && src[j] !== q) {
		if (q === '`' && src[j] === '$' && src[j + 1] === '{') break;
		if (src[j] === '\\') { text += src[j + 1] || ''; j += 2; continue; }
		text += src[j++];
	}
	return text;
}

// The offset of the parenthesis that closes the one at `open`, read in the masked text.
function closer(masked, open) {
	let depth = 0;
	for (let k = open; k < masked.length; k++) {
		const c = masked[k];
		if (c === '(' || c === '[' || c === '{') depth++;
		else if (c === ')' || c === ']' || c === '}') { depth--; if (depth === 0) return k; }
	}
	return masked.length;
}

const SAFE_VALUE = String.raw`(?:path|require\(\s*['"](?:node:)?path['"]\s*\))\.dirname\(\s*process\.execPath\s*\)`;

/**
 * Every launch of a bare program name in one file's source that does not start from node's own folder.
 *
 * Returns:
 *     [{ line, call, program }]
 */
export function scanText(src) {
	const masked = mask(src);
	// Names the file sets to node's own folder: const SAFE_CWD = path.dirname(process.execPath).
	// Read in the source, kept only where the match starts in code (not inside a comment or a string).
	const inCode = (k) => masked[k] === src[k];
	const safeNames = new Set([...src.matchAll(new RegExp(String.raw`\b([A-Za-z_$][\w$]*)\s*=\s*${SAFE_VALUE}`, 'g'))]
		.filter((m) => inCode(m.index)).map((m) => m[1]));
	const safeCwd = new RegExp(String.raw`\bcwd\s*:\s*(?:${SAFE_VALUE}|(${[...safeNames].map((s) => s.replace(/\$/g, '\\$')).join('|') || '(?!)'})\b)`);
	const found = [];
	// A call by its bare name, or through an object (child_process.spawnSync, require('node:child_process').spawnSync),
	// never a method of something else (a regex's .exec).
	const re = new RegExp(String.raw`(^|[^\w$.]|\)\.|\b(?:child_process|childProcess|cp)\.)(${CALLS.join('|')})\s*\(`, 'g');
	for (const m of masked.matchAll(re)) {
		const call = m[2];
		const open = m.index + m[0].length - 1;
		let a = open + 1;
		while (a < src.length && /\s/.test(masked[a])) a++;
		const lit = literalAt(src, a);
		if (lit === null) continue;
		const program = SHELL_LINE.has(call) ? (lit.trim().split(/\s+/)[0] || '').replace(/^["']|["']$/g, '') : lit;
		if (!program || /[\\/:]/.test(program)) continue;
		const end = closer(masked, open);
		// The options are read in the source, and count only in code, so a cwd: written inside a string never does.
		const own = src.slice(open, end + 1);
		const hit = safeCwd.exec(own);
		if (!hit || !inCode(open + hit.index)) found.push({ line: src.slice(0, m.index + m[1].length).split('\n').length, call, program });
	}
	return found;
}

/**
 * Scan every .mjs/.cjs/.js file under the given folders of a kit root.
 *
 * Returns:
 *     [{ file, line, call, program }] with file relative to root, in posix form, sorted
 */
export function scan(root, dirs = ['project', 'user']) {
	const out = [];
	const walk = (d) => {
		let es = [];
		try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
		for (const e of es.sort((x, y) => (x.name < y.name ? -1 : x.name > y.name ? 1 : 0))) {
			const p = path.join(d, e.name);
			if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p); } else if (e.isFile() && EXTS.test(e.name)) {
				for (const f of scanText(fs.readFileSync(p, 'utf8'))) out.push({ file: path.relative(root, p).split(path.sep).join('/'), ...f });
			}
		}
	};
	for (const d of dirs) walk(path.join(root, d));
	return out;
}

export const lineOf = (f) => `${f.file}:${f.line} ${f.call}('${f.program}')`;

function main(argv) {
	const args = argv.slice(2);
	const at = args.indexOf('--dirs');
	const dirs = at >= 0 ? String(args[at + 1] || '').split(',').filter(Boolean) : ['project', 'user'];
	const rest = at < 0 ? args : args.filter((a, k) => k !== at && k !== at + 1);
	const root = path.resolve(rest[0] || path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
	if (!dirs.length || !dirs.every((d) => fs.existsSync(path.join(root, d)))) {
		console.error(`spawn-check: ${root} has no ${dirs.join(' or ') || 'folders to read'}`);
		return 2;
	}
	const found = scan(root, dirs);
	for (const f of found) console.log(lineOf(f));
	console.log(`${found.length} unsafe bare-name launch${found.length === 1 ? '' : 'es'}${found.length ? ': start each from node\'s own folder, through safe-spawn.cjs (or its options inline in a guard that must load alone)' : ''}`);
	return found.length ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv);
