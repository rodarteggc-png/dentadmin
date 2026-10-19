const { google } = require('googleapis');

const CALENDAR_ID = process.env.DOCTOR_CALENDAR_EMAIL || 'dra.avilaodontologia@gmail.com';
const TIMEZONE = 'America/Monterrey';

/**
 * Obtiene el cliente autenticado de Google Calendar
 */
function getCalendarClient() {
    const credentialsStr = process.env.GOOGLE_CREDENTIALS;
    if (!credentialsStr) return null;

    try {
        const credentials = typeof credentialsStr === 'string' ? JSON.parse(credentialsStr) : credentialsStr;
        const auth = new google.auth.GoogleAuth({
            credentials,
            scopes: [
                'https://www.googleapis.com/auth/calendar.events',
                'https://www.googleapis.com/auth/calendar.readonly'
            ]
        });
        return google.calendar({ version: 'v3', auth });
    } catch (err) {
        console.error('Error inicializando cliente de Google Calendar:', err.message);
        return null;
    }
}

/**
 * Convierte fecha y hora (formato 12h o 24h) a ISO con offset GMT-6 (Monterrey)
 */
function parseToIso(fechaStr, horaStr) {
    if (!fechaStr) return null;
    let hours = 10;
    let minutes = 0;

    if (horaStr) {
        const ampmMatch = horaStr.match(/(\d+):(\d+)\s*(AM|PM)?/i);
        if (ampmMatch) {
            hours = parseInt(ampmMatch[1], 10);
            minutes = parseInt(ampmMatch[2], 10);
            const period = ampmMatch[3] ? ampmMatch[3].toUpperCase() : null;
            if (period === 'PM' && hours !== 12) hours += 12;
            if (period === 'AM' && hours === 12) hours = 0;
        } else {
            const simpleMatch = horaStr.match(/(\d+):(\d+)/);
            if (simpleMatch) {
                hours = parseInt(simpleMatch[1], 10);
                minutes = parseInt(simpleMatch[2], 10);
            }
        }
    }

    const pad = (n) => String(n).padStart(2, '0');
    return `${fechaStr}T${pad(hours)}:${pad(minutes)}:00-06:00`;
}

/**
 * Inserta una nueva cita en el Google Calendar de la Doctora
 */
async function createCalendarEvent({ summary, description, fecha, hora, duracionMin = 60 }) {
    const calendar = getCalendarClient();
    if (!calendar) {
        return { success: false, reason: 'GOOGLE_CREDENTIALS no configurado en entorno' };
    }

    try {
        const startIso = parseToIso(fecha, hora);
        const startDate = new Date(startIso);
        const endDate = new Date(startDate.getTime() + duracionMin * 60 * 1000);

        const event = {
            summary: summary || 'Cita Clínica - Dra. Rosa Ávila',
            description: description || 'Agendado desde CareDent Nube',
            start: {
                dateTime: startDate.toISOString(),
                timeZone: TIMEZONE
            },
            end: {
                dateTime: endDate.toISOString(),
                timeZone: TIMEZONE
            }
        };

        const res = await calendar.events.insert({
            calendarId: CALENDAR_ID,
            resource: event
        });

        console.log('✅ Evento sincronizado en Google Calendar:', res.data.id);
        return { success: true, eventId: res.data.id, link: res.data.htmlLink };
    } catch (err) {
        console.error('⚠️ Error al crear evento en Google Calendar:', err.message);
        return { success: false, error: err.message };
    }
}

/**
 * Consulta los eventos de Google Calendar para sincronizarlos o verificar bloqueos
 */
async function listCalendarEvents(timeMin, timeMax) {
    const calendar = getCalendarClient();
    if (!calendar) return [];

    try {
        const min = timeMin || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
        const max = timeMax || new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString();

        const res = await calendar.events.list({
            calendarId: CALENDAR_ID,
            timeMin: min,
            timeMax: max,
            singleEvents: true,
            orderBy: 'startTime'
        });

        return (res.data.items || []).map(item => ({
            id: item.id,
            summary: item.summary || 'Ocupado en Google Calendar',
            description: item.description || '',
            start: item.start.dateTime || item.start.date,
            end: item.end.dateTime || item.end.date,
            htmlLink: item.htmlLink,
            origen: 'google_calendar'
        }));
    } catch (err) {
        console.error('⚠️ Error al consultar eventos de Google Calendar:', err.message);
        return [];
    }
}

/**
 * Elimina un evento de Google Calendar
 */
async function deleteCalendarEvent(eventId) {
    const calendar = getCalendarClient();
    if (!calendar || !eventId) return false;

    try {
        await calendar.events.delete({
            calendarId: CALENDAR_ID,
            eventId: eventId
        });
        console.log('🗑️ Evento cancelado en Google Calendar:', eventId);
        return true;
    } catch (err) {
        console.warn('No se pudo eliminar evento en Google Calendar:', err.message);
        return false;
    }
}

/**
 * Sincroniza eventos existentes de Google Calendar hacia la base de datos de DentaAdmin
 */
async function syncGoogleEventsToDb(db, timeMin, timeMax) {
    const calendar = getCalendarClient();
    if (!calendar) {
        return { success: false, reason: 'GOOGLE_CREDENTIALS no disponible en entorno' };
    }

    const crypto = require('crypto');
    const events = await listCalendarEvents(timeMin, timeMax);
    let importados = 0;
    let omitidos = 0;

    for (const evt of events) {
        if (!evt.start) continue;

        let fecha = '';
        let hora = '';
        if (evt.start.includes('T')) {
            const parts = evt.start.split('T');
            fecha = parts[0];
            hora = parts[1].substring(0, 5);
        } else {
            fecha = evt.start;
            hora = '10:00';
        }

        await new Promise((resolve) => {
            db.get(
                `SELECT id FROM citas WHERE google_event_id = ? OR (fecha = ? AND hora = ?)`,
                [evt.id, fecha, hora],
                (err, existing) => {
                    if (err || existing) {
                        omitidos++;
                        return resolve();
                    }

                    let paciente = evt.summary;
                    let motivo = 'Cita de Google Calendar';
                    if (evt.summary && evt.summary.startsWith('Cita:')) {
                        const clean = evt.summary.replace('Cita:', '').trim();
                        const subParts = clean.split('-');
                        paciente = subParts[0] ? subParts[0].trim() : clean;
                        if (subParts[1]) motivo = subParts[1].trim();
                    }

                    const id = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 15);
                    const createdAt = new Date().toISOString();

                    db.run(
                        `INSERT INTO citas (id, nombre_paciente, fecha, hora, motivo, estado, doctor, id_sillon, google_event_id, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        [id, paciente, fecha, hora, motivo, 'programada', 'Dra. Rosa Avila', 'sillon_1', evt.id, createdAt],
                        (errIns) => {
                            if (!errIns) importados++;
                            resolve();
                        }
                    );
                }
            );
        });
    }

    return { success: true, totalGoogle: events.length, importados, omitidos };
}

module.exports = {
    CALENDAR_ID,
    getCalendarClient,
    createCalendarEvent,
    listCalendarEvents,
    deleteCalendarEvent,
    syncGoogleEventsToDb,
    parseToIso
};
