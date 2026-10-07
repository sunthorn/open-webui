// Temporary-password generator for admin-created accounts.
// Look-alike characters (0 O o 1 l I) are excluded so the password can be
// read aloud or copied by hand without ambiguity.

const LOWER = 'abcdefghijkmnpqrstuvwxyz';
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const DIGITS = '23456789';

export const PASSWORD_ALPHABET = LOWER + UPPER + DIGITS;
export const GENERATED_PASSWORD_LENGTH = 12;

/** Unbiased random integer in [0, max) from crypto.getRandomValues (rejection sampling). */
const randomIndex = (max: number): number => {
	const limit = Math.floor(0x100000000 / max) * max;
	const buf = new Uint32Array(1);
	do {
		crypto.getRandomValues(buf);
	} while (buf[0] >= limit);
	return buf[0] % max;
};

const pick = (chars: string): string => chars[randomIndex(chars.length)];

/** 12 chars; always at least one lowercase, one uppercase and one digit. */
export const generatePassword = (length: number = GENERATED_PASSWORD_LENGTH): string => {
	const chars = [pick(LOWER), pick(UPPER), pick(DIGITS)];
	while (chars.length < length) chars.push(pick(PASSWORD_ALPHABET));

	// Fisher–Yates so the guaranteed characters are not always up front.
	for (let i = chars.length - 1; i > 0; i--) {
		const j = randomIndex(i + 1);
		[chars[i], chars[j]] = [chars[j], chars[i]];
	}
	return chars.join('');
};
