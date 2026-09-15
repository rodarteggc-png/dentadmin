const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, 'dentadmin.sqlite');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error abriendo la base de datos', err.message);
    } else {
        console.log('Conectado a la base de datos SQLite.');
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
            )`, () => {
                db.get("SELECT * FROM usuarios WHERE username = 'admin'", (err, row) => {
                    if (!row) {
                        db.run("INSERT INTO usuarios (id, username, password, rol) VALUES ('1', 'admin', 'admin123', 'administrador')");
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
            console.log('Tablas inicializadas correctamente.');
        });
    }
});

module.exports = db;
