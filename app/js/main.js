/*
*	This file holds a very minimal route handler for a pure js SPA. Each view
*	code and logic are stored in the views dir (one js file per view).
*/

// Helper modules scripts.
import { verify_auth } from './utils/auth.js';

// Views handlers scripts. Each view as a render method that instantiates the
// view.
import { render as render_home	 	} from './views/home.js';
import { render as render_player 	} from './views/player.js';
import { render as render_cards 	} from './views/cards.js';
import { render as render_versus 	} from './views/versus.js';
import { render as render_options 	} from './views/options.js';
import { render as render_not_found } from './views/not_found.js';

const view = document.querySelector('#view');

// Routes object, holds the function that build the view inside the #view elem.
const routes = {
	'/app/home':	render_home,
	'/app/player':	render_player,
	'/app/cards':	render_cards,
	'/app/versus':	render_versus,
	'/app/options':	render_options,
};

// Checks the routes object against the url pathname, fetches the corresponding
// function that will populate #view childrens.
//
// Since 'IPC' is not needed outside of a single case of starting watching a 
// video after clicking on the history view / while reviewing cards we handle
// those cases using URL queries. 
function render(to) {
	const url = new URL(to, location.origin);
	const pathname = url.pathname;

	const build = routes[pathname];

	document.body.dataset.route =
		build ? pathname.split('/').pop() : 'not-found';

	if (!build) {
		history.replaceState(null, '', '/app/home');
		render('/app/home');
		return;
	}

	// The player takes an optional video id from ?v= and t=
	// other builders take no args and ignore the extra value/values.
	//
	// [TODO?] if there is need for more inter view comunication having a class
	// handle it may be a preferable solution.
	if (pathname === '/app/player') {
		const v = url.searchParams.get('v');
		const video_id = /^[\w-]{11}$/.test(v) ? v : null;
		view.replaceChildren(build(video_id));
		return;
	}

	view.replaceChildren(build());
}

// Uses history API to save new entries in browser history, then it calls
// the render function.
export function navigate(to, { replace = false } = {}) {
	if (!may_navigate()) return;

	const url = new URL(to, location.origin);

	if (replace) history.replaceState(null, '', url);
	else history.pushState(null, '', url);

	// pass pathname + search so a ?v= video id is not lost on the way to render
	render(url.pathname + url.search);
}

// Intercepts clicks on in-app links from sending request to the server.
// It then passes the request to the navigate function.
document.addEventListener('click', (e) => {
	const a = e.target.closest('a');
	if (!a || !a.href)
		return;
	if (e.defaultPrevented || e.button !== 0)
		return;
	if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
		return;
	if (a.target && a.target !== '_self')
		return;
	if (a.hasAttribute('download') || a.getAttribute('rel') === 'external')
		return;

	const url = new URL(a.href);
	if (url.origin !== location.origin)
		return;
	if (!url.pathname.startsWith('/app'))
		return;
	if (url.pathname === location.pathname && url.hash)
		return;

	e.preventDefault();

	// This check is here to prevent having a duplicate history entry.
	if (url.href === location.href)
		return;

	navigate(url);
});

// After users clicks back or forward we call render on that path. pathname +
// search keeps the player's ?v= id when navigating through history.
window.addEventListener('popstate', () => {
	render(location.pathname + location.search);
});

window.addEventListener('beforeunload', e => {
	if (nav_block && nav_block()) {
		e.preventDefault();
		e.returnValue = '';
	}
});

render(location.pathname + location.search);
verify_auth();

// Helper functions preventing leaving the versus/game view during a match.

let nav_block = null;
let nav_leave = null;

export function set_nav_guard(is_blocking, on_leave) {
	nav_block = is_blocking;
	nav_leave = on_leave;
}

export function clear_nav_guard() {
	nav_block = null;
	nav_leave = null;
}

// true if navigation may proceed.
function may_navigate() {
	if (!nav_block || !nav_block()) return true;

	const ok = window.confirm('Leaving will forfeit the match. Leave anyway?');
	if (ok && nav_leave) nav_leave();
	return ok;
}