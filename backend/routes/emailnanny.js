const express = require('express');
const router = express.Router();

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

// Allow requests from any Chrome extension origin
router.use((req, res, next) => {
    const origin = req.headers.origin || '';
    if (origin.startsWith('chrome-extension://')) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
});

router.post('/token', async (req, res) => {
    const { code, redirect_uri, code_verifier } = req.body;
    if (!code || !redirect_uri || !code_verifier) {
        return res.status(400).json({ error: 'Missing required fields' });
    }
    try {
        const response = await fetch(TOKEN_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: process.env.EMAILNANNY_CLIENT_ID,
                client_secret: process.env.EMAILNANNY_CLIENT_SECRET,
                redirect_uri,
                grant_type: 'authorization_code',
                code,
                code_verifier
            })
        });
        const data = await response.json();
        if (!response.ok) return res.status(response.status).json(data);
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: 'Token exchange failed' });
    }
});

router.post('/refresh', async (req, res) => {
    const { refresh_token } = req.body;
    if (!refresh_token) {
        return res.status(400).json({ error: 'Missing refresh_token' });
    }
    try {
        const response = await fetch(TOKEN_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: process.env.EMAILNANNY_CLIENT_ID,
                client_secret: process.env.EMAILNANNY_CLIENT_SECRET,
                grant_type: 'refresh_token',
                refresh_token
            })
        });
        const data = await response.json();
        if (!response.ok) return res.status(response.status).json(data);
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: 'Token refresh failed' });
    }
});

module.exports = router;
