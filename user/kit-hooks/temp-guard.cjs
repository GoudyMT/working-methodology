// The temp guard (rule:pre-compact-scan item 5). Found in a project (2026-11-01): a closeout step deleted "every
// temp folder but mine" - a listing of the shared Claude temp folder piped to a recursive delete - and wiped other
// sessions' scratch folders. Every session shares that temp folder, so a delete by exclusion or of a shared parent
// destroys work no session here can see.
//
// PreToolUse on the shell tools. A command that deletes recursively, or pipes a listing into a delete, and names the
// temp area (%TEMP%, $env:TEMP, $TMPDIR, /tmp, the temp path itself) is refused unless every temp path it names is
// inside this session's own folder (<temp>/claude/<project>/<session id>/). A temp path it cannot resolve to a place
// inside that folder - a variable, a Join-Path, a "..", no session id - counts as outside: it fails closed. Other
// deletes and plain listings go through. The sanctioned way to clear temp files is the closeout's temp-clean.mjs.
const fs = require('fs');
const os = require('os');

const DELETE = [
	// PowerShell's Remove-Item and its aliases, and the shells' rm, with a recursive switch.
	/\b(remove-item|ri|rm|del|erase|rmdir|rd)\b[^|;\n]*\s-r[a-z]*\b/i,
	/\brm\s+(-[a-z]*r[a-z]*\b|--recursive\b)/i,
	// cmd's recursive deletes.
	/\b(rmdir|rd|del|erase)\b[^|;\n]*\s\/s\b/i,
	// A listing piped into a delete, the form that deleted by exclusion.
	/\|\s*(%\s*\{[^}]*)?\b(remove-item|ri|rm|del|erase|rmdir|rd)\b/i,
	/\bxargs\b[^|;\n]*\brm\b/i,
	/\bfind\b[^|;\n]*\s(-delete\b|-exec\s+rm\b)/i,
	/\[(system\.)?io\.directory\]::delete\s*\(/i,
];
const posix = (p) => p.replace(/\\/g, '/').replace(/^\/([a-z])\//i, '$1:/').replace(/\/+$/, '').toLowerCase();

let looksLikeDelete = false;

function main() {
	const input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
	const command = String((input.tool_input || {}).command || '');
	if (!DELETE.some((re) => re.test(command))) return;
	looksLikeDelete = true;
	const root = posix(os.tmpdir());
	const TOKEN = '\u0000TMP\u0000';
	// Every way a command names the temp folder becomes one token, then each mention is read with what follows it.
	const text = command
		.replace(/\$\{?env:(temp|tmp)\}?|%(temp|tmp)%|\$\{?(tmpdir|temp|tmp)\}?|\[(system\.)?io\.path\]::gettemppath\(\)|(?<![\w.])\/tmp\b/gi, TOKEN)
		.replace(new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\//g, '[\\\\/]'), 'gi'), TOKEN)
		.replace(new RegExp(root.replace(/^([a-z]):/, '/$1').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), TOKEN);
	if (!text.includes(TOKEN)) return;
	const sid = String(input.session_id || '').toLowerCase();
	const outside = [];
	for (const m of text.matchAll(new RegExp(`${TOKEN}([^\\s'"|;,)\`]*)`, 'g'))) {
		const rest = m[1].replace(/\\/g, '/');
		const parts = [];
		for (const seg of rest.split('/').filter(Boolean)) {
			if (seg === '..') parts.pop();
			else if (seg !== '.') parts.push(seg.toLowerCase());
		}
		// Inside this session's own folder: claude/<project>/<session id>/...
		const own = sid && parts[0] === 'claude' && parts.length >= 3 && parts[2] === sid && !rest.split('/').includes('..');
		if (!own) outside.push(`${root}/${parts.join('/')}`);
	}
	if (!outside.length) return;
	process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason:
		`Refused: this command deletes recursively, or pipes a listing into a delete, and names the shared temp folder outside this session's own folder (${outside[0]}). Every session shares that folder, so a delete by exclusion or of a parent destroys other sessions' work. Delete only the exact paths this session made, inside its own scratch folder: node <closeout skill folder>/temp-clean.mjs clean <scratch folder>. A shared copy the tools cannot delete goes in the handoff for the owner.` } }));
}

// A command that looked like a delete but could not be checked is refused, not let through: this guard fails closed.
try { main(); } catch {
	if (looksLikeDelete) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'The temp guard could not check this command; delete exact paths with temp-clean.mjs instead.' } }));
}
