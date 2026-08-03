const ui_state = {};


export function render() {
	let new_view = document.createElement('div');
	new_view.setAttribute("id", "not-found");

	new_view.innerHTML = `
		<div class="error-message">This view does not exist</div>
	`;

	return new_view;
}