/*
*	Cards view.
*/


import { 
	create_template, stamp_template, render_rows 
} from '../utils/template.js';
import { create_notification } from '../utils/notif.js';

//	1..4 map onto ts-fsrs Again / Hard / Good / Easy.
const RATING = { AGAIN: 1, HARD: 2, GOOD: 3, EASY: 4 };

// Browser page size. The backend caps limit at 20.
const BROWSE_PAGE_SIZE = 9999;

/*
*	TEMPLATES
*/

const CARDS_ROOT = create_template`
<div id="cards-review" data-scene="overview"></div>
`;

const OVERVIEW = create_template`
<div class="cards-overview">
	<div class="cards-overview-head">
		<h1 class="cards-overview-title">Decks</h1>
		<button class="cards-browse-open" type="button">Browse cards</button>
	</div>
	<div class="cards-decklist"></div>
</div>
`;

const DECK_ROW = create_template`
<button class="cards-deck" type="button">
	<span class="cards-deck-name"></span>
	<span class="cards-deck-counts">
		<span class="cards-count cards-count-new"></span>
		<span class="cards-count cards-count-learning"></span>
		<span class="cards-count cards-count-review"></span>
	</span>
</button>
`;

const REVIEW = create_template`
<div class="cards-review-scene" data-state="loading" data-revealed="false">
	<div class="cards-review-head">
		<button class="cards-open-player" type="button" title="Open in player">Open in player</button>
		<button class="cards-edit-current" type="button" title="Edit this card">Edit card</button>
	</div>

	<div class="cards-message"></div>

	<div class="cards-stage">
		<div class="cards-face">
			<div class="cards-word"></div>

			<div class="cards-back">
				<a class="cards-source" target="_blank" rel="noopener">
					<img class="cards-thumb" alt="">
					<span class="cards-source-label">Watch in context</span>
				</a>
				<div class="cards-reading"></div>
				<ol class="cards-meanings"></ol>
				<div class="cards-phrase"></div>

				<button class="cards-audio-btn" type="button">Replay audio</button>
				<audio class="cards-audio" preload="none"></audio>
			</div>
		</div>

		<div class="cards-controls">
			<button class="cards-reveal" type="button">Show answer</button>

			<div class="cards-grades">
				<button type="button" data-rating="1">Again</button>
				<button type="button" data-rating="2">Hard</button>
				<button type="button" data-rating="3">Good</button>
				<button type="button" data-rating="4">Easy</button>
			</div>
		</div>
	</div>
</div>
`;

const CARD_MEANING = create_template`
<li class="cards-sense"></li>
`;

const BROWSE = create_template`
<div class="cards-browse-scene">
	<div class="cards-browse-head">
		<button class="cards-browse-back" type="button">&laquo; Decks</button>
		<input class="cards-browse-search" type="search"
			placeholder="Search word, reading or meaning" spellcheck="false">
		<span class="cards-browse-count"></span>
		<span class="cards-browse-pager">
			<button class="cards-browse-prev" type="button">&laquo;</button>
			<span class="cards-browse-page"></span>
			<button class="cards-browse-next" type="button">&raquo;</button>
		</span>
	</div>

	<div class="cards-browse-main">
		<div class="cards-browse-list" role="listbox"></div>

		<form class="cards-editor">
			<div class="cards-editor-empty">Select a card to edit it.</div>

			<div class="cards-editor-fields">
				<label>Word
					<input name="word" type="text" spellcheck="false">
				</label>
				<label>Reading
					<input name="reading" type="text" spellcheck="false">
				</label>
				<label>Meanings (one per line)
					<textarea name="meanings" rows="4" spellcheck="false"></textarea>
				</label>
				<label>Phrase
					<textarea name="phrase" rows="3" spellcheck="false"></textarea>
				</label>

				<div class="cards-editor-actions">
					<button class="cards-editor-preview" type="button">Preview</button>
					<button class="cards-editor-save" type="submit">Save</button>
					<button class="cards-editor-delete" type="button">Delete</button>
				</div>
			</div>
		</form>
		<div class="cards-editor-scrim"></div>
	</div>
</div>
`;

const BROWSE_ROW = create_template`
<div class="cards-browse-row" role="option" tabindex="0">
	<span class="cards-browse-word"></span>
	<span class="cards-browse-phrase"></span>
	<span class="cards-browse-due"></span>
</div>
`;

const PREVIEW = create_template`
<div class="cards-preview-layer">
	<div class="cards-preview-scrim"></div>
	<div class="cards-preview" role="dialog" data-revealed="false">
		<div class="cards-face">
			<div class="cards-word"></div>
			<div class="cards-back">
				<div class="cards-reading"></div>
				<ol class="cards-meanings"></ol>
				<div class="cards-phrase"></div>
			</div>
		</div>
		<div class="cards-preview-foot">
			<button class="cards-preview-reveal" type="button">Show answer</button>
			<button class="cards-preview-close" type="button">Close</button>
		</div>
	</div>
</div>
`;

/*
*	STATE
*/

const local_state = {
	scene: 'overview',	// 'overview', 'review' or 'browse'.
	card: null,
	revealed: false,
	busy: false,

	browse: { page: 0, count: 0, cards: [], selected: null, query: '' },
};

let els = null;

/*
*	Network.
*/

async function fetch_overview() {
	const res = await fetch('/api/cards/overview', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		credentials: 'same-origin',
	});

	if (!res.ok) {
		throw new Error(`overview responded ${res.status}`);
	}

	const { decks } = await res.json();
	return Array.isArray(decks) ? decks : [];
}

async function fetch_next() {
	const res = await fetch('/api/cards/next', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		credentials: 'same-origin',
	});

	if (!res.ok) {
		throw new Error(`next responded ${res.status}`);
	}

	const { card } = await res.json();
	return card ?? null;
}

async function send_grade(card_id, rating) {
	const res = await fetch('/api/cards/grade', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ card_id, rating }),
		credentials: 'same-origin',
	});

	if (!res.ok) {
		throw new Error(`grade responded ${res.status}`);
	}

	return res.json();
}

// Audio. The yt-dlp url expires and is IP-bound, a fresh one is fetched on 
// demand and cached on the for the review session.
async function ensure_audio_src(card) {
	if (els.audio.dataset.forVideo === card.video_id && els.audio.src) return;

	const res = await fetch('/api/meda/audio', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		credentials: 'same-origin',
		body: JSON.stringify({ address: card.video_id }),
	});

	if (!res.ok) {
		throw new Error(`audio responded ${res.status}`);
	}

	const { audio_url } = await res.json();
	els.audio.src = audio_url;
	els.audio.dataset.forVideo = card.video_id;
}


// Play the card's cue slice [timestamp, timestamp_end].
let stop_at_end = null;

function is_current(card) {
	return !!els
		&& document.contains(els.root)
		&& local_state.scene === 'review'
		&& local_state.card === card;
}

function play_clip(card) {
	if (!card || !card.video_id) return;
	if (!is_current(card)) return;

	ensure_audio_src(card).then(() => {
		// The card may have changed while the url was being fetched.
		if (!is_current(card)) return;

		const start = card.timestamp ?? 0;
		const end = card.timestamp_end ?? null;

		if (stop_at_end) {
			els.audio.removeEventListener('timeupdate', stop_at_end);
			stop_at_end = null;
		}

		els.audio.currentTime = start;
		els.audio.play().catch(() => { /* autoplay or seek rejected */ });

		stop_at_end = () => {
			if (!is_current(card) || (end != null && els.audio.currentTime >= end)) {
				els.audio.pause();
				els.audio.removeEventListener('timeupdate', stop_at_end);
				stop_at_end = null;
			}
		};
		els.audio.addEventListener('timeupdate', stop_at_end);
	}).catch(error => {
		console.error('Failed to play clip');
		console.error(`\tMessage: ${error.message}`);
	});
}

function prefetch_audio(card) {
	if (!card || !card.video_id) return;

	ensure_audio_src(card).catch(error => {
		console.error('Failed to prefetch audio');
		console.error(`\tMessage: ${error.message}`);
	});
}

function stop_clip() {
	if (!els || !els.audio) return;

	els.audio.pause();
	if (stop_at_end) {
		els.audio.removeEventListener('timeupdate', stop_at_end);
		stop_at_end = null;
	}
}

function set_scene(scene) {
	local_state.scene = scene;
	if (els) els.root.dataset.scene = scene;
}

// Overview.
// Can support multiple deck, not present in backend for now.
function fill_deck(refs, deck, root) {
	root.querySelector('.cards-deck-name').textContent = deck.name;

	root.querySelector('.cards-count-new').textContent = 
		`${deck.new_remaining} new`;
	root.querySelector('.cards-count-learning').textContent = 
		`${deck.learning} learning`;
	root.querySelector('.cards-count-review').textContent = 
		`${deck.review} review`;

	const total = deck.new_remaining + deck.learning + deck.review;
	root.disabled = total === 0;

	root.addEventListener('click', () => start_review(deck.deck_id));
}

async function load_overview() {
	set_scene('overview');

	try {
		const decks = await fetch_overview();

		els.decklist.innerHTML = '';
		els.decklist.append(render_rows(DECK_ROW, decks, fill_deck));
	} catch (error) {
		console.error('Failed to fetch deck overview');
		console.error(`\tMessage: ${error.message}`);
		els.decklist.textContent = 'Could not load decks.';
	}
}

function start_review(/* deck_id */) {
	// No other decks for now...
	set_scene('review');
	load_next();
}

/*
*	Review phase.
*/

function set_phase(phase, message = '') {
	if (!els) return;

	els.review_scene.dataset.state = phase;
	if (message) els.message.textContent = message;
}

function set_revealed(on) {
	local_state.revealed = on;
	if (els) els.review_scene.dataset.revealed = String(on);
}

// Fill the face from a card. 

function fill_meaning(refs, meaning, root) {
	root.textContent = meaning;
}

function paint_card(card) {
	els.word.textContent = card.word ?? '';

	els.reading.textContent =
		card.reading && card.reading !== card.word ? card.reading : '';

	els.meanings.innerHTML = '';
	els.meanings.append(render_rows(CARD_MEANING, card.meanings ?? [], fill_meaning));

	els.phrase.textContent = card.phrase ?? '';

	
	if (card.video_id) {
		const s = Math.floor(card.timestamp ?? 0);
		const e = Math.ceil(card.timestamp_end ?? s);

		els.source.href = `https://www.youtube.com/embed/${card.video_id}?start=${s}&end=${e}`;
		els.thumb.src = `https://i.ytimg.com/vi/${card.video_id}/0.jpg`;
		els.source.style.display = '';
		els.audio_btn.style.display = '';
	} else {
		els.source.style.display = 'none';
		els.audio_btn.style.display = 'none';
	}
}

// Loop. Pull the next card, or fall to the done phase when the server does 
// not return anything else.

async function load_next() {
	local_state.busy = false;
	set_phase('loading', 'Loading...');

	// Drop the previous card's audio so a new card never plays a stale slice.
	stop_clip();
	if (els.audio) {
		els.audio.removeAttribute('src');
		delete els.audio.dataset.forVideo;
	}

	try {
		const card = await fetch_next();

		if (!card) {
			local_state.card = null;
			set_phase('done', 'All done for today.');
			return;
		}

		local_state.card = card;
		set_revealed(false);
		paint_card(card);
		
		set_phase('review');

		if (els.face) els.face.scrollTop = 0;

		prefetch_audio(card);
	} catch (error) {
		console.error('Failed to fetch next card');
		console.error(`\tMessage: ${error.message}`);
		set_phase('error', 'Could not load the next card.');
	}
}

function reveal() {
	if (!local_state.card || local_state.revealed) return;
	set_revealed(true);
}

async function grade(rating) {
	// Only a revealed card can be answered, and only one answer at a time.
	if (!local_state.card || !local_state.revealed || local_state.busy) return;

	local_state.busy = true;
	els.review_scene.dataset.busy = 'true';

	try {
		await send_grade(local_state.card.card_id, rating);
		await load_next();   // clears busy on the way in
	} catch (error) {
		console.error('Failed to grade card');
		console.error(`\tMessage: ${error.message}`);

		local_state.busy = false;
		set_phase('error', 'Could not save that answer.');
	} finally {
		if (els) els.review_scene.dataset.busy = 'false';
	}
}

// Open the current card's clip in the full player. 
function open_current_in_player() {
	const card = local_state.card;
	if (!card || !card.video_id) return;

	const start = Math.floor(card.timestamp ?? 0);
	const url = `/app/player?v=${encodeURIComponent(card.video_id)}&t=${start}`;

	stop_clip();
	window.location.href = url;
}

// Jump to the browser with the current review card selected for editing.
async function edit_current_card() {
	const card = local_state.card;
	if (!card) return;

	stop_clip();
	set_scene('browse');
	await load_browse_page(0);

	const row = els.browse_list.querySelector(
		`.cards-browse-row[data-card_id="${card.card_id}"]`
	);
	if (row) {
		const match = local_state.browse.cards.find(c => c.card_id === card.card_id);
		select_browse_card(match ?? card, row);
		row.scrollIntoView({ block: 'nearest' });
	} else {
		select_browse_card(card);
	}
}

/*
*	Browse phase.
*/

// text that can be seen right of the word/lemma in the card browser.
function browse_due_label(due) {
	if (!due) return { text: 'new', cls: 'is-new' };
	const days = Math.round((due - Date.now()) / 86_400_000);
	if (days < 0)   return { text: `${-days}d overdue`, cls: 'is-overdue' };
	if (days === 0) return { text: 'due today',         cls: 'is-due' };
	return { text: `in ${days}d`, cls: 'is-scheduled' };
}

async function fetch_card_page(limit, page) {
	const res = await fetch('/api/cards/list', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		credentials: 'same-origin',
		body: JSON.stringify({ limit, page }),
	});
	if (!res.ok) throw new Error(`list responded ${res.status}`);
	return res.json();   // { cards, count, page, limit }
}

function fill_browse_row(refs, card, root) {
	root.dataset.card_id = card.card_id;
	root.querySelector('.cards-browse-word').textContent = card.word;
	root.querySelector('.cards-browse-phrase').textContent = card.phrase ?? '';

	const due = browse_due_label(card.due);
	const el = root.querySelector('.cards-browse-due');
	el.textContent = due.text;
	el.className = `cards-browse-due ${due.cls}`;

	const activate = () => select_browse_card(card, root);
	root.addEventListener('click', activate);
	root.addEventListener('keydown', e => {
		if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); }
	});
}

function card_matches(card, q) {
	if (!q) return true;
	const hay = [
		card.word ?? '',
		card.reading ?? '',
		card.phrase ?? '',
		...(card.meanings ?? []),
	].join('\n').toLowerCase();
	return hay.includes(q);
}

// Render the current cards through the active query filter.
function render_browse_list() {
	const q = local_state.browse.query.trim().toLowerCase();
	const shown = local_state.browse.cards.filter(c => card_matches(c, q));

	els.browse_list.innerHTML = '';
	els.browse_list.append(render_rows(BROWSE_ROW, shown, fill_browse_row));

	els.browse_count.textContent = q
		? `${shown.length} of ${local_state.browse.cards.length}`
		: `${local_state.browse.cards.length} card${local_state.browse.cards.length === 1 ? '' : 's'}`;

	// With the whole deck on one page the pager is not used; keep it hidden.
	els.browse_pager.style.display = 'none';

	select_browse_card(null);
}

async function load_browse_page(page) {
	try {
		const { cards, count } = await fetch_card_page(BROWSE_PAGE_SIZE, page);

		local_state.browse.page = page;
		local_state.browse.count = count ?? 0;
		local_state.browse.cards = Array.isArray(cards) ? cards : [];

		render_browse_list();
	} catch (error) {
		console.error('Failed to load card list');
		console.error(`\tMessage: ${error.message}`);
		els.browse_list.textContent = 'Could not load the cards.';
	}
}

// Select a card into the editor.
function select_browse_card(card, row = null) {
	local_state.browse.selected = card;

	for (const r of els.browse_list.querySelectorAll('.cards-browse-row')) {
		r.dataset.selected = row === r ? 'yes' : 'no';
	}

	els.editor.dataset.state = card ? 'editing' : 'empty';
	if (!card) return;

	els.editor.elements.word.value = card.word ?? '';
	els.editor.elements.reading.value = card.reading ?? '';
	els.editor.elements.meanings.value = (card.meanings ?? []).join('\n');
	els.editor.elements.phrase.value = card.phrase ?? '';
}

// Read the editor back into a payload.
function editor_payload() {
	const f = els.editor.elements;
	return {
		card_id: local_state.browse.selected.card_id,
		word: f.word.value.trim(),
		reading: f.reading.value.trim(),
		meanings: f.meanings.value.split('\n')
			.map(s => s.trim()).filter(s => s !== ''),
		phrase: f.phrase.value.trim(),
	};
}

async function save_browse_card(e) {
	e.preventDefault();
	const card = local_state.browse.selected;
	if (!card) return;

	const payload = editor_payload();
	if (!payload.word) {
		create_notification('The word cannot be empty', 'error');
		return;
	}

	try {
		const res = await fetch('/api/cards/update', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			credentials: 'same-origin',
			body: JSON.stringify(payload),
		});
		const data = await res.json();
		if (!res.ok) throw new Error(
			data.message ?? `update responded ${res.status}`
		);

		create_notification('Card saved');
		load_browse_page(local_state.browse.page);
	} catch (error) {
		console.error('Failed to save card');
		console.error(`\tMessage: ${error.message}`);
		create_notification(error.message, 'error');
	}
}

async function delete_browse_card() {
	const card = local_state.browse.selected;
	if (!card) return;
	if (!window.confirm(
		`Delete \u300c${card.word}\u300d and its review history?`
	)) 
		return;

	try {
		const res = await fetch('/api/cards/delete', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			credentials: 'same-origin',
			body: JSON.stringify({ card_id: card.card_id }),
		});
		if (!res.ok) throw new Error(`delete responded ${res.status}`);

		create_notification('Card deleted');
		load_browse_page(0);
	} catch (error) {
		console.error('Failed to delete card');
		console.error(`\tMessage: ${error.message}`);
		create_notification('Could not delete the card', 'error');
	}
}

/*
*	Preview little window.
*/

let preview_el = null;

function close_preview() {
	if (!preview_el) return;
	preview_el.remove();
	preview_el = null;
}

function open_preview() {
	if (!local_state.browse.selected) return;
	close_preview();

	const p = editor_payload();
	const { root } = stamp_template(PREVIEW);

	root.querySelector('.cards-word').textContent = p.word;
	root.querySelector('.cards-reading').textContent =
		p.reading && p.reading !== p.word ? p.reading : '';
	root.querySelector('.cards-phrase').textContent = p.phrase;

	const meanings = root.querySelector('.cards-meanings');
	meanings.append(render_rows(CARD_MEANING, p.meanings, fill_meaning));

	const panel = root.querySelector('.cards-preview');
	root.querySelector('.cards-preview-reveal').addEventListener('click', () => {
		panel.dataset.revealed = 'true';
	});
	root.querySelector('.cards-preview-close').addEventListener('click', close_preview);
	root.querySelector('.cards-preview-scrim').addEventListener('click', close_preview);

	els.root.appendChild(root);
	preview_el = root;
}

function open_browse() {
	set_scene('browse');
	load_browse_page(0);
}

/*
*	Events.
*/

function bind_events() {
	els.reveal.addEventListener('click', reveal);

	els.audio_btn.addEventListener('click', () => play_clip(local_state.card));

	// Review header actions.
	els.open_player.addEventListener('click', open_current_in_player);
	els.edit_current.addEventListener('click', edit_current_card);

	for (const button of els.grades.querySelectorAll('button')) {
		button.addEventListener('click', () => grade(Number(button.dataset.rating)));
	}

	// Browser.
	els.browse_open.addEventListener('click', open_browse);
	els.browse_back.addEventListener('click', () => {
		close_preview();
		load_overview();
	});

	let search_timer = null;
	els.browse_search.addEventListener('input', () => {
		clearTimeout(search_timer);
		search_timer = setTimeout(() => {
			local_state.browse.query = els.browse_search.value;
			render_browse_list();
		}, 120);
	});

	els.editor.addEventListener('submit', save_browse_card);
	els.editor_delete.addEventListener('click', delete_browse_card);
	els.editor_preview.addEventListener('click', open_preview);

	// Tapping outside the editor sheet (mobile) closes it.
	els.editor_scrim?.addEventListener('click', () => select_browse_card(null));
}

document.addEventListener('keydown', e => {
	if (!els || !document.contains(els.root)) return;

	// Preview window closes on Escape, in any scene.
	if (e.key === 'Escape' && preview_el) {
		close_preview();
		return;
	}

	// Editor sheet closes on Escape while browsing.
	if (e.key === 'Escape' && local_state.scene === 'browse'
		&& local_state.browse.selected) {
		select_browse_card(null);
		return;
	}

	if (local_state.scene !== 'review' || local_state.card == null) return;

	const tag_name = e.target.tagName;
	if (tag_name === 'INPUT' || tag_name === 'TEXTAREA') return;

	if (!local_state.revealed) {
		if (e.code === 'Space' || e.key === 'Enter') {
			e.preventDefault();
			reveal();
		}
		return;
	}

	if (e.key >= '1' && e.key <= '4') {
		e.preventDefault();
		grade(Number(e.key));
	}
});

/*
*	View.
*/

function render() {
	const { root } = stamp_template(CARDS_ROOT);

	const overview = stamp_template(OVERVIEW).root;
	const review = stamp_template(REVIEW).root;
	const browse = stamp_template(BROWSE).root;
	root.append(overview, review, browse);

	els = {
		root,
		decklist: overview.querySelector('.cards-decklist'),

		review_scene: review,
		message: review.querySelector('.cards-message'),

		open_player: review.querySelector('.cards-open-player'),
		edit_current: review.querySelector('.cards-edit-current'),

		word: review.querySelector('.cards-word'),
		reading: review.querySelector('.cards-reading'),
		meanings: review.querySelector('.cards-meanings'),
		phrase: review.querySelector('.cards-phrase'),

		reveal: review.querySelector('.cards-reveal'),
		grades: review.querySelector('.cards-grades'),

		source: review.querySelector('.cards-source'),
		thumb: review.querySelector('.cards-thumb'),

		audio: review.querySelector('.cards-audio'),
		audio_btn: review.querySelector('.cards-audio-btn'),

		face: review.querySelector('.cards-face'),

		// Browser.
		browse_scene: browse,
		browse_open: overview.querySelector('.cards-browse-open'),
		browse_back: browse.querySelector('.cards-browse-back'),
		browse_search: browse.querySelector('.cards-browse-search'),
		browse_count: browse.querySelector('.cards-browse-count'),
		browse_pager: browse.querySelector('.cards-browse-pager'),
		browse_page: browse.querySelector('.cards-browse-page'),
		browse_prev: browse.querySelector('.cards-browse-prev'),
		browse_next: browse.querySelector('.cards-browse-next'),
		browse_list: browse.querySelector('.cards-browse-list'),

		// Editor.
		editor: browse.querySelector('.cards-editor'),
		editor_scrim: browse.querySelector('.cards-editor-scrim'),
		editor_delete: browse.querySelector('.cards-editor-delete'),
		editor_preview: browse.querySelector('.cards-editor-preview'),
	};

	bind_events();
	load_overview();

	return root;
}

export { render };