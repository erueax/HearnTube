import { create_template, stamp_template, render_rows } from './template.js';
import { create_notification } from './notif.js';

const AUTH_SCREEN = create_template`
	<div id="auth-view">
		<div id="auth-form-container">
			<p id="auth-user-pre-message" data-ref="first_message"></p>
			<form method="POST" target="_self" action="/api/auth/login"
				class="login visible" data-ref="login_form">
				<input type="text" name="username" placeholder="username">
				<input type="password" name="password" placeholder="password">
				<button>login</button>
			</form>
			<form method="POST" target="_self" action="/api/auth/register"
				class="register hidden" data-ref="register_form">
				<input type="text" name="username" placeholder="username">
				<input type="email" name="email" placeholder="email">
				<input type="password" name="password" placeholder="password">
				<button>register</button>
			</form>
			<p id="auth-user-post-message" data-ref="second_message"></p>
			<button id="auth-change-button" data-ref="change_button"></button>
		</div>
	</div>
`;

export async function verify_auth() {
	try {
		const res = await fetch('/api/auth/me', {
			method: 'POST',
			credentials: 'same-origin',
		});

		if (!res.ok) {
			setup_login_screen();
		}
	} catch {
		// network error
		setup_login_screen();
	}
}

function setup_login_screen() {
	const { root, refs } = stamp_template(AUTH_SCREEN);

	refs.first_message.innerText = "Welcome back";
	refs.second_message.innerText = "Don't have an account?";

	refs.change_button.innerText = "create account";

	refs.change_button.addEventListener('click', (e) => {
	    const visible_form = e.currentTarget.parentElement.querySelector('.visible');
		const hidden_form = e.currentTarget.parentElement.querySelector('.hidden');

		visible_form.classList.add("hidden");
		visible_form.classList.remove("visible");

		hidden_form.classList.add("visible");
		hidden_form.classList.remove("hidden");

		let first_message = document.querySelector("#auth-user-pre-message");
		let second_message = document.querySelector("#auth-user-post-message");
		let change_button = document.querySelector("#auth-change-button");

		let is_login = 
			e.currentTarget.parentElement.querySelector("form.visible.login")
			!== null;

		first_message.innerText = 
			(is_login) ? "Welcome back" : "Welcome to HearnTube";
		second_message.innerText = 
			(is_login) ? "Don't have an account?" : "Do you have an account?";
		change_button.innerText = 
			(is_login) ? "create account" : "login";
	});

	refs.login_form.addEventListener('submit', async (e) => {
		e.preventDefault();

		let form_data = new FormData(e.currentTarget);
		let username = form_data.get("username");
		let password = form_data.get("password");

		try {
			const res = await fetch('/api/auth/login', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				credentials: 'same-origin',
				body: JSON.stringify({ username, password }),
			});

	        const data = await res.json();
	        if (!res.ok) throw new Error(data.message ?? 'Login failed');

			create_notification(data.message, "notification");

			const p = window.location.pathname;
			const known = 	p === '/app/player' || p === '/app/cards' ||
				p === '/app/versus' || p === '/app/options';
			window.location.assign(known ? p : '/app/home');
	    } catch (err) {
			create_notification(err.message, "alert");
	    }
	});

	refs.register_form.addEventListener('submit', async (e) => {
		e.preventDefault();

		let form_data = new FormData(e.currentTarget);
		let username = form_data.get("username");
		let email = form_data.get("email");
		let password = form_data.get("password");

		try {
	        const res = await fetch('/api/auth/register', {
	            method: 'POST',
	            headers: { 'Content-Type': 'application/json' },
	            credentials: 'same-origin',
	            body: JSON.stringify({ username, email, password }),
	        });

	        const data = await res.json();
	        if (!res.ok) throw new Error(data.message ?? 'Register failed');

			create_notification(data.message, "notification");

	        window.location.assign(data.redirect);
	    } catch (err) {
	        // console.error(err.message);
			create_notification(err.message, "alert");
	    }
	});

	document.body.prepend(root);
}