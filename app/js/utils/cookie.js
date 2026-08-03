/* Cookie handling server functions */

export function setCookie(name, value, days = 365) {
	const expires = new Date(Date.now() + days * 864e5).toUTCString();
	document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Lax`;
}

export function getCookie(name) {
	const match = document.cookie.match(
		new RegExp('(?:^|; )' + encodeURIComponent(name) + '=([^;]*)')
	);
	return match ? decodeURIComponent(match[1]) : null;
}