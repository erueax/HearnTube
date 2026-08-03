import express from 'express';
import { 
	create_user, 
	authenticate_user, 
	create_session, 
	destroy_session, 
	delete_user_by_session,
	get_user_by_session,
	delete_other_sessions
} from '../controllers/database.js';

const router = express.Router();

router.post('/login', async (req, res) => {
	const { username, password } = req.body;

	if (!username || !password) {
		return res.status(400).json({ 
			message: "Username and password are required." 
		});
	}

	const user = await authenticate_user(username, password);

	if (!user) {
		console.log("Invalid credentials");
		return res.status(401).json({ message: "Invalid credentials." });
	}

	// Records user session in the session db table.
	const session_id = create_session(user.id);
	
	// Sends http only cookie that will be sent by the client on every request. 
	res.cookie('session_id', session_id, { 
		httpOnly: true, 
		sameSite: 'strict' 
	});

	return res.status(200).json({ redirect: "/app/home" });
});

router.post('/logout', async (req, res) => {
	const { effect_area } = req.body;
	let session_id = req.cookies?.session_id;

	if(effect_area === "this") {
		res.clearCookie('session_id', { httpOnly: true, sameSite: 'strict' });
		destroy_session(session_id);
	} 
	if(effect_area === "others") {
		/* 
		Was supposed to implement logging from other sessions here. 
		Forgot about it and did it via another post route.
		[TODO] if there is time available fix this...
		*/
	}
	
	return res.status(200).json({ message: "logout succesful" });
});

router.post('/register', async (req, res) => {
	const { username, email, password } = req.body;

	if (!username || !email || !password) {
		return res.status(400).json({ message: "All fields are required." });
	}

	let user_id;
	try {
		user_id = await create_user(username, email, password);
	} catch (err) {
		const msg = String(err?.message ?? '');
		if (msg.includes('users.username')) {
			return res.status(409).json({ message: "Username already exists." });
		}
		if (msg.includes('users.email')) {
			return res.status(409).json({ message: "Email already registered." });
		}
		throw err; 
	}

	const session_id = create_session(user_id, SESSION_TTL_MS);
	res.cookie('session_id', session_id, {
		httpOnly: true,
		sameSite: 'strict',
		maxAge: SESSION_TTL_MS,
	});

	return res.status(201).json({ redirect: "/app/home" });
});

router.post('/delete_account', async (req, res) => {
	let session_id = req.cookies?.session_id;

	console.log(`user in session ${session_id} wants to delete his account`);

	delete_user_by_session(session_id);

	res.clearCookie('session_id', { httpOnly: true, sameSite: 'strict' });

	return res.status(200).json({ redirect: "/app/home" });
});

router.post('/logout_others', async (req, res) => {
	const session_id = req.cookies?.session_id;
	const user = get_user_by_session(session_id);
	
	if (!user) 
		return res.status(401).json({ result: "not authenticated" });

	delete_other_sessions(user.id, session_id);
	return res.status(200).json({ message: 'other sessions ended' });
});

router.post('/me', async (req, res) => {
	const user = get_user_by_session(req.cookies?.session_id);
	if (!user) return res.status(401).json({ result: "not authenticated" });

	if (!user) 
		return res.status(401).json({ result: "not authenticated" });
	
	return res.status(200).json({ 
		user: { id: user.id, username: user.username } 
	});
});

export default router;