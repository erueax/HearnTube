import express from 'express';
import {
	get_user_by_session, card_exists, get_default_deck,
	create_card, get_next_card, record_review, deck_overview,
	review_forecast, get_new_cards_limit, set_new_cards_limit,
	leaderboard, cards_by_video,
	get_cards, count_cards, delete_card, update_card,
} from '../controllers/database.js';

const router = express.Router();

const MAX_LIMIT = 9999;

router.post('/create', async (req, res) => {
	const session_id = req.cookies?.session_id;
	const user = get_user_by_session(session_id);
	if (!user) return res.status(401).json({ result: "not authenticated" });
	const user_id = user.id;

	if(card_exists(user_id, get_default_deck(user_id), req.body.jmdict_id)) {
		return res.status(409).json({ result: "card already there" });
	}

	const cards = {
		word:		req.body.word,
		jmdict_id: 	req.body.jmdict_id,
		phrase: 	req.body.phrase,
		reading: 	req.body.reading,
		meanings: 	req.body.meanings,
		video_id: 	req.body.video_id,
		timestamp:	req.body.timestamp,
		timestamp_end:	req.body.timestamp_end,
	}

	create_card(user_id, cards);

	return res.status(200).json({ result: "card created" });
});

// This checks if the card is already present in the user's deck.
router.post('/exists', async (req, res) => {
	const session_id = req.cookies?.session_id;
	const user = get_user_by_session(session_id);
	if (!user) return res.status(401).json({ result: "not authenticated" });
	const deck_id = get_default_deck(user.id);

	const ids = Array.isArray(req.body.jmdict_ids) ? req.body.jmdict_ids : [];

	const present = ids.filter(id =>
		id != null && card_exists(user.id, deck_id, String(id))
	);

	return res.status(200).json({ present });
});

// This is used to get the next card (be it the new or to be reviewed.)
router.post('/next', async (req, res) => {
	const user = get_user_by_session(req.cookies?.session_id);
	if (!user) return res.status(401).json({ result: "not authenticated" });

	const card = get_next_card(user.id);
	return res.status(200).json({ card });
});

// After user grades the card in the frontend we apply the grade and store in db
router.post('/grade', async (req, res) => {
	const user = get_user_by_session(req.cookies?.session_id);
	if (!user) return res.status(401).json({ result: "not authenticated" });

	const rating = Number(req.body.rating);
	if (![1, 2, 3, 4].includes(rating)) {
		return res.status(400).json({ result: "bad rating" });
	}

	const card = record_review(user.id, req.body.card_id, rating);
	if (!card) return res.status(404).json({ result: "card not found" });

	return res.status(200).json({ card });
});

// Overview of the state of the user's deck
router.post('/overview', async (req, res) => {
	const user = get_user_by_session(req.cookies?.session_id);
	if (!user) return res.status(401).json({ result: "not authenticated" });

	return res.status(200).json({ decks: [deck_overview(user.id)] });
});

// Get cards by video.
router.post('/by_video', async (req, res) => {
	const user = get_user_by_session(req.cookies?.session_id);
	if (!user) return res.status(401).json({ result: "not authenticated" });

	const { video_id } = req.body ?? {};
	if (!/^[\w-]{11}$/.test(video_id)) {
		return res.status(400).json({ error: 'invalid video_id' });
	}

	const cards = cards_by_video(user.id, video_id);
	return res.status(200).json({ cards });
});

// For the main page. Used to populate the graph showing how many card reviews
// will need to be done in the subsequent days.
router.post('/forecast', async (req, res) => {
	const user = get_user_by_session(req.cookies?.session_id);
	if (!user) return res.status(401).json({ result: "not authenticated" });

	const days = Math.min(Math.max(Number(req.body?.days) || 7, 1), 30);
	return res.status(200).json({ forecast: review_forecast(user.id, days) });
});

// This route both returns and can set the new card daily limit for the user's
// deck.
router.post('/limit', async (req, res) => {
	const user = get_user_by_session(req.cookies?.session_id);
	if (!user) return res.status(401).json({ result: "not authenticated" });

	if ('value' in (req.body ?? {})) {
		const n = Number(req.body.value);
		if (!Number.isInteger(n) || n < 0 || n > 9999) {
			return res.status(400).json({ message: 'invalid value' });
		}
		set_new_cards_limit(user.id, n);
	}

	return res.status(200).json({ value: get_new_cards_limit(user.id) });
});

// To get leaderboard for the card view.
router.post('/leaderboard', async (req, res) => {
	const user = get_user_by_session(req.cookies?.session_id);

	if (!user)
		return res.status(401).json({ result: "not authenticated" });

	return res.status(200).json({ rows: leaderboard(user.id) });
});

// Paged list of the user's cards, newest first.
router.post('/list', async (req, res) => {
	const user = get_user_by_session(req.cookies?.session_id);
	if (!user) return res.status(401).json({ result: "not authenticated" });

	const lim = Number(req.body?.limit);
	const pg  = Number(req.body?.page);

	if (!Number.isInteger(lim) || lim < 1 || lim > MAX_LIMIT) {
		return res.status(400).json({ error: 'invalid limit' });
	}
	if (!Number.isInteger(pg) || pg < 0) {
		return res.status(400).json({ error: 'invalid page' });
	}

	const cards = get_cards(user.id, lim, pg);
	const count = count_cards(user.id);
	return res.status(200).json({ cards, count, page: pg, limit: lim });
});

// Edit the user-facing fields of one card.
router.post('/update', async (req, res) => {
	const user = get_user_by_session(req.cookies?.session_id);
	if (!user) return res.status(401).json({ result: "not authenticated" });

	const card_id = Number(req.body?.card_id);
	if (!Number.isInteger(card_id)) {
		return res.status(400).json({ error: 'invalid card_id' });
	}

	const word = req.body?.word;
	if (typeof word !== 'string' || word.trim() === '') {
		return res.status(400).json({ error: 'word must be a non-empty string' });
	}

	const reading = typeof req.body?.reading === 'string' ? req.body.reading : '';
	const phrase  = typeof req.body?.phrase  === 'string' ? req.body.phrase  : '';

	const meanings = Array.isArray(req.body?.meanings)
		? req.body.meanings.filter(m => typeof m === 'string' && m.trim() !== '')
		: [];

	try {
		const card = update_card(user.id, card_id, {
			word: word.trim(), reading, phrase, meanings,
		});
		if (!card) return res.status(404).json({ result: "card not found" });

		return res.status(200).json({ card });
	} catch (err) {
		if (String(err?.message ?? '').includes('UNIQUE')) {
			return res.status(409).json({
				message: 'a card with this word and reading already exists',
			});
		}
		throw err;
	}
});

// Delete one card (and its reviews).
router.post('/delete', async (req, res) => {
	const user = get_user_by_session(req.cookies?.session_id);
	if (!user) return res.status(401).json({ result: "not authenticated" });

	const card_id = Number(req.body?.card_id);
	if (!Number.isInteger(card_id)) {
		return res.status(400).json({ error: 'invalid card_id' });
	}

	const removed = delete_card(user.id, card_id);
	if (!removed) return res.status(404).json({ result: "card not found" });

	return res.status(200).json({ ok: true });
});

export default router;