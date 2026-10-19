require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./database');
const crypto = require('crypto');
const generateId = () => crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 15);
const jwt = require('jsonwebtoken');
const fs = require('fs');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const googleCalendar = require('./googleCalendar');

const helmet = require('helmet');

const app = express();
const PORT = process.env.PORT || 3000;
const SECRET_KEY = process.env.SECRET_KEY || 'dentadmin_secret_super_seguro';

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json());

const staticDir = process.env.VERCEL ? process.cwd() : __dirname;
const publicDir = path.join(staticDir, 'public');
if (fs.existsSync(publicDir)) {
    app.use(express.static(publicDir));
}
app.use(express.static(staticDir));

// Ruta raíz garantizada
app.get('/', (req, res) => {
    const htmlPath = fs.existsSync(path.join(publicDir, 'index.html')) 
        ? path.join(publicDir, 'index.html') 
        : path.join(staticDir, 'index.html');
    res.sendFile(htmlPath);
});

// Endpoint de diagnóstico de salud y conexión en la nube
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        database: db.isTurso ? 'turso_cloud' : (process.env.VERCEL ? 'turso_missing' : 'sqlite_local'),
        hasTursoUrl: Boolean(process.env.TURSO_DATABASE_URL),
        hasTursoToken: Boolean(process.env.TURSO_AUTH_TOKEN),
        hasGoogleCredentials: Boolean(process.env.GOOGLE_CREDENTIALS),
        doctorCalendarEmail: googleCalendar.CALENDAR_ID,
        time: new Date().toISOString()
    });
});

// Endpoints de Sincronización con Google Calendar
app.post('/api/calendar/sync', async (req, res) => {
    try {
        const result = await googleCalendar.syncGoogleEventsToDb(db, req.body.timeMin, req.body.timeMax);
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/calendar/sync', async (req, res) => {
    try {
        const result = await googleCalendar.syncGoogleEventsToDb(db, req.query.timeMin, req.query.timeMax);
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Servir la carpeta uploads estáticamente para ver las imágenes
const dataPath = process.env.CAREDENT_DATA_PATH || __dirname;
const isServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
const uploadDir = isServerless ? path.join('/tmp', 'uploads') : path.join(dataPath, 'uploads');

try {
    if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
    }
} catch (err) {
    console.warn('Aviso: Directorio uploads omitido en filesystem de solo lectura:', err.message);
}

// Servir uploads estáticamente si existen en disco local
app.use('/uploads', express.static(uploadDir));

// Endpoint para servir imágenes/archivos guardados permanentemente en Turso Cloud
app.get('/api/archivos/:id/ver', (req, res) => {
    db.get('SELECT data, mime_type, original_name, filename FROM archivos WHERE id = ?', [req.params.id], (err, row) => {
        if (err) return res.status(500).send('Error en base de datos');
        if (!row) return res.status(404).send('Archivo no encontrado');

        if (row.data) {
            const buffer = Buffer.from(row.data, 'base64');
            res.setHeader('Content-Type', row.mime_type || 'image/jpeg');
            res.setHeader('Content-Length', buffer.length);
            res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(row.original_name || 'archivo')}"`);
            res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache navegador 24h
            return res.send(buffer);
        }

        // Fallback para archivos legacy en disco
        if (row.filename) {
            const localPath = path.join(uploadDir, row.filename);
            if (fs.existsSync(localPath)) return res.sendFile(localPath);
        }
        res.status(404).send('Contenido no disponible');
    });
});

// Compatibilidad con rutas directas /uploads/:filename (busca en disco o en Turso)
app.get('/uploads/:filename', (req, res) => {
    const localFile = path.join(uploadDir, req.params.filename);
    if (fs.existsSync(localFile)) {
        return res.sendFile(localFile);
    }
    db.get('SELECT data, mime_type, original_name FROM archivos WHERE filename = ?', [req.params.filename], (err, row) => {
        if (!err && row && row.data) {
            const buffer = Buffer.from(row.data, 'base64');
            res.setHeader('Content-Type', row.mime_type || 'image/jpeg');
            res.setHeader('Content-Length', buffer.length);
            res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(row.original_name || 'archivo')}"`);
            res.setHeader('Cache-Control', 'public, max-age=86400');
            return res.send(buffer);
        }
        res.status(404).send('Archivo no encontrado');
    });
});

// Colecciones válidas
const collections = ['pacientes', 'citas', 'pagos', 'historia', 'presupuestos', 'gastos', 'inventario', 'tareas', 'odontogramas', 'archivos', 'recetas', 'usuarios', 'antecedentes', 'periodontogramas', 'ortodoncia', 'prestaciones', 'tratamientos_detalles', 'abonos_tratamientos', 'sillones', 'laboratorios_ordenes'];

// Configuración de Multer en Memoria (Directo a Turso Cloud sin depender de /tmp efímero)
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 25 * 1024 * 1024 } // 25 MB máx (las imágenes optimizadas pesarán < 200 KB)
});

// --- Login ---
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    db.get(`SELECT id, username, password as hash, rol FROM usuarios WHERE username = ?`, [username], async (err, user) => {
        if (err) return res.status(500).json({ error: 'Error del servidor' });
        if (!user) return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
        
        const match = await bcrypt.compare(password, user.hash);
        if (!match) return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
        
        const token = jwt.sign({ id: user.id, username: user.username, rol: user.rol }, SECRET_KEY, { expiresIn: '12h' });
        res.json({ success: true, token, user: { id: user.id, username: user.username, rol: user.rol } });
    });
});

// Middleware de autenticación
const authenticateToken = (req, res, next) => {
    // Permitir /api/seed temporalmente si se quiere inicializar (opcional)
    if (req.path === '/api/seed') return next();
    
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (token == null) return res.status(401).json({ error: 'Requiere autenticación' });

    jwt.verify(token, SECRET_KEY, (err, user) => {
        if (err) return res.status(403).json({ error: 'Token inválido o expirado', code: 'INVALID_TOKEN' });
        req.user = user;
        next();
    });
};

// --- Endpoint de Subida de Archivos a la Nube (Turso Cloud) ---
app.post('/api/upload', authenticateToken, upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No se subió ningún archivo' });
    
    const paciente = req.body.paciente;
    if (!paciente) {
        return res.status(400).json({ error: 'Falta especificar el paciente' });
    }

    const fileId = generateId();
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const filename = uniqueSuffix + path.extname(req.file.originalname);
    const base64Data = req.file.buffer.toString('base64');
    const mimeType = req.file.mimetype || 'image/jpeg';
    const sizeBytes = req.file.size || req.file.buffer.length;

    const archivoData = {
        id: fileId,
        nombre_paciente: paciente,
        original_name: req.file.originalname,
        filename: filename,
        data: base64Data,
        mime_type: mimeType,
        size_bytes: sizeBytes,
        createdAt: new Date().toISOString()
    };

    const keys = Object.keys(archivoData);
    const placeholders = keys.map(() => '?').join(',');
    const values = Object.values(archivoData);

    db.run(`INSERT INTO archivos (${keys.join(',')}) VALUES (${placeholders})`, values, function(err) {
        if (err) return res.status(500).json({ error: err.message });
        
        // Respuesta ligera: omitir 'data' en el JSON de confirmación
        const resArchivo = { ...archivoData };
        delete resArchivo.data;
        res.json({ success: true, message: 'Archivo guardado permanentemente en la nube', archivo: resArchivo });
    });
});

// --- Integración con Asistente Virtual (Bot de Citas) ---
function registrarCitaDesdeBot({ nombre, telefono, correo, fecha, hora, motivo, doctor, id_sillon, google_event_id }, callback) {
    if (!nombre || !fecha || !hora) {
        return callback(new Error('Faltan datos obligatorios (nombre, fecha u hora)'));
    }
    const createdAt = new Date().toISOString();
    const docName = doctor || 'Dra. Rosa Avila';
    const sillonId = id_sillon || 'sillon_1';

    // 1. Verificar o crear el paciente
    db.get(`SELECT id FROM pacientes WHERE LOWER(nombre) = LOWER(?)`, [nombre.trim()], (err, pacienteRow) => {
        if (err) return callback(err);

        const insertarCita = (pacId) => {
            // 2. Evitar duplicados exactos
            db.get(
                `SELECT * FROM citas WHERE (LOWER(nombre_paciente) = LOWER(?) AND fecha = ? AND hora = ?) OR (google_event_id IS NOT NULL AND google_event_id = ?)`,
                [nombre.trim(), fecha, hora, google_event_id || 'NONE'],
                (err2, citaExistente) => {
                    if (err2) return callback(err2);
                    if (citaExistente) {
                        return callback(null, { cita: citaExistente, duplicada: true });
                    }

                    const nuevaCita = {
                        id: generateId(),
                        nombre_paciente: nombre.trim(),
                        fecha,
                        hora,
                        motivo: motivo || 'Valoración General (Asistente Virtual)',
                        estado: 'programada',
                        doctor: docName,
                        id_sillon: sillonId,
                        google_event_id: google_event_id || null,
                        createdAt
                    };
                    db.run(
                        `INSERT INTO citas (id, nombre_paciente, fecha, hora, motivo, estado, doctor, id_sillon, google_event_id, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        [nuevaCita.id, nuevaCita.nombre_paciente, nuevaCita.fecha, nuevaCita.hora, nuevaCita.motivo, nuevaCita.estado, nuevaCita.doctor, nuevaCita.id_sillon, nuevaCita.google_event_id, nuevaCita.createdAt],
                        (err3) => {
                            if (err3) return callback(err3);
                            callback(null, { cita: nuevaCita, duplicada: false });
                        }
                    );
                }
            );
        };

        if (!pacienteRow) {
            const nuevoPacId = generateId();
            db.run(
                `INSERT INTO pacientes (id, nombre, telefono, correo, createdAt) VALUES (?, ?, ?, ?, ?)`,
                [nuevoPacId, nombre.trim(), telefono || '', correo || '', createdAt],
                (errPac) => {
                    if (errPac) return callback(errPac);
                    insertarCita(nuevoPacId);
                }
            );
        } else {
            insertarCita(pacienteRow.id);
        }
    });
}

// POST automático desde el chatbot
app.post('/api/bot-cita', (req, res) => {
    registrarCitaDesdeBot(req.body || {}, (err, result) => {
        if (err) return res.status(400).json({ error: err.message });
        res.json({ success: true, ...result });
    });
});

// GET de 1 clic desde el correo de la doctora
app.get('/api/bot-cita', (req, res) => {
    registrarCitaDesdeBot(req.query || {}, (err, result) => {
        if (err) {
            return res.status(400).send(`<h2>❌ Error al registrar cita: ${err.message}</h2>`);
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
    <p><strong>Paciente:</strong> ${cita.nombre_paciente}</p>
    <p><strong>Servicio:</strong> ${cita.motivo}</p>
    <p><strong>Fecha y Hora:</strong> ${cita.fecha} a las ${cita.hora}</p>
    <p><strong>Estado:</strong> Pendiente</p>
    <a class="btn" href="/">Abrir Panel DentAdmin</a>
  </div>
</body>
</html>`);
    });
});

// --- Endpoints Genéricos CRUD ---
// Aplicar middleware a todas las rutas bajo /api/ (excepto login)
app.use('/api/:col', authenticateToken);

// GET de usuarios (sin contraseña)
app.get('/api/usuarios', authenticateToken, (req, res) => {
    db.all(`SELECT id, username, rol FROM usuarios`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// POST (Crear usuario)
app.post('/api/usuarios', authenticateToken, async (req, res) => {
    try {
        const { username, password, rol } = req.body;
        if (!username || !password || !rol) {
            return res.status(400).json({ error: 'Todos los campos son obligatorios (usuario, contraseña y rol)' });
        }
        if (password.length < 6) {
            return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
        }

        // Verificar si el nombre de usuario ya existe
        db.get('SELECT id FROM usuarios WHERE LOWER(username) = LOWER(?)', [username.trim()], async (errCheck, existing) => {
            if (errCheck) return res.status(500).json({ error: errCheck.message });
            if (existing) {
                return res.status(400).json({ error: `El nombre de usuario "${username.trim()}" ya está registrado. Por favor elija otro.` });
            }

            const id = generateId();
            const hash = await bcrypt.hash(password, 10);
            db.run(`INSERT INTO usuarios (id, username, password, rol) VALUES (?, ?, ?, ?)`, [id, username.trim(), hash, rol], function(err) {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ id, username: username.trim(), rol });
            });
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// PUT (Actualizar usuario)
app.put('/api/usuarios/:id', authenticateToken, async (req, res) => {
    try {
        const { username, password, rol } = req.body;
        if (!username || !rol) {
            return res.status(400).json({ error: 'Usuario y rol son obligatorios' });
        }

        // Verificar que no choque con otro usuario existente
        db.get('SELECT id FROM usuarios WHERE LOWER(username) = LOWER(?) AND id != ?', [username.trim(), req.params.id], async (errCheck, existing) => {
            if (errCheck) return res.status(500).json({ error: errCheck.message });
            if (existing) {
                return res.status(400).json({ error: `El nombre de usuario "${username.trim()}" ya está en uso por otra cuenta.` });
            }

            if (password && password.trim().length > 0) {
                if (password.length < 6) {
                    return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
                }
                const hash = await bcrypt.hash(password, 10);
                db.run(`UPDATE usuarios SET username = ?, password = ?, rol = ? WHERE id = ?`, [username.trim(), hash, rol, req.params.id], function(err) {
                    if (err) return res.status(500).json({ error: err.message });
                    res.json({ success: true, id: req.params.id, username: username.trim(), rol });
                });
            } else {
                db.run(`UPDATE usuarios SET username = ?, rol = ? WHERE id = ?`, [username.trim(), rol, req.params.id], function(err) {
                    if (err) return res.status(500).json({ error: err.message });
                    res.json({ success: true, id: req.params.id, username: username.trim(), rol });
                });
            }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// --- Endpoints REST genéricos ---

// GET (Todos los registros de una colección)
app.get('/api/:col', (req, res) => {
    const col = req.params.col;
    if (!collections.includes(col)) return res.status(400).json({ error: 'Colección no válida' });
    
    // Si es archivos, omitir la columna 'data' pesada para carga instantánea
    const query = col === 'archivos'
        ? `SELECT id, nombre_paciente, original_name, filename, mime_type, size_bytes, createdAt FROM archivos`
        : `SELECT rowid, * FROM ${col}`;

    db.all(query, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// GET (Obtener un registro por ID)
app.get('/api/:col/:id', (req, res) => {
    const col = req.params.col;
    if (!collections.includes(col)) return res.status(400).json({ error: 'Colección no válida' });

    db.get(`SELECT rowid, * FROM ${col} WHERE id = ?`, [req.params.id], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(404).json({ error: 'No encontrado' });
        res.json(row);
    });
});

// POST (Crear registro)
app.post('/api/:col', (req, res) => {
    const col = req.params.col;
    if (!collections.includes(col)) return res.status(400).json({ error: 'Colección no válida' });

    const data = req.body;
    data.id = data.id || generateId();
    data.createdAt = data.createdAt || new Date().toISOString();

    const insertRecord = () => {
        const keys = Object.keys(data);
        const placeholders = keys.map(() => '?').join(',');
        const values = Object.values(data);

        db.run(`INSERT INTO ${col} (${keys.join(',')}) VALUES (${placeholders})`, values, function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json(data);
        });
    };

    // Si es una cita nueva, sincronizar con Google Calendar en segundo plano
    if (col === 'citas' && data.fecha && data.hora && req.body.syncGoogle !== false) {
        googleCalendar.createCalendarEvent({
            summary: `Cita: ${data.nombre_paciente} - ${data.motivo || 'Consulta'}`,
            description: `Paciente: ${data.nombre_paciente}\nDoctor(a): ${data.doctor || 'Dra. Rosa Avila'}\nSillón: ${data.id_sillon || 'Sillón 1'}\nEstado: ${data.estado || 'programada'}`,
            fecha: data.fecha,
            hora: data.hora
        }).then(result => {
            if (result && result.success && result.eventId) {
                data.google_event_id = result.eventId;
            }
            insertRecord();
        }).catch(() => {
            insertRecord();
        });
    } else {
        insertRecord();
    }
});

// PUT (Actualizar registro)
app.put('/api/:col/:id', (req, res) => {
    const col = req.params.col;
    if (!collections.includes(col)) return res.status(400).json({ error: 'Colección no válida' });

    const data = req.body;
    const keys = Object.keys(data);
    if (keys.length === 0) return res.status(400).json({ error: 'Sin datos para actualizar' });

    const setString = keys.map(k => `${k} = ?`).join(', ');
    const values = Object.values(data);
    values.push(req.params.id);

    db.run(`UPDATE ${col} SET ${setString} WHERE id = ?`, values, function(err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: 'No encontrado o sin cambios' });
        res.json({ success: true });
    });
});

// DELETE (Eliminar registro)
app.delete('/api/:col/:id', (req, res) => {
    const col = req.params.col;
    if (!collections.includes(col)) return res.status(400).json({ error: 'Colección no válida' });

    if (col === 'citas') {
        db.get(`SELECT google_event_id FROM citas WHERE id = ?`, [req.params.id], (errCita, cita) => {
            if (cita && cita.google_event_id) {
                googleCalendar.deleteCalendarEvent(cita.google_event_id).catch(() => {});
            }
        });
    }

    db.run(`DELETE FROM ${col} WHERE id = ?`, [req.params.id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: 'No encontrado' });
        res.json({ success: true });
    });
});


// Endpoint para poblar datos de demo (Seed) si está vacío
app.post('/api/seed', (req, res) => {
    // Verificamos si pacientes está vacío
    db.get("SELECT COUNT(*) AS count FROM pacientes", [], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (row.count > 0) return res.json({ success: true, message: 'La base de datos ya tiene datos' });
        
        // Función de utilidad para generar la fecha de hoy, ayer y mañana
        const pad=n=>String(n).padStart(2,'0');
        const fmt=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
        const addDays=(d,n)=>{const r=new Date(d);r.setDate(r.getDate()+n);return r};
        const h=fmt(new Date()), m=fmt(addDays(new Date(),1)), y=fmt(addDays(new Date(),-1));
        
        const insertData = (col, items) => {
            items.forEach(item => {
                item.id = generateId();
                item.createdAt = new Date().toISOString();
                const keys = Object.keys(item);
                const placeholders = keys.map(() => '?').join(',');
                db.run(`INSERT INTO ${col} (${keys.join(',')}) VALUES (${placeholders})`, Object.values(item));
            });
        };

        insertData('pacientes', [
            {nombre: 'Carlos Mendoza', telefono: '555-100-2001', correo: 'carlos@mail.com'},
            {nombre: 'María López', telefono: '555-200-3002', correo: 'maria@mail.com'},
            {nombre: 'Paco Ruiz', telefono: '555-300-4003', correo: 'paco@mail.com'},
            {nombre: 'Ana García', telefono: '555-400-5004', correo: 'ana@mail.com'},
            {nombre: 'Luis Torres', telefono: '555-500-6005', correo: 'luis@mail.com'}
        ]);
        insertData('citas', [
            {nombre_paciente:'Carlos Mendoza',fecha:m,hora:'16:00',motivo:'Limpieza',estado:'pendiente'},
            {nombre_paciente:'María López',fecha:h,hora:'10:00',motivo:'Ortodoncia',estado:'completada'},
            {nombre_paciente:'Paco Ruiz',fecha:h,hora:'11:30',motivo:'Consulta',estado:'pendiente'},
            {nombre_paciente:'Luis Torres',fecha:y,hora:'09:00',motivo:'Extracción',estado:'completada'},
            {nombre_paciente:'Ana García',fecha:h,hora:'14:00',motivo:'Revisión',estado:'pendiente'}
        ]);
        insertData('pagos', [
            {nombre_paciente:'María López',monto:1200,concepto:'Ortodoncia',metodo:'Tarjeta',fecha:h},
            {nombre_paciente:'Luis Torres',monto:800,concepto:'Extracción',metodo:'Efectivo',fecha:y},
            {nombre_paciente:'Paco Ruiz',monto:500,concepto:'Consulta',metodo:'Efectivo',fecha:h}
        ]);
        insertData('historia', [
            {nombre_paciente:'Luis Torres',diente_zona:'Molar 36',tratamiento:'Resina',descripcion:'Aplicación de resina compuesta',fecha:y},
            {nombre_paciente:'María López',diente_zona:'Arcada superior',tratamiento:'Brackets',descripcion:'Ajuste de brackets metálicos',fecha:h}
        ]);
        insertData('presupuestos', [
            {nombre_paciente:'Ana García',tratamientos:'Limpieza + Blanqueamiento',monto:3500,estado:'pendiente',fecha:h},
            {nombre_paciente:'Carlos Mendoza',tratamientos:'Corona + Endodoncia diente 14',monto:8000,estado:'aprobado',fecha:y}
        ]);
        insertData('gastos', [
            {concepto:'Renta del local',monto:15000,fecha:h},
            {concepto:'Material de limpieza',monto:450,fecha:y}
        ]);
        insertData('inventario', [
            {insumo:'Guantes de látex',stock:50,ultimo_tipo:'ingreso',ultimo_qty:50,fecha:h},
            {insumo:'Resina compuesta',stock:20,ultimo_tipo:'ingreso',ultimo_qty:20,fecha:y},
            {insumo:'Anestesia lidocaína',stock:35,ultimo_tipo:'ingreso',ultimo_qty:35,fecha:h}
        ]);
        insertData('tareas', [
            {descripcion:'Llamar a Ana García para confirmar cita',responsable:'Sonia',fecha_limite:m,estado:'pendiente'},
            {descripcion:'Enviar encuesta de satisfacción a pacientes de ortodoncia',responsable:'Ana',fecha_limite:h,estado:'pendiente'}
        ]);

        res.json({ success: true, message: 'Datos de prueba insertados' });
    });
});

// Middleware global de captura de errores (Requerido en Express 5 para Vercel Serverless)
app.use((err, req, res, next) => {
    console.error('⚠️ Error capturado en Express:', err);
    res.status(500).json({
        error: 'Error interno del servidor',
        message: err.message
    });
});

if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`Servidor DentAdmin (Backend Real) corriendo en http://localhost:${PORT}`);
    });
}

module.exports = app;
