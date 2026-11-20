// The retired-wording check (K153, build 20; the owner's rule "working memory matches the kit at closeout"). Notes kept
// a rule the kit had replaced, and later threads acted on them. A script reads the working-memory files for the old
// wording the kit lists in retired-wording.json beside this file; state.mjs check (run by the closeout's release check)
// fails on each hit, and the session-start report names them. A line that starts with (history) quotes an old rule on
// purpose, and a sentence that says the wording is no longer the rule states the new one: both are skipped. What it cannot see: a retired rule in other words than the pattern, and project memory outside the
// repo (a coordinator's memory folder).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const FILES = ['_Working Memory.md', '_Loop Learnings.md', '_Active Plan.md'];

/** The retired wordings, or [] when the list is missing or broken (the state check names a broken list). */
export function retiredList(file = path.join(HERE, 'retired-wording.json')) {
	const j = JSON.parse(fs.readFileSync(file, 'utf8'));
	return (j.retired || []).map((r) => ({ ...r, re: new RegExp(r.pattern, 'i') }));
}

/**
 * Each line of the working-memory files that keeps retired wording.
 *
 * Args:
 *     root: the project folder
 *     list: the retired wordings (retiredList())
 *
 * Returns:
 *     [{ file, line, text, rule, since, now }]
 */
export function retiredHits(root, list = retiredList()) {
	const hits = [];
	for (const file of FILES) {
		let text;
		try { text = fs.readFileSync(path.join(root, file), 'utf8'); } catch { continue; }
		text.split(/\r?\n/).forEach((l, i) => {
			// The build 20 sweep: only a line that opens with (history) is marked, and a sentence that says the old wording
			// is no longer the rule (never, no longer, retired) is the new rule, not the old one.
			if (/^\s*(?:[-*+]|\d+\.)?\s*\(history\)/i.test(l)) return;
			for (const r of list) {
				const m = r.re.exec(l);
				if (!m) continue;
				const before = l.slice(0, m.index).split(/[.;!?]\s/).pop();
				if (/\b(never|not|no longer|don't|do not|retired|replaced|instead of)\b/i.test(before)) continue;
				hits.push({ file, line: i + 1, text: m[0], rule: r.rule, where: r.where, since: r.since, now: r.now });
				break;
			}
		});
	}
	return hits;
}

/** One line per hit, for the state check and the session-start report. */
export const hitLine = (h) => `${h.file} line ${h.line}: retired wording "${h.text.slice(0, 60)}" (${h.rule ? `rule:${h.rule}` : h.where}, since ${h.since}); the rule now: ${h.now}. Remove the line, or start it with (history)`;
