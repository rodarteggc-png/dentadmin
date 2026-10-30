const { google } = require('googleapis');
const crypto = require('crypto');

const CALENDAR_ID = process.env.DOCTOR_CALENDAR_EMAIL || 'dra.avilaodontologia@gmail.com';
const TIMEZONE = 'America/Monterrey';
// Acota la latencia de Google para no agotar el maxDuration de la función serverless.
const GOOGLE_TIMEOUT_MS = Number(process.env.GOOGLE_TIMEOUT_MS) || 6000;
const MAX_SYNC_RANGE_MS = 180 * 24 * 60 * 60 * 1000;

// undefined = sin inicializar, null = no disponible. Reutiliza el token OAuth entre invocaciones calientes.
let cachedClient;

/**
 * Obtiene el cliente autenticado de Google Calendar
 */
function getCalendarClient() {
    if (cachedClient !== undefined) return cachedClient;
    const credentialsStr = process.env.GOOGLE_CREDENTIALS;
    if (!credentialsStr) {
        cachedClient = null;
        return cachedClient;
    }

    try {
        const credentials = typeof credentialsStr === 'string' ? JSON.parse(credentialsStr) : credentialsStr;
        const auth = new google.auth.GoogleAuth({
            credentials,
            scopes: [
                'https://www.googleapis.com/auth/calendar.events',
                'https://www.googleapis.com/auth/calendar.readonly'
            ]
        });
        cachedClient = google.calendar({ version: 'v3', auth, timeout: GOOGLE_TIMEOUT_MS });
    } catch (err) {
        console.error('Error inicializando cliente de Google Calendar:', err.message);
        cachedClient = null;
    }
    return cachedClient;
}

function toValidIso(value, fallbackMs) {
    const d = value ? new Date(value) : null;
    return d && !isNaN(d.getTime()) ? d.toISOString() : new Date(fallbackMs).toISOString();
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
 * Actualiza fecha/hora/descripcion de un evento existente (reprogramación desde DentaAdmin)
 */
async function updateCalendarEvent(eventId, { summary, description, fecha, hora, duracionMin = 60 }) {
    const calendar = getCalendarClient();
    if (!calendar || !eventId) return { success: false, reason: 'Sin cliente o sin eventId' };

    try {
        const requestBody = {};
        if (summary) requestBody.summary = summary;
        if (description) requestBody.description = description;
        if (fecha && hora) {
            const startDate = new Date(parseToIso(fecha, hora));
            const endDate = new Date(startDate.getTime() + duracionMin * 60 * 1000);
            requestBody.start = { dateTime: startDate.toISOString(), timeZone: TIMEZONE };
            requestBody.end = { dateTime: endDate.toISOString(), timeZone: TIMEZONE };
        }
        await calendar.events.patch({ calendarId: CALENDAR_ID, eventId, requestBody });
        return { success: true };
    } catch (err) {
        console.error('⚠️ Error al actualizar evento en Google Calendar:', err.message);
        return { success: false, error: err.message };
    }
}

/**
 * Consulta los eventos de Google Calendar (paginado). Lanza excepción si Google falla.
 */
async function listCalendarEvents(timeMin, timeMax) {
    const calendar = getCalendarClient();
    if (!calendar) return [];

    const now = Date.now();
    const min = toValidIso(timeMin, now - 7 * 24 * 60 * 60 * 1000);
    let max = toValidIso(timeMax, now + 60 * 24 * 60 * 60 * 1000);
    if (new Date(max) - new Date(min) > MAX_SYNC_RANGE_MS) {
        max = new Date(new Date(min).getTime() + MAX_SYNC_RANGE_MS).toISOString();
    }

    const items = [];
    let pageToken;
    do {
        const res = await calendar.events.list({
            calendarId: CALENDAR_ID,
            timeMin: min,
            timeMax: max,
            singleEvents: true,
            orderBy: 'startTime',
            maxResults: 2500,
            pageToken
        });
        items.push(...(res.data.items || []));
        pageToken = res.data.nextPageToken;
    } while (pageToken && items.length < 10000);

    return items.map(item => ({
        id: item.id,
        summary: item.summary || 'Ocupado en Google Calendar',
        description: item.description || '',
        start: item.start.dateTime || item.start.date,
        end: item.end.dateTime || item.end.date,
        htmlLink: item.htmlLink,
        origen: 'google_calendar'
    }));
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

    let events;
    try {
        events = await listCalendarEvents(timeMin, timeMax);
    } catch (err) {
        console.error('⚠️ Error al consultar eventos de Google Calendar:', err.message);
        return { success: false, reason: `No se pudo consultar Google Calendar: ${err.message}` };
    }

    let omitidos = 0;
    const parsed = [];
    for (const evt of events) {
        // Eventos de día completo (vacaciones, bloqueos) no son citas de pacientes.
        if (!evt.start || !evt.start.includes('T')) { omitidos++; continue; }
        const [fecha, time] = evt.start.split('T');
        parsed.push({ evt, fecha, hora: time.substring(0, 5) });
    }
    if (parsed.length === 0) {
        return { success: true, totalGoogle: events.length, importados: 0, omitidos };
    }

    // 1 sola lectura en lugar de 1 SELECT por evento (N+1).
    const fechas = parsed.map(p => p.fecha).sort();
    const ids = parsed.map(p => p.evt.id);
    const existing = await db.allAsync(
        `SELECT google_event_id, fecha, hora FROM citas WHERE (fecha BETWEEN ? AND ?) OR google_event_id IN (${ids.map(() => '?').join(',')})`,
        [fechas[0], fechas[fechas.length - 1], ...ids]
    );
    const knownIds = new Set(existing.map(r => r.google_event_id).filter(Boolean));
    const takenSlots = new Set(existing.map(r => `${r.fecha}|${r.hora}`));

    const statements = [];
    const createdAt = new Date().toISOString();
    for (const { evt, fecha, hora } of parsed) {
        const slot = `${fecha}|${hora}`;
        if (knownIds.has(evt.id) || takenSlots.has(slot)) { omitidos++; continue; }
        knownIds.add(evt.id);
        takenSlots.add(slot);

        let paciente = evt.summary;
        let motivo = 'Cita de Google Calendar';
        if (evt.summary && evt.summary.startsWith('Cita:')) {
            const clean = evt.summary.replace('Cita:', '').trim();
            const sep = clean.indexOf(' - ');
            paciente = sep === -1 ? clean : clean.slice(0, sep).trim();
            if (sep !== -1) motivo = clean.slice(sep + 3).trim() || motivo;
        }

        statements.push({
            sql: `INSERT INTO citas (id, nombre_paciente, fecha, hora, motivo, estado, doctor, id_sillon, google_event_id, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            args: [crypto.randomUUID(), paciente, fecha, hora, motivo, 'programada', 'Dra. Rosa Avila', 'sillon_1', evt.id, createdAt]
        });
    }

    // Lotes transaccionales: un corte deja lotes completos; re-ejecutar es idempotente por google_event_id.
    let importados = 0;
    try {
        for (let i = 0; i < statements.length; i += 200) {
            const chunk = statements.slice(i, i + 200);
            await db.batch(chunk);
            importados += chunk.length;
        }
    } catch (err) {
        console.error('⚠️ Error guardando eventos importados:', err.message);
        return { success: false, reason: 'Sincronización parcial; vuelve a ejecutarla', totalGoogle: events.length, importados, omitidos };
    }

    return { success: true, totalGoogle: events.length, importados, omitidos };
}

module.exports = {
    CALENDAR_ID,
    getCalendarClient,
    createCalendarEvent,
    updateCalendarEvent,
    listCalendarEvents,
    deleteCalendarEvent,
    syncGoogleEventsToDb,
    parseToIso
};
