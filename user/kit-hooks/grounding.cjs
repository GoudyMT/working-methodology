// The grounding check (E18, build 20; the owner 2026-11-04: "never just item codes to pick from"). The 60-second
// overview has been a template and rule text since 1.19.0 and scored 0 of 4 as prose, so it is held here, on the one
// place every decision reaches the owner: the choice pop-up (AskUserQuestion).
//   - an option label that is mostly item codes (K150, TC3, R1-2) is held: a label names the choice in plain words;
//   - a sentence of a question or an option that names an item code with fewer than six plain words beside it is held;
//   - a plan file the question names (.../plans/<name>.md) must open with an "## Overview" section of three lines (what
//     we are looking at, what was found or measured, what is being decided), the build-start overview.
// The refusal goes back to Claude, who rewrites the pop-up; the owner never sees a held one. What it cannot see: a
// chat message (no hook reads one), and whether the plain words are true. A pop-up it cannot read passes.
const fs = require('fs');
const path = require('path');

const CODE = /\b[A-Z]{1,4}\d{1,3}[a-z]?(?:-\d+)?\b/g;
const words = (s) => String(s || '').split(/\s+/).map((w) => w.replace(/^[^\w$]+|[^\w%]+$/g, '')).filter(Boolean);
const plain = (s) => words(s).filter((w) => !new RegExp(`^${CODE.source}$`).test(w));
const sentences = (s) => String(s || '').split(/(?<=[.!?])\s+|\n+/).filter((x) => x.trim());

/** Whether a plan file opens with an Overview section of at least three lines before its next heading. */
function overview(file) {
	const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
	const at = lines.findIndex((l) => /^## Overview\s*$/.test(l));
	if (at < 0 || at > 40) return false;
	const body = [];
	for (const l of lines.slice(at + 1)) { if (/^#{1,6} /.test(l)) break; if (l.trim()) body.push(l); }
	return body.length >= 3;
}

function problemsOf(input) {
	const out = [];
	for (const q of (input.tool_input && input.tool_input.questions) || []) {
		for (const o of q.options || []) {
			const codes = String(o.label || '').match(CODE) || [];
			if (codes.length && codes.length * 2 >= words(o.label).length) out.push(`the option "${String(o.label).slice(0, 40)}" is item codes; name it in plain words`);
		}
		for (const text of [q.question, ...(q.options || []).map((o) => o.description)]) {
			for (const s of sentences(text)) {
				const codes = s.match(CODE);
				if (codes && plain(s).length < 6) out.push(`"${codes[0]}" in "${s.trim().slice(0, 60)}" has no plain words beside it`);
			}
		}
		for (const m of String(q.question || '').matchAll(/[\w./\\:-]*plans[\\/][\w.-]+\.md/g)) {
			const file = path.resolve(String(input.cwd || process.cwd()), m[0]);
			if (fs.existsSync(file) && !overview(file)) out.push(`the plan ${m[0]} has no "## Overview" of three lines at its top`);
		}
	}
	return out;
}

function check(input) {
	if (!input || input.tool_name !== 'AskUserQuestion') return null;
	let found = [];
	try { found = problemsOf(input); } catch { return null; }
	if (!found.length) return null;
	return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: `Held: this pop-up ${found.slice(0, 3).join('; ')}. Open with the 60-second overview (what we are looking at, what was found or measured, what is being decided; _Templates/_Ask Formats.md) and give each item code a plain sentence, then ask again.` } };
}

module.exports = { check };
