require('dotenv').config();

module.exports = async (req, res) => {
    let googleCredsStatus = 'missing';

    if (process.env.GOOGLE_CREDENTIALS) {
        try {
            const parsed = typeof process.env.GOOGLE_CREDENTIALS === 'string' 
                ? JSON.parse(process.env.GOOGLE_CREDENTIALS) 
                : process.env.GOOGLE_CREDENTIALS;
            googleCredsStatus = parsed.client_email ? 'valid_json' : 'missing_client_email';
        } catch (err) {
            googleCredsStatus = 'invalid_json';
        }
    }

    // Endpoint público: solo booleanos, nunca stacks, URLs ni cuentas de servicio.
    const diagnostics = {
        status: 'ok',
        timestamp: new Date().toISOString(),
        env: {
            hasTursoUrl: Boolean(process.env.TURSO_DATABASE_URL),
            hasTursoToken: Boolean(process.env.TURSO_AUTH_TOKEN),
            hasSecretKey: Boolean(process.env.SECRET_KEY),
            hasBotApiKey: Boolean(process.env.BOT_API_KEY),
            hasGoogleCredentials: Boolean(process.env.GOOGLE_CREDENTIALS),
            googleCredentialsStatus: googleCredsStatus,
            isVercel: Boolean(process.env.VERCEL)
        }
    };

    try {
        const db = require('../database');
        diagnostics.dbLoaded = true;
        diagnostics.isTurso = Boolean(db && db.isTurso);
    } catch (dbErr) {
        console.error('health: database.js no cargó:', dbErr);
        diagnostics.dbLoaded = false;
    }

    try {
        require('../server');
        diagnostics.serverLoaded = true;
    } catch (srvErr) {
        console.error('health: server.js no cargó:', srvErr);
        diagnostics.serverLoaded = false;
    }

    res.status(200).json(diagnostics);
};
