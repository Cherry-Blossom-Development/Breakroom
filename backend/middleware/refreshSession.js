const jwt = require('jsonwebtoken');
const { extractToken } = require('../utilities/auth');

const SECRET_KEY = process.env.SECRET_KEY;
const COOKIE_MAX_AGE = 48 * 60 * 60 * 1000; // 48 hours in ms

/**
 * Sliding session middleware.
 * On every API request that carries a valid JWT, issue a fresh 48h token.
 * Web clients receive it via the refreshed cookie (automatic).
 * Mobile clients receive it via the X-New-Token response header.
 */
function refreshSession(req, res, next) {
    const token = extractToken(req);
    if (!token) return next();

    try {
        const payload = jwt.verify(token, SECRET_KEY);
        const newToken = jwt.sign({ username: payload.username }, SECRET_KEY, { expiresIn: '48h' });

        // Refresh cookie for web clients
        res.cookie('jwtToken', newToken, {
            maxAge: COOKIE_MAX_AGE,
            domain: process.env.NODE_ENV === 'production' ? '.prosaurus.com' : undefined,
            path: '/',
            httpOnly: false,
            secure: process.env.CORS_ORIGIN?.startsWith('https') || process.env.NODE_ENV === 'production',
            sameSite: 'lax'
        });

        // Send new token in header for mobile clients
        res.setHeader('X-New-Token', newToken);

        next();
    } catch (err) {
        // Token expired or invalid — let the route handler deal with it
        next();
    }
}

module.exports = refreshSession;
