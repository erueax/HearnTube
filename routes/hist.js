import express from 'express';
import {
	get_user_by_session,
	add_history, get_history, count_history,
	clear_history, delete_history_entry,
} from '../controllers/database.js';

const router = express.Router();

// To reject things that are not youtbe IDs.
const ID_RE = /^[\w-]{11}$/;
// Max page size cap.
const MAX_LIMIT = 20;

// Adds entry to the user's history.
router.post('/add', async (req, res) => {
	const user = get_user_by_session(req.cookies?.session_id);
	if (!user) return res.status(401).json({ result: "not authenticated" });

	const { video_id } = req.body ?? {};

	if (!ID_RE.test(video_id)) {
		return res.status(400).json({ error: 'invalid video_id' });
	}

	add_history(user.id, video_id);

	return res.status(200).json({ ok: true });
});

// Lists user's history.
router.post('/list', async (req, res) => {
	const user = get_user_by_session(req.cookies?.session_id);
	if (!user) return res.status(401).json({ result: "not authenticated" });

	const { limit, page } = req.body ?? {};

	const lim = Number(limit);
	const pg  = Number(page);

	if (!Number.isInteger(lim) || lim < 1 || lim > MAX_LIMIT) {
		return res.status(400).json({ error: 'invalid limit' });
	}

	if (!Number.isInteger(pg) || pg < 0) {
		return res.status(400).json({ error: 'invalid page' });
	}

	const history = get_history(user.id, lim, pg);
	const count   = count_history(user.id);

	return res.status(200).json({ history, count, page: pg, limit: lim });
});

// Delete one entry from the user's history.
router.post('/delete', async (req, res) => {
	const user = get_user_by_session(req.cookies?.session_id);
	if (!user) return res.status(401).json({ result: "not authenticated" });

	const { video_id } = req.body ?? {};
	if (!ID_RE.test(video_id)) {
		return res.status(400).json({ error: 'invalid video_id' });
	}

	const removed = delete_history_entry(user.id, video_id);
	return res.status(200).json({ ok: removed });
});

// Clear the user's entire history.
router.post('/clear', async (req, res) => {
	const user = get_user_by_session(req.cookies?.session_id);
	if (!user) return res.status(401).json({ result: "not authenticated" });

	clear_history(user.id);
	return res.status(200).json({ ok: true });
});

export default router;