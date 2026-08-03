/*
*	Versus view.
*/


import { 
	create_template, stamp_template, render_rows 
} from '../utils/template.js';
import { create_notification } from '../utils/notif.js'

// Incredibly ugly circular import. Since the imported function are not called
// at module evaluation time it should be fine.
import { set_nav_guard, clear_nav_guard } from '../main.js'; 

const MIN_PLAYERS_UI = 2;
const MAX_PLAYERS_UI = 4;

/*
*	TEMPLATES
*/

const VERSUS = create_template`
<div id="versus" data-scene="room" data-phase="question">

	<div class="vs-room-scene">
		<h1 class="vs-title">Versus</h1>

		<div class="vs-controls">
			<button class="vs-create" type="button">Create room</button>
			<span class="vs-or">or</span>
			<input class="vs-code-input" type="text" placeholder="ROOM CODE" spellcheck="false" autocomplete="off" maxlength="6">
			<button class="vs-join" type="button">Join</button>
		</div>

		<div class="vs-lobby">
			<div class="vs-lobby-head">
				<span class="vs-room-code"></span>
				<button class="vs-leave-lobby" type="button">Leave</button>
			</div>

			<ul class="vs-players"></ul>

			<button class="vs-start" type="button">Start game</button>
			<div class="vs-wait-host">Waiting for the host to start...</div>
		</div>

		<h2 class="vs-lb-title">Leaderboard</h2>
		<div class="vs-leaderboard"></div>
	</div>

	<div class="vs-game-scene">
		<div class="vs-game-head">
			<span class="vs-round-label"></span>
			<button class="vs-quit" type="button">Quit</button>
		</div>

		<div class="vs-scoreboard"></div>

		<div class="vs-starting">
			<div class="vs-starting-line">Game starting...</div>
		</div>

		<div class="vs-timer"><i class="vs-timer-bar"></i></div>

		<div class="vs-question">
			<p class="vs-phrase"></p>
		</div>

		<div class="vs-options"></div>

		<div class="vs-result">
			<div class="vs-result-line"></div>
			<div class="vs-result-answer"></div>
		</div>

		<div class="vs-over">
			<div class="vs-over-line"></div>
			<ol class="vs-standings"></ol>
			<button class="vs-back" type="button">Back to lobby</button>
		</div>
	</div>
</div>
`;

const OPTION = create_template`
<button class="vs-option" type="button"></button>
`;

const PLAYER_ROW = create_template`
<li class="vs-player">
	<span class="vs-player-name"></span><span class="vs-player-host"></span>
</li>
`;

const LB_ROW = create_template`
<div class="vs-lb-row">
	<span class="vs-lb-rank"></span>
	<span class="vs-lb-name"></span>
	<span class="vs-lb-wins"></span>
</div>
`;

const SCORE_CHIP = create_template`
<div class="vs-score-chip">
	<span class="vs-score-name"></span>
	<span class="vs-score-value"></span>
</div>
`;

const STANDING_ROW = create_template`
<li class="vs-standing">
	<span class="vs-standing-rank"></span>
	<span class="vs-standing-name"></span>
	<span class="vs-standing-score"></span>
</li>
`;

/*
*	STATE
*/

const local_state = {
	ws: null,
	me: null,          // { user_id, username }
	room: null,        // Last lobby state.
	round_total: 0,
	round_index: -1,
	answered: false,   // Answered the current round?
	timer: null,       // Countdown interval.
	players: [],       // [{ user_id, username }] for the current match.
};

let els = null;

/*
*	Socket. 
*	One connection for the view. Reused if still open across a remount.
*/

function ws_send(obj) {
	const ws = local_state.ws;
	if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

function connect() {
	if (local_state.ws && local_state.ws.readyState === WebSocket.OPEN) {
		// Already connected from a previous mount.
		return;
	}

	const proto = location.protocol === 'https:' ? 'wss' : 'ws';
	const ws = new WebSocket(`${proto}://${location.host}/ws/game`);
	local_state.ws = ws;

	ws.addEventListener('message', e => {
		let msg;
		try { msg = JSON.parse(e.data); } catch { return; }
		handle(msg);
	});

	ws.addEventListener('close', () => {
		create_notification('Disconnected from the game server', 'error');
	});
}

/*
*	Scene / phase control.
*/

function set_scene(scene) {
	if (els) els.root.dataset.scene = scene;
}

function set_phase(phase) {
	if (els) els.root.dataset.phase = phase;
}

/*
*	Lobby rendering.
*/

function fill_player(refs, p, root) {
	root.querySelector('.vs-player-name').textContent = 
		p.username ?? `#${p.user_id}`;
	const is_host = local_state.room && p.user_id === local_state.room.host_id;
	root.querySelector('.vs-player-host').textContent = is_host ? 'host' : '';
}

function paint_lobby(state) {
	local_state.room = state;

	if (!state || !state.code) {
		els.root.dataset.room = 'none';
		return;
	}

	els.root.dataset.room = 'in';
	els.room_code.textContent = `Room ${state.code}`;

	els.players.innerHTML = '';
	els.players.append(
		render_rows(PLAYER_ROW, state.players ?? [], fill_player)
	);

	const am_host = local_state.me && state.host_id === local_state.me.user_id;
	els.root.dataset.host = am_host ? 'yes' : 'no';

	const count = state.players?.length ?? 0;
	els.start.disabled = count < MIN_PLAYERS_UI || count > MAX_PLAYERS_UI;
}

/*
*	Game rendering.
*/

function fill_score_chip(refs, row, root) {
	root.querySelector('.vs-score-name').textContent = username_of(row.id);
	root.querySelector('.vs-score-value').textContent = row.score;
	if (local_state.me && row.id === local_state.me.user_id) 
		root.dataset.me = 'yes';
	if (!row.active) root.dataset.out = 'yes';
}

function paint_scores(scores) {
	if (!els) return;

	const by_id = new Map(scores.map(s => [s.id, s]));
	const order = local_state.players.length
		? local_state.players.map(p => p.user_id)
		: scores.map(s => s.id);

	const rows = order.map(id => {
		const s = by_id.get(id) ?? { score: 0, active: true };
		return { id, score: s.score ?? 0, active: s.active !== false };
	});

	els.scoreboard.innerHTML = '';
	els.scoreboard.append(render_rows(SCORE_CHIP, rows, fill_score_chip));
}

function fill_option(refs, word, root) {
	root.textContent = word;
	root.dataset.choice = word;
	root.addEventListener('click', () => choose(word));
}

function start_countdown(ms) {
	stop_countdown();

	const deadline = Date.now() + ms;
	const tick = () => {
		const left = Math.max(0, deadline - Date.now());
		const frac = left / ms;
		els.timer_bar.style.transform = `scaleX(${frac})`;
		if (left <= 0) stop_countdown();
	};
	tick();
	local_state.timer = setInterval(tick, 100);
}

function stop_countdown() {
	if (local_state.timer) { 
		clearInterval(local_state.timer); 
		local_state.timer = null; 
	}
}

// Render the phrase, underlining the blank.
function set_phrase(blanked) {
	els.phrase.innerHTML = '';

	const parts = String(blanked).split('\u0001');
	parts.forEach((part, i) => {
		if (i % 2 === 1) {
			const span = document.createElement('span');
			span.className = 'vs-blank';
			span.textContent = part;
			els.phrase.append(span);
		} else if (part) {
			els.phrase.append(document.createTextNode(part));
		}
	});
}

function show_round(msg) {
	local_state.round_index = msg.round_index;
	local_state.answered = false;

	els.round_label.textContent = 
		`Round ${msg.round_index + 1} of ${msg.round_total}`;
	set_phrase(msg.blanked);

	els.options.innerHTML = '';
	els.options.append(render_rows(OPTION, msg.options ?? [], fill_option));

	set_phase('question');
	start_countdown(msg.deadline_ms ?? 20000);
}

// Player picks an option.
function choose(word) {
	if (local_state.answered) return;
	local_state.answered = true;

	ws_send({ type: 'answer', choice: word });

	for (const b of els.options.querySelectorAll('.vs-option')) {
		b.disabled = true;
		if (b.dataset.choice === word) b.dataset.picked = 'yes';
	}
}

// Round over! Reveal the answer and say who won it.
function show_result(msg) {
	stop_countdown();

	for (const b of els.options.querySelectorAll('.vs-option')) {
		b.disabled = true;
		if (b.dataset.choice === msg.answer) b.dataset.correct = 'yes';
		else if (b.dataset.picked === 'yes') b.dataset.wrong = 'yes';
	}

	let line;
	if (msg.round_winner == null) 
		line = 'Nobody got it';
	else if (msg.round_winner === local_state.me?.user_id) 
		line = 'You won the round';
	else 
		line = `${username_of(msg.round_winner)} won the round`;

	els.result_line.textContent = line;
	els.result_answer.textContent = `Answer: ${msg.answer}`;
	paint_scores(msg.scores);
	set_phase('result');
}

function fill_standing(refs, s, root) {
	root.querySelector('.vs-standing-rank').textContent = ordinal(s.rank);
	root.querySelector('.vs-standing-name').textContent = username_of(s.id);
	root.querySelector('.vs-standing-score').textContent =
		`${s.score} pt${s.score === 1 ? '' : 's'}`;
	if (local_state.me && s.id === local_state.me.user_id) 
		root.dataset.me = 'yes';
}

function show_over(msg) {
	stop_countdown();
	clear_nav_guard();

	const scores = (Array.isArray(msg.scores) ? msg.scores : []).slice();
	scores.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

	// Standard competition ranking. Equal scores share a place.
	let last_score = null;
	let last_rank = 0;
	const standings = scores.map((s, i) => {
		if (s.score !== last_score) { last_rank = i + 1; last_score = s.score; }
		return { id: s.id, score: s.score ?? 0, rank: last_rank };
	});

	const mine = standings.find(s => s.id === local_state.me?.user_id);
	if (!mine) {
		els.over_line.textContent = 'Match over';
	} else if (mine.rank === 1) {
		const shared = standings.filter(s => s.rank === 1).length > 1;
		els.over_line.textContent = shared ? 'You tied for 1st!' : 'You win!';
	} else {
		els.over_line.textContent = `You finished ${ordinal(mine.rank)}`;
	}

	els.standings.innerHTML = '';
	els.standings.append(render_rows(STANDING_ROW, standings, fill_standing));

	set_phase('over');

	// The global ranking just changed. Refresh it for the lobby.
	load_leaderboard();
}

/*
*	Message router.
*/

function handle(msg) {
	switch (msg.type) {
		case 'connected':
			local_state.me = { user_id: msg.user_id, username: msg.username };
			break;
		case 'room_created':
		case 'room_joined':
			paint_lobby(msg);
			set_scene('room');
			break;
		case 'player_list':
			paint_lobby(msg);
			break;
		case 'game_starting':
			set_scene('game');
			set_phase('starting');
			break;
		case 'game_started':
			local_state.round_total = msg.round_total;
			local_state.players = Array.isArray(msg.players) ? msg.players : [];
			paint_scores(local_state.players.map(
				p => ({ id: p.user_id, score: 0, active: true })
			));
			set_scene('game');
			set_phase('question');
			set_nav_guard(
				() => els?.root?.dataset.scene === 'game'
					&& els.root.dataset.phase !== 'over',
				() => ws_send({ type: 'leave_room' }), 	// User leaved so he
														// forfeited.
			);
			break;
		case 'round_start':
			show_round(msg);
			break;
		case 'answer_ack':
			// nothing else...
			break;
		case 'round_result':
			show_result(msg);
			break;
		case 'player_forfeit':
			if (msg.user_id !== local_state.me?.user_id) {
				create_notification(
					`${username_of(msg.user_id)} left the match`, 'notification'
				);
			}
			paint_scores(msg.scores);
			break;
		case 'match_over':
			show_over(msg);
			break;
		case 'error':
			// If we were waiting on the build, drop back to the lobby.
			if (els && els.root.dataset.scene === 'game'
				&& els.root.dataset.phase === 'starting') {
				set_scene('room');
			}
			create_notification(msg.message ?? 'Game error', 'error');
			break;
	}
}

/*
*	Events.
*/

function bind_events() {
	els.create.addEventListener('click', 
		() => ws_send({ type: 'create_room' })
	);

	els.join.addEventListener('click', () => {
		const code = els.code_input.value.trim().toUpperCase();
		if (code) ws_send({ type: 'join_room', code });
	});
	els.code_input.addEventListener('keydown', e => {
		if (e.key === 'Enter') els.join.click();
	});

	els.start.addEventListener('click', () => ws_send({ type: 'start_game' }));

	els.leave_lobby.addEventListener('click', () => {
		ws_send({ type: 'leave_room' });
		paint_lobby(null);
	});

	// Quit mid-game is equivalent to forfeiting.
	els.quit.addEventListener('click', () => {
		ws_send({ type: 'leave_room' });
	});

	// After the match send back to the lobby view
	els.back.addEventListener('click', () => {
		set_scene('room');
		paint_lobby(null);
	});
}

/*
*	Scoreboard.
*/

async function fetch_leaderboard() {
	const res = await fetch('/api/cards/leaderboard', {
		method: 'POST',
		credentials: 'same-origin',
	});
	if (!res.ok) throw new Error(`leaderboard responded ${res.status}`);
	const { rows } = await res.json();
	return Array.isArray(rows) ? rows : [];
}

function fill_lb_row(refs, row, root) {
	root.querySelector('.vs-lb-rank').textContent = row.rank;
	root.querySelector('.vs-lb-name').textContent = row.username ?? '-';
	root.querySelector('.vs-lb-wins').textContent = 
		row.wins == null ? '' : `${row.wins}`;
	if (row.is_me) root.dataset.me = 'yes';
	if (row.username == null) root.dataset.empty = 'yes';
}

async function load_leaderboard() {
	try {
		const rows = await fetch_leaderboard();

		els.leaderboard.innerHTML = '';
		els.leaderboard.append(render_rows(LB_ROW, rows, fill_lb_row));

		const kids = els.leaderboard.children;
		if (kids.length >= 2) {
			const last = rows[rows.length - 1];
			const prev = rows[rows.length - 2];
			if (last && prev && last.username != null && 
				last.rank > prev.rank + 1) {
				kids[kids.length - 1].dataset.gap = 'yes';
			}
		}
	} catch (error) {
		console.error('Failed to load leaderboard');
		console.error(`\tMessage: ${error.message}`);
		els.leaderboard.textContent = 'Could not load the leaderboard.';
	}
}

/*
*	View.
*/

function username_of(user_id) {
	if (local_state.me && user_id === local_state.me.user_id) return 'You';
	const p = local_state.players.find(p => p.user_id === user_id);
	return p?.username ?? `#${user_id}`;
}

function ordinal(n) {
	const rem = n % 100;
	if (rem >= 11 && rem <= 13) return `${n}th`;
	switch (n % 10) {
		case 1: 	return `${n}st`;
		case 2:		return `${n}nd`;
		case 3: 	return `${n}rd`;
		default:	return `${n}th`;
	}
}

export function render() {
	const { root } = stamp_template(VERSUS);

	els = {
		root,
		// room scene
		create: root.querySelector('.vs-create'),
		join: root.querySelector('.vs-join'),
		code_input: root.querySelector('.vs-code-input'),
		room_code: root.querySelector('.vs-room-code'),
		leave_lobby: root.querySelector('.vs-leave-lobby'),
		players: root.querySelector('.vs-players'),
		start: root.querySelector('.vs-start'),
		leaderboard: root.querySelector('.vs-leaderboard'),
		// game scene
		round_label: root.querySelector('.vs-round-label'),
		scoreboard: root.querySelector('.vs-scoreboard'),
		quit: root.querySelector('.vs-quit'),
		timer_bar: root.querySelector('.vs-timer-bar'),
		phrase: root.querySelector('.vs-phrase'),
		options: root.querySelector('.vs-options'),
		result_line: root.querySelector('.vs-result-line'),
		result_answer: root.querySelector('.vs-result-answer'),
		over_line: root.querySelector('.vs-over-line'),
		standings: root.querySelector('.vs-standings'),
		back: root.querySelector('.vs-back'),
	};

	root.dataset.room = 'none';
	root.dataset.host = 'no';

	bind_events();
	connect();
	load_leaderboard();

	return root;
}