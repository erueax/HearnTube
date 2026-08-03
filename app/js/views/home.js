/*
*	Home view. 
*/


import { 
	create_template, stamp_template, render_rows 
} from '../utils/template.js';
import { create_notification } from '../utils/notif.js';

/*
*	Const and functions related to history 'page' size.
*/

// For the history pages.
const WIDE = '(min-width: 35rem)';
function page_size() {
	return window.matchMedia(WIDE).matches ? 6 : 1;
}

// Crossing the breakpoint changes the page size.
window.matchMedia(WIDE).addEventListener('change', () => {
	if (els) 
		load_page(0);
});

/*
*	TEMPLATES
*/

const HOME_ROOT = create_template`
<div id="home" data-state="loading">
	<h1 class="home-welcome"></h1>
	
	<h2 class="home-title">Recently watched</h2>
	<div class="home-history">
		<div class="home-grid"></div>
		<div class="home-pager">
			<button class="home-prev" type="button">&laquo; Newer</button>
			<span class="home-page-label"></span>
			<button class="home-next" type="button">Older &raquo;</button>
		</div>
	</div>


	<h2 class="home-title">Reviews forecast & Reviews pie</h2>
	<div class="home-charts">
		<div class="home-forecast">
			<canvas class="home-forecast-canvas"></canvas>
		</div>
		<div class="home-deck">
			<canvas class="home-deck-canvas"></canvas>
		</div>
	</div>

	<div class="home-message"></div>
</div>
`;

const HISTORY_CARD = create_template`
<div class="home-card">
	<a class="home-thumb-link">
		<img class="home-thumb" alt="" loading="lazy">
	</a>

	<div class="home-card-body">
		<span class="home-card-title"></span>
		<span class="home-card-time"></span>
	</div>

	<div class="home-card-actions">
		<a class="home-watch" role="button">Watch</a>
		<button class="home-delete" type="button" title="Remove from history">Delete</button>
	</div>
</div>
`;

/*
*	STATE
*/

const local_state = {
	page: 0,
	count: 0,
};

let els = null;

/*
*	History fetch functions.
*/

async function fetch_history(limit, page) {
	const res = await fetch('/api/hist/list', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ limit, page }),
		credentials: 'same-origin',
	});

	if (!res.ok) {
		throw new Error(`history responded ${res.status}`);
	}

	return res.json();   // { history, count, page, limit }
}

/*
*	Welcome line. The username is fetched from the server. A failed	lookup 
*	just leaves a generic greeting rather than a blank or a crash.
*/
async function paint_welcome() {
	try {
		const res = await fetch('/api/auth/me', {
			method: 'POST',
			credentials: 'same-origin',
		});
		if (!res.ok) return;

		const { user } = await res.json();
		const hello_username_part = document.createElement('span');
		hello_username_part.textContent = 
			user ? `${user.username}様！` : 'お客様';
		hello_username_part.style.textWrap = 'nowrap';
		els.welcome.append('いらっしゃいませ');
		els.welcome.append(hello_username_part);
	} catch {
	}
}

/*
*	Review forecast.
*/
let chart = null;

async function paint_forecast() {
	try {
		const res = await fetch('/api/cards/forecast', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			credentials: 'same-origin',
			body: JSON.stringify({ days: 7 }),
		});
		if (!res.ok) throw new Error(`forecast responded ${res.status}`);

		const { forecast } = await res.json();
		if (!Array.isArray(forecast)) throw new Error('bad forecast payload');

		const labels = forecast.map((_, i) =>
			i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : `+${i}d`);

		if (chart) {
			chart.destroy();
			chart = null;
		}

		// Chart is a global from the self-hosted chart.umd.js script tag.
		chart = new Chart(els.forecast_canvas, {
			type: 'bar',
			data: {
				labels,
				datasets: [{
					label: 'Reviews due',
					data: forecast,
					backgroundColor: 'rgba(224, 122, 155, 0.85)',
					borderRadius: 0,
					maxBarThickness: 60,
				}],
			},
			options: {
				responsive: true,
				maintainAspectRatio: false,
				plugins: { legend: { display: false } },
				scales: {
					y: { beginAtZero: true, ticks: { precision: 0, color: '#888' }, grid: { color: 'rgba(255,255,255,0.06)' } },
					x: { ticks: { color: '#888' }, grid: { display: false } },
				},
			},
		});

		els.forecast.style.display = '';
	} catch (error) {
		console.error('Failed to fetch forecast');
		console.error(`\tMessage: ${error.message}`);

		// Hide the graph on failure.
		els.forecast.style.display = 'none';
	}
}

let deck_chart = null;

async function paint_deck() {
	try {
		const res = await fetch('/api/cards/overview', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			credentials: 'same-origin',
			body: JSON.stringify({}),
		});
		if (!res.ok) throw new Error(`overview responded ${res.status}`);

		const { decks } = await res.json();
		const deck = Array.isArray(decks) ? decks[0] : null;
		if (!deck) throw new Error('bad overview payload');

		const review = deck.review ?? 0;
		const learning = deck.learning ?? 0;
		const fresh = deck.new_available ?? 0;

		if (deck_chart) { deck_chart.destroy(); deck_chart = null; }

		if (review + learning + fresh === 0) {
			els.deck.style.display = 'none';
			return;
		}

		deck_chart = new Chart(els.deck_canvas, {
			type: 'doughnut',
			data: {
				labels: ['Review', 'To study', 'New'],
				datasets: [{
					data: [review, learning, fresh],
					backgroundColor: [
						'rgba(224, 122, 155, 0.85)',
						'rgba(224, 122, 155, 0.50)',
						'rgba(224, 122, 155, 0.22)',
					],
					/* borderColor: 'var(--color-bg)',*/
					/* borderWidth: 2,*/
				}],
			},
			options: {
				responsive: true,
				maintainAspectRatio: false,
				plugins: {
					legend: { position: 'bottom', labels: { color: '#888' } },
				},
			},
		});

		els.deck.style.display = '';
	} catch (error) {
		console.error('Failed to fetch deck overview');
		console.error(`\tMessage: ${error.message}`);
		els.deck.style.display = 'none';
	}
}

// Fetch youtube video title.
async function fetch_title(video_id) {
	const target = `https://www.youtube.com/watch?v=${video_id}`;
	const url = `https://www.youtube.com/oembed?url=${encodeURIComponent(target)}&format=json`;

	const res = await fetch(url);
	if (!res.ok) {
		throw new Error(`oembed responded ${res.status}`);
	}

	const { title } = await res.json();
	return title ?? '';
}


// Formats from unix timestamp to text.
function ago(unix_seconds) {
	const s = Math.max(0, 
		Math.floor(Date.now() / 1000 - Number(unix_seconds || 0)));

	const m = Math.floor(s / 60);
	const h = Math.floor(m / 60);
	const d = Math.floor(h / 24);

	if (s < 60) return 'just now';
	if (m < 60) return `${m} minute${m === 1 ? '' : 's'} ago`;
	if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
	if (d < 7)  return `${d} day${d === 1 ? '' : 's'} ago`;

	if (d < 30) {
		const w = Math.floor(d / 7);
		return `${w} week${w === 1 ? '' : 's'} ago`;
	}

	if (d < 365) {
		const mo = Math.floor(d / 30);
		return `${mo} month${mo === 1 ? '' : 's'} ago`;
	}

	const y = Math.floor(d / 365);
	return `${y} year${y === 1 ? '' : 's'} ago`;
}

// Populates the given video history card.
function fill_card(refs, entry, root) {
	const href = `/app/player?v=${encodeURIComponent(entry.video_id)}`;

	root.querySelector('.home-thumb-link').href = href;
	root.querySelector('.home-watch').href = href;

	root.querySelector('.home-thumb').src = 
		`https://i.ytimg.com/vi/${entry.video_id}/0.jpg`;
	root.querySelector('.home-card-time').textContent = ago(entry.watched_at);

	const title_el = root.querySelector('.home-card-title');
	title_el.textContent = entry.video_id;

	fetch_title(entry.video_id)
		.then(title => { if (title) title_el.textContent = title; })
		.catch(() => {});

	root.querySelector('.home-delete').addEventListener('click', (e) => {
		e.preventDefault();
		e.stopPropagation();
		delete_entry(entry.video_id);
	});
}

/*
*	Pager. The count and the page size give the number of pages; the buttons
*	are disabled at the ends. A single page needs no pager at all.
*/
function paint_pager() {
	const pages = Math.max(1, Math.ceil(local_state.count / page_size()));
	const page = local_state.page;

	els.page_label.textContent = `Page ${page + 1} of ${pages}`;
	els.prev.disabled = page <= 0;
	els.next.disabled = page >= pages - 1;

	els.pager.style.display = pages > 1 ? '' : 'none';
}

/*
*	Load and draw one page.
*/
async function load_page(page) {
	if (!els) return;

	const first_load = els.root.dataset.state !== 'ready';
	if (first_load) {
		els.root.dataset.state = 'loading';
		els.message.textContent = 'Loading...';
	}

	try {
		const { history, count } = await fetch_history(page_size(), page);

		local_state.page = page;
		local_state.count = count ?? 0;

		if (!Array.isArray(history) || !history.length) {
			els.root.dataset.state = 'empty';
			els.message.textContent = 'No videos watched yet.';
			return;
		}

		els.grid.innerHTML = '';
		els.grid.append(render_rows(HISTORY_CARD, history, fill_card));

		const size = page_size();
		const pages = Math.ceil((count ?? 0) / size);
		if (pages > 1) {
			for (let i = history.length; i < size; i++) {
				const { root } = stamp_template(HISTORY_CARD);
				root.classList.add('home-card-placeholder');
				root.querySelector('.home-card-title').textContent = '\u00a0';
				root.querySelector('.home-card-time').textContent = '\u00a0';
				els.grid.append(root);
			}
		}

		paint_pager();
		els.root.dataset.state = 'ready';
	} catch (error) {
		console.error('Failed to fetch history');
		console.error(`\tMessage: ${error.message}`);

		els.root.dataset.state = 'error';
		els.message.textContent = 'Could not load your history.';
	}
}

async function delete_entry(video_id) {
	try {
		const res = await fetch('/api/hist/delete', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			credentials: 'same-origin',
			body: JSON.stringify({ video_id }),
		});
		if (!res.ok) throw new Error(`delete responded ${res.status}`);

		const { ok } = await res.json();
		if (!ok) throw new Error('entry not found');

		create_notification('Removed from history', 'notification');

		const page = local_state.page;
		const remaining = local_state.count - 1;
		const last_page = Math.max(0, Math.ceil(remaining / page_size()) - 1);
		load_page(Math.min(page, last_page));
	} catch (error) {
		console.error('Failed to delete history entry');
		console.error(`\tMessage: ${error.message}`);
		create_notification('Could not remove video', 'error');
	}
}

/*
*	Events. The pager steps one page at a time and cannot run past either end.
*/
function bind_events() {
	els.prev.addEventListener('click', () => {
		if (local_state.page > 0) load_page(local_state.page - 1);
	});

	els.next.addEventListener('click', () => {
		const pages = Math.ceil(local_state.count / page_size());
		if (local_state.page < pages - 1) load_page(local_state.page + 1);
	});
}

/*
*	View.
*/

export function render() {
	const { root } = stamp_template(HOME_ROOT);

	els = {
		root,
		welcome: root.querySelector('.home-welcome'),
		forecast: root.querySelector('.home-forecast'),
		forecast_canvas: root.querySelector('.home-forecast-canvas'),
		message: root.querySelector('.home-message'),
		grid: root.querySelector('.home-grid'),
		pager: root.querySelector('.home-pager'),
		prev: root.querySelector('.home-prev'),
		next: root.querySelector('.home-next'),
		page_label: root.querySelector('.home-page-label'),
		deck: root.querySelector('.home-deck'),
		deck_canvas: root.querySelector('.home-deck-canvas'),
	};

	bind_events();
	paint_welcome();
	paint_forecast();
	paint_deck() 
	load_page(0);

	return root;
}