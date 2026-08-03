import { create_template, stamp_template, render_rows } from './template.js';

const NOTIFICATION = create_template`
	<div class="auth-notification notification">
		<span class="notification-message" data-ref="message"></span>
	</div>
`;

export function create_notification(text, type = 'notification', ttl = 1200) {
	const { root, refs } = stamp_template(NOTIFICATION);

	refs.message.innerText = text;
	root.classList.add(type);

	document.body.prepend(root);
	requestAnimationFrame(move_notifications_down);

	setTimeout(() => dismiss(root), ttl);
	return root;
}

function dismiss(root) {
	root.classList.add('fade-out');
	root.addEventListener('transitionend', () => {
		root.remove();
		move_notifications_down();   // Close the gap left behind.
	}, { once: true });
}

function move_notifications_down() {
	const notifications = document.querySelectorAll(".auth-notification");
	const gap = 8;
	let offset = 0;

	notifications.forEach((el) => {
		el.style.transform = `translateY(${offset}px)`;
		offset += el.offsetHeight + gap;
	});
}