import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';



const db_path = path.join(import.meta.dirname, '..', 'data', 'dict.db');
const json_path = path.join(
	import.meta.dirname, 
	'..', 
	'data', 
	'jmdict-eng-common.json'
);

const db = new DatabaseSync(db_path);

db.exec(`
	CREATE TABLE IF NOT EXISTS words (
		form		TEXT	NOT NULL,
		word		TEXT	NOT NULL,
		reading		TEXT,
		meanings	TEXT	NOT NULL,
		entry_id	TEXT
	);

	CREATE INDEX IF NOT EXISTS words_form ON words(form);
	CREATE INDEX IF NOT EXISTS words_reading ON words(reading);
`);

const statements = {
	insert_word: db.prepare(`
		INSERT INTO words (form, word, reading, meanings, entry_id)
		VALUES (?, ?, ?, ?, ?)
	`),
	find_words: db.prepare(`
		SELECT word, reading, meanings, entry_id FROM words
		WHERE form = ? ORDER BY rowid
	`),

	// Words sharing a reading, word != reading keeps only kanji-bearing 
	// entries.
	find_by_reading: db.prepare(`
		SELECT DISTINCT word, reading, meanings, entry_id FROM words
		WHERE reading = ? AND entry_id != ? AND word != reading
		ORDER BY RANDOM()
		LIMIT ?
	`),

	// A random bunch of kanji-bearing words.
	random_words: db.prepare(`
		SELECT DISTINCT word, reading, meanings, entry_id FROM words
		WHERE word != reading
		ORDER BY RANDOM()
		LIMIT ?
	`),

	any_word: db.prepare(`SELECT EXISTS(SELECT 1 FROM words) AS present`)
};

function build() {
	const { words } = JSON.parse(fs.readFileSync(json_path, 'utf8'));

	db.exec('BEGIN');
	try {
		for (const entry of words) {
			const first_reading = entry.kana[0]?.text ?? null;
			const word = entry.kanji[0]?.text ?? first_reading;
			if (!word) continue;

			const meanings = JSON.stringify(entry.sense.flatMap(
				sense => sense.gloss.filter(g => g.lang === 'eng').map(g => g.text)
			));

			for (const form of entry.kanji) {
			statements.insert_word.run(form.text, word, first_reading, meanings, entry.id);
			}
			for (const form of entry.kana) {
				statements.insert_word.run(form.text, word, form.text, meanings, entry.id);
			}
		}
		db.exec('COMMIT');
	} catch (err) {
		db.exec('ROLLBACK');
		throw err;
	}
}

if (!statements.any_word.get().present) build();

// Kuromoji reports readings in katakana, JMdict stores them in hiragana.
function to_hiragana(text) {
	let out = '';

	for (const ch of text) {
		// codePointAt fro unicode code.
		const code = ch.codePointAt(0);
		out += ((code >= 0x30a1) && (code <= 0x30f6)) ? 
			String.fromCodePoint(code - 0x60) : ch;
	}

	return out;
}

function shape(row) {
	return {
		word: row.word,
		reading: row.reading,
		meanings: JSON.parse(row.meanings),
		entry_id: row.entry_id,
	};
}

export function get_entries(form, reading = null) {
	const rows = statements.find_words.all(form).map(shape);
	if (!reading || rows.length < 2) return rows;

	const wanted = to_hiragana(reading);
	const idx = rows.findIndex(row => row.reading === wanted);

	if (idx <= 0) return rows;

	return [rows[idx], ...rows.slice(0, idx), ...rows.slice(idx + 1)];
}

// Things for the versus game.

function kanji_count(s) {
	let n = 0;
	for (const ch of s) {
		const c = ch.codePointAt(0);
		if ((c >= 0x4e00) && (c <= 0x9fff)) 
			n++;
	}
	return n;
}

// katakana-only strings must never be a question word or an option
function is_katakana_only(s) {
	for (const ch of s) {
		const c = ch.codePointAt(0);
		if (c === 0x30fc) continue;   // allow the prolonged sound mark 'ー'
		if (c < 0x30a1 || c > 0x30f6) return false;
	}
	return s.length > 0;
}

/*
*	1. same reading (homophones )
*	2. same kanji count
*	3. random kanji-bearing words (fallback)
*/
export function build_options(answer, want = 4) {
	const need = want - 1;
	const answer_kc = kanji_count(answer.word);

	const chosen = new Map();
	const seen_words = new Set([answer.word]);

	const take = rows => {
		for (const r of rows) {
			if (chosen.size >= need) break;
			if (seen_words.has(r.word)) continue;
			if (is_katakana_only(r.word)) continue;
			seen_words.add(r.word);
			chosen.set(r.word, r);
		}
	};

	// Same reading/
	take(statements.find_by_reading.all(answer.reading, answer.entry_id ?? '', 20));

	// Same kanji count.
	if (chosen.size < need) {
		const sample = statements.random_words.all(400);
		take(sample.filter(r => kanji_count(r.word) === answer_kc));
	}

	// Any kanji-bearing word.
	if (chosen.size < need) {
		take(statements.random_words.all(200));
	}

	const options = [answer.word, ...chosen.keys()];

	// Shuffle.
	for (let i = options.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[options[i], options[j]] = [options[j], options[i]];
	}

	return options;
}