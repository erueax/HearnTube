import { 
	create_template, stamp_template
} from '../utils/template.js';
import { create_notification } from '../utils/notif.js';

const ui_state = {};

const OPTIONS = create_template`
	<div id="options-contaier">
		<h1>Options</h1>
		<div class="options-row">
			<p>Current user: </p>
			<p data-ref="username"></p>
		</div>
		<div class="options-row">
			<p>New cards per day:</p>
			<span class="options-inline">
				<input data-ref="new_limit" type="number" min="0" max="9999" step="1">
				<button data-ref="save_limit">save</button>
			</span>
		</div>
		<div class="options-row">
			<!-- <p>Logout from this session:</p> -->
			<button id="options-logout" class="opt-button" data-ref="logout">
				Logout from this session
			</button>
		</div>
		<div class="options-row">
			<!-- <p>Log out of all other sessions:</p> -->
			<button id="options-logout-others" class="opt-button" data-ref="logout_others">
				Log out of all other sessions
			</button>
		</div>
		<div class="options-row">
			<!-- <p>Delete this account:</p> -->
			<button id="options-delete-account" class="opt-button" data-ref="delete_account">
				Delete this account
			</button>	
		</div>
	</div>
`;


export function render() {
	const { root, refs } = stamp_template(OPTIONS);

	// The username comes from the server side.
	fetch('/api/auth/me', { method: 'POST', credentials: 'same-origin' })
		.then(res => res.ok ? res.json() : null)
		.then(data => {
			refs.username.textContent = data?.user ? '@' + data.user.username : '';
		})
		.catch(() => { refs.username.textContent = ''; });

	// Load the current daily card limit into the input.
	fetch('/api/cards/limit', { method: 'POST', credentials: 'same-origin' })
		.then(res => res.ok ? res.json() : null)
		.then(data => {
			if (data && typeof data.value === 'number') refs.new_limit.value = data.value;
		})
		.catch(() => { /* leave input blank on failure */ });

	refs.save_limit.addEventListener("click", async (e) => {
		e.preventDefault();

		const value = Number(refs.new_limit.value);
		if (!Number.isInteger(value) || value < 0) {
			console.error('invalid new-cards value');
			return;
		}

		try {
			const res = await fetch('/api/cards/limit', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				credentials: 'same-origin',
				body: JSON.stringify({ value }),
			});
			const data = await res.json();
			if (!res.ok) throw new Error(data.message ?? 'could not save');

			create_notification('Updated new cards limits');

			refs.new_limit.value = data.value;
		} catch (err) {
			console.error(err.message);
			create_notification(err.message);
		}
	});

	refs.logout_others.addEventListener("click", async (e) => {
		e.preventDefault();

		try {
			const res = await fetch('/api/auth/logout_others', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				credentials: 'same-origin',
			});
			const data = await res.json();
			if (!res.ok) throw new Error(data.message ?? 'could not log out others');

			// console.log('other sessions ended');
			create_notification('other sessions ended');
		} catch (err) {
			console.error(err.message);
		}
	});

	refs.logout.addEventListener("click", async (e) => {
		e.preventDefault();

		try {
			const res = await fetch('/api/auth/logout', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				credentials: 'same-origin',
				body: JSON.stringify({ effect_area: "this" }),
			});

			const data = await res.json();
			if (!res.ok) 
				throw new Error(data.message ?? 'logout failed');
			window.location.assign(window.location.pathname);
		} catch (err) {
			console.error(err.message);
		}
	});

	refs.delete_account.addEventListener("click", async (e) => {
		e.preventDefault();

		try {
			const res = await fetch('/api/auth/delete_account', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				credentials: 'same-origin',
				body: JSON.stringify({}),
			});

			const data = await res.json();
			if (!res.ok) throw new Error(data.message ?? 'delete account failed');

			window.location.assign(data.redirect);
		} catch (err) {
			console.error(err.message);
		}
	});

	return root; 
}