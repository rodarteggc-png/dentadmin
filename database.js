const path = require('path');
const bcrypt = require('bcryptjs');

let db;

const INDEXES = [
    'CREATE INDEX IF NOT EXISTS idx_citas_fecha_hora ON citas(fecha, hora)',
    'CREATE INDEX IF NOT EXISTS idx_citas_google_event ON citas(google_event_id)',
    'CREATE INDEX IF NOT EXISTS idx_pacientes_nombre_lower ON pacientes(LOWER(nombre))',
    'CREATE INDEX IF NOT EXISTS idx_usuarios_username_lower ON usuarios(LOWER(username))',
    'CREATE INDEX IF NOT EXISTS idx_archivos_paciente ON archivos(nombre_paciente)',
    'CREATE INDEX IF NOT EXISTS idx_archivos_filename ON archivos(filename)',
    'CREATE INDEX IF NOT EXISTS idx_tratdet_paciente ON tratamientos_detalles(nombre_paciente)',
    'CREATE INDEX IF NOT EXISTS idx_abonos_tratdet ON abonos_tratamientos(id_tratamiento_detalle)'
];

if (process.env.TURSO_DATABASE_URL && process.env.TURSO_AUTH_TOKEN) {
    const { createClient } = require('@libsql/client');
    console.log('⚡ Conectando a Turso Cloud Database...');
    const turso = createClient({
        url: process.env.TURSO_DATABASE_URL,
        authToken: process.env.TURSO_AUTH_TOKEN
    });

    // Two-arg then(): an exception thrown inside the callback must never re-enter it as a DB error.
    const deliver = (promise, onOk, callback) => {
        promise
            .then(onOk, err => {
                if (callback) callback(err);
                else console.error('[db] Error sin callback:', err.message);
            })
            .catch(err => console.error('[db] Excepción dentro del callback:', err));
    };

    db = {
        isTurso: true,
        all(sql, params, callback) {
            if (typeof params === 'function') { callback = params; params = []; }
            deliver(turso.execute({ sql, args: params || [] }), res => callback(null, res.rows), callback);
        },
        get(sql, params, callback) {
            if (typeof params === 'function') { callback = params; params = []; }
            deliver(turso.execute({ sql, args: params || [] }), res => callback(null, res.rows[0] || null), callback);
        },
        run(sql, params, callback) {
            if (typeof params === 'function') { callback = params; params = []; }
            deliver(turso.execute({ sql, args: params || [] }), res => {
                if (callback) callback.call({ changes: res.rowsAffected, lastID: res.lastInsertRowid }, null);
            }, callback);
        },
        async batch(statements) {
            const results = await turso.batch(statements.map(s => ({ sql: s.sql, args: s.args || [] })), 'write');
            return results.map(r => ({ changes: r.rowsAffected }));
        },
        serialize(fn) {
            if (fn) fn();
        }
    };
    Promise.allSettled(INDEXES.map(sql => turso.execute(sql)))
        .then(results => results.forEach(r => r.status === 'rejected' && console.warn('[db] Índice omitido:', r.reason.message)));
    console.log('✅ Base de datos Turso Cloud lista y enlazada.');
} else if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NODE_ENV === 'production') {
    console.error('⚠️ ALERTA: No se detectó TURSO_DATABASE_URL ni TURSO_AUTH_TOKEN en entorno Serverless/Vercel.');
    db = {
        isTurso: false,
        all: (s, p, cb) => (cb || p)(new Error('Base de datos en la nube no configurada en Vercel. Por favor configura TURSO_DATABASE_URL y TURSO_AUTH_TOKEN en Vercel Dashboard.')),
        get: (s, p, cb) => (cb || p)(new Error('Base de datos en la nube no configurada en Vercel. Por favor configura TURSO_DATABASE_URL y TURSO_AUTH_TOKEN en Vercel Dashboard.')),
        run: (s, p, cb) => (cb || p)(new Error('Base de datos en la nube no configurada en Vercel. Por favor configura TURSO_DATABASE_URL y TURSO_AUTH_TOKEN en Vercel Dashboard.')),
        batch: () => Promise.reject(new Error('Base de datos en la nube no configurada en Vercel. Por favor configura TURSO_DATABASE_URL y TURSO_AUTH_TOKEN en Vercel Dashboard.')),
        serialize: fn => fn && fn()
    };
} else {
    const sqlite3 = require('sqlite3').verbose();
    const dbPath = path.resolve(__dirname, 'dentadmin.sqlite');
    db = new sqlite3.Database(dbPath, (err) => {
        if (err) {
            console.error('Error abriendo la base de datos', err.message);
        } else {
            console.log('Conectado a la base de datos SQLite local.');
            db.serialize(() => {
                db.run(`CREATE TABLE IF NOT EXISTS pacientes (
                id TEXT PRIMARY KEY,
                nombre TEXT NOT NULL,
                telefono TEXT,
                correo TEXT,
                createdAt TEXT
            )`);

            db.run(`CREATE TABLE IF NOT EXISTS citas (
                id TEXT PRIMARY KEY,
                nombre_paciente TEXT,
                fecha TEXT,
                hora TEXT,
                motivo TEXT,
                estado TEXT,
                createdAt TEXT
            )`);

            db.run(`CREATE TABLE IF NOT EXISTS pagos (
                id TEXT PRIMARY KEY,
                nombre_paciente TEXT,
                monto REAL,
                concepto TEXT,
                metodo TEXT,
                fecha TEXT,
                createdAt TEXT
            )`);

            db.run(`CREATE TABLE IF NOT EXISTS historia (
                id TEXT PRIMARY KEY,
                nombre_paciente TEXT,
                diente_zona TEXT,
                tratamiento TEXT,
                descripcion TEXT,
                fecha TEXT,
                createdAt TEXT
            )`);

            db.run(`CREATE TABLE IF NOT EXISTS presupuestos (
                id TEXT PRIMARY KEY,
                nombre_paciente TEXT,
                tratamientos TEXT,
                monto REAL,
                estado TEXT,
                fecha TEXT,
                createdAt TEXT
            )`);

            db.run(`CREATE TABLE IF NOT EXISTS gastos (
                id TEXT PRIMARY KEY,
                concepto TEXT,
                monto REAL,
                fecha TEXT,
                createdAt TEXT
            )`);

            db.run(`CREATE TABLE IF NOT EXISTS inventario (
                id TEXT PRIMARY KEY,
                insumo TEXT,
                stock INTEGER,
                ultimo_tipo TEXT,
                ultimo_qty INTEGER,
                fecha TEXT,
                createdAt TEXT
            )`);

            db.run(`CREATE TABLE IF NOT EXISTS tareas (
                id TEXT PRIMARY KEY,
                descripcion TEXT,
                responsable TEXT,
                fecha_limite TEXT,
                estado TEXT,
                createdAt TEXT
            )`);
            
            db.run(`CREATE TABLE IF NOT EXISTS usuarios (
                id TEXT PRIMARY KEY,
                username TEXT UNIQUE,
                password TEXT,
                rol TEXT
            )`, async () => {
                db.get("SELECT * FROM usuarios WHERE username = 'admin'", async (err, row) => {
                    if (!row) {
                        const hash = await bcrypt.hash('admin123', 10);
                        db.run("INSERT INTO usuarios (id, username, password, rol) VALUES ('1', 'admin', ?, 'administrador')", [hash]);
                    }
                });
            });

            db.run(`CREATE TABLE IF NOT EXISTS odontogramas (
                id TEXT PRIMARY KEY,
                nombre_paciente TEXT,
                diente TEXT,
                cara TEXT,
                estado TEXT,
                createdAt TEXT
            )`);
            
            db.run(`CREATE TABLE IF NOT EXISTS archivos (
                id TEXT PRIMARY KEY,
                nombre_paciente TEXT,
                original_name TEXT,
                filename TEXT,
                data TEXT,
                mime_type TEXT,
                size_bytes INTEGER,
                createdAt TEXT
            )`);
            
            db.run(`CREATE TABLE IF NOT EXISTS recetas (
                id TEXT PRIMARY KEY,
                nombre_paciente TEXT,
                edad TEXT,
                peso TEXT,
                medicamentos TEXT,
                fecha TEXT
            )`);
            
            db.run(`CREATE TABLE IF NOT EXISTS antecedentes (
                id TEXT PRIMARY KEY,
                nombre_paciente TEXT UNIQUE,
                alergias TEXT,
                enfermedades TEXT,
                medicamentos_actuales TEXT,
                alertas_medicas TEXT,
                createdAt TEXT
            )`);
            
            db.run(`CREATE TABLE IF NOT EXISTS periodontogramas (
                id TEXT PRIMARY KEY,
                nombre_paciente TEXT,
                diente TEXT,
                sondaje TEXT,
                sangrado BOOLEAN,
                movilidad TEXT,
                fecha TEXT,
                createdAt TEXT
            )`);
            
            db.run(`CREATE TABLE IF NOT EXISTS ortodoncia (
                id TEXT PRIMARY KEY,
                nombre_paciente TEXT,
                aparatologia TEXT,
                ligas TEXT,
                higiene TEXT,
                notas TEXT,
                fecha TEXT,
                createdAt TEXT
            )`);

            // --- Catálogo de Prestaciones (Estilo Dentalink) ---
            db.run(`CREATE TABLE IF NOT EXISTS prestaciones (
                id TEXT PRIMARY KEY,
                codigo TEXT,
                categoria TEXT,
                nombre TEXT NOT NULL,
                precio REAL NOT NULL,
                aplica_a TEXT DEFAULT 'diente',
                createdAt TEXT
            )`, () => {
                db.get("SELECT COUNT(*) as count FROM prestaciones", [], (err, row) => {
                    if (!err && row && row.count === 0) {
                        const catalogoInicial = [
                            { id: 'prest_01', codigo: 'PREV-01', categoria: 'Prevención y Diagnóstico', nombre: 'Valoración / Diagnóstico Integral', precio: 300, aplica_a: 'boca_completa' },
                            { id: 'prest_02', codigo: 'PREV-02', categoria: 'Prevención y Diagnóstico', nombre: 'Limpieza Dental con Ultrasonido (Profilaxis)', precio: 600, aplica_a: 'boca_completa' },
                            { id: 'prest_03', codigo: 'PREV-03', categoria: 'Prevención y Diagnóstico', nombre: 'Aplicación de Flúor Barniz', precio: 350, aplica_a: 'boca_completa' },
                            { id: 'prest_04', codigo: 'PREV-04', categoria: 'Prevención y Diagnóstico', nombre: 'Sellador de Fosetas y Fisuras', precio: 400, aplica_a: 'cara' },
                            { id: 'prest_05', codigo: 'OPER-01', categoria: 'Operatorias y Resinas', nombre: 'Resina Estética 1 Superficie', precio: 750, aplica_a: 'cara' },
                            { id: 'prest_06', codigo: 'OPER-02', categoria: 'Operatorias y Resinas', nombre: 'Resina Estética 2 o más Superficies', precio: 950, aplica_a: 'cara' },
                            { id: 'prest_07', codigo: 'OPER-03', categoria: 'Operatorias y Resinas', nombre: 'Incrustación Estética Inlay / Onlay', precio: 2500, aplica_a: 'diente' },
                            { id: 'prest_08', codigo: 'ENDO-01', categoria: 'Endodoncia', nombre: 'Endodoncia Unirradicular', precio: 2200, aplica_a: 'diente' },
                            { id: 'prest_09', codigo: 'ENDO-02', categoria: 'Endodoncia', nombre: 'Endodoncia Birradicular', precio: 2800, aplica_a: 'diente' },
                            { id: 'prest_10', codigo: 'ENDO-03', categoria: 'Endodoncia', nombre: 'Endodoncia Molar (Multirradicular)', precio: 3500, aplica_a: 'diente' },
                            { id: 'prest_11', codigo: 'CIRU-01', categoria: 'Cirugía Oral', nombre: 'Extracción Dental Simple', precio: 800, aplica_a: 'diente' },
                            { id: 'prest_12', codigo: 'CIRU-02', categoria: 'Cirugía Oral', nombre: 'Cirugía de Tercer Molar (Muela del Juicio)', precio: 2800, aplica_a: 'diente' },
                            { id: 'prest_13', codigo: 'REHA-01', categoria: 'Rehabilitación y Prótesis', nombre: 'Corona Porcelana sobre Metal', precio: 3200, aplica_a: 'diente' },
                            { id: 'prest_14', codigo: 'REHA-02', categoria: 'Rehabilitación y Prótesis', nombre: 'Corona Zirconia / Disilicato de Litio', precio: 4800, aplica_a: 'diente' },
                            { id: 'prest_15', codigo: 'ESTE-01', categoria: 'Estética Dental', nombre: 'Blanqueamiento Dental Led (Consultorio)', precio: 2800, aplica_a: 'boca_completa' },
                            { id: 'prest_16', codigo: 'PERI-01', categoria: 'Periodoncia', nombre: 'Raspado y Alisado Radicular (por cuadrante)', precio: 900, aplica_a: 'diente' },
                            { id: 'prest_17', codigo: 'ORTO-01', categoria: 'Ortodoncia', nombre: 'Guarda Oclusal Miorrelajante', precio: 2200, aplica_a: 'boca_completa' }
                        ];
                        catalogoInicial.forEach(p => {
                            db.run(`INSERT INTO prestaciones (id, codigo, categoria, nombre, precio, aplica_a, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                                [p.id, p.codigo, p.categoria, p.nombre, p.precio, p.aplica_a, new Date().toISOString()]);
                        });
                        console.log('Catálogo de prestaciones inicializado con 17 aranceles clínicos.');
                    }
                });
            });

            // --- Tratamientos Desglosados por Pieza Dental (Estilo Dentalink) ---
            db.run(`CREATE TABLE IF NOT EXISTS tratamientos_detalles (
                id TEXT PRIMARY KEY,
                id_presupuesto TEXT,
                nombre_paciente TEXT NOT NULL,
                id_prestacion TEXT,
                nombre_prestacion TEXT NOT NULL,
                diente TEXT,
                cara TEXT,
                precio REAL NOT NULL,
                descuento REAL DEFAULT 0,
                total REAL NOT NULL,
                realizado INTEGER DEFAULT 0,
                pagado REAL DEFAULT 0,
                liquidado INTEGER DEFAULT 0,
                fecha_realizado TEXT,
                createdAt TEXT
            )`);

            // --- Abonos Directos a Tratamientos de Piezas (Opción 1 - Dentalink) ---
            db.run(`CREATE TABLE IF NOT EXISTS abonos_tratamientos (
                id TEXT PRIMARY KEY,
                id_tratamiento_detalle TEXT NOT NULL,
                nombre_paciente TEXT NOT NULL,
                diente TEXT,
                cara TEXT,
                prestacion_nombre TEXT,
                monto REAL NOT NULL,
                metodo TEXT DEFAULT 'Efectivo',
                doctor TEXT,
                fecha TEXT,
                notas TEXT,
                createdAt TEXT
            )`);

            // --- Sillones / Unidades Dentales (Opción 3 - Dentalink) ---
            db.run(`CREATE TABLE IF NOT EXISTS sillones (
                id TEXT PRIMARY KEY,
                nombre TEXT NOT NULL,
                codigo TEXT,
                color TEXT DEFAULT '#3b82f6',
                activo INTEGER DEFAULT 1,
                createdAt TEXT
            )`, () => {
                db.get("SELECT COUNT(*) as count FROM sillones", [], (err, row) => {
                    if (!err && row && row.count === 0) {
                        const sillonesIniciales = [
                            { id: 'sillon_1', nombre: 'Sillón 1 (Principal)', codigo: 'U-01', color: '#3b82f6' },
                            { id: 'sillon_2', nombre: 'Sillón 2 (Quirúrgico)', codigo: 'U-02', color: '#10b981' },
                            { id: 'sillon_3', nombre: 'Sillón 3 (Odontopediatría / Ortodoncia)', codigo: 'U-03', color: '#f59e0b' }
                        ];
                        sillonesIniciales.forEach(s => {
                            db.run(`INSERT INTO sillones (id, nombre, codigo, color, activo, createdAt) VALUES (?, ?, ?, ?, 1, ?)`,
                                [s.id, s.nombre, s.codigo, s.color, new Date().toISOString()]);
                        });
                        console.log('Sillones dentales inicializados (3 unidades).');
                    }
                });
            });

            // Añadir columnas de sillón y doctor a citas de forma segura
            db.run(`ALTER TABLE citas ADD COLUMN id_sillon TEXT DEFAULT 'sillon_1'`, () => {});
            db.run(`ALTER TABLE citas ADD COLUMN nombre_sillon TEXT DEFAULT 'Sillón 1'`, () => {});
            db.run(`ALTER TABLE citas ADD COLUMN doctor TEXT DEFAULT 'Dra. Rosa Avila'`, () => {});
            db.run(`ALTER TABLE citas ADD COLUMN hora_llegada TEXT`, () => {});
            db.run(`ALTER TABLE citas ADD COLUMN hora_atencion TEXT`, () => {});
            db.run(`ALTER TABLE citas ADD COLUMN hora_fin TEXT`, () => {});
            db.run(`ALTER TABLE citas ADD COLUMN google_event_id TEXT`, () => {});

            // Columnas para almacenamiento permanente de archivos/fotos en Turso Cloud
            db.run(`ALTER TABLE archivos ADD COLUMN data TEXT`, () => {});
            db.run(`ALTER TABLE archivos ADD COLUMN mime_type TEXT`, () => {});
            db.run(`ALTER TABLE archivos ADD COLUMN size_bytes INTEGER`, () => {});

            // --- Órdenes de Laboratorio Dental (Opción 4 - Dentalink) ---
            db.run(`CREATE TABLE IF NOT EXISTS laboratorios_ordenes (
                id TEXT PRIMARY KEY,
                folio TEXT,
                nombre_paciente TEXT NOT NULL,
                diente TEXT,
                trabajo TEXT NOT NULL,
                laboratorio_nombre TEXT NOT NULL,
                fecha_envio TEXT,
                fecha_entrega_estimada TEXT,
                fecha_recibido TEXT,
                costo_laboratorio REAL DEFAULT 0,
                estado TEXT DEFAULT 'enviado',
                doctor TEXT,
                color_guia TEXT,
                notas TEXT,
                createdAt TEXT
            )`, () => {
                db.get("SELECT COUNT(*) as count FROM laboratorios_ordenes", [], (err, row) => {
                    if (!err && row && row.count === 0) {
                        const hoy = new Date();
                        const pad = n => String(n).padStart(2,'0');
                        const fmt = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
                        const addD = (d, n) => { const r = new Date(d); r.setDate(r.getDate() + n); return r; };

                        const ordenesDemo = [
                            {
                                id: 'lab_01',
                                folio: 'LAB-100201',
                                nombre_paciente: 'Carlos Mendoza',
                                diente: '16',
                                trabajo: 'Corona Zirconia Monolítica',
                                laboratorio_nombre: 'Dental Art Lab',
                                fecha_envio: fmt(addD(hoy, -3)),
                                fecha_entrega_estimada: fmt(addD(hoy, 2)),
                                fecha_recibido: null,
                                costo_laboratorio: 1400,
                                estado: 'enviado',
                                doctor: 'Dra. Rosa Avila',
                                color_guia: 'A2',
                                notas: 'Ajuste oclusal pasivo, contacto interproximal mesial firme.'
                            },
                            {
                                id: 'lab_02',
                                folio: 'LAB-100202',
                                nombre_paciente: 'María López',
                                diente: '21',
                                trabajo: 'Carilla Dental Estética',
                                laboratorio_nombre: 'Estética Cerámica Pro',
                                fecha_envio: fmt(addD(hoy, -6)),
                                fecha_entrega_estimada: fmt(addD(hoy, -1)),
                                fecha_recibido: fmt(hoy),
                                costo_laboratorio: 1800,
                                estado: 'recibido',
                                doctor: 'Dra. Rosa Avila',
                                color_guia: 'B1 (Alta translucidez)',
                                notas: 'Recibido en clínica. Lista para cita de cementado con resina dual.'
                            },
                            {
                                id: 'lab_03',
                                folio: 'LAB-100203',
                                nombre_paciente: 'Ana García',
                                diente: 'Arcada Superior',
                                trabajo: 'Guarda Oclusal Miorrelajante',
                                laboratorio_nombre: 'OrtoLab Norte',
                                fecha_envio: fmt(addD(hoy, -10)),
                                fecha_entrega_estimada: fmt(addD(hoy, -5)),
                                fecha_recibido: fmt(addD(hoy, -4)),
                                costo_laboratorio: 750,
                                estado: 'instalado',
                                doctor: 'Dra. Rosa Avila',
                                color_guia: 'Transparente rígida/semirrígida',
                                notas: 'Instalada y calibrada con papel de articular de 40 micras.'
                            }
                        ];

                        ordenesDemo.forEach(o => {
                            db.run(`INSERT INTO laboratorios_ordenes (id, folio, nombre_paciente, diente, trabajo, laboratorio_nombre, fecha_envio, fecha_entrega_estimada, fecha_recibido, costo_laboratorio, estado, doctor, color_guia, notas, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                                [o.id, o.folio, o.nombre_paciente, o.diente, o.trabajo, o.laboratorio_nombre, o.fecha_envio, o.fecha_entrega_estimada, o.fecha_recibido, o.costo_laboratorio, o.estado, o.doctor, o.color_guia, o.notas, new Date().toISOString()]);
                        });
                        console.log('Órdenes de laboratorio dental inicializadas (3 órdenes demo).');
                    }
                });
            });

            INDEXES.forEach(sql => db.run(sql, (idxErr) => {
                if (idxErr) console.warn('[db] Índice omitido:', idxErr.message);
            }));

            console.log('Tablas inicializadas correctamente.');
        });
    }
});

    const runLocal = (sql, args = []) => new Promise((resolve, reject) => {
        db.run(sql, args, function (err) {
            if (err) return reject(err);
            resolve({ changes: this.changes });
        });
    });
    // sqlite3 shares one connection: serialize transactions to avoid nested BEGIN.
    let batchQueue = Promise.resolve();
    db.batch = (statements) => {
        const job = batchQueue.then(async () => {
            await runLocal('BEGIN IMMEDIATE');
            try {
                const results = [];
                for (const s of statements) results.push(await runLocal(s.sql, s.args || []));
                await runLocal('COMMIT');
                return results;
            } catch (err) {
                await runLocal('ROLLBACK').catch(() => {});
                throw err;
            }
        });
        batchQueue = job.catch(() => {});
        return job;
    };
}

db.allAsync = (sql, params = []) => new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
});
db.getAsync = (sql, params = []) => new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
});
db.runAsync = (sql, params = []) => new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
        if (err) return reject(err);
        resolve({ changes: this ? this.changes : 0, lastID: this ? this.lastID : undefined });
    });
});

module.exports = db;
