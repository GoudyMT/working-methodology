// A Claude project thread's host requires every PR body to open with a two-line attribution block: an HTML comment
// marker and a "Requested by" line. It is the host's, not the body's, so the PR-body audits check what follows it.
// Only a block at the very top is read past; one anywhere else stays part of the body and its checks.
const BLOCK = /^<!-- claude-projects-attribution: \{[^\n]*\} -->\r?\n_Requested by [^\n]+_\r?\n(?:\r?\n)?/;

/**
 * Split a leading host attribution block off a PR body.
 *
 * Args:
 *     text: the PR body as written
 *
 * Returns:
 *     { body, present } - the body the audits check, and whether the block was there
 */
export function stripAttribution(text) {
	const m = text.match(BLOCK);
	return m ? { body: text.slice(m[0].length), present: true } : { body: text, present: false };
}
