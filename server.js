require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./database');
const crypto = require('crypto');
const generateId = () => crypto.randomUUID();
const jwt = require('jsonwebtoken');
const fs = require('fs');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const googleCalendar = require('./googleCalendar');

const helmet = require('helmet');

const app = express();
const PORT = process.env.PORT || 3000;
const isServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
const isProduction = isServerless || process.env.NODE_ENV === 'production';
const SECRET_KEY = process.env.SECRET_KEY || (isProduction ? null : 'dentadmin_dev_only_secret_no_usar_en_produccion');
if (!SECRET_KEY) {
    // Fail-closed: el valor por defecto está publicado en el repo y permitiría forjar tokens de administrador.
    throw new Error('SECRET_KEY no está configurada en el entorno de producción.');
}

process.on('unhandledRejection', (reason) => console.error('⚠️ Promesa rechazada sin capturar:', reason));

if (isServerless) app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').map(o => o.trim()).filter(Boolean);
app.use(cors({ origin: allowedOrigins.length ? allowedOrigins : false }));
app.use(express.json({ limit: '1mb' }));

const staticDir = process.env.VERCEL ? process.cwd() : __dirname;
const publicDir = path.join(staticDir, 'public');
// Solo /public: servir la raíz exponía server.js, dentadmin.sqlite y Pass/.
app.use(express.static(publicDir));

app.get('/', (req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
});

// Endpoint de diagnóstico de salud y conexión en la nube
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        database: db.isTurso ? 'turso_cloud' : (process.env.VERCEL ? 'turso_missing' : 'sqlite_local'),
        hasTursoUrl: Boolean(process.env.TURSO_DATABASE_URL),
        hasTursoToken: Boolean(process.env.TURSO_AUTH_TOKEN),
        hasGoogleCredentials: Boolean(process.env.GOOGLE_CREDENTIALS),
        time: new Date().toISOString()
    });
});

// ─── Autenticación y autorización ───
const ROLES = ['administrador', 'doctor', 'asistente', 'recepcion'];
const R = 'read';
const W = 'write';
// Espejo server-side de ROLES_PERMISSIONS (public/app.js). El administrador tiene acceso total.
const PERMISSIONS = {
    doctor: {
        pacientes: W, citas: W, historia: W, odontogramas: W, antecedentes: W, periodontogramas: W, ortodoncia: W,
        archivos: W, recetas: W, presupuestos: W, prestaciones: W, tratamientos_detalles: W, abonos_tratamientos: W,
        laboratorios_ordenes: W, pagos: W, tareas: W, sillones: R
    },
    asistente: {
        pacientes: W, citas: W, historia: R, odontogramas: R, antecedentes: R, periodontogramas: R, ortodoncia: R,
        archivos: W, inventario: W, laboratorios_ordenes: W, tareas: W, sillones: R, prestaciones: R, tratamientos_detalles: R
    },
    recepcion: {
        pacientes: W, citas: W, presupuestos: W, pagos: W, abonos_tratamientos: W, tratamientos_detalles: W,
        prestaciones: R, laboratorios_ordenes: W, tareas: W, sillones: R
    }
};

function can(rol, col, mode) {
    if (rol === 'administrador') return true;
    const level = (PERMISSIONS[rol] || {})[col];
    return level === W || (level === R && mode === R);
}
const forbidden = (res) => res.status(403).json({ error: 'Tu rol no tiene permiso para esta operación', code: 'FORBIDDEN' });
const authorize = (mode, ...fixedCols) => (req, res, next) => {
    const cols = fixedCols.length ? fixedCols : [req.params.col];
    return cols.every(col => can(req.user.rol, col, mode)) ? next() : forbidden(res);
};
const requireRole = (...roles) => (req, res, next) => (roles.includes(req.user.rol) ? next() : forbidden(res));

const USER_CACHE_TTL_MS = 60 * 1000;
const userCache = new Map();
async function getActiveUser(id) {
    const cached = userCache.get(id);
    if (cached && Date.now() - cached.at < USER_CACHE_TTL_MS) return cached.user;
    const user = await db.getAsync('SELECT id, username, rol FROM usuarios WHERE id = ?', [id]);
    userCache.set(id, { user, at: Date.now() });
    return user;
}

async function authenticateToken(req, res, next) {
    const [scheme, token] = (req.headers.authorization || '').split(' ');
    if (scheme !== 'Bearer' || !token) return res.status(401).json({ error: 'Requiere autenticación' });

    let payload;
    try {
        payload = jwt.verify(token, SECRET_KEY, { algorithms: ['HS256'] });
    } catch {
        return res.status(401).json({ error: 'Token inválido o expirado', code: 'INVALID_TOKEN' });
    }
    // Rol releído de BD: un usuario eliminado o degradado pierde acceso en <=60 s y no hasta que expire el JWT (12 h).
    const user = await getActiveUser(payload.id);
    if (!user) return res.status(401).json({ error: 'La cuenta ya no existe', code: 'INVALID_TOKEN' });
    req.user = user;
    next();
}

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILURES = 10;
// Por instancia serverless; limita fuerza bruta sin dependencias externas.
const loginFailures = new Map();
function isLoginLocked(key) {
    const entry = loginFailures.get(key);
    if (!entry) return false;
    if (Date.now() - entry.first > LOGIN_WINDOW_MS) {
        loginFailures.delete(key);
        return false;
    }
    return entry.count >= LOGIN_MAX_FAILURES;
}
function registerLoginFailure(key) {
    if (loginFailures.size > 10000) loginFailures.clear();
    const entry = loginFailures.get(key);
    if (!entry || Date.now() - entry.first > LOGIN_WINDOW_MS) loginFailures.set(key, { count: 1, first: Date.now() });
    else entry.count++;
}

const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cleanStr = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const SAFE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

// Servir la carpeta uploads (archivos legacy en disco)
const dataPath = process.env.CAREDENT_DATA_PATH || __dirname;
const uploadDir = isServerless ? path.join('/tmp', 'uploads') : path.join(dataPath, 'uploads');

try {
    if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
    }
} catch (err) {
    console.warn('Aviso: Directorio uploads omitido en filesystem de solo lectura:', err.message);
}

// Express decodifica %2F en params: sin esta guarda '..%2F..%2Fproc%2Fself%2Fenviron' filtraba los secretos.
function resolveUploadPath(filename) {
    if (typeof filename !== 'string' || !filename) return null;
    const root = path.resolve(uploadDir);
    const fullPath = path.resolve(root, path.basename(filename));
    return fullPath.startsWith(root + path.sep) ? fullPath : null;
}

const SAFE_MIME = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic', 'application/pdf']);
const MIME_EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp', 'image/heic': '.heic', 'application/pdf': '.pdf' };

// El tipo se deduce de los bytes, nunca del cliente: impide subir HTML/SVG que se ejecute en el origen de la app.
function detectMime(buf) {
    if (!buf || buf.length < 12) return null;
    const ascii = (start, end) => buf.subarray(start, end).toString('latin1');
    if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
    if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
    if (ascii(0, 4) === 'GIF8') return 'image/gif';
    if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
    if (ascii(0, 5) === '%PDF-') return 'application/pdf';
    if (ascii(4, 8) === 'ftyp' && /^(heic|heix|mif1|msf1|heif)$/.test(ascii(8, 12))) return 'image/heic';
    return null;
}

const FILE_URL_TTL_SEC = 12 * 3600;
const signFile = (id, exp) => crypto.createHmac('sha256', SECRET_KEY).update(`archivo:${id}:${exp}`).digest('base64url');
function signedFileUrl(id) {
    // Expiración redondeada a la hora: URL estable => el navegador reutiliza su caché y no relee Turso.
    const exp = Math.ceil((Date.now() / 1000 + FILE_URL_TTL_SEC) / 3600) * 3600;
    return `/api/archivos/${encodeURIComponent(id)}/ver?exp=${exp}&sig=${signFile(id, exp)}`;
}
function isValidFileSignature(id, exp, sig) {
    if (typeof exp !== 'string' || typeof sig !== 'string' || !/^\d+$/.test(exp)) return false;
    if (Number(exp) < Date.now() / 1000) return false;
    const expected = Buffer.from(signFile(id, exp));
    const given = Buffer.from(sig);
    return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

function sendStoredFile(res, row) {
    const buffer = Buffer.from(row.data, 'base64');
    const safeMime = SAFE_MIME.has(row.mime_type);
    res.setHeader('Content-Type', safeMime ? row.mime_type : 'application/octet-stream');
    res.setHeader('Content-Length', buffer.length);
    res.setHeader('Content-Disposition', `${safeMime ? 'inline' : 'attachment'}; filename="${encodeURIComponent(row.original_name || 'archivo')}"`);
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.send(buffer);
}

// <img> no puede enviar Authorization: el acceso se concede con URL firmada (HMAC) emitida en GET /api/archivos.
app.get('/api/archivos/:id/ver', async (req, res) => {
    if (!isValidFileSignature(req.params.id, req.query.exp, req.query.sig)) {
        return res.status(403).send('Enlace inválido o expirado');
    }
    const row = await db.getAsync('SELECT data, mime_type, original_name, filename FROM archivos WHERE id = ?', [req.params.id]);
    if (!row) return res.status(404).send('Archivo no encontrado');
    if (row.data) return sendStoredFile(res, row);

    const localPath = resolveUploadPath(row.filename);
    if (localPath && fs.existsSync(localPath)) return res.sendFile(localPath);
    res.status(404).send('Contenido no disponible');
});

// Rutas legacy /uploads: ahora requieren sesión (eran fotos clínicas públicas)
app.get('/uploads/:filename', authenticateToken, authorize(R, 'archivos'), async (req, res) => {
    const localFile = resolveUploadPath(req.params.filename);
    if (localFile && fs.existsSync(localFile)) return res.sendFile(localFile);

    const row = await db.getAsync('SELECT data, mime_type, original_name FROM archivos WHERE filename = ?', [path.basename(req.params.filename)]);
    if (row && row.data) return sendStoredFile(res, row);
    res.status(404).send('Archivo no encontrado');
});

// Colecciones válidas (usuarios se gestiona solo con rutas dedicadas: el CRUD genérico filtraba hashes)
const collections = ['pacientes', 'citas', 'pagos', 'historia', 'presupuestos', 'gastos', 'inventario', 'tareas', 'odontogramas', 'archivos', 'recetas', 'antecedentes', 'periodontogramas', 'ortodoncia', 'prestaciones', 'tratamientos_detalles', 'abonos_tratamientos', 'sillones', 'laboratorios_ordenes'];

// Vercel rechaza cuerpos > 4.5 MB: el límite real debe ser menor (las fotos optimizadas pesan < 200 KB).
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 }
});

// --- Login ---
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body || {};
    if (typeof username !== 'string' || typeof password !== 'string' || !username.trim() || !password) {
        return res.status(400).json({ error: 'Usuario y contraseña son obligatorios' });
    }
    const key = `${req.ip}|${username.trim().toLowerCase()}`;
    if (isLoginLocked(key)) {
        return res.status(429).json({ error: 'Demasiados intentos fallidos. Intenta de nuevo en 15 minutos.' });
    }

    const user = await db.getAsync('SELECT id, username, password AS hash, rol FROM usuarios WHERE username = ?', [username.trim()]);
    const match = user && user.hash ? await bcrypt.compare(password, user.hash) : false;
    if (!match) {
        registerLoginFailure(key);
        return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
    }
    loginFailures.delete(key);

    const token = jwt.sign({ id: user.id, username: user.username, rol: user.rol }, SECRET_KEY, { expiresIn: '12h', algorithm: 'HS256' });
    res.json({ success: true, token, user: { id: user.id, username: user.username, rol: user.rol } });
});

// --- Endpoint de Subida de Archivos a la Nube (Turso Cloud) ---
app.post('/api/upload', authenticateToken, authorize(W, 'archivos'), upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No se subió ningún archivo' });

    const paciente = cleanStr(req.body.paciente, 120);
    if (!paciente) {
        return res.status(400).json({ error: 'Falta especificar el paciente' });
    }
    const mimeType = detectMime(req.file.buffer);
    if (!mimeType) {
        return res.status(415).json({ error: 'Formato no permitido. Usa JPG, PNG, WEBP, GIF, HEIC o PDF.' });
    }
    const pacienteRow = await db.getAsync('SELECT id FROM pacientes WHERE LOWER(nombre) = LOWER(?)', [paciente]);
    if (!pacienteRow) return res.status(404).json({ error: 'El paciente no existe' });

    const archivo = {
        id: generateId(),
        nombre_paciente: paciente,
        original_name: path.basename(req.file.originalname || 'archivo').slice(0, 200),
        filename: `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${MIME_EXT[mimeType]}`,
        mime_type: mimeType,
        size_bytes: req.file.size || req.file.buffer.length,
        createdAt: new Date().toISOString()
    };

    // Un único INSERT (metadatos + binario): si la conexión se corta no quedan registros sin contenido ni archivos huérfanos.
    await db.runAsync(
        'INSERT INTO archivos (id, nombre_paciente, original_name, filename, data, mime_type, size_bytes, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [archivo.id, archivo.nombre_paciente, archivo.original_name, archivo.filename, req.file.buffer.toString('base64'), archivo.mime_type, archivo.size_bytes, archivo.createdAt]
    );
    res.json({ success: true, message: 'Archivo guardado permanentemente en la nube', archivo: { ...archivo, url: signedFileUrl(archivo.id) } });
});

// --- Integración con Asistente Virtual (Bot de Citas) ---
function hasValidBotKey(req) {
    const expected = process.env.BOT_API_KEY;
    if (!expected) {
        // Compatibilidad temporal con AsistDental: configurar BOT_API_KEY en ambos proyectos para cerrar el endpoint.
        console.warn('⚠️ BOT_API_KEY no configurada: /api/bot-cita acepta peticiones anónimas.');
        return true;
    }
    const given = req.get('x-bot-key') || req.query.key;
    if (typeof given !== 'string') return false;
    const a = crypto.createHash('sha256').update(given).digest();
    const b = crypto.createHash('sha256').update(expected).digest();
    return crypto.timingSafeEqual(a, b);
}

async function registrarCitaDesdeBot(input) {
    const nombre = cleanStr(input.nombre, 120);
    const fecha = cleanStr(input.fecha, 20);
    const hora = cleanStr(input.hora, 20);
    if (!nombre || !fecha || !hora) {
        const err = new Error('Faltan datos obligatorios (nombre, fecha u hora)');
        err.status = 400;
        throw err;
    }
    const googleEventId = cleanStr(input.google_event_id, 200) || null;

    const citaExistente = await db.getAsync(
        `SELECT * FROM citas WHERE (LOWER(nombre_paciente) = LOWER(?) AND fecha = ? AND hora = ?) OR (google_event_id IS NOT NULL AND google_event_id = ?)`,
        [nombre, fecha, hora, googleEventId || 'NONE']
    );
    if (citaExistente) return { cita: citaExistente, duplicada: true };

    const pacienteRow = await db.getAsync('SELECT id FROM pacientes WHERE LOWER(nombre) = LOWER(?)', [nombre]);
    const createdAt = new Date().toISOString();
    const nuevaCita = {
        id: generateId(),
        nombre_paciente: nombre,
        fecha,
        hora,
        motivo: cleanStr(input.motivo, 200) || 'Valoración General (Asistente Virtual)',
        estado: 'programada',
        doctor: cleanStr(input.doctor, 120) || 'Dra. Rosa Avila',
        id_sillon: cleanStr(input.id_sillon, 64) || 'sillon_1',
        google_event_id: googleEventId,
        createdAt
    };

    const statements = [];
    if (!pacienteRow) {
        statements.push({
            sql: 'INSERT INTO pacientes (id, nombre, telefono, correo, createdAt) VALUES (?, ?, ?, ?, ?)',
            args: [generateId(), nombre, cleanStr(input.telefono, 30), cleanStr(input.correo, 120), createdAt]
        });
    }
    statements.push({
        sql: 'INSERT INTO citas (id, nombre_paciente, fecha, hora, motivo, estado, doctor, id_sillon, google_event_id, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        args: [nuevaCita.id, nuevaCita.nombre_paciente, nuevaCita.fecha, nuevaCita.hora, nuevaCita.motivo, nuevaCita.estado, nuevaCita.doctor, nuevaCita.id_sillon, nuevaCita.google_event_id, nuevaCita.createdAt]
    });
    // Paciente + cita en una sola transacción: un corte no deja expedientes creados sin su cita.
    await db.batch(statements);
    return { cita: nuevaCita, duplicada: false };
}

// POST automático desde el chatbot
app.post('/api/bot-cita', async (req, res) => {
    if (!hasValidBotKey(req)) return res.status(401).json({ error: 'Clave de integración inválida' });
    try {
        const result = await registrarCitaDesdeBot(req.body || {});
        res.json({ success: true, ...result });
    } catch (err) {
        if (err.status === 400) return res.status(400).json({ error: err.message });
        throw err;
    }
});

// GET de 1 clic desde el correo de la doctora
app.get('/api/bot-cita', async (req, res) => {
    if (!hasValidBotKey(req)) return res.status(401).send('<h2>❌ Enlace no autorizado</h2>');
    let result;
    try {
        result = await registrarCitaDesdeBot(req.query || {});
    } catch (err) {
        if (err.status === 400) return res.status(400).send(`<h2>❌ Error al registrar cita: ${escapeHtml(err.message)}</h2>`);
        throw err;
    }
    const { cita, duplicada } = result;
    res.send(`<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Cita Registrada — DentAdmin</title>
  <style>
    body { font-family: system-ui, sans-serif; background: #eef4fb; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
    .card { background: #fff; padding: 32px; border-radius: 16px; box-shadow: 0 8px 24px rgba(0,0,0,0.1); max-width: 420px; text-align: center; }
    h2 { color: #2b6cb0; margin-top: 0; }
    p { color: #334155; margin: 8px 0; font-size: 15px; }
    .btn { display: inline-block; margin-top: 20px; padding: 12px 24px; background: #3b82f6; color: #fff; text-decoration: none; border-radius: 999px; font-weight: 600; }
  </style>
</head>
<body>
  <div class="card">
    <h2>${duplicada ? 'ℹ️ La cita ya estaba registrada' : '✅ Cita registrada en DentAdmin'}</h2>
    <p><strong>Paciente:</strong> ${escapeHtml(cita.nombre_paciente)}</p>
    <p><strong>Servicio:</strong> ${escapeHtml(cita.motivo)}</p>
    <p><strong>Fecha y Hora:</strong> ${escapeHtml(cita.fecha)} a las ${escapeHtml(cita.hora)}</p>
    <p><strong>Estado:</strong> Pendiente</p>
    <a class="btn" href="/">Abrir Panel DentAdmin</a>
  </div>
</body>
</html>`);
});

// --- A partir de aquí toda ruta /api/* exige JWT válido ---
app.use('/api', authenticateToken);

// Endpoints de Sincronización con Google Calendar (antes eran públicos: cualquiera disparaba escrituras y cuota de Google)
const syncCalendar = async (req, res) => {
    const src = req.method === 'GET' ? req.query : (req.body || {});
    const result = await googleCalendar.syncGoogleEventsToDb(db, src.timeMin, src.timeMax);
    res.json(result);
};
app.post('/api/calendar/sync', authorize(W, 'citas'), syncCalendar);
app.get('/api/calendar/sync', authorize(W, 'citas'), syncCalendar);

// --- Gestión de usuarios: exclusivo de administrador ---
app.get('/api/usuarios', requireRole('administrador'), async (req, res) => {
    res.json(await db.allAsync('SELECT id, username, rol FROM usuarios'));
});

app.post('/api/usuarios', requireRole('administrador'), async (req, res) => {
    const username = cleanStr(req.body.username, 60);
    const { password, rol } = req.body || {};
    if (!username || typeof password !== 'string' || !rol) {
        return res.status(400).json({ error: 'Todos los campos son obligatorios (usuario, contraseña y rol)' });
    }
    if (!ROLES.includes(rol)) return res.status(400).json({ error: 'Rol no válido' });
    if (password.length < 6) {
        return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
    }

    const existing = await db.getAsync('SELECT id FROM usuarios WHERE LOWER(username) = LOWER(?)', [username]);
    if (existing) {
        return res.status(400).json({ error: `El nombre de usuario "${username}" ya está registrado. Por favor elija otro.` });
    }

    const id = generateId();
    const hash = await bcrypt.hash(password, 10);
    await db.runAsync('INSERT INTO usuarios (id, username, password, rol) VALUES (?, ?, ?, ?)', [id, username, hash, rol]);
    res.json({ id, username, rol });
});

app.put('/api/usuarios/:id', requireRole('administrador'), async (req, res) => {
    const username = cleanStr(req.body.username, 60);
    const { password, rol } = req.body || {};
    if (!username || !rol) {
        return res.status(400).json({ error: 'Usuario y rol son obligatorios' });
    }
    if (!ROLES.includes(rol)) return res.status(400).json({ error: 'Rol no válido' });
    if (req.params.id === req.user.id && rol !== 'administrador') {
        return res.status(400).json({ error: 'No puedes quitarte el rol de administrador a ti mismo' });
    }

    const existing = await db.getAsync('SELECT id FROM usuarios WHERE LOWER(username) = LOWER(?) AND id != ?', [username, req.params.id]);
    if (existing) {
        return res.status(400).json({ error: `El nombre de usuario "${username}" ya está en uso por otra cuenta.` });
    }

    let result;
    if (typeof password === 'string' && password.trim().length > 0) {
        if (password.length < 6) {
            return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
        }
        const hash = await bcrypt.hash(password, 10);
        result = await db.runAsync('UPDATE usuarios SET username = ?, password = ?, rol = ? WHERE id = ?', [username, hash, rol, req.params.id]);
    } else {
        result = await db.runAsync('UPDATE usuarios SET username = ?, rol = ? WHERE id = ?', [username, rol, req.params.id]);
    }
    if (!result.changes) return res.status(404).json({ error: 'Usuario no encontrado' });
    userCache.delete(req.params.id);
    res.json({ success: true, id: req.params.id, username, rol });
});

app.delete('/api/usuarios/:id', requireRole('administrador'), async (req, res) => {
    if (req.params.id === req.user.id) {
        return res.status(400).json({ error: 'No puedes eliminar tu propia cuenta' });
    }
    const result = await db.runAsync('DELETE FROM usuarios WHERE id = ?', [req.params.id]);
    if (!result.changes) return res.status(404).json({ error: 'Usuario no encontrado' });
    userCache.delete(req.params.id);
    res.json({ success: true });
});

// --- Operaciones financieras / inventario atómicas ---
// Abono = UPDATE saldo + INSERT abono + INSERT pago en una transacción (antes eran 3 fetch independientes desde el navegador).
app.post('/api/tratamientos_detalles/:id/abonos', authorize(W, 'tratamientos_detalles', 'abonos_tratamientos', 'pagos'), async (req, res) => {
    const monto = Number(req.body.monto);
    if (!Number.isFinite(monto) || monto <= 0) return res.status(400).json({ error: 'El monto debe ser mayor a 0' });

    const item = await db.getAsync('SELECT * FROM tratamientos_detalles WHERE id = ?', [req.params.id]);
    if (!item) return res.status(404).json({ error: 'Tratamiento no encontrado' });

    const total = Number(item.total || item.precio || 0);
    const saldo = total - Number(item.pagado || 0);
    if (monto > saldo + 0.009) {
        return res.status(400).json({ error: `El abono excede el saldo pendiente ($${saldo.toFixed(2)})` });
    }

    const createdAt = new Date().toISOString();
    const fecha = /^\d{4}-\d{2}-\d{2}$/.test(req.body.fecha) ? req.body.fecha : createdAt.slice(0, 10);
    const metodo = cleanStr(req.body.metodo, 40) || 'Efectivo';
    const doctor = cleanStr(req.body.doctor, 120);
    const abono = await pickColumns('abonos_tratamientos', {
        id: generateId(), id_tratamiento_detalle: item.id, nombre_paciente: item.nombre_paciente, diente: item.diente,
        cara: item.cara, prestacion_nombre: item.nombre_prestacion, monto, metodo, doctor, fecha,
        notas: cleanStr(req.body.notas, 500), createdAt
    });
    const pago = await pickColumns('pagos', {
        id: generateId(), nombre_paciente: item.nombre_paciente, monto,
        concepto: `Abono Pieza #${item.diente}: ${item.nombre_prestacion}`, metodo, doctor, fecha, createdAt
    });

    await db.batch([
        {
            // Incremento atómico en SQL: dos cajas cobrando a la vez no se pisan el saldo.
            sql: 'UPDATE tratamientos_detalles SET pagado = COALESCE(pagado, 0) + ?, liquidado = CASE WHEN COALESCE(pagado, 0) + ? >= ? THEN 1 ELSE 0 END WHERE id = ?',
            args: [monto, monto, total, item.id]
        },
        insertStatement('abonos_tratamientos', abono),
        insertStatement('pagos', pago)
    ]);

    const tratamiento = await db.getAsync('SELECT rowid, * FROM tratamientos_detalles WHERE id = ?', [item.id]);
    res.json({ success: true, tratamiento, abono, pago });
});

app.post('/api/inventario/movimiento', authorize(W, 'inventario'), async (req, res) => {
    const insumo = cleanStr(req.body.insumo, 120);
    const tipo = req.body.tipo === 'ingreso' ? 'ingreso' : 'egreso';
    const cantidad = Number.parseInt(req.body.cantidad, 10);
    if (!insumo || !Number.isInteger(cantidad) || cantidad <= 0) {
        return res.status(400).json({ error: 'Insumo y cantidad (> 0) son obligatorios' });
    }
    const fecha = /^\d{4}-\d{2}-\d{2}$/.test(req.body.fecha) ? req.body.fecha : new Date().toISOString().slice(0, 10);

    const existing = await db.getAsync('SELECT id FROM inventario WHERE LOWER(insumo) = LOWER(?)', [insumo]);
    let id;
    if (existing) {
        id = existing.id;
        await db.runAsync(
            `UPDATE inventario SET stock = CASE WHEN ? = 'ingreso' THEN COALESCE(stock, 0) + ? ELSE MAX(0, COALESCE(stock, 0) - ?) END,
             ultimo_tipo = ?, ultimo_qty = ?, fecha = ? WHERE id = ?`,
            [tipo, cantidad, cantidad, tipo, cantidad, fecha, id]
        );
    } else {
        id = generateId();
        await db.runAsync(
            'INSERT INTO inventario (id, insumo, stock, ultimo_tipo, ultimo_qty, fecha, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [id, insumo, tipo === 'ingreso' ? cantidad : 0, tipo, cantidad, fecha, new Date().toISOString()]
        );
    }
    res.json(await db.getAsync('SELECT rowid, * FROM inventario WHERE id = ?', [id]));
});

// --- Endpoints REST genéricos ---
const columnCache = new Map();
async function getColumns(col) {
    if (!columnCache.has(col)) {
        const rows = await db.allAsync(`PRAGMA table_info(${col})`);
        columnCache.set(col, new Set(rows.map(r => r.name)));
    }
    return columnCache.get(col);
}

// Whitelist de columnas reales: las claves del body ya no se interpolan en SQL (antes era inyección SQL vía nombres de campo).
async function pickColumns(col, body) {
    const columns = await getColumns(col);
    const out = {};
    for (const [key, value] of Object.entries(body || {})) {
        if (!columns.has(key) || value === undefined) continue;
        out[key] = value !== null && typeof value === 'object' ? JSON.stringify(value) : value;
    }
    return out;
}

function insertStatement(col, data) {
    const keys = Object.keys(data);
    return { sql: `INSERT INTO ${col} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`, args: Object.values(data) };
}

const validCollection = (req, res, next) => (collections.includes(req.params.col) ? next() : res.status(400).json({ error: 'Colección no válida' }));
// archivos solo se escribe vía /api/upload: por el CRUD genérico se podía inyectar filename/data arbitrarios.
const blockArchivosWrite = (req, res, next) => (req.params.col === 'archivos' ? res.status(405).json({ error: 'Usa /api/upload para archivos' }) : next());

const ARCHIVO_META = 'id, nombre_paciente, original_name, filename, mime_type, size_bytes, createdAt';

function citaGoogleText(c) {
    return {
        summary: `Cita: ${c.nombre_paciente} - ${c.motivo || 'Consulta'}`,
        description: `Paciente: ${c.nombre_paciente}\nDoctor(a): ${c.doctor || 'Dra. Rosa Avila'}\nSillón: ${c.id_sillon || 'Sillón 1'}\nEstado: ${c.estado || 'programada'}`
    };
}

async function linkGoogleEvent(cita) {
    const result = await googleCalendar.createCalendarEvent({ ...citaGoogleText(cita), fecha: cita.fecha, hora: cita.hora });
    if (!result || !result.success || !result.eventId) return null;
    try {
        await db.runAsync('UPDATE citas SET google_event_id = ? WHERE id = ?', [result.eventId, cita.id]);
        return result.eventId;
    } catch (err) {
        // Compensación: sin vínculo en BD el evento quedaría huérfano en el calendario de la doctora.
        console.error('No se pudo vincular google_event_id, revirtiendo evento:', err.message);
        await googleCalendar.deleteCalendarEvent(result.eventId);
        return null;
    }
}

// GET (Todos los registros de una colección)
app.get('/api/:col', validCollection, authorize(R), async (req, res) => {
    const col = req.params.col;
    if (col === 'archivos') {
        const rows = await db.allAsync(`SELECT ${ARCHIVO_META} FROM archivos`);
        return res.json(rows.map(r => ({ ...r, url: signedFileUrl(r.id) })));
    }
    res.json(await db.allAsync(`SELECT rowid, * FROM ${col}`));
});

// GET (Obtener un registro por ID)
app.get('/api/:col/:id', validCollection, authorize(R), async (req, res) => {
    const col = req.params.col;
    const row = col === 'archivos'
        ? await db.getAsync(`SELECT ${ARCHIVO_META} FROM archivos WHERE id = ?`, [req.params.id])
        : await db.getAsync(`SELECT rowid, * FROM ${col} WHERE id = ?`, [req.params.id]);
    if (!row) return res.status(404).json({ error: 'No encontrado' });
    res.json(col === 'archivos' ? { ...row, url: signedFileUrl(row.id) } : row);
});

// POST (Crear registro)
app.post('/api/:col', validCollection, blockArchivosWrite, authorize(W), async (req, res) => {
    const col = req.params.col;
    const body = req.body || {};
    const data = await pickColumns(col, { createdAt: new Date().toISOString(), ...body });
    // Los ids terminan en atributos onclick del frontend: solo se aceptan ids con caracteres seguros.
    data.id = typeof data.id === 'string' && SAFE_ID_RE.test(data.id) ? data.id : generateId();

    await db.runAsync(insertStatement(col, data).sql, Object.values(data));

    // Primero la BD y después Google: si el INSERT falla no queda un evento huérfano en el calendario.
    if (col === 'citas' && data.fecha && data.hora && body.syncGoogle !== false) {
        const eventId = await linkGoogleEvent(data);
        if (eventId) data.google_event_id = eventId;
    }
    res.json(data);
});

// PUT (Actualizar registro)
app.put('/api/:col/:id', validCollection, blockArchivosWrite, authorize(W), async (req, res) => {
    const col = req.params.col;
    const data = await pickColumns(col, req.body);
    delete data.id;
    const keys = Object.keys(data);
    if (keys.length === 0) return res.status(400).json({ error: 'Sin datos para actualizar' });

    const previous = col === 'citas' && (data.fecha || data.hora)
        ? await db.getAsync('SELECT * FROM citas WHERE id = ?', [req.params.id])
        : null;

    const result = await db.runAsync(
        `UPDATE ${col} SET ${keys.map(k => `${k} = ?`).join(', ')} WHERE id = ?`,
        [...Object.values(data), req.params.id]
    );
    if (result.changes === 0) return res.status(404).json({ error: 'No encontrado o sin cambios' });

    // Reprogramación: mantener Google Calendar alineado (antes la cita quedaba en la hora vieja en el celular de la doctora).
    const rescheduled = previous && ((data.fecha && data.fecha !== previous.fecha) || (data.hora && data.hora !== previous.hora));
    if (rescheduled && previous.google_event_id) {
        const merged = { ...previous, ...data };
        await googleCalendar.updateCalendarEvent(previous.google_event_id, { ...citaGoogleText(merged), fecha: merged.fecha, hora: merged.hora });
    }
    res.json({ success: true });
});

// DELETE (Eliminar registro)
app.delete('/api/:col/:id', validCollection, authorize(W), async (req, res) => {
    const col = req.params.col;
    const cita = col === 'citas'
        ? await db.getAsync('SELECT google_event_id FROM citas WHERE id = ?', [req.params.id])
        : null;

    const result = await db.runAsync(`DELETE FROM ${col} WHERE id = ?`, [req.params.id]);
    if (result.changes === 0) return res.status(404).json({ error: 'No encontrado' });

    // Se espera la llamada: en serverless una promesa suelta se congela al responder y el evento nunca se borraba.
    if (cita && cita.google_event_id) await googleCalendar.deleteCalendarEvent(cita.google_event_id);
    res.json({ success: true });
});

// Middleware global de captura de errores (Express 5 enruta aquí los rechazos de handlers async)
app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
        return res.status(status).json({ error: status === 413 ? 'El archivo supera 4 MB' : err.message });
    }
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Petición demasiado grande' });
    console.error('⚠️ Error capturado en Express:', err);
    if (res.headersSent) return next(err);
    res.status(500).json({
        error: 'Error interno del servidor',
        // En producción no se exponen mensajes de SQLite/Turso (revelan esquema).
        message: isProduction ? undefined : err.message
    });
});

if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`Servidor DentAdmin (Backend Real) corriendo en http://localhost:${PORT}`);
    });
}

module.exports = app;
