import express from 'express';
import { get_tokens } from '../controllers/tokenizer.js';
import { get_entries } from '../controllers/dictionary.js';

const router = express.Router();

// Function words get a grammatical role on top of dictionary entries.
const function_pos = new Set(
	['助詞', '助動詞', '記号', '補助記号', '接続詞', 'フィラー']
);

// Never looked up in the dictionary, things like punctuation.
const no_lookup = new Set(['記号', '補助記号', 'フィラー']);

// Hand-written.
export const grammar = {
	// Helper verbs.
	'ます':		'polite',
	'た':		'past',
	'だ':		'copula',
	'です':		'copula (polite)',
	'ない':		'negative',
	'ぬ':		'negative (classical)',
	'ん':		'negative / explanatory',
	'れる':		'passive / potential',
	'られる': 	'passive / potential',
	'せる':		'causative',
	'させる': 	'causative',
	'たい':		'desiderative (want to)',
	'らしい': 	'seeming / hearsay',
	'よう':		'volitional / conjecture',
	'まい':		'negative volitional',
	// Particles.
	'は':		'topic',
	'が':		'subject',
	'を':		'object',
	'に':		'to / at / by',
	'へ':		'toward',
	'で':		'at / by means of',
	'と':		'and / with / quotation',
	'から':		'from / because',
	'まで':		'until / as far as',
	'より':		'than / from',
	'の':		'possessive / nominalizer',
	'も':		'also / even',
	'か':		'question / or',
	'ね':		'seeking agreement',
	'よ':		'assertion',
	'て':		'connective',
	'ば':		'conditional',
};

// '_' is the category fallback when the subtype itself is unknown.
const detail_roles = {
	'助詞': {
		'格助詞': 'case particle',
		'係助詞': 'binding particle',
		'副助詞': 'adverbial particle',
		'接続助詞': 'conjunctive particle',
		'終助詞': 'sentence-final particle',
		'並立助詞': 'parallel particle',
		'連体化': 'adnominalizer',
		'副詞化': 'adverbializer',
		_: 'particle',
	},
	'助動詞': { _: 'auxiliary' },
	'接続詞': { _: 'conjunction' },
	'フィラー': { _: 'filler' },
	'記号': { _: 'symbol' },
	'補助記号': { _: 'symbol' },
};

// Lemma table first, then the subtype map, then the category fallback.
function role_of(token) {
	const precise = grammar[token.lemma];
	if (precise) return precise;

	const by_pos = detail_roles[token.pos];
	if (!by_pos) return null;

	return by_pos[token.pos_detail] ?? by_pos._;
}

router.post('/tokenize', async (req, res) => {
	const { text } = req.body ?? {};

	if (typeof text !== 'string' || text.length === 0) {
		return res.status(400).json({ error: 'text must be a non-empty string' });
	}

	const tokens = await get_tokens(text);

	const pretty_responses = tokens.map(token => {
		const is_function = function_pos.has(token.pos);

		return {
			word: token.surface,
			reading: token.reading,
			type: token.pos,
			role: is_function ? role_of(token) : null,
			entries: no_lookup.has(token.pos)
				? []
				: get_entries(token.lemma, token.reading),
		};
	});

	return res.status(200).json(pretty_responses);
});

export default router;