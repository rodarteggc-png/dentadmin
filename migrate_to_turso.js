require('dotenv').config();
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { createClient } = require('@libsql/client');

async function migrate() {
    console.log('🚀 Iniciando migración de SQLite local a Turso Cloud...');

    if (!process.env.TURSO_DATABASE_URL || !process.env.TURSO_AUTH_TOKEN) {
        console.error('❌ Falta TURSO_DATABASE_URL o TURSO_AUTH_TOKEN en .env');
        process.exit(1);
    }

    const turso = createClient({
        url: process.env.TURSO_DATABASE_URL,
        authToken: process.env.TURSO_AUTH_TOKEN
    });

    const localDbPath = path.resolve(__dirname, 'dentadmin.sqlite');
    const localDb = new sqlite3.Database(localDbPath);

    const getLocalData = (query, params = []) => {
        return new Promise((resolve, reject) => {
            localDb.all(query, params, (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    };

    try {
        // 1. Obtener todas las tablas de SQLite local
        const tables = await getLocalData("SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'");
        console.log(`📦 Se encontraron ${tables.length} tablas locales para migrar.`);

        for (const t of tables) {
            console.log(`\n⚙️ Procesando tabla: ${t.name}...`);

            // Crear tabla en Turso
            if (t.sql) {
                await turso.execute(t.sql);
            }

            // Obtener registros locales
            const rows = await getLocalData(`SELECT * FROM ${t.name}`);
            console.log(`   Leyendo ${rows.length} registros locales de '${t.name}'...`);

            if (rows.length > 0) {
                let inserted = 0;
                for (const row of rows) {
                    const keys = Object.keys(row);
                    const placeholders = keys.map(() => '?').join(',');
                    const values = Object.values(row);

                    // Insert or replace para evitar duplicados
                    const insertSql = `INSERT OR REPLACE INTO ${t.name} (${keys.join(',')}) VALUES (${placeholders})`;
                    await turso.execute({ sql: insertSql, args: values });
                    inserted++;
                }
                console.log(`   ✅ ${inserted} registros migrados a Turso.`);
            } else {
                console.log(`   ℹ️ Tabla vacía, esquema creado.`);
            }

            // Verificar conteo en Turso
            const countRes = await turso.execute(`SELECT COUNT(*) as c FROM ${t.name}`);
            console.log(`   📊 Total en Turso (${t.name}): ${countRes.rows[0].c}`);
        }

        console.log('\n🎉 ¡MIGRACIÓN COMPLETADA EXITOSAMENTE A TURSO CLOUD!');
        localDb.close();
        process.exit(0);
    } catch (error) {
        console.error('❌ Error durante la migración:', error);
        localDb.close();
        process.exit(1);
    }
}

migrate();
