require('dotenv').config();

module.exports = async (req, res) => {
    let googleCredsStatus = 'missing';
    let serviceAccountEmail = null;
    let googleParseError = null;

    if (process.env.GOOGLE_CREDENTIALS) {
        try {
            const parsed = typeof process.env.GOOGLE_CREDENTIALS === 'string' 
                ? JSON.parse(process.env.GOOGLE_CREDENTIALS) 
                : process.env.GOOGLE_CREDENTIALS;
            googleCredsStatus = 'valid_json';
            serviceAccountEmail = parsed.client_email || 'sin client_email';
        } catch (err) {
            googleCredsStatus = 'invalid_json';
            googleParseError = err.message;
        }
    }

    const diagnostics = {
        status: 'ok',
        timestamp: new Date().toISOString(),
        nodeVersion: process.version,
        env: {
            hasTursoUrl: Boolean(process.env.TURSO_DATABASE_URL),
            tursoUrl: process.env.TURSO_DATABASE_URL ? (process.env.TURSO_DATABASE_URL.substring(0, 15) + '...') : null,
            hasTursoToken: Boolean(process.env.TURSO_AUTH_TOKEN),
            hasSecretKey: Boolean(process.env.SECRET_KEY),
            hasGoogleCredentials: Boolean(process.env.GOOGLE_CREDENTIALS),
            googleCredentialsStatus: googleCredsStatus,
            serviceAccountEmail,
            googleParseError,
            isVercel: Boolean(process.env.VERCEL)
        }
    };

    try {
        const db = require('../database');
        diagnostics.dbLoaded = true;
        diagnostics.isTurso = Boolean(db && db.isTurso);
    } catch (dbErr) {
        diagnostics.dbLoaded = false;
        diagnostics.dbError = {
            message: dbErr.message,
            stack: dbErr.stack
        };
    }

    try {
        const app = require('../server');
        diagnostics.serverLoaded = true;
    } catch (srvErr) {
        diagnostics.serverLoaded = false;
        diagnostics.serverError = {
            message: srvErr.message,
            stack: srvErr.stack
        };
    }

    res.status(200).json(diagnostics);
};
