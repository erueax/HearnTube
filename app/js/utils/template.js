// Parses a tagged template literal string once into a <template> element
// this never receives any dynamic data (optional static data at initialization)
//
// This function can be called with by tagging a literal.  Example:
// 		create_template`<span>Hello there %{name}!<span>`;
// which would be the same as doing:
// 		create_template(["hello there ", "!"], name);
export function create_template(html_chunks, ...static_values) {
	const template_element = document.createElement('template');
	template_element.innerHTML = String.raw(
		{ raw: html_chunks }, 
		...static_values
	);

	return template_element;
}




// Produces one live copy of a template along with named handles to every
// element marked data-ref (which is how we give it its name).
// Alternative name: transubstantiate_template (joke).
//
// it returns: the "root" of the fragment, the document holding the fragments
// and the look up table refs.
export function stamp_template(template) {
	// To 'have it' in the document but not yet into the document tree.
	const fragment = document.importNode(template.content, true);
	const refs = {};
	for (const el of fragment.querySelectorAll('[data-ref]')) {
		refs[el.dataset.ref] = el;
	}
	return { 
		root: fragment.firstElementChild, 
		fragment: fragment, 
		refs 
	};
}

// Produces one copy of a row template per item and fills it via the callback.
// Framgments is created, it gets fillied by templates then these children will
// be .append to a node.
export function render_rows(row_template, items, fill) {
	const batch = document.createDocumentFragment();
	for (const item of items) {
		const { root, refs } = stamp_template(row_template);
		fill(refs, item, root);
		batch.append(root);
	}
	return batch;
}