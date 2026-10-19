require('dotenv').config();

module.exports = async (req, res) => {
    const diagnostics = {
        status: 'ok',
        timestamp: new Date().toISOString(),
        nodeVersion: process.version,
        env: {
            hasTursoUrl: Boolean(process.env.TURSO_DATABASE_URL),
            tursoUrl: process.env.TURSO_DATABASE_URL ? (process.env.TURSO_DATABASE_URL.substring(0, 15) + '...') : null,
            hasTursoToken: Boolean(process.env.TURSO_AUTH_TOKEN),
            hasSecretKey: Boolean(process.env.SECRET_KEY),
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
