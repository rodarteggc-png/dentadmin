/* ════════════════════════════════════════
   DentAdmin – test.js
   Suite de pruebas en consola
   Ejecutar: Copiar/pegar en la consola del navegador
   o cargar con <script src="test.js"></script>
════════════════════════════════════════ */

(function() {
  'use strict';

  let passed = 0, failed = 0;
  const results = [];

  function assert(condition, name) {
    if (condition) {
      passed++;
      results.push(`  ✅ ${name}`);
    } else {
      failed++;
      results.push(`  ❌ ${name}`);
    }
  }

  function section(title) {
    results.push(`\n══ ${title} ══`);
  }

  // ── Limpiar localStorage para test limpio ──
  localStorage.clear();
  seedData();

  // ════════════════════════════════════════
  // 1. BASE DE DATOS
  // ════════════════════════════════════════
  section('1. BASE DE DATOS (localStorage)');

  // Seed verificar
  assert(DB.get('pacientes').length === 5, 'Seed: 5 pacientes cargados');
  assert(DB.get('citas').length === 5, 'Seed: 5 citas cargadas');
  assert(DB.get('pagos').length === 3, 'Seed: 3 pagos cargados');

  // Add
  const newPac = DB.add('pacientes', { nombre: 'TEST User', telefono: '000-000-0000', correo: 'test@test.com' });
  assert(newPac.id, 'DB.add: genera ID automático');
  assert(newPac.createdAt, 'DB.add: genera createdAt');
  assert(DB.get('pacientes').length === 6, 'DB.add: incrementa lista');

  // Find
  const found = DB.find('pacientes', newPac.id);
  assert(found && found.nombre === 'TEST User', 'DB.find: encuentra por ID');

  // Update
  DB.update('pacientes', newPac.id, { telefono: '111-111-1111' });
  const updated = DB.find('pacientes', newPac.id);
  assert(updated.telefono === '111-111-1111', 'DB.update: actualiza campo');

  // Remove
  DB.remove('pacientes', newPac.id);
  assert(DB.get('pacientes').length === 5, 'DB.remove: elimina correctamente');
  assert(!DB.find('pacientes', newPac.id), 'DB.remove: ya no existe');

  // ════════════════════════════════════════
  // 2. NAVEGACIÓN
  // ════════════════════════════════════════
  section('2. NAVEGACIÓN SIDEBAR');

  navigateTo('citas');
  assert(document.getElementById('section-citas').classList.contains('section--active'), 'Nav: sección Citas activa');
  assert(!document.getElementById('section-dashboard').classList.contains('section--active'), 'Nav: Dashboard inactivo');
  assert(document.getElementById('topbar-title').textContent === 'Citas', 'Nav: topbar muestra "Citas"');

  navigateTo('pacientes');
  assert(document.getElementById('section-pacientes').classList.contains('section--active'), 'Nav: sección Pacientes activa');
  assert(document.getElementById('topbar-title').textContent === 'Pacientes', 'Nav: topbar muestra "Pacientes"');

  navigateTo('pagos');
  assert(document.getElementById('section-pagos').classList.contains('section--active'), 'Nav: sección Pagos activa');

  navigateTo('reportes');
  assert(document.getElementById('section-reportes').classList.contains('section--active'), 'Nav: sección Reportes activa');

  navigateTo('dashboard');
  assert(document.getElementById('section-dashboard').classList.contains('section--active'), 'Nav: volver a Dashboard');

  // ════════════════════════════════════════
  // 3. NLP - AGENDAR CITA
  // ════════════════════════════════════════
  section('3. NLP – AGENDAR CITA');

  let r = nlpProcess('Agenda a Carlos Mendoza mañana a las 4 de la tarde para una limpieza');
  assert(r.action_type === 'AGENDAR_CITA', 'NLP: detecta AGENDAR_CITA');
  assert(r.status === 'SUCCESS', 'NLP: status SUCCESS con datos completos');
  assert(r.data.nombre_paciente === 'Carlos Mendoza', 'NLP: extrae nombre "Carlos Mendoza"');
  assert(r.data.motivo_o_concepto === 'Limpieza', 'NLP: extrae motivo "Limpieza"');
  assert(r.data.fecha_hora && r.data.fecha_hora.includes('16:00'), 'NLP: extrae hora 16:00');

  r = nlpProcess('Quiero agendar a Maria');
  assert(r.action_type === 'AGENDAR_CITA', 'NLP: detecta AGENDAR_CITA parcial');
  assert(r.status === 'ERROR', 'NLP: status ERROR por datos faltantes');
  assert(r.message.includes('fecha'), 'NLP: mensaje menciona fecha faltante');
  assert(r.message.includes('hora'), 'NLP: mensaje menciona hora faltante');
  assert(r.message.includes('motivo'), 'NLP: mensaje menciona motivo faltante');

  // ════════════════════════════════════════
  // 4. NLP - REGISTRAR PAGO
  // ════════════════════════════════════════
  section('4. NLP – REGISTRAR PAGO');

  r = nlpProcess('Paco acaba de pagar 500 pesos en efectivo por su consulta');
  assert(r.action_type === 'REGISTRAR_PAGO', 'NLP: detecta REGISTRAR_PAGO');
  assert(r.status === 'SUCCESS', 'NLP: status SUCCESS');
  assert(r.data.monto === 500, 'NLP: extrae monto 500');
  assert(r.data.motivo_o_concepto === 'Consulta', 'NLP: extrae concepto "Consulta"');
  assert(r.data.metodo_pago === 'Efectivo', 'NLP: extrae método "Efectivo"');

  r = nlpProcess('Cobrar a Pedro con tarjeta');
  assert(r.action_type === 'REGISTRAR_PAGO', 'NLP: detecta REGISTRAR_PAGO parcial');
  assert(r.status === 'ERROR', 'NLP: ERROR por datos faltantes');
  assert(r.message.includes('monto'), 'NLP: menciona monto faltante');

  // ════════════════════════════════════════
  // 5. NLP - CREAR PACIENTE
  // ════════════════════════════════════════
  section('5. NLP – CREAR PACIENTE');

  r = nlpProcess('Registra al paciente Ana García con teléfono 555-123-4567');
  assert(r.action_type === 'CREAR_PACIENTE', 'NLP: detecta CREAR_PACIENTE');
  assert(r.status === 'SUCCESS', 'NLP: status SUCCESS');
  assert(r.data.nombre_paciente, 'NLP: extrae nombre del paciente');
  assert(r.data.telefono === '555-123-4567', 'NLP: extrae teléfono');

  r = nlpProcess('Crea nuevo paciente Roberto');
  assert(r.action_type === 'CREAR_PACIENTE', 'NLP: detecta CREAR_PACIENTE parcial');
  assert(r.status === 'ERROR', 'NLP: ERROR sin teléfono');

  // ════════════════════════════════════════
  // 6. NLP - ACCIÓN DESCONOCIDA
  // ════════════════════════════════════════
  section('6. NLP – ACCIÓN DESCONOCIDA');

  r = nlpProcess('¿Cuál es la capital de Francia?');
  assert(r.action_type === 'DESCONOCIDO', 'NLP: detecta DESCONOCIDO');
  assert(r.status === 'ERROR', 'NLP: status ERROR');

  // ════════════════════════════════════════
  // 7. NLP EXECUTE → DATOS EN BD
  // ════════════════════════════════════════
  section('7. NLP EXECUTE → PERSISTENCIA');

  const citasBefore = DB.get('citas').length;
  const result = nlpProcess('Agenda a Roberto López hoy a las 3pm para una consulta');
  nlpExecute(result);
  assert(DB.get('citas').length === citasBefore + 1, 'Execute: cita guardada en BD');

  const pagosBefore = DB.get('pagos').length;
  const result2 = nlpProcess('Pago de Roberto López de 750 pesos en tarjeta por consulta');
  nlpExecute(result2);
  assert(DB.get('pagos').length === pagosBefore + 1, 'Execute: pago guardado en BD');

  const pacBefore = DB.get('pacientes').length;
  const result3 = nlpProcess('Registra al paciente Sonia Vega con teléfono 555-999-8888');
  nlpExecute(result3);
  assert(DB.get('pacientes').length === pacBefore + 1, 'Execute: paciente guardado en BD');

  // ════════════════════════════════════════
  // 8. RENDERS DE TABLAS
  // ════════════════════════════════════════
  section('8. RENDERS DE TABLAS');

  navigateTo('citas');
  const citasRows = document.querySelectorAll('#citas-tbody tr').length;
  assert(citasRows > 0, `Citas: tabla tiene ${citasRows} filas`);

  navigateTo('pacientes');
  const pacRows = document.querySelectorAll('#pacientes-tbody tr').length;
  assert(pacRows > 0, `Pacientes: tabla tiene ${pacRows} filas`);

  navigateTo('pagos');
  const pagoRows = document.querySelectorAll('#pagos-tbody tr').length;
  assert(pagoRows > 0, `Pagos: tabla tiene ${pagoRows} filas`);

  // ════════════════════════════════════════
  // 9. DASHBOARD STATS
  // ════════════════════════════════════════
  section('9. DASHBOARD STATS');

  navigateTo('dashboard');
  refreshDashboard();
  const statPac = document.getElementById('stat-pacientes').textContent;
  assert(parseInt(statPac) === DB.get('pacientes').length, `Dashboard: stat pacientes = ${statPac}`);

  // ════════════════════════════════════════
  // 10. REPORTES
  // ════════════════════════════════════════
  section('10. REPORTES');

  navigateTo('reportes');
  const rptPac = document.getElementById('rpt-pacientes').textContent;
  assert(parseInt(rptPac) === DB.get('pacientes').length, `Reportes: KPI pacientes = ${rptPac}`);

  // ════════════════════════════════════════
  // RESULTADOS
  // ════════════════════════════════════════
  results.push('');
  results.push('════════════════════════════════════════');
  results.push(`  RESULTADOS: ${passed} passed ✅  /  ${failed} failed ❌  /  ${passed+failed} total`);
  results.push('════════════════════════════════════════');

  // Volver al dashboard
  navigateTo('dashboard');

  // Imprimir
  console.log(results.join('\n'));

  // Mostrar resumen visual
  const summary = document.createElement('div');
  summary.style.cssText = `
    position: fixed; top: 20px; right: 20px; z-index: 9999;
    background: ${failed ? '#FEF2F2' : '#F0FDF4'};
    border: 2px solid ${failed ? '#DC2626' : '#16A34A'};
    border-radius: 12px; padding: 20px 28px;
    font-family: Inter, sans-serif; box-shadow: 0 8px 30px rgba(0,0,0,.15);
    max-height: 80vh; overflow-y: auto; min-width: 340px;
  `;
  summary.innerHTML = `
    <h3 style="margin:0 0 12px;font-size:16px;color:${failed?'#DC2626':'#16A34A'}">
      ${failed ? '❌' : '🎉'} Test Results: ${passed}/${passed+failed}
    </h3>
    <pre style="font-size:12px;line-height:1.8;white-space:pre-wrap;color:#374151;margin:0">${results.join('\n')}</pre>
    <button onclick="this.parentElement.remove()" style="
      margin-top:14px;padding:6px 16px;border:none;border-radius:6px;
      background:${failed?'#DC2626':'#16A34A'};color:#fff;cursor:pointer;font-weight:600;font-size:13px;
    ">Cerrar</button>
  `;
  document.body.appendChild(summary);

})();
