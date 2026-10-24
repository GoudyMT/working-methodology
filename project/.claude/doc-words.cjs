// The project's word count for the docs' 1,500-word cap (set the cap per project): every whitespace-separated token that holds a
// letter or a digit, over the whole file. Markdown symbols on their own (- | # >) are not words; a word with a
// symbol attached ("cap," "**Base:**" "07-personal-data.md") is one word.
// Usage: node .claude/doc-words.cjs <file.md> [...]; exit 1 when any file is over the cap.
const fs = require('node:fs');
const path = require('node:path');

const WORD_CAP = 1500;

function countWords(text) {
	let count = 0;
	let token = '';
	const flush = () => {
		if ([...token].some((c) => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9'))) count++;
		token = '';
	};
	for (const ch of text) {
		if (ch.charCodeAt(0) <= 32) flush();
		else token += ch;
	}
	flush();
	return count;
}

if (require.main === module) {
	let over = 0;
	for (const file of process.argv.slice(2)) {
		const words = countWords(fs.readFileSync(file, 'utf8'));
		const flag = words > WORD_CAP ? 'OVER by ' + (words - WORD_CAP) : 'ok';
		if (words > WORD_CAP) over++;
		console.log(String(words).padStart(6) + '  ' + flag.padEnd(12) + path.basename(file));
	}
	process.exit(over > 0 ? 1 : 0);
}

module.exports = { countWords, WORD_CAP };
