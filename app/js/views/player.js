/*
*	Player view.
*/


import { create_template, stamp_template, render_rows } from '../utils/template.js';

/*
*	Regular expression const decleration
*/

// This RE extracts start time and end time of subtitle lines
const CUE_RE = /((?:\d{1,2}:)?\d{1,2}:\d{2}[.,]\d{1,3})\s*-->\s*((?:\d{1,2}:)?\d{1,2}:\d{2}[.,]\d{1,3})/;

// This RE extracts youtube video id from the entire url
const ID_RE = /^[\w-]{11}$/;

/*
*	Consts
*/

// How many lines after the selected one to analyse ahead of time.
const PREFETCH_AHEAD = 9;

// Minimum gap between progress/sync ticks, in milliseconds.
const TICK_MS = 100;

/*
*	Global state.
*/

const STATE = {
	UNSTARTED: -1,
	ENDED: 0,
	PLAYING: 1,
	PAUSED: 2,
	BUFFERING: 3,
	CUED: 5
};

/* Per sentence fetch state, shown by the glyph under the cue timestamp. */
const ANALYSIS = {
	IDLE: 'idle',
	PENDING: 'pending',
	READY: 'ready',
	ERROR: 'error'
};

/*
*	TEMPLATES.
*/

const IMMERSION_PLAYER = create_template`
<div id="video-immersion" data-loaded="false">
	<div class="workspace">
		<div class="loader">
			<div class="video-search-box">
				<input id="url" type="text" placeholder="Paste a YouTube link" spellcheck="false" autocomplete="off">
				<button id="loadVideo" class="btn">Load</button>
			</div>
		</div>

		<div id="video-info">
			<h2 id="video-title"></h2>
			<ul class="vcard-list"></ul>
		</div>

		<div id="stage"></div>

		<div id="controls">
			<div class="crow">
				<button class="follow-chip" id="follow" data-on="true">
					<span class="led"></span>
					<span class="chip-label">
						<span id="follow-label">Following</span>
						<span class="chip-sizer">Following</span>
					</span>
				</button>
				<div class="cluster">
					<button id="backBtn" title="Previous line">&laquo;</button>
					<button id="playBtn" title="Play / Pause">&#9654;</button>
					<button id="fwdBtn" title="Next line">&raquo;</button>
				</div>
				<div class="progress" role="progressbar" id="progress">
					<i id="prog"></i>
				</div>
			</div>
		</div>

		<div class="transcript">
			<div class="track" id="track">
				<div class="empty">Awaiting transcript...</div>
			</div>
		</div>
	</div>

	<div id="video-empty">
	    <img class="empty-art empty-art-none"    src="/app/img/no_video.svg">
	    <img class="empty-art empty-art-loading" src="/app/img/searching_video.svg">
	    <img class="empty-art empty-art-error"   src="/app/img/not_found_video.svg">
	    <span class="empty-no-video">No video loaded</span>
	    <span class="empty-loading">Loading video...</span>
	    <span class="empty-error">Could not load this video</span>
	</div>
</div>
`;

const CUE_ROW = create_template`
<div class="cue" role="button" tabindex="0">
	<span class="ts">
		<span class="ts-time"></span>
		<span class="ts-state" data-state="idle"></span>
	</span>
	<span class="text"></span>
</div>
`;

const TOKEN = create_template`
<span class="token">
	<span class="token-word"></span>
</span>
`;

const LOOKUP = create_template`
<div class="lookup-layer">
	<div class="lookup-scrim"></div>
	<div class="lookup" role="dialog">
		<div class="lookup-head">
			<span class="lookup-surface"></span>
			<span class="lookup-reading"></span>
			<span class="lookup-pos"></span>
		</div>
		<div class="lookup-entries"></div>
		<div class="lookup-foot"></div>
	</div>
</div>
`;

const LOOKUP_ENTRY = create_template`
<div class="entry">
	<div class="entry-head">
		<span class="entry-word"></span>
		<span class="entry-reading"></span>
		<button class="card-add" type="button" data-state="idle"></button>
	</div>
	<ol class="entry-senses"></ol>
</div>
`;

const LOOKUP_SENSE = create_template`
<li class="sense"></li>
`;

const VIDEO_CARD_ROW = create_template`
<li class="vcard-row" role="button" tabindex="0">
	<span class="vcard-word"></span>
	<span class="vcard-meaning"></span>
	<span class="vcard-due"></span>
</li>
`;

/*
*	STATE.
*/

const local_state = {
	player: null,
	player_ready: false,
	video_id: '',
	loaded_id: null,

	cues: [],
	active_idx: -1,
	follow: true,
	video_ar: 16 / 9,

	selected_cue: null,
	selected_token: null,
	pending_play: false,

	// Start position (seconds) requested via the ?t=.
	// 0 means "no request".
	pending_seek: 0,
};

// The open lookup popup, or null.
let lookup_el = null;
let resume_after_lookup = false;

function set_selected(cue) {
	local_state.selected_cue = cue ? { ...cue } : null;
}

let els = null;

/*
*   Youtube iframe API.
*/

const tag = document.createElement('script');
tag.src = 'https://www.youtube.com/iframe_api';
document.head.appendChild(tag);

// Set once the iframe API script has finished loading.
let api_ready = false;

function hide_cc() {
	const p = local_state.player;
	if (!p || typeof p.unloadModule !== 'function') return;

	for (const mod of ['captions', 'cc']) {
		try {
			p.setOption(mod, 'track', {});
			p.unloadModule(mod);
		} catch (error) { /* module not loaded yet */ }
	}
}

window.onYouTubeIframeAPIReady = function () {
	api_ready = true;
	create_player();
};

// Build a fresh player inside #stage. 
// The resume position is a constructions via parameters.
function create_player() {
	if (!api_ready || !els || !document.contains(els.stage)) return;

	if (local_state.player) {
		try {
			local_state.player.destroy();
		} catch (error) { /* its frame is already gone */ }
	}

	local_state.player = null;
	local_state.player_ready = false;

	const mount = document.createElement('div');
	els.stage.appendChild(mount);

	const cue = local_state.selected_cue;
	const same_video = local_state.loaded_id === local_state.video_id;
	const cue_start = same_video && cue &&
		cue.start > 0 ? Math.floor(cue.start) : 0;

	// A ?t= query seek (set at mount) wins over the cue seed. Consumed once.
	const start = Math.max(local_state.pending_seek || 0, cue_start);
	local_state.pending_seek = 0;

	local_state.player = new YT.Player(mount, {
		videoId: local_state.video_id,
		playerVars: {
			controls: 0, disablekb: 1, fs: 0, playsinline: 1, rel: 0, cc_load_policy: 0, hl: 'ja', start,
		},
		events: {
			onReady: () => {
				local_state.player_ready = true;
				hide_cc();
				reflect_state(local_state.player.getPlayerState());
			},
			onStateChange: (e) => {
				if (e.data === STATE.PLAYING) {
					hide_cc();

					if (!transcript_ready()) {
						local_state.pending_play = true;
						local_state.player.pauseVideo();
						reflect_state(STATE.PAUSED);
						return;
					}
				}

				reflect_state(e.data);
			},
		},
	});
}

async function apply_video_info(id) {
	const target = `https://www.youtube.com/watch?v=${id}`;
	const url = `https://www.youtube.com/oembed?url=${encodeURIComponent(target)}&format=json`;

	try {
		const res = await fetch(url);

		if (!res.ok) {
			throw new Error(`oembed responded ${res.status}`);
		}

		const { title, width, height } = await res.json();

		if (width && height) {
			local_state.video_ar = width / height;
			if (els) 
				els.workspace.style.setProperty('--video-ar', local_state.video_ar);
		}

		if (title && els) 
			set_video_title(title);
	} catch (error) {
		console.error('Failed to fetch video info');
		console.error(`\tMessage: ${error.message}`);
	}
}

function set_video_title(text) {
	local_state.video_title = text;

	els.title.classList.remove('scrolling');
	els.title.innerHTML = '';

	if (TITLE_STATIC.matches) { els.title.textContent = text; return; }

	const container = els.title.parentElement;
	const a = document.createElement('span');
	a.textContent = text;
	els.title.appendChild(a);

	requestAnimationFrame(() => {
		if (!els || !document.contains(els.title)) return;
		if (els.title.scrollWidth > container.clientWidth) {
			const b = a.cloneNode(true);
			els.title.appendChild(b);
			els.title.classList.add('scrolling');
		}
	});
}

function change_title_with_respect_to_screen_width() {
	if (els && local_state.video_title) {
		console.log('change_title_with_respect_to_screen_width()');
		set_video_title(local_state.video_title);
	}
}

const TITLE_STATIC = window.matchMedia(
	'(((width > 1024px) or ((min-aspect-ratio: 4/3) and (height <= 900px))) and (height > 600px))'
);
TITLE_STATIC.addEventListener(
	'change', 
	change_title_with_respect_to_screen_width
);

let title_resize_timer = null;
window.addEventListener('resize', () => {
	size_tail();
	close_lookup();
	clearTimeout(title_resize_timer);
	title_resize_timer = 
		setTimeout(change_title_with_respect_to_screen_width, 150);
});

/*
*	Subtitle parsing and loading.
*/

function parse_time(stamp) {
	const parts = stamp.trim().replace(',', '.').split(':').map(Number);

	if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
	if (parts.length === 2) return parts[0] * 60 + parts[1];
	return parts[0];
}

function parse_captions(raw) {
	const text = String(raw || '').replace(/\r/g, '').replace(/^\s*WEBVTT.*?(\n\n|$)/s, '');
	const out = [];

	for (const block of text.split(/\n{2,}/)) {
		const lines = block.split('\n').filter(l => l.trim() !== '');
		const i = lines.findIndex(l => CUE_RE.test(l));

		if (i === -1) continue;

		const match = lines[i].match(CUE_RE);
		const body = lines.slice(i + 1).join(' ').replace(/<[^>]+>/g, '').trim();

		if (body) out.push({ start: parse_time(match[1]), end: parse_time(match[2]), text: body });
	}

	return out.sort((a, b) => a.start - b.start);
}

async function fetch_subtitles(address) {
	set_status('Loading transcript...');

	try {
		const res = await fetch('/api/meda/subtitles', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ address }),
			credentials: 'same-origin',
		});

		if (!res.ok) {
			throw new Error(`subtitles responded ${res.status}`);
		}

		const { subtitles } = await res.json();

		if (!subtitles) {
			throw new Error('no subtitles returned');
		}

		local_state.cues = parse_captions(subtitles);
		cached_sentences_morpho_analysis.clear();
		in_flight_morpho_analysis.clear();
		failed_morpho_analysis.clear();
		load_video_cards(local_state.video_id);
		local_state.loaded_id = local_state.video_id;
		
		if (els) {
			els.root.dataset.loaded = 
				local_state.cues.length > 0 ? 'true' : 'error';
		}

		set_selected(null);
		render_transcript();

		if (local_state.cues.length > 0) {
			record_history(local_state.video_id);

			if (local_state.pending_play && local_state.player_ready) {
				local_state.player.playVideo();
			}
		}
		local_state.pending_play = false;
	} catch (error) {
		console.error('Failed to fetch subtitles');
		console.error(`\tMessage: ${error.message}`);

		if (els) els.root.dataset.loaded = 'error';	// show not-found svg
		set_status('Could not load subtitles.');
	}
}

function ensure_transcript() {
	if (local_state.loaded_id === local_state.video_id && local_state.cues.length) {
		render_transcript();
		return;
	}

	fetch_subtitles(`https://www.youtube.com/watch?v=${local_state.video_id}`);
}

function record_history(video_id) {
	fetch('/api/hist/add', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		credentials: 'same-origin',
		body: JSON.stringify({ video_id }),
	}).catch(error => {
		console.error('Failed to record history');
		console.error(`\tMessage: ${error.message}`);
	});
}

/*
*   Playback controls.
*/

function extract_id(input) {
	const value = input.trim();

	if (ID_RE.test(value)) return value;

	const match = value.match(/(?:v=|youtu\.be\/|embed\/|shorts\/|live\/)([\w-]{11})/);
	return match ? match[1] : null;
}

// Playback is held until the transcript is in.
function transcript_ready() {
	return local_state.loaded_id === local_state.video_id
		&& local_state.cues.length > 0;
}

function toggle_play() {
	if (!local_state.player_ready) return;

	const p = local_state.player;

	if (p.getPlayerState() === STATE.PLAYING) {
		p.pauseVideo();
		return;
	}

	if (!transcript_ready()) {
		local_state.pending_play = true;
		return;
	}
	
	p.playVideo();
}

function reflect_state(state) {
	if (!els) return;

	els.play_btn.innerHTML = state === STATE.PLAYING ? '&#10074;&#10074;' : '&#9654;';
}

function seek_to(seconds) {
	if (!local_state.player_ready) return;

	local_state.player.seekTo(seconds, true);

	if (transcript_ready()) local_state.player.playVideo();
}

// Step to the previous or next line. 
// Back restarts the current line when we are already well into it. 
function seek_cue(dir) {
	if (!local_state.player_ready || !local_state.cues.length) return;

	const t = local_state.player.getCurrentTime();
	const idx = find_active(t);
	const back = ((idx >= 0 && t) > (local_state.cues[idx].start + 0.7)) ? 
		idx : idx - 1;
	const target = Math.max(
		Math.min(local_state.cues.length - 1, dir < 0 ? back : idx + 1),
		0 
	);

	seek_to(local_state.cues[target].start);
}

function load_video() {
	const address = els.url.value.trim();
	const id = extract_id(address);

	if (!id) {
		els.url.style.borderColor = '#e0533d';
		setTimeout(() => els.url.style.borderColor = '', 900);
		return;
	}

	if (local_state.player) {
		local_state.player.cueVideoById(id);
	} else {
		requestAnimationFrame(create_player);
	}

	local_state.video_id = id;
	local_state.loaded_id = null;
	// local_state.video_cards = [];
	render_video_cards();
	set_selected(null);
	local_state.cues = [];
	local_state.active_idx = -1;
	clear_tokens();
	set_status('Loading transcript...');

	fetch_subtitles(ID_RE.test(address) ? `https://www.youtube.com/watch?v=${id}` : address);
	apply_video_info(id);
}

/*
*   Transcript rendering and sync.
*/

// Bind click and keyboard activation (Enter / Space) to the same handler.
function on_activate(el, fn) {
	el.addEventListener('click', fn);
	el.addEventListener('keydown', e => {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			fn(e);
		}
	});
}

function fmt(seconds) {
	const s = Math.max(0, Math.floor(seconds || 0));
	return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function fill_cue(refs, cue, root) {
	root.querySelector('.ts-time').textContent = fmt(cue.start);
	root.querySelector('.text').textContent = cue.text;

	paint_cue_state(root, cue_state(cue.text));

	on_activate(root, () => {
		if (String(window.getSelection()).length) return;

		set_selected(cue);

		// Click means "follow this one", even if scrolling had turned it off.
		set_follow(true, root);

		tokenise_cue(root, cue, local_state.cues.indexOf(cue));

		// Already the line being played.
		if (local_state.cues[local_state.active_idx] === cue) return;

		seek_to(cue.start);
	});
}

function set_status(message) {
	if (!els) return;

	els.track.innerHTML = '';

	const div = document.createElement('div');
	div.className = 'empty';
	div.textContent = message;

	els.track.appendChild(div);
}

function render_transcript() {
	if (!els) return;

	if (!local_state.cues.length) {
		set_status('No cues parsed from the transcript.');
		return;
	}

	els.track.innerHTML = '';
	els.track.append(render_rows(CUE_ROW, local_state.cues, fill_cue));

	// Tail spacer so the last line can still scroll to the top.
	const tail = document.createElement('div');
	tail.className = 'track-tail';
	els.track.appendChild(tail);

	size_tail();
	local_state.active_idx = -1;

	restore_selection();
}

// Re-mark the line that was selected before the view was torn down.
function restore_selection() {
	const previous = local_state.selected_cue;
	if (!previous) return;

	const idx = local_state.cues.findIndex(
		c => c.start === previous.start && 
		c.text === previous.text
	);
	if (idx === -1) return;

	mark_active_row(idx);

	// Resolves from the analysis cache when the line was read before.
	const row = els.track.children[idx];
	if (row) tokenise_cue(row, local_state.cues[idx], idx);
}

function mark_active_row(idx) {
	if (!els) return;

	const rows = els.track.children;

	if (rows[local_state.active_idx]) 
		rows[local_state.active_idx].classList.remove('active');

	for (let i = 0; i < rows.length; i++) 
		rows[i].classList.toggle('past', i < idx);

	if (rows[idx]) {
		rows[idx].classList.add('active');
		rows[idx].classList.remove('past');

		if (local_state.follow) scroll_cue_to_top(rows[idx]);
	}

	local_state.active_idx = idx;
}

function size_tail() {
	if (!els) return;

	const tail = els.track.querySelector('.track-tail');
	const first = els.track.querySelector('.cue');

	if (!tail) return;

	const row_h = first ? first.getBoundingClientRect().height : 0;
	tail.style.height = `${Math.max(0, els.track.clientHeight - row_h)}px`;
}

// Scroll the .track container.
// scrollIntoView would drag the page and the video with it. 
function scroll_cue_to_top(el) {
	const track = els.track;
	const delta = 
		el.getBoundingClientRect().top - track.getBoundingClientRect().top;

	track.scrollTo({ top: track.scrollTop + delta, behavior: 'smooth' });
}

// A cue stays active until the NEXT one starts.
function find_active(t) {
	let idx = -1;

	for (let i = 0; i < local_state.cues.length; i++) {
		if (local_state.cues[i].start <= t) idx = i;
		else break;
	}

	return idx;
}

function set_follow(on, target = null) {
	local_state.follow = on;

	if (!els) return;

	els.follow.dataset.on = on;
	els.follow_label.textContent = on ? 'Following' : 'Follow';

	if (!on) return;

	const row = target ?? els.track.children[local_state.active_idx];
	if (row) scroll_cue_to_top(row);
}

function sync_active(seconds) {
	const idx = find_active(seconds);

	if (idx === local_state.active_idx) 
		return;

	clear_tokens();

	mark_active_row(idx);

	if (!local_state.cues[idx]) return;

	set_selected(local_state.cues[idx]);
	request_cue_analysis(idx);
	prefetch_cue_analysis(idx);
}

let last_tick = 0;
function loop(ts) {
	requestAnimationFrame(loop);

	if (ts - last_tick < TICK_MS) return;
	last_tick = ts;

	const p = local_state.player;
	if (!els || !document.contains(els.track)) return;
	if (
		!local_state.player_ready || !p || 
		typeof p.getCurrentTime !== 'function'
	) 
		return;

	const t = p.getCurrentTime();
	const d = p.getDuration() || 0;
	const pct = d ? Math.min(100, Math.max(0, t / d * 100)) : 0;

	els.prog.style.width = `${pct}%`;

	sync_active(t);
}
requestAnimationFrame(loop);

/*
*	Morphological analyser section.
*/

// This Map is the record of what is cached.
const cached_sentences_morpho_analysis = new Map();
const in_flight_morpho_analysis = new Map();
const failed_morpho_analysis = new Set();

// This function fetches the morpho analysis of a provided sentence. 
// The API returns an array in which every lemma/word has: word, reading, type
// (type of word: noun, verb, etc.), meanings (list of english translation of
// the term).
function fetch_sentences_morpho_analysis(sentence) {
	if (cached_sentences_morpho_analysis.has(sentence))
		return Promise.resolve(cached_sentences_morpho_analysis.get(sentence));

	// User has already asked for this exact line, wait on the same request.
	if (in_flight_morpho_analysis.has(sentence))
		return in_flight_morpho_analysis.get(sentence);

	const request = request_morpho_analysis(sentence)
		.finally(() => in_flight_morpho_analysis.delete(sentence));

	in_flight_morpho_analysis.set(sentence, request);

	return request;
}

// The backend returns the token array directly. Otherwise null.
async function request_morpho_analysis(sentence) {
	try {
		const res = await fetch('/api/anlys/tokenize', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ "text": sentence }),
			credentials: 'same-origin',
		});

		if (!res.ok) {
			throw new Error(`anlys responded ${res.status}`);
		}

		const analysis = await res.json();

		if (!Array.isArray(analysis)) {
			console.error('Unexpected tokenize payload:', analysis);
			throw new Error('no token array in the response');
		}

		failed_morpho_analysis.delete(sentence);
		cached_sentences_morpho_analysis.set(sentence, analysis);

		return analysis;
	} catch (error) {
		console.error('Failed to fetch morpho analysis');
		console.error(`\tSentence: ${sentence}`);
		console.error(`\tMessage: ${error.message}`);

		failed_morpho_analysis.add(sentence);
		return null;
	}
}


function cue_state(sentence) {
	if (cached_sentences_morpho_analysis.has(sentence)) return ANALYSIS.READY;
	if (in_flight_morpho_analysis.has(sentence)) return ANALYSIS.PENDING;
	if (failed_morpho_analysis.has(sentence)) return ANALYSIS.ERROR;

	return ANALYSIS.IDLE;
}

// Write the current state onto one row's glyph.
function paint_cue_state(row, state) {
	const glyph = row.querySelector('.ts-state');
	if (glyph) glyph.dataset.state = state;
}

function repaint_cue_state(idx) {
	const cue = local_state.cues[idx];
	const row = els && els.track.children[idx];

	if (cue && row) paint_cue_state(row, cue_state(cue.text));
}

// Analyse one line and keep its glyph in step.
async function request_cue_analysis(idx) {
	const cue = local_state.cues[idx];
	if (!cue) return null;

	repaint_cue_state(idx);

	const analysis = await fetch_sentences_morpho_analysis(cue.text);

	// The transcript may have been replaced while the request was out.
	if (local_state.cues[idx] !== cue) return null;

	repaint_cue_state(idx);

	return analysis;
}

// Warm the lines after `idx`.
function prefetch_cue_analysis(idx) {
	const last = Math.min(idx + PREFETCH_AHEAD, local_state.cues.length - 1);

	for (let i = idx + 1; i <= last; i++) request_cue_analysis(i);
}

function fill_token(refs, token, root, cue) {
	root.querySelector('.token-word').textContent = token.word ?? '';
	root.dataset.type = token.type ?? '';
	// entries[0] is the best guess.
	const primary = token.entries && token.entries[0];
	root.title = primary ? primary.meanings.join(', ') : '';

	on_activate(root, (e) => {
		// Keep the click off the cue row, which would seek.
		e.stopPropagation();

		handle_token_click(root, token, cue);
	});
}

/*
*	Card creation.
*/

// Entries known to be in the deck. Request cache.
const carded = new Set();

// The deck is keyed on the entry. The same word met is always one card. 
function card_key(entry) {
	return `${entry.word}\u241f${entry.reading ?? ''}`;
}

function set_card_state(button, state) {
	button.dataset.state = state;
	button.disabled = state === 'sending' || state === 'carded';

	button.textContent = {
		idle: 'Add card',
		sending: 'Adding...',
		carded: 'In deck',
		error: 'Retry',
	}[state];
}

async function create_card(button, entry, cue) {
	set_card_state(button, 'sending');

	try {
		const res = await fetch('/api/cards/create', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				word: entry.word,
				jmdict_id: entry.entry_id,
				phrase: cue.text,
				reading: entry.reading,
				meanings: entry.meanings,
				video_id: local_state.video_id,
				timestamp: cue.start,
				timestamp_end: cue.end,
			}),
			credentials: 'same-origin',
		});

		// 409 means that the word has already been mined by the user.
		if (res.ok || res.status === 409) {
			carded.add(card_key(entry));
			set_card_state(button, 'carded');

			load_video_cards(local_state.video_id);
			return;
		}

		throw new Error(`cards/create responded ${res.status}`);
	} catch (error) {
		console.error('Failed to create card');
		console.error(`\tWord: ${entry.word}`);
		console.error(`\tMessage: ${error.message}`);

		set_card_state(button, 'error');
	}
}

async function mark_existing_cards(root, entries) {
	const ids = entries.map(e => e.entry_id).filter(Boolean);
	if (!ids.length) return;

	let present;
	try {
		const res = await fetch('/api/cards/exists', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ jmdict_ids: ids }),
			credentials: 'same-origin',
		});

		if (!res.ok) {
			throw new Error(`cards/exists responded ${res.status}`);
		}

		({ present } = await res.json());
	} catch (error) {
		console.error('Failed to check deck membership');
		console.error(`\tMessage: ${error.message}`);
		return;
	}

	if (!Array.isArray(present) || !present.length) return;

	const set = new Set(present.map(String));

	for (const entry of entries) {
		if (set.has(String(entry.entry_id))) carded.add(card_key(entry));
	}

	if (lookup_el !== root) return;

	for (const button of root.querySelectorAll('.card-add')) {
		if (set.has(String(button.dataset.jmdict))) set_card_state(button, 'carded');
	}
}

/*
*	Lookup popup.
*	Shows every dictionary candidate for the clicked token, best guess first.
*/

// The backend reports readings in katakana; the dictionary stores hiragana.
// (Personal preference, i am not sure i can motivate it, still either one 
// or the othet).
function to_hiragana(text) {
	let out = '';

	for (const ch of String(text ?? '')) {
		const code = ch.codePointAt(0);
		out += code >= 0x30a1 && code <= 0x30f6 ? String.fromCodePoint(code - 0x60) : ch;
	}

	return out;
}

function fill_sense(refs, meaning, root) {
	root.textContent = meaning;
}

function fill_entry(refs, entry, root, cue) {
	root.querySelector('.entry-word').textContent = entry.word ?? '';

	const reading = root.querySelector('.entry-reading');
	// A kana-only word is its own reading; printing it twice says nothing.
	reading.textContent = entry.reading && entry.reading !== entry.word ? entry.reading : '';

	root.querySelector('.entry-senses').append(
		render_rows(LOOKUP_SENSE, entry.meanings ?? [], fill_sense)
	);

	const button = root.querySelector('.card-add');

	button.dataset.jmdict = entry.entry_id ?? '';
	set_card_state(button, carded.has(card_key(entry)) ? 'carded' : 'idle');
	button.addEventListener('click', () => create_card(button, entry, cue));
}

function close_lookup() {
	if (!lookup_el) return;

	for (const previous of els.track.querySelectorAll('.token.selected')) {
		previous.classList.remove('selected');
	}

	if (resume_after_lookup && local_state.player_ready) local_state.player.playVideo();
	resume_after_lookup = false;

	lookup_el.remove();
	lookup_el = null;
}


const FLOATING = '(min-width: 700px)';

function place_lookup(anchor) {
	if (!window.matchMedia(FLOATING).matches) return;

	const panel = lookup_el.querySelector('.lookup');
	const rect = anchor.getBoundingClientRect();
	const box = panel.getBoundingClientRect();
	const margin = 8;

	let top = rect.bottom + 6;
	if (top + box.height > window.innerHeight - margin) top = rect.top - box.height - 6;
	if (top < margin) top = margin;

	let left = rect.left;
	if (left + box.width > window.innerWidth - margin) left = window.innerWidth - box.width - margin;
	if (left < margin) left = margin;

	panel.style.top = `${top}px`;
	panel.style.left = `${left}px`;
}

function open_lookup(anchor, token, cue) {
	close_lookup();

	const p = local_state.player;

	if (local_state.player_ready && p.getPlayerState() === STATE.PLAYING) {
		resume_after_lookup = true;
		p.pauseVideo();
	}

	const entries = Array.isArray(token.entries) ? token.entries : [];
	const { root } = stamp_template(LOOKUP);

	root.querySelector('.lookup-scrim').addEventListener('click', close_lookup);

	root.querySelector('.lookup-surface').textContent = token.word ?? '';
	root.querySelector('.lookup-reading').textContent = to_hiragana(token.reading);
	root.querySelector('.lookup-pos').textContent = token.role
		? `${token.type} \u00b7 ${token.role}`
		: (token.type ?? '');

	const list = root.querySelector('.lookup-entries');
	const foot = root.querySelector('.lookup-foot');

	if (entries.length) {
		list.append(render_rows(LOOKUP_ENTRY, entries, (refs, entry, root) => fill_entry(refs, entry, root, cue)));
		mark_existing_cards(root, entries);
		foot.textContent = entries.length > 1
			? `${entries.length} entries written 「${token.word}」`
			: '';
	} else {
		list.textContent = token.role
			? 'Grammatical word - no dictionary entry.'
			: 'No dictionary entry.';
	}

	els.root.appendChild(root);
	lookup_el = root;

	place_lookup(anchor);
}

// Runs whenever a word is clicked. Records the selection and opens the lookup.
function handle_token_click(element, token, cue) {
	for (const previous of els.track.querySelectorAll('.token.selected')) {
		previous.classList.remove('selected');
	}

	element.classList.add('selected');
	local_state.selected_token = token;

	open_lookup(element, token, cue);
}

// Put the plain sentence back on every tokenised row.
function clear_tokens() {
	if (!els) return;

	for (const row of els.track.querySelectorAll('.cue.tokenised')) {
		const idx = Array.prototype.indexOf.call(els.track.children, row);
		const cue = local_state.cues[idx];

		if (cue) row.querySelector('.text').textContent = cue.text;
		row.classList.remove('tokenised');
	}

	local_state.selected_token = null;
	close_lookup();
}

// Swap a cue's sentence for its analysed words.
async function tokenise_cue(row, cue, idx) {
	const analysis = await request_cue_analysis(idx);

	// The row may have gone, or the transcript may have been replaced.
	if (!els || !els.track.contains(row) || local_state.cues[idx] !== cue) return;
	if (!Array.isArray(analysis)) return;

	clear_tokens();

	const slot = row.querySelector('.text');
	slot.innerHTML = '';

	slot.append(render_rows(TOKEN, analysis, (refs, token, root) => fill_token(refs, token, root, cue)));

	row.classList.add('tokenised');
}

/*
*	Video info population functions.
*/

function due_label(due) {
	if (!due) return { text: 'new', cls: 'is-new' };
	const days = Math.round((due - Date.now()) / 86_400_000);
	if (days < 0)   return { text: `${-days}d overdue`, cls: 'is-overdue' };
	if (days === 0) return { text: 'due today',         cls: 'is-due' };
	return { text: `in ${days}d`, cls: 'is-scheduled' };
}

function fill_video_card(refs, card, root) {
	const word_el    = root.querySelector('.vcard-word');
	const meaning_el = root.querySelector('.vcard-meaning');
	const due_el     = root.querySelector('.vcard-due');

	if (word_el)    word_el.textContent = card.word;
	if (meaning_el) meaning_el.textContent = (card.meanings ?? [])[0] ?? '';

	const due = due_label(card.due);
	if (due_el) {
		due_el.textContent = due.text;
		due_el.className = `vcard-due ${due.cls}`;
	}

	root.title = card.last_review
		? `last reviewed ${Math.round((Date.now() - card.last_review) / 86_400_000)}d ago`
		: 'not yet reviewed';

	on_activate(root, () => jump_to_cue(card.timestamp));
}

function render_video_cards() {
	if (!els || !els.vcards) return;
	els.vcards.innerHTML = '';
	els.vcards.append(render_rows(VIDEO_CARD_ROW, local_state.video_cards ?? [], fill_video_card));
}

async function load_video_cards(video_id) {
	if (!els || !els.vcards) return;
	try {
		const res = await fetch('/api/cards/by_video', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			credentials: 'same-origin',
			body: JSON.stringify({ video_id }),
		});
		if (!res.ok) throw new Error(`by-video responded ${res.status}`);
		const { cards } = await res.json();

		// The user may have loaded a different video while this was in flight.
		if (video_id !== local_state.video_id) return;

		local_state.video_cards = Array.isArray(cards) ? cards : [];
		render_video_cards();
	} catch (error) {
		console.error('Failed to load video cards');
		console.error(`\tMessage: ${error.message}`);
	}
}

function jump_to_cue(ts) {
	if (ts == null) return;
	const idx = local_state.cues.findIndex(c => Math.abs(c.start - ts) < 0.05);
	
	if (idx === -1) return; // Card is from a cue not in the current transcript.
	const cue = local_state.cues[idx];

	if (local_state.player_ready) { local_state.player.seekTo(ts, true); local_state.player.pauseVideo(); }
	
	set_selected(cue);
	set_follow(true);
	mark_active_row(idx);

	const row = els.track.children[idx];
	if (row) tokenise_cue(row, cue, idx);
}

/*
*   View.
*/

function bind_events() {
	els.load_btn.addEventListener('click', load_video);
	els.url.addEventListener('keydown', e => { if (e.key === 'Enter') load_video(); });

	els.play_btn.addEventListener('click', toggle_play);
	els.back_btn.addEventListener('click', () => seek_cue(-1));
	els.fwd_btn.addEventListener('click', () => seek_cue(1));

	els.follow.addEventListener('click', () => set_follow(!local_state.follow));
	els.track.addEventListener('wheel', () => { if (local_state.follow) set_follow(false); }, { passive: true });
	els.track.addEventListener('touchmove', () => { if (local_state.follow) set_follow(false); }, { passive: true });
}

function render(video_id = null) {
	if (video_id) {
		local_state.video_id = video_id;
	}

	// Optional ?t= start time (seconds)
	const t = new URLSearchParams(location.search).get('t');
	const t_num = t == null ? NaN : Number(t);
	local_state.pending_seek =
		Number.isFinite(t_num) && t_num > 0 ? Math.floor(t_num) : 0;

	const { root } = stamp_template(IMMERSION_PLAYER);

	els = {
		root,
		url: root.querySelector('#url'),
		load_btn: root.querySelector('#loadVideo'),
		workspace: root.querySelector('.workspace'),

		title: root.querySelector('#video-title'),
		stage: root.querySelector('#stage'),
		controls: root.querySelector('#controls'),

		play_btn: root.querySelector('#playBtn'),
		back_btn: root.querySelector('#backBtn'),
		fwd_btn: root.querySelector('#fwdBtn'),

		progress: root.querySelector('#progress'),
		prog: root.querySelector('#prog'),
		track: root.querySelector('#track'),
		follow: root.querySelector('#follow'),
		follow_label: root.querySelector('#follow-label'),

		title: root.querySelector('#video-title'),
		vcards: root.querySelector('.vcard-list'),
		stage: root.querySelector('#stage'),
	};

	els.workspace.style.setProperty('--video-ar', local_state.video_ar);

	if (
		local_state.player && 
		!document.body.contains(local_state.player.getIframe?.())
	) {
		local_state.player = null;
		local_state.player_ready = false;
	}

	bind_events();
	reflect_state(STATE.UNSTARTED);

	if (!local_state.video_id) {
		// Nothing loaded show the "no video" cover.
		els.root.dataset.loaded = 'false';
	} else if (local_state.loaded_id === local_state.video_id
	           && local_state.cues && local_state.cues.length > 0) {
		// This video is already loaded from a previous mount: rebuild the
		// view from surviving state, repaint the transcript and remake the
		// player.
		els.root.dataset.loaded = 'true';
		apply_video_info(local_state.video_id);
		render_transcript();
		load_video_cards(local_state.video_id);	// Repopulate the panel.
		requestAnimationFrame(create_player);
	} else {
		// A video is incoming but not yet loaded. Print loading while fetching.
		set_selected(null);
		els.root.dataset.loaded = 'loading';
		apply_video_info(local_state.video_id);
		ensure_transcript();
		requestAnimationFrame(create_player);
	}

	return root;
}

window.addEventListener('resize', () => { size_tail(); close_lookup(); });

document.addEventListener('keydown', e => {
	if (!els || !document.contains(els.controls)) return;

	if (e.key === 'Escape' && lookup_el) {
		close_lookup();
		return;
	}

	const tag_name = e.target.tagName;
	if (e.code === 'Space' && tag_name !== 'TEXTAREA' && tag_name !== 'INPUT') {
		e.preventDefault();
		toggle_play();
	}
});

export { render };