import express 			from 'express';
import path 			from 'node:path';
import cookie_parser 	from 'cookie-parser';
import helmet 			from 'helmet';

import log from './middlewares/logger.js';

import auth_router 	from './routes/auth.js';
import meda_router 	from './routes/meda.js';
import anlys_router from './routes/anlys.js';
import cards_router from './routes/cards.js';
import hist_router	from './routes/hist.js';

import { warmup as tokenizer_warmup } from './controllers/tokenizer.js';
import { attach_game } from './controllers/game.js';

tokenizer_warmup();

const app = express();
const PORT = process.env.PORT || 8080;

const SITE_DIR = path.join(import.meta.dirname, 'site'); // Landing page.
const APP_DIR  = path.join(import.meta.dirname, 'app'); // SPA assets.

// Security (helmet) and parsing middlewares.
app.use(helmet.contentSecurityPolicy({
	directives: {
		defaultSrc: ["'self'"],
		scriptSrc:	["'self'", 'https://www.youtube.com', 
			'https://s.ytimg.com'],
		frameSrc:	['https://www.youtube.com'],
		connectSrc:	["'self'", 'https://www.youtube.com', 'ws:', 'wss:'],  
		imgSrc:		["'self'", 'https://i.ytimg.com', 'data:'],
		mediaSrc:	["'self'", 'https://*.googlevideo.com'],
	},
}));
app.use(cookie_parser());	// For req.cookie.
app.use(express.json());
app.use(log);

// Static resources.
app.use(express.static(SITE_DIR)); 			// "marketing" site at '/'
app.use('/app', express.static(APP_DIR)); 	// SPA static assets

// Any /app/* path serves the app.
app.get(/^\/app(?:\/.*)?$/, (req, res) => {
	res.sendFile(path.join(APP_DIR, 'index.html'));
});

// Serves the presentation page.
app.get('/', (req, res) => {
    res.sendFile(path.join(SITE_DIR, 'index.html'));
});

// Any /* path (except for /app/*) redirects to /.
app.get(/^\/(?!app|api).*/, (req, res) => {
    res.redirect('/');
});

app.use('/api/auth', auth_router); // api for auth.

// API routes (all JSON, all under /api)
app.use('/api/meda', meda_router); 		// Api for video data and metadata.
app.use('/api/anlys', anlys_router); 	// Api for JP token. and dict. 
app.use('/api/cards', cards_router); 	// Api for card creation and review/
app.use('/api/hist', hist_router); 		// Api for watched video history.
app.use('/api', (req, res) => {			// Unmached API calls go here.
	res.status(404).json({ 
		message: 'Not found.' 
	});
});  

app.use((err, req, res, next) => {
	console.error(err);
	const code = err.status ?? err.statusCode ?? 500;
	res.status(code).json({ 
		message: err.expose ? err.message : 'Server error.' 
	});
});

const server = app.listen(PORT, () => {
	console.log(`server is listening on port ${PORT}...`);
});

attach_game(server);