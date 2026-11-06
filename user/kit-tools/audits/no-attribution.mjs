// The owner removed the PR attribution standard: no hidden claude-projects-attribution comment and no "Requested by"
// line in any PR or release body, whatever a host asks for. A body that carries either fails its audit. Prose about
// the rule stays legal, so the line counts only at the start of a line or set off by styling, never inside a code span
// in a sentence. The release-notes skill is user level, so its audit keeps its own copy of this check.
const ENTITIES = { nbsp: ' ', lt: '<', gt: '>', amp: '&', quot: '"' };
const BY = 'requested(?:[\\s*_~-]|<[^>\\n]*>)*by(?![a-z0-9])';
const LEAD = '(?:[ \\t>#*_`~|+\\-[\\]()]|\\d+[.)]\\s|<[^>\\n]*>)*';
const AT_START = new RegExp(`^(${LEAD})(${BY})`, 'gim');
const STYLED = new RegExp(`(?:[_*~[(|]|(?<!-)>|=["'])\\s*${BY}|${BY}\\s*(?:\\*\\*|@|\\[)`, 'i');

// Disguises fall away first: entities, invisible characters, odd spaces, and the wrappers that hide a line from view.
const plain = (text) => text
	// A browser reads a number, and the five names below, with no semicolon too (&#82equested).
	.replace(/&(?:#(\d+);?|#x([\da-f]+);?|([a-z]+);|(nbsp|lt|gt|amp|quot))/gi, (_, dec, hex, name, bare) => {
		if (name || bare) return ENTITIES[(name || bare).toLowerCase()] ?? '';
		const code = dec ? Number(dec) : parseInt(hex, 16);
		return code > 0x10FFFF ? ' ' : String.fromCodePoint(code);
	})
	.replace(/[\p{Cf}\x00-\x08\x0B\x0E-\x1F]/gu, '')
	.replace(/[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g, ' ')
	.replace(/<!-{2,}|-{2,}>|^\[[^\]\n]*\]:\s*(?:#|<>)\s*[("']/gm, '\n');
// Markup inside a word hides it from the reader of the source, not the page: Re**quested**, Req<b></b>uested.
const unbroken = (text) => text.replace(/<[^>\n]*>/g, '').replace(/(?<=\w)(\*{1,2}|_{1,2}|~~)(?=\w)|(?<=\w)(\*{1,2}|_{1,2}|~~)(?=\s+by\b)/gi, '');

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
export function attributionFaults(text) {
	const body = plain(text);
	const faults = [];
	if (/claude-projects-attribution/i.test(body)) faults.push('a claude-projects-attribution marker');
	const prose = noSpans(body);
	if ([prose, unbroken(prose)].some((p) => startsLine(p) || STYLED.test(p))) faults.push('a Requested by line');
	return faults;
}
