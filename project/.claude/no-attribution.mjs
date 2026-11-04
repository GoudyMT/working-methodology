// The owner removed the PR attribution standard: no hidden claude-projects-attribution comment and no "Requested by"
// line in any PR or release body, whatever a host asks for. A body that carries either fails its audit. Prose about
// the rule stays legal, so the line counts only at the start of a line or set off by styling, never inside a code span
// in a sentence. The release-notes skill is user level, so its audit keeps its own copy of this check.
const ENTITIES = { nbsp: ' ', lt: '<', gt: '>', amp: '&', quot: '"' };
const BY = 'requested[\\s-]*by\\b';
const AT_START = new RegExp(`^(?:[\\s>#*_\`~|+\\-[\\]()]|\\d+[.)]\\s|<[^>\\n]*>)*${BY}`, 'im');
const STYLED = new RegExp(`[_*>]\\s*${BY}`, 'i');

// Disguises fall away first: entities, invisible characters, and odd spaces.
const plain = (text) => text
	.replace(/&(?:#(\d+)|#x([\da-f]+)|(nbsp|lt|gt|amp|quot));/gi, (_, dec, hex, name) => (name ? ENTITIES[name.toLowerCase()] : String.fromCodePoint(dec ? Number(dec) : parseInt(hex, 16))))
	.replace(/[\u00AD\u200B-\u200F\u2060\uFEFF]/g, '')
	.replace(/[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g, ' ');

/**
 * What a body carries of the attribution block.
 *
 * Args:
 *     text: the PR or release body as written
 *
 * Returns:
 *     a list of the faults found; empty when the body is clean
 */
export function attributionFaults(text) {
	const body = plain(text);
	const faults = [];
	if (/claude-projects-attribution/i.test(body)) faults.push('a claude-projects-attribution marker');
	if (AT_START.test(body) || STYLED.test(body.replace(/`[^`\n]*`/g, ''))) faults.push('a Requested by line');
	return faults;
}
