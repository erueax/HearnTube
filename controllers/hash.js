import argon2 from 'argon2';

// Simple module for creating and verifying hashes.

async function hash(plain) {
	return argon2.hash(plain, {
		type: argon2.argon2id,
		memoryCost: 19456, // 19 MiB as suggested by OWASP.
		timeCost: 2,
		parallelism: 1,
	});
}

async function verify_hash(plain, hash) {
	return argon2.verify(hash, plain);
}

export { hash, verify_hash }