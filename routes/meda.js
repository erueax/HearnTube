import express from 'express';
import { 
	get_video_subtitles, get_video_audio_url 
} from '../controllers/ytdlp.js';

// meda is short fot MEta DAta (could't come up with an actually good 
// abbreviation). This meta data are the ones extracted from youtube videos;
// mostly subtitles needed for the player.
// Now also audio for cards.

const router = express.Router();

router.post('/subtitles', async (req, res) => {
	const { address } = req.body;

	let subtitles = await (get_video_subtitles(address));
	if(!subtitles) res.status(404).json({ subtitles: subtitles });

	return res.status(200).json({ subtitles: subtitles });
});

router.post('/audio', async (req, res) => {
	const { address } = req.body;

	const audio_url = await get_video_audio_url(address);
	
	return res.status(200).json({ audio_url });
});

export default router;