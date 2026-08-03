import { WebSocketServer } from 'ws';
import crypto from 'node:crypto';
import { get_user_by_session, random_cards, record_match } from './database.js';
import { get_tokens } from './tokenizer.js';
import { build_options } from './dictionary.js';

// Rooms are stored in memory inside this Map.
const rooms = new Map();

// Consts.
const NOUN = '名詞';	// To find nouns.
const MIN_PLAYERS = 2;	// Smallest match.
const MAX_PLAYERS = 4;	// A room holds at most four players.
const ROUNDS = 10;		// How many rounds per match.

// Find the token that is the card's word AND a noun (surface or lemma match)
function pick_target_token(tokens, word) {
	return tokens.find(t =>
		t.pos === NOUN && (t.surface === word || t.lemma === word)
	) ?? null;
}

// Replace [start, end] of the phrase with the reading, by offset so a repeated
// word blanks the right occurrence.
function blank_phrase(phrase, start, end, reading) {
	return 	phrase.slice(0, start) + '\u0001' + 
			reading + '\u0001' + 
			phrase.slice(end);
}

// Turn one card into a round, or null if it cannot be used
async function make_round(card) {
	if (!card || !card.word || !card.phrase || !card.reading) return null;

	const tokens = await get_tokens(card.phrase);
	const target = pick_target_token(tokens, card.word);
	if (!target) return null;

	const options = build_options({
		word: card.word,
		reading: card.reading,
		entry_id: card.jmdict_id ?? null,
	});
	if (options.length < 4) return null;

	return {
		phrase: card.phrase,
		blanked: blank_phrase(
			card.phrase, 
			target.start, 
			target.end, 
			card.reading
		),
		answer: card.word,
		reading: card.reading,
		meanings: card.meanings ?? [],
		options,
		video_id: card.video_id ?? null,
		timestamp: card.timestamp ?? null,
	};
}

// Draw noun-rounds from every player's Mining deck. Each player must supply
// their share; returns null if one cannot (the match must not start then).
async function build_round_set(player_ids, total = ROUNDS) {
	const per_player = Math.max(2, Math.ceil(total / player_ids.length));
	const pool = [];

	for (const user_id of player_ids) {
		const cards = random_cards(user_id, per_player * 6);

		const rounds = [];
		for (const card of cards) {
			if (rounds.length >= per_player) break;
			const round = await make_round(card);
			if (round) rounds.push(round);
		}

		if (rounds.length < per_player) return null;
		pool.push(...rounds);
	}

	for (let i = pool.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[pool[i], pool[j]] = [pool[j], pool[i]];
	}

	return pool.slice(0, total);
}

// MATCH ENGINE

const ROUND_MS = 20_000;

function create_match(player_ids, match_rounds, { round_ms = ROUND_MS } = {}) {
	return {
		players: new Map(player_ids.map(id => 
			[id, { id, score: 0, active: true }]
		)),
		rounds: match_rounds,
		round_ms,
		index: -1,
		open_at: null,
		answers: new Map(),
		status: 'created',
		winner_id: undefined,
	};
}

function active_ids(match) {
	return [...match.players.values()].filter(p => p.active).map(p => p.id);
}

function current_round(match) {
	return match.rounds[match.index] ?? null;
}

function open_round(match, now) {
	if ((match.index + 1) >= match.rounds.length) return null;

	match.index += 1;
	match.open_at = now;
	match.answers = new Map();
	match.status = 'playing';

	return current_round(match);
}

// Returns true if this answer completes the round (all active players answered)
function submit_answer(match, user_id, choice, at) {
	const player = match.players.get(user_id);
	if (!player || !player.active) return false;
	if (match.status !== 'playing') return false;
	if (match.answers.has(user_id)) return false;

	const round = current_round(match);
	if (!round) return false;

	match.answers.set(
		user_id, { choice, at, correct: choice === round.answer }
	);

	return active_ids(match).every(id => match.answers.has(id));
}

function is_expired(match, now) {
	return match.status === 'playing'
		&& match.open_at != null
		&& now - match.open_at >= match.round_ms;
}

function resolve_round(match) {
	const correct = [...match.answers.entries()]
		.filter(([id, a]) => a.correct && match.players.get(id)?.active)
		.map(([id, a]) => ({ id, at: a.at }));

	let round_winner = null;
	if (correct.length > 0) {
		correct.sort((a, b) => a.at - b.at);
		round_winner = correct[0].id;
		match.players.get(round_winner).score += 1;
	}

	return {
		round_index: match.index,
		answer: current_round(match)?.answer ?? null,
		round_winner,
		answers: [...match.answers.entries()].map(([id, a]) => ({
			id, choice: a.choice, correct: a.correct, at: a.at,
		})),
		scores: scores(match),
	};
}

// Quit/disconnect means forfeiting the match.
// Give the current round to those still in, end if only one remains.
function forfeit(match, user_id) {
	const player = match.players.get(user_id);
	if (!player || !player.active) return { ended: false, credited: [] };

	player.active = false;

	const credited = [];
	if (match.status === 'playing' && current_round(match)) {
		for (const p of match.players.values()) {
			if (p.active) { p.score += 1; credited.push(p.id); }
		}
	}

	return { ended: active_ids(match).length < 2, credited };
}

function scores(match) {
	return [...match.players.values()].map(
		p => ({ id: p.id, score: p.score, active: p.active })
	);
}

function finish(match) {
	match.status = 'finished';

	const all = [...match.players.values()];
	const top = Math.max(...all.map(p => p.score));
	const leaders = all.filter(p => p.score === top);

	match.winner_id = leaders.length === 1 ? leaders[0].id : null;
	return match.winner_id;
}

function is_last_round(match) {
	return match.index + 1 >= match.rounds.length;
}

/*
*	Socket handling.
*/

function public_round(round, index, total, round_ms) {
	return {
		round_index: index,
		round_total: total,
		blanked: round.blanked,
		options: round.options,
		deadline_ms: round_ms,
	};
}

// Clear any running round timer on a room
function clear_timer(room) {
	if (room.timer) { clearTimeout(room.timer); room.timer = null; }
}

// Open the next round (or finish if none left), broadcast it.
function next_round(room) {
	const match = room.match;
	const round = open_round(match, Date.now());

	if (!round) { end_match(room); return; }

	broadcast(room, 'round_start',
		public_round(round, match.index, match.rounds.length, match.round_ms));

	clear_timer(room);
	room.timer = setTimeout(() => {
		// Time finished.
		if (is_expired(match, Date.now())) finish_round(room);
	}, match.round_ms);
}

// Resolve the current round, tell everyone the result, then advance or end
function finish_round(room) {
	clear_timer(room);
	const result = resolve_round(room.match);

	broadcast(room, 'round_result', {
		round_index: result.round_index,
		answer: result.answer,
		round_winner: result.round_winner,
		scores: result.scores,
	});

	if (is_last_round(room.match)) end_match(room);
	else room.timer = setTimeout(() => next_round(room), 2500);
}

// Finish the match: 
// compute winner, broadcast, finish match.
function end_match(room) {
	clear_timer(room);
 
	const winner_id = finish(room.match);
 
	try {
		record_match(scores(room.match), winner_id);
	} catch (err) {
		console.error('Failed to record match');
		console.error(`\tMessage: ${err.message}`);
	}
 
	broadcast(room, 'match_over', {
		winner_id,	// null == draw
		scores: scores(room.match),
	});
 
	room.status = 'lobby';
	room.match = null;
}

// Host starts the game for a room in the lobby.
async function start_game(ws, user) {
	const room = rooms.get(ws.room_code);
	if (!room) return;
	if (room.host_id !== user.id) {
		send(ws, 'error', { message: 'only the host can start' });
		return;
	}
	if (room.status !== 'lobby') {
		send(ws, 'error', { message: 'already started' });
		return;
	}

	const count = room.players.size;
	if (count < MIN_PLAYERS || count > MAX_PLAYERS) {
		send(ws, 'error', {
			message: `need between ${MIN_PLAYERS} and ${MAX_PLAYERS} players`,
		});
		return;
	}

	// Lock the room and tell everyone the match is coming.
	room.status = 'starting';
	broadcast(room, 'game_starting', {});

	const player_ids = [...room.players.keys()];

	let round_set;
	try {
		round_set = await build_round_set(player_ids);
	} catch (err) {
		console.error('Failed to build round set');
		console.error(`\tMessage: ${err.message}`);
		room.status = 'lobby';
		broadcast(room, 'error', { message: 'could not build the game' });
		return;
	}

	// A player may have left while we were building.
	if (room.players.size !== player_ids.length) {
		room.status = 'lobby';
		broadcast(
			room, 
			'error', 
			{ message: 'a player left before the game started' }
		);
		return;
	}

	if (!round_set) {
		room.status = 'lobby';
		broadcast(
			room, 
			'error', 
			{ message: 'a player has too few cards to start' }
		);
		return;
	}

	room.match = create_match(player_ids, round_set);
	room.status = 'playing';

	broadcast(room, 'game_started', {
		round_total: round_set.length,
		players: [...room.players.values()].map(p => (
			{ user_id: p.user_id, username: p.username }
		)),
	});

	next_round(room);
}

// A player answers the current round.
function answer(ws, user, choice) {
	const room = rooms.get(ws.room_code);
	if (!room || !room.match || room.status !== 'playing') return;

	const complete = submit_answer(room.match, user.id, choice, Date.now());

	// Acknowledge just to this player (for UI).
	send(ws, 'answer_ack', { round_index: room.match.index });

	if (complete) finish_round(room);	// Everyone answered.
}

/*
* 	Rooms.
*/

// Pull session_id out of the upgrade request's Cookie header. 
// Same auth as HTTP
function user_from_request(req) {
	const raw = req.headers.cookie ?? '';
	const match = raw.match(/(?:^|;\s*)session_id=([^;]+)/);
	if (!match) 
		return null;
	return get_user_by_session(decodeURIComponent(match[1]));
}

// Short room code.
function make_code() {
	let code;
	do {
		code = crypto.randomBytes(3).toString('hex').toUpperCase();
	} while (rooms.has(code));
	return code;
}

// Send data.
function send(ws, type, data = {}) {
	if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type, ...data }));
}

// Broadcast data.
function broadcast(room, type, data = {}) {
	for (const { ws } of room.players.values()) send(ws, type, data);
}

function room_state(room) {
	return {
		code: room.code,
		host_id: room.host_id,
		status: room.status,
		players: [...room.players.values()].map(
			p => ({ user_id: p.user_id, username: p.username })
		),
	};
}

function handle_message(ws, user, raw) {
	let msg;
	try { msg = JSON.parse(raw); } catch { return; }

	switch (msg.type) {
		case 'create_room': {
			const code = make_code();
			const room = {
				code,
				host_id: user.id,
				players: new Map(),
				status: 'lobby',
			};
			room.players.set(
				user.id, 
				{ ws, user_id: user.id, username: user.username }
			);
			rooms.set(code, room);

			ws.room_code = code;	// Remember which room this socket is in.
			send(ws, 'room_created', room_state(room));
			break;
		}
		case 'join_room': {
			const room = rooms.get(String(msg.code ?? '').toUpperCase());
			if (!room) {
				send(ws, 'error', { message: 'no such room' }); break;
			}
			if (room.status !== 'lobby') {
				send(ws, 'error', { message: 'game already started' }); break;
			}
			if (
				!room.players.has(user.id) && room.players.size >= MAX_PLAYERS
			) {
				send(ws, 'error', { message: 'room is full' }); break;
			}

			room.players.set(
				user.id,
				{ ws, user_id: user.id, username: user.username }
			);
			ws.room_code = room.code;

			send(ws, 'room_joined', room_state(room));
			broadcast(room, 'player_list', room_state(room));
			break;
		}
		case 'start_game': {
			start_game(ws, user);
			break;
		}
		case 'answer': {
			answer(ws, user, msg.choice);
			break;
		}
		case 'leave_room': {
			leave(ws, user);
			break;
		}
	}
}

function leave(ws, user) {
	const room = rooms.get(ws.room_code);
	if (!room) return;

	// Mid-match.
	if (room.match && room.status === 'playing') {
		const { ended, credited } = forfeit(room.match, user.id);

		broadcast(room, 'player_forfeit', {
			user_id: user.id,
			credited,
			scores: scores(room.match),
		});

		if (ended) end_match(room);
	}

	room.players.delete(user.id);
	ws.room_code = null;

	if (room.players.size === 0) {
		clear_timer(room);
		rooms.delete(room.code);
		return;
	}

	// Oldest remaining player becomes the host.
	if (room.host_id === user.id) {
		room.host_id = [...room.players.keys()][0];
	}
	broadcast(room, 'player_list', room_state(room));
}

export function attach_game(server) {
	const wss = new WebSocketServer({ server, path: '/ws/game' });

	wss.on('connection', (ws, req) => {
		const user = user_from_request(req);
		if (!user) {
			send(ws, 'error', { message: 'not authenticated' });
			ws.close();
			return;
		}

		send(ws, 'connected', { user_id: user.id, username: user.username });

		ws.on('message', raw => handle_message(ws, user, raw));
		ws.on('close', () => leave(ws, user));
	});
}
