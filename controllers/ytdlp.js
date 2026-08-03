import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const execFile = promisify(execFileCb);

// We fetch subtitles by using yt-dlp, we call it directly via exec. 
async function fetch_subs_once(url, lang) {
	const dir = await mkdtemp(path.join(tmpdir(), 'subs-'));

	try {
		await execFile('yt-dlp', [
			'-q', '--no-warnings', '--skip-download',
			'--write-subs', '--sub-langs', lang,
			'-P', dir, '-o', 'sub',
			url,
		]);

		const files = await readdir(dir);
		const vtt = files.find(f => f.endsWith('.vtt'));

		// No file written means no subtitle track, 
		// or at leadt nothing came back this try.
		if (!vtt) throw new Error('no subtitle file produced');

		const text = await readFile(path.join(dir, vtt), 'utf8');
		if (!text.trim()) throw new Error('subtitle file was empty');

		return text;
	} finally {
		await rm(dir, { recursive: true, force: true });   // Clean up always.
	}
}

// Fetch Japanese (by default) subtitles for a video.
// Retries attempts times. yt-dlp is (understandably...) non reliable.
async function get_video_subtitles(url, lang = 'ja', attempts = 3) {
	if (!/^[a-zA-Z0-9_-]+$/.test(lang)) {
		throw new Error('Invalid language code format');
	}

	let last_err;
	for (let i = 0; i < attempts; i++) {
		try {
			return await fetch_subs_once(url, lang);
		} catch (error) {
			last_err = error;
			console.error(`Subtitle fetch attempt ${i + 1}/${attempts} failed`);
			console.error(`\tMessage: ${error.message}`);

			if (i < attempts - 1) {
				await new Promise(r => setTimeout(r, 400 * (i + 1)));
			}
		}
	}

	throw new Error(`Could not fetch subtitles for language: ${lang}. Details: ${last_err?.message}`);
}

// Direct audio URL for a video. -f "wa" worst audio (small, speech is fine),
// -g prints the media URL without downloading. THE URL IS TEMPORARY! (and
// maybe IP bound?)
async function get_video_audio_url(url) {
	try {
		const { stdout } = await execFile('yt-dlp', [
			'-q', '--no-warnings',
			'-f', 'wa',
			'-g',
			url,
		]);

		const audio_url = stdout.trim();
		if (!audio_url) throw new Error('No audio URL returned.');

		return audio_url.split('\n')[0];
	} catch (error) {
		console.error('Failed to fetch audio URL');
		console.error(`\tExit Code: ${error.code}`);
		console.error(`\tMessage: ${error.message}`);
		throw new Error(`Could not fetch audio URL. Details: ${error.message}`);
	}
}

export { get_video_subtitles, get_video_audio_url };