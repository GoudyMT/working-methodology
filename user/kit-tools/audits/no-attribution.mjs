// The owner removed the PR attribution standard: no hidden claude-projects-attribution comment and no "Requested by"
// line in any PR or release body, whatever a host asks for. A body that carries either fails its audit. Prose about
// the rule stays legal, so the line counts only at the start of a line or set off by styling, never inside a code span
// in a sentence. The release-notes skill is user level, so its audit keeps its own copy of this check.
const ENTITIES = { nbsp: ' ', lt: '<', gt: '>', amp: '&', quot: '"' };
const BY = 'requested(?:[\\s*_~-]|<[^>\\n]*>)*by(?![a-z0-9])';
const LEAD = '(?:[ \\t>#*_`~|+\\-[\\]()]|\\d+[.)]\\s|<[^>\\n]*>)*';
const AT_START = new RegExp(`^(${LEAD})(${BY})`, 'gim');
const STYLED = new RegExp(`(?:[_*~[(|]|(?<!-)>|=["'])\\s*${BY}|${BY}\\s*(?:\\*\\*|@|\\[)`, 'i');

/**
 * A body's character entities as a browser reads them: a number, and the five names below, with no semicolon too
 * (&#82equested). The PR-body audits read the body this way, so &#65;I is the word AI it shows on the page.
 *
 * Args:
 *     text: the body as written
 *
 * Returns:
 *     the text with each entity replaced by its character
 */
export const entities = (text) => text.replace(/&(?:#(\d+);?|#x([\da-f]+);?|([a-z]+);|(nbsp|lt|gt|amp|quot))/gi, (_, dec, hex, name, bare) => {
	if (name || bare) return ENTITIES[(name || bare).toLowerCase()] ?? '';
	const code = dec ? Number(dec) : parseInt(hex, 16);
	return code > 0x10FFFF ? ' ' : String.fromCodePoint(code);
});

// Disguises fall away first: entities, invisible characters, odd spaces, and the wrappers that hide a line from view.
const plain = (text) => entities(text)
	.replace(/[\p{Cf}\x00-\x08\x0B\x0E-\x1F]/gu, '')
	.replace(/[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g, ' ')
	.replace(/<!-{2,}|-{2,}>|^\[[^\]\n]*\]:\s*(?:#|<>)\s*[("']/gm, '\n');
// Markup inside a word hides it from the reader of the source, not the page: Re**quested**, Req<b></b>uested.
// Tags and empty links come out until none is left, as uncommented() does for comments, so no removal can join a new one;
// a lone angle bracket left over goes too, so no part of a tag survives.
const untagged = (text) => { let t = String(text), was; do { was = t; t = t.replace(/<[^>\n]*>/g, '').replace(/!?\[\]\([^)\n]*\)/g, ''); } while (t !== was); return t.replace(/[<>]/g, ''); };
const unbroken = (text) => untagged(text).replace(/(?<=\w)(\*{1,2}|_{1,2}|~~)(?=\w)|(?<=\w)(\*{1,2}|_{1,2}|~~)(?=\s+by\b)/gi, '');

// A code span in a sentence is prose about the line; one alone on its line is the line.
const noSpans = (body) => body.replace(/\[[xX]\]/g, ' ').replace(/(?<!\\)`[^`\n]*(?<!\\)`(?=[^\n]*\w)/g, ' ');

// At the start of a line, unless a plain lowercase "requested by" only continues the sentence above it.
function startsLine(body) {
	for (const m of body.matchAll(AT_START)) {
		const before = body.slice(0, m.index).split(/\r?\n|\r/);
		const above = before.length > 1 ? before[before.length - 2].trim() : '';
		// A list item's wrapped text continues its sentence too ("- the cleanup that was" / "  requested by ...").
		const listItem = /^([-*+]|\d+[.)])\s+\S/.test(above) && !/[.!?:]$/.test(above);
		if (m[1].trim() || !/^r/.test(m[2]) || !above || /^[#|>]/.test(above) || (/^-/.test(above) && !listItem)) return true;
	}
	return false;
}

/**
 * What a body carries of the attribution block.
 *
 * Args:
 *     text: the PR or release body as written
 *
 * Returns:
 *     a list of the faults found; empty when the body is clean
 */
// K143 (build 18): a comment inside a line is hidden on the page (Re<!---->quested by), so the text is also read with
// each one taken out, again until none is left (Re<!-<!---->->quested leaves Re<!-->quested, itself an empty comment).
const uncommented = (text) => { let t = String(text), was; do { was = t; t = t.replace(/<!--(?:>|->|[\s\S]*?-->)/g, ''); } while (t !== was); return t; };
export function attributionFaults(text) {
	const body = plain(text);
	const faults = [];
	const prose = noSpans(body);
	const joined = noSpans(plain(uncommented(text)));
	// The marker word is read with comments, tags and empty links taken out too (claude-projects-<!---->attribution).
	if ([body, unbroken(body), joined, unbroken(joined)].some((p) => /claude-projects-attribution/i.test(p))) faults.push('a claude-projects-attribution marker');
	if ([prose, unbroken(prose), joined, unbroken(joined)].some((p) => startsLine(p) || STYLED.test(p))) faults.push('a Requested by line');
	return faults;
}
