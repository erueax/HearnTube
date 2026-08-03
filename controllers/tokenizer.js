import path from 'node:path';
import { fileURLToPath } from 'node:url';
import kuromoji from 'kuromoji';

// kumoji needs a vocabulary. It has a default one.
const KUROMOJI_DIR = path.dirname(fileURLToPath(
	import.meta.resolve('kuromoji')
));
const DIC_PATH = path.join(KUROMOJI_DIR, '..', 'dict');

let building = null;

// Runned once to initialized kuromoji.
function build_tokenizer() {
    if (!building) {
        building = new Promise((resolve, reject) => {
            kuromoji.builder({ dicPath: DIC_PATH }).build((err, tokenizer) => {
                if (err) {
                    building = null;
                    return reject(new Error(`Could not load dictionary at ${DIC_PATH}. Details: ${err.message}`));
                }
                resolve(tokenizer);
            });
        });
    }

	return building;
}

// Used to see if lemmas that the tokenizer divides are actually one word with
// helper verbs and such.
function is_glue(token) {
    const { pos, pos_detail_1, surface_form } = token;

    return pos === '助動詞'
        || (pos === '動詞' && (pos_detail_1 === '非自立' || pos_detail_1 === '接尾'))
        || (pos === '形容詞' && pos_detail_1 === '非自立')
        || (pos === '助詞' && pos_detail_1 === '接続助詞' && /^[てで]$/.test(surface_form));
}

async function get_tokens(text, merge = false) {
    if (typeof text !== 'string') {
        throw new Error('Invalid input: expected a string');
    }

    if (text.trim() === '') {
        return [];
    }

    const tokenizer = await build_tokenizer();
    const tokens = [];

    for (const token of tokenizer.tokenize(text)) {
        const previous = tokens.at(-1);

        if (merge && previous && is_glue(token)) {
            previous.surface += token.surface_form;
            previous.reading += token.reading || '';
            previous.end += token.surface_form.length;
            continue;
        }

        tokens.push({
            surface: token.surface_form,
            reading: token.reading || '',
            lemma: token.basic_form !== '*' ? token.basic_form : token.surface_form,
            pos: token.pos,
            start: token.word_position - 1,
            end: token.word_position - 1 + token.surface_form.length
        });
    }

    return tokens;
}

async function warmup() {
    await build_tokenizer();
}

export { get_tokens, warmup };