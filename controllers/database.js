import path from 'node:path';
import { DatabaseSync } from "node:sqlite";
import { hash, verify_hash } from "./hash.js";
import { fsrs, Rating } from 'ts-fsrs';

/*
*	In this file are defined all functions that work on the main db. 
*	This db contains eveything in the application that is not the dictionary.
*/

const db_path = path.join(import.meta.dirname, '..', 'data', 'app.db');
const db = new DatabaseSync(db_path);

db.exec(`
	CREATE TABLE IF NOT EXISTS users (
		id 				INTEGER	PRIMARY KEY NOT NULL,
		username 		TEXT	NOT NULL UNIQUE,
		email			TEXT	NOT NULL UNIQUE,
		password_hash 	TEXT	NOT NULL,
		created_at 		INTEGER NOT NULL
	);

	CREATE TABLE IF NOT EXISTS sessions (
		session_id 				TEXT PRIMARY KEY,
		user_id					INTEGER NOT NULL,
		started_at 				INTEGER NOT NULL,
		expires_at 				INTEGER NOT NULL,
		FOREIGN KEY (user_id) 	REFERENCES users(id)
	);

	CREATE TABLE IF NOT EXISTS decks (
		deck_id				TEXT PRIMARY KEY,
		user_id				INTEGER NOT NULL,
		name				TEXT	NOT NULL,
		is_default			INTEGER NOT NULL DEFAULT 0,
		created_at			INTEGER	NOT	NULL,

		new_cards 			INTEGER NOT NULL DEFAULT 5,
		fsrs_params			TEXT,
		fsrs_fitted_at		INTEGER,
		fstd_fitted_reviews	INTEGER NOT NULL DEFAULT 0,

		FOREIGN KEY (user_id) 	REFERENCES users(id)
	);

	CREATE INDEX IF NOT EXISTS decks_user ON decks(user_id);

	CREATE UNIQUE INDEX IF NOT EXISTS one_default_per_user
	ON decks(user_id) WHERE is_default = 1;

	CREATE TABLE IF NOT EXISTS cards (
		card_id 		INTEGER PRIMARY KEY NOT NULL,	
		deck_id			TEXT NOT NULL,

		word			TEXT NOT NULL,
		reading			TEXT NOT NULL DEFAULT '', 
		meanings		TEXT NOT NULL,
		jmdict_id		TEXT,
		phrase			TEXT NOT NULL DEFAULT '',
		video_id 		TEXT,	
		timestamp		REAL,
		timestamp_end	REAL,
		created_at		INTEGER NOT NULL,
		
		due				INTEGER DEFAULT NULL,
		stability		REAL NOT NULL DEFAULT 0,
		difficulty		REAL NOT NULL DEFAULT 0,
		elapsed_days	INTEGER NOT NULL DEFAULT 0,
		scheduled_days	INTEGER NOT NULL DEFAULT 0,
		reps			INTEGER NOT NULL DEFAULT 0,
		lapses			INTEGER NOT NULL DEFAULT 0,
		learning_steps	INTEGER NOT NULL DEFAULT 0,
		state			INTEGER NOT NULL DEFAULT 0,
		last_review		INTEGER,

		UNIQUE (deck_id, word, reading),
		CHECK (state BETWEEN 0 AND 3),
		FOREIGN KEY (deck_id) REFERENCES decks(deck_id)
	);

	CREATE TABLE IF NOT EXISTS reviews (
		review_id 			INTEGER PRIMARY KEY NOT NULL,
		card_id 			INTEGER NOT NULL,

		rating 				INTEGER NOT NULL,
		state 				INTEGER NOT NULL,
		due 				INTEGER NOT NULL,
		stability 			REAL NOT NULL,
		difficulty 			REAL NOT NULL,
		elapsed_days 		INTEGER NOT NULL,
		last_elapsed_days	INTEGER NOT NULL,
		scheduled_days 		INTEGER NOT NULL,
		learning_steps 		INTEGER NOT NULL DEFAULT 0,
		reviewed_at 		INTEGER NOT NULL,

		undone_at 			INTEGER,
		
		CHECK (rating BETWEEN 1 AND 4),
		CHECK (state BETWEEN 0 AND 3),
		FOREIGN KEY (card_id) REFERENCES cards(card_id)
	);

	CREATE TABLE IF NOT EXISTS history (
		user_id    INTEGER NOT NULL,
		video_id   TEXT    NOT NULL,
		watched_at INTEGER NOT NULL,

		PRIMARY KEY (user_id, video_id)
	);

	CREATE INDEX IF NOT EXISTS idx_history_user_time
	ON history (user_id, watched_at DESC);

	CREATE TABLE IF NOT EXISTS matches (
		match_id    TEXT PRIMARY KEY,
		winner_id   INTEGER,
		created_at  INTEGER NOT NULL,
		ended_at    INTEGER,
		FOREIGN KEY (winner_id) REFERENCES users(id)
	);

	CREATE TABLE IF NOT EXISTS match_players (
		match_id    TEXT    NOT NULL,
		user_id     INTEGER NOT NULL,
		score       INTEGER NOT NULL DEFAULT 0,
		defeated    INTEGER NOT NULL DEFAULT 0,
		PRIMARY KEY (match_id, user_id),
		FOREIGN KEY (match_id) REFERENCES matches(match_id),
		FOREIGN KEY (user_id)  REFERENCES users(id)
	);

	CREATE INDEX IF NOT EXISTS idx_match_players_user
	ON match_players (user_id);
`);

/*
*	Migration code for old matches.
*/

function column_exists(table, column) {
	try {
		const row = db.prepare(
			`SELECT COUNT(*) AS n FROM pragma_table_info('${table}') WHERE name = ?`
		).get(column);
		return row.n > 0;
	} catch {
		return false;
	}
}

if (!column_exists('match_players', 'defeated')) {
	try {
		db.exec(
			`ALTER TABLE match_players ADD COLUMN defeated INTEGER NOT NULL DEFAULT 0`
		);
		db.exec(`
			UPDATE match_players
			SET defeated = (
				SELECT COUNT(*) FROM match_players AS o
				WHERE o.match_id = match_players.match_id
				  AND o.score < match_players.score
			)
		`);
	} catch (err) {
		console.error('Could not migrate match_players.defeated');
		console.error(`\tMessage: ${err.message}`);
	}
}

const statements = {
	/* 
	*	Related to users and sessions. 
	*/
	
	// User statements.
	create_user: db.prepare(`
		INSERT INTO users (username, email, password_hash, created_at)
		VALUES (?, ?, ?, ?)
  	`),
	find_user_by_username: db.prepare(`
		SELECT * 
		FROM users 
		WHERE username = ?
	`),
	find_user_by_id: db.prepare(`
		SELECT * 
		FROM users 
		WHERE id = ?
	`),
	delete_user_by_id: db.prepare(`
		DELETE FROM users 
		WHERE id = ?
	`),
	find_user_by_session: db.prepare(`
		SELECT u.* FROM users u
		JOIN sessions s ON s.user_id = u.id
		WHERE s.session_id = ?
	`),

	// Sessions statements.
	create_session: db.prepare(`
		INSERT INTO sessions (session_id, user_id, started_at, expires_at)
		VALUES (?, ?, ?, ?)
	`),
	find_session: db.prepare(`
		SELECT * 
		FROM sessions 
		WHERE session_id = ?
	`),
	delete_session: db.prepare(`
		DELETE FROM sessions 
		WHERE session_id = ?
	`),
	delete_sessions_by_user: db.prepare(`
		DELETE FROM sessions 
		WHERE user_id = ?
	`),
	delete_other_sessions: db.prepare(`
		DELETE FROM sessions
		WHERE user_id = ? AND session_id != ?
	`),
	touch_session: db.prepare(`
		UPDATE sessions SET expires_at = ? WHERE session_id = ?
	`),

	/* 
	*	Related to decks and cards. 
	*/

	// Decks statemensts.
	create_deck: db.prepare(`
		INSERT INTO decks (deck_id, user_id, name, is_default, created_at)
		VALUES (?, ?, ?, ?, ?)
	`),
	find_first_deck_by_user: db.prepare(`
		SELECT deck_id FROM decks
		WHERE user_id = ?
		ORDER BY created_at, deck_id
		LIMIT 1
	`),
	find_default_deck: db.prepare(`
		SELECT deck_id FROM decks
		WHERE user_id = ? AND is_default = 1
		LIMIT 1
	`),
	find_deck: db.prepare(`
		SELECT * 
		FROM decks 
		WHERE deck_id = ?
	`),
	deck_overview: db.prepare(`
		SELECT
			COUNT(*) FILTER (WHERE c.due IS NULL) AS new_count,
			COUNT(*) FILTER (WHERE c.due <= ? AND c.state IN (1, 3))  AS learning_count,
			COUNT(*) FILTER (WHERE c.due <= ? AND c.state = 2) AS review_count
		FROM cards c
		WHERE c.deck_id = ?
	`),
	delete_decks_by_user: db.prepare(`DELETE FROM decks WHERE user_id = ?`),

	// Cards statements.

	// keeping due NULL at creation, a new card as not already been 
	// graded 馬鹿〜
	insert_card: db.prepare(`
		INSERT INTO cards (
			deck_id, word, reading, meanings, jmdict_id,
			phrase, video_id, timestamp, timestamp_end, created_at
		)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`),
	find_card_owned: db.prepare(`
		SELECT c.* FROM cards c
		JOIN decks d ON d.deck_id = c.deck_id
		WHERE d.user_id = ? AND c.card_id = ?
	`),
	find_card_by_word: db.prepare(`
		SELECT c.* FROM cards c
		JOIN decks d ON d.deck_id = c.deck_id
		WHERE d.user_id = ? AND c.deck_id = ? AND c.word = ? AND c.reading = ?
	`),
	find_cards_by_video: db.prepare(`
		SELECT * FROM cards
		WHERE deck_id = ? AND video_id = ?
		ORDER BY timestamp ASC
	`),
	find_next_card: db.prepare(`
		SELECT c.* FROM cards c
		JOIN decks d ON d.deck_id = c.deck_id
		WHERE d.user_id = ? AND c.due <= ?
		ORDER BY c.due
		LIMIT 1
	`),
	find_next_new_card: db.prepare(`
		SELECT c.* FROM cards c
		JOIN decks d ON d.deck_id = c.deck_id
		WHERE d.user_id = ? AND c.due IS NULL
		ORDER BY c.created_at, c.card_id
		LIMIT 1
	`),
	find_next_learning_ahead: db.prepare(`
		SELECT c.* FROM cards c
		JOIN decks d ON d.deck_id = c.deck_id
		WHERE d.user_id = ? AND c.state IN (1, 3)
		  AND c.due IS NOT NULL AND c.due <= ?
		ORDER BY c.due
		LIMIT 1
	`),
	count_due: db.prepare(`
		SELECT COUNT(*) AS n FROM cards c
		JOIN decks d ON d.deck_id = c.deck_id
		WHERE d.user_id = ? AND c.due <= ?
	`),
	delete_card: db.prepare(`DELETE FROM cards WHERE card_id = ?`),
	find_card_by_jmdict: db.prepare(`
		SELECT c.card_id FROM cards c
		JOIN decks d ON d.deck_id = c.deck_id
		WHERE d.user_id = ? AND c.deck_id = ? AND c.jmdict_id = ?
		LIMIT 1
	`),
	update_card_fields: db.prepare(`
		UPDATE cards SET word = ?, reading = ?, meanings = ?, phrase = ?
		WHERE card_id = ?
	`),
	// Counts new cards introduced today.
	count_new_today: db.prepare(`
		SELECT COUNT(*) AS n FROM reviews r
		JOIN cards c ON c.card_id = r.card_id
		JOIN decks d ON d.deck_id = c.deck_id
		WHERE d.user_id = ? AND r.undone_at IS NULL
		  AND r.reviewed_at >= ? AND r.state = 0
	`),
	// Count unstudied card in the deck.
	count_new_available: db.prepare(`
		SELECT COUNT(*) AS n FROM cards c
		JOIN decks d ON d.deck_id = c.deck_id
		WHERE d.user_id = ? AND c.due IS NULL
	`),
	set_deck_new_cards: db.prepare(`
		UPDATE decks SET new_cards = ?
		WHERE deck_id = ? AND user_id = ?
	`),
	get_deck_new_cards: db.prepare(`
		SELECT new_cards FROM decks
		WHERE deck_id = ? AND user_id = ?
	`),
	delete_cards_by_user: db.prepare(`
		DELETE FROM cards WHERE deck_id IN (
			SELECT deck_id FROM decks WHERE user_id = ?
		)
	`),
	get_cards: db.prepare(`
		SELECT c.* FROM cards c
		JOIN decks d ON d.deck_id = c.deck_id
		WHERE d.user_id = ?
		ORDER BY c.created_at DESC, c.card_id DESC
		LIMIT ? OFFSET ?
	`),
	count_cards: db.prepare(`
		SELECT COUNT(*) AS count FROM cards c
		JOIN decks d ON d.deck_id = c.deck_id
		WHERE d.user_id = ?
	`),
	

	// Reviews statements.
	insert_review: db.prepare(`
		INSERT INTO reviews (
			card_id, rating, state, due, stability, difficulty,
			elapsed_days, last_elapsed_days, scheduled_days,
			learning_steps, reviewed_at
		)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`),
	update_schedule: db.prepare(`
		UPDATE cards SET
			due = ?, stability = ?, difficulty = ?, elapsed_days = ?,
			scheduled_days = ?, reps = ?, lapses = ?, learning_steps = ?,
			state = ?, last_review = ?
		WHERE card_id = ?
	`),
	mark_review_undone: db.prepare(`
		UPDATE reviews SET undone_at = ? WHERE review_id = ?
	`),
	find_last_review: db.prepare(`
		SELECT r.* FROM reviews r
		JOIN cards c ON c.card_id = r.card_id
		JOIN decks d ON d.deck_id = c.deck_id
		WHERE d.user_id = ? AND r.undone_at IS NULL AND r.reviewed_at >= ?
		ORDER BY r.reviewed_at DESC, r.review_id DESC
		LIMIT 1
	`),
	delete_reviews_by_card: db.prepare(`
		DELETE FROM reviews 
		WHERE card_id = ?
	`),
	review_forecast: db.prepare(`
		SELECT
			CAST((c.due - ?) / 86400000 AS INTEGER) AS day_offset,
			COUNT(*) AS n
		FROM cards c
		JOIN decks d ON d.deck_id = c.deck_id
		WHERE d.user_id = ?
		  AND c.due IS NOT NULL
		  AND c.due >= ?
		  AND c.due < ?
		GROUP BY day_offset
		ORDER BY day_offset
	`),
	random_cards: db.prepare(`
		SELECT c.* FROM cards c
		JOIN decks d ON d.deck_id = c.deck_id
		WHERE d.user_id = ?
		ORDER BY RANDOM()
		LIMIT ?
	`),
	delete_reviews_by_user: db.prepare(`
		DELETE FROM reviews WHERE card_id IN (
			SELECT c.card_id FROM cards c
			JOIN decks d ON d.deck_id = c.deck_id
			WHERE d.user_id = ?
		)
	`),
	

	/*
	*	History statements.
	*/

	add_history: db.prepare(`
		INSERT INTO history (user_id, video_id, watched_at)
		VALUES (?, ?, ?)
		ON CONFLICT (user_id, video_id)
		DO UPDATE SET watched_at = excluded.watched_at
	`),

	// number of rows skipped ahead of it.
	get_history: db.prepare(`
		SELECT video_id, watched_at
		FROM history
		WHERE user_id = ?
		ORDER BY watched_at DESC
		LIMIT ? OFFSET ?
	`),

	count_history: db.prepare(`
		SELECT COUNT(*) AS count
		FROM history
		WHERE user_id = ?
	`),

	delete_history_by_user: db.prepare(`
		DELETE FROM history 
		WHERE user_id = ?
	`),

	delete_history_entry: db.prepare(`
		DELETE FROM history
		WHERE user_id = ? AND video_id = ?
	`),

	
	/*
	*	Game statements.
	*/

	create_match: db.prepare(`
		INSERT INTO matches (match_id, winner_id, created_at, ended_at) VALUES (?, ?, ?, ?)
	`),
	add_match_player: db.prepare(`
		INSERT INTO match_players (match_id, user_id, score, defeated)
		VALUES (?, ?, ?, ?)
	`),
	delete_match_players_by_user: db.prepare(`
		DELETE FROM match_players 
		WHERE user_id = ?
	`),
	clear_match_wins_by_user: db.prepare(`
		UPDATE matches 
		SET winner_id = NULL 
		WHERE winner_id = ?
	`),

	// Leader board.
	leaderboard_all: db.prepare(`
		SELECT u.id AS user_id, u.username,
		       COALESCE(SUM(mp.defeated), 0) AS wins
		FROM users u
		LEFT JOIN match_players mp ON mp.user_id = u.id
		GROUP BY u.id
		ORDER BY wins DESC, u.username ASC
	`),
	player_count: db.prepare(`SELECT COUNT(*) AS n FROM users`),
};

/*
*	Users and session functions.
*/

// user methods
export async function create_user(username, email, password) {
	const password_hash = await hash(password);
	const created_at = Date.now();

	db.exec('BEGIN');
	try {
		const { lastInsertRowid } = statements.create_user.run(
			username, email, password_hash, created_at
		);
		const user_id = Number(lastInsertRowid);

		statements.create_deck.run(
			crypto.randomUUID(),
			user_id, 
			'Mining', 
			1,			// is_default: this is the user's base mining deck
			created_at
		);

		db.exec('COMMIT');
		return user_id;
	} catch (err) {
		db.exec('ROLLBACK');
		throw err;
	}
}

export function get_user_by_username(username) {
	return statements.find_user_by_username.get(username);
}

export function get_user_by_id(id) {
	return statements.find_user_by_id.get(id);
}

export async function authenticate_user(username, password) {
	const user = statements.find_user_by_username.get(username);
	
	if (!user) 
		return null;
	
	return (await verify_hash(password, user.password_hash)) ? user : null;
}

export function get_user_by_session(session_id) {
	if (session_id == null) return null;

	const session = statements.find_session.get(session_id);
	if (!session) return null;
	if (session.expires_at < Date.now()) {
		statements.delete_session.run(session_id);
		return null;
	}

	// Renew only when past half-life.
	const now = Date.now();
	if (session.expires_at - now < SESSION_TTL_MS / 2) {
		statements.touch_session.run(now + SESSION_TTL_MS, session_id);
	}

	return statements.find_user_by_session.get(session_id);
}

// Session methods.
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 60;

export function create_session(user_id, ttl_ms = SESSION_TTL_MS) {
	const session_id = crypto.randomUUID(); // not guessable
	const now = Date.now();
	statements.create_session.run(session_id, user_id, now, now + ttl_ms);
	return session_id;
}

export function get_session(session_id) {
	const session = statements.find_session.get(session_id);
	if (!session) return null;
	if (session.expires_at < Date.now()) {   // expired, clean up and reject
		statements.delete_session.run(session_id);
		return null;
	}
	return session;
}

export function destroy_session(session_id) {
	statements.delete_session.run(session_id);
}
export function delete_user_by_session(session_id) {
	const session = statements.find_session.get(session_id);
	if (!session) return false;

	const user_id = session.user_id;

	db.exec('BEGIN');
	try {
		statements.delete_reviews_by_user.run(user_id);
		statements.delete_cards_by_user.run(user_id);
		statements.delete_decks_by_user.run(user_id);
		statements.delete_match_players_by_user.run(user_id);
		statements.clear_match_wins_by_user.run(user_id);
		statements.delete_history_by_user.run(user_id);
		statements.delete_sessions_by_user.run(user_id);
		statements.delete_user_by_id.run(user_id);
		db.exec('COMMIT');
		return true;
	} catch (err) {
		db.exec('ROLLBACK');
		throw err;
	}
}

export function delete_other_sessions(user_id, keep_session_id) {
	statements.delete_other_sessions.run(user_id, keep_session_id);
}



/*
*	Functions for decks and cards.
*/

// Decks methods.

export function get_default_deck(user_id) {
	const deck = statements.find_default_deck.get(user_id);
	if (deck) return deck.deck_id;

	// create_user always makes this deck; if it is somehow missing, recreate
	// the right one (named Mining)
	const id = crypto.randomUUID();
	statements.create_deck.run(id, user_id, 'Mining', 1, Date.now());
	return id;
}

const LEARN_AHEAD_MS = 20 * 60 * 1000;
export function deck_overview(user_id) {
	const deck_id = get_default_deck(user_id);
	const deck = statements.find_deck.get(deck_id);
	const now = Date.now();

	const { new_count, learning_count, review_count } =
		statements.deck_overview.get(now + LEARN_AHEAD_MS, now, deck_id);

	return {
		deck_id,
		name: deck?.name ?? 'Deck',
		new_available: new_count,
		new_remaining: count_new_remaining(user_id),
		learning: learning_count,
		review: review_count,
	};
}

// Cards and reviews methods.

export function create_card(user_id, card) {
	const deck_id = get_default_deck(user_id);
	const now = Date.now();

	const { lastInsertRowid } = statements.insert_card.run(
		deck_id, card.word, card.reading ?? '', JSON.stringify(card.meanings ?? []),
		card.jmdict_id ?? null, card.phrase ?? '', card.video_id ?? null,
		card.timestamp ?? null, card.timestamp_end ?? null, now,
	);

	return Number(lastInsertRowid);
}

export function get_card(user_id, card_id) {
	const row = statements.find_card_owned.get(user_id, card_id);
	return row ? shape_card(row) : null;
}

export function get_next_card(user_id) {
	const now = Date.now();

	const due = statements.find_next_card.get(user_id, now);
	if (due) return shape_card(due);

	const deck_id = get_default_deck(user_id);
	const limit = statements.find_deck.get(deck_id)?.new_cards ?? 0;
	const introduced = statements.count_new_today.get(user_id, start_of_day()).n;

	if (introduced < limit) {
		const fresh = statements.find_next_new_card.get(user_id);
		if (fresh) return shape_card(fresh);
	}

	const soon = statements.find_next_learning_ahead.get(user_id, now + LEARN_AHEAD_MS);
	return soon ? shape_card(soon) : null;
}

export function count_due_cards(user_id) {
	return statements.count_due.get(user_id, Date.now()).n;
}

export function delete_card(user_id, card_id) {
	if (!statements.find_card_owned.get(user_id, card_id)) return false;

	db.exec('BEGIN');
	try {
		statements.delete_reviews_by_card.run(card_id);
		statements.delete_card.run(card_id);
		db.exec('COMMIT');
		return true;
	} catch (err) {
		db.exec('ROLLBACK');
		throw err;
	}
}

export function update_card(user_id, card_id, fields) {
	const row = statements.find_card_owned.get(user_id, card_id);
	if (!row) return null;

	statements.update_card_fields.run(
		fields.word ?? row.word,
		fields.reading ?? row.reading,
		JSON.stringify(fields.meanings ?? JSON.parse(row.meanings)),
		fields.phrase ?? row.phrase,
		card_id,
	);

	return get_card(user_id, card_id);
}

function shape_card(row) {
	return row ? { ...row, meanings: JSON.parse(row.meanings) } : null;
}

export function card_exists(user_id, deck_id, jmdict_id) {
	return statements.find_card_by_jmdict.get(user_id, deck_id, jmdict_id) !== undefined;
}

export function set_new_cards_limit(user_id, n) {
	const deck_id = get_default_deck(user_id);
	statements.set_deck_new_cards.run(n, deck_id, user_id);
}

export function get_new_cards_limit(user_id) {
	const deck_id = get_default_deck(user_id);
	return statements.get_deck_new_cards.get(deck_id, user_id)?.new_cards ?? 0;
}

// The DAY_ROLLOVER_H is used so that a day does not finish at midnight. 
// To not lose an ANKI streak I have many times burned the midnight oil...
const DAY_ROLLOVER_H = 4;
function start_of_day(now = Date.now()) {
	const d = new Date(now - DAY_ROLLOVER_H * 3600_000);
	d.setHours(0, 0, 0, 0);
	return d.getTime() + DAY_ROLLOVER_H * 3600_000;
}

export function count_new_remaining(user_id) {
	const deck_id = get_default_deck(user_id);

	const limit = statements.find_deck.get(deck_id)?.new_cards ?? 0;
	const introduced = statements.count_new_today.get(user_id, start_of_day()).n;
	const available = statements.count_new_available.get(user_id).n;

	// The new cards left to do today, but never more than actually are present
	// in the user deck.
	return Math.max(0, Math.min(limit - introduced, available));
}

// Cards in the user's deck, paged like get_history.
export function get_cards(user_id, limit, page = 0) {
	return statements.get_cards.all(user_id, limit, page * limit).map(shape_card);
}

export function cards_by_video(user_id, video_id) {
	if (!video_id) return [];
	const deck_id = get_default_deck(user_id);
	return statements.find_cards_by_video.all(deck_id, video_id).map(shape_card);
}

export function count_cards(user_id) {
	return statements.count_cards.get(user_id).count;
}

const scheduler = fsrs();

function to_fsrs(row) {
	// A new card has due = NULL. Fall back to created_at so it is never
	// new Date(null) === the 1970 epoch
	return {
		due: row.due != null ? new Date(row.due) : new Date(row.created_at),
		stability: row.stability,
		difficulty: row.difficulty, elapsed_days: row.elapsed_days,
		scheduled_days: row.scheduled_days, reps: row.reps,
		lapses: row.lapses, learning_steps: row.learning_steps ?? 0,
		state: row.state,
		last_review: row.last_review ? new Date(row.last_review) : undefined,
	};
}

function from_fsrs(obj) {
	const out = {};
	for (const [k, v] of Object.entries(obj))
		out[k] = v instanceof Date ? v.getTime() : v ?? null;
	return out;
}

export function record_review(user_id, card_id, rating) {
	const row = statements.find_card_owned.get(user_id, card_id);
	if (!row) return null;

	// Compute BEFORE the transaction.
	const result = scheduler.next(to_fsrs(row), new Date(), rating);
	const card = from_fsrs(result.card);
	const log  = from_fsrs(result.log);

	db.exec('BEGIN');
	try {
		statements.update_schedule.run(
			card.due, card.stability, card.difficulty, card.elapsed_days,
			card.scheduled_days, card.reps, card.lapses, card.learning_steps,
			card.state, card.last_review,
			card_id
		);
		statements.insert_review.run(
			card_id, log.rating, log.state, log.due, log.stability,
			log.difficulty, log.elapsed_days, log.last_elapsed_days,
			log.scheduled_days, log.learning_steps,
			log.review // ts-fsrs review maps to the reviewed_at column
		);
		db.exec('COMMIT');
	} catch (err) {
		db.exec('ROLLBACK');
		throw err;
	}

	return card;
}

export function review_forecast(user_id, days = 7) {
	const start = start_of_day();
	const end = start + days * 86400000;

	const rows = statements.review_forecast.get
		? statements.review_forecast.all(start, user_id, start, end)
		: [];

	const buckets = new Array(days).fill(0);
	for (const { day_offset, n } of rows) {
		if (day_offset >= 0 && day_offset < days) buckets[day_offset] = n;
	}
	return buckets;
}

export function random_cards(user_id, n) {
	return statements.random_cards.all(user_id, n).map(shape_card);
}

/*
*	History functions
*/

export function add_history(user_id, video_id) {
	console.log(user_id, video_id);
	statements.add_history.run(
		user_id, 
		video_id, 
		Math.floor(Date.now() / 1000)
	);
}

// The page defaults to 0 to make the default request return the last limit
// seen video 
export function get_history(user_id, limit, page = 0) {
	return statements.get_history.all(user_id, limit, page * limit);
}

export function count_history(user_id) {
	return statements.count_history.get(user_id).count;
}

// Delete the user's whole watch history.
export function clear_history(user_id) {
	statements.delete_history_by_user.run(user_id);
}

// Delete one video from this user's history. Returns whether a row was removed.
export function delete_history_entry(user_id, video_id) {
	return statements.delete_history_entry.run(user_id, video_id).changes > 0;
}

/*
*	Match functions.
*/

// players is [{ id, score }, ...] for both contestants.
export function record_match(players, winner_id) {
	const match_id = crypto.randomUUID();
	const now = Date.now();

	// Poits players earns is num. of opponents they finished strictly above.
	const scored = players.map(p => ({
		id: p.id,
		score: p.score ?? 0,
		defeated: players.filter(
			o => o.id !== p.id && (o.score ?? 0) < (p.score ?? 0)
		).length,
	}));

	db.exec('BEGIN');
	try {
		statements.create_match.run(match_id, winner_id ?? null, now, now);
		for (const player of scored) {
			statements.add_match_player.run(
				match_id, player.id, player.score, player.defeated
			);
		}
		db.exec('COMMIT');
	} catch (err) {
		db.exec('ROLLBACK');
		throw err;
	}

	return match_id;
}

export function match_history(user_id, limit = 20, page = 0) {
	return statements.match_history_for_user.all(user_id, limit, page * limit);
}

export function match_stats(user_id) {
	const { played, won } = 
		statements.match_counts_for_user.get(user_id, user_id);
	let lost = played - won;
	return { played, won, lost };
}

export function leaderboard(user_id) {
	const all = statements.leaderboard_all.all();

	let last_wins = null;
	let last_rank = 0;
	const ranked = all.map((r, i) => {
		if (r.wins !== last_wins) {
			last_rank = i + 1;
			last_wins = r.wins;
		}
		return {
			rank: last_rank,
			username: r.username,
			wins: r.wins,
			is_me: r.user_id === user_id,
		};
	});

	const player = ranked.find(r => r.is_me);

	// User is within the first 10 rows so show the first 10.
	if (!player || ranked.indexOf(player) < 10) {
		return pad_to_10(ranked.slice(0, 10));
	}

	// User is past row 10, show the first 9 rows then the player's own row.
	return [...ranked.slice(0, 9), player];
}

function pad_to_10(rows) {
	const out = rows.slice();
	while (out.length < 10) {
		out.push({ rank: out.length + 1, username: null, wins: null, is_me: false });
	}
	return out;
}

export default db;