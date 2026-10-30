/* ════════════════════════════════════════
   CareDent – app.js  (v2 – 8 acciones NLP)
   Persistencia: localStorage
════════════════════════════════════════ */
'use strict';

let isDarkMode = localStorage.getItem('theme') === 'dark';
if (isDarkMode) document.documentElement.setAttribute('data-theme', 'dark');

window.toggleTheme = function() {
    isDarkMode = !isDarkMode;
    if (isDarkMode) {
        document.documentElement.setAttribute('data-theme', 'dark');
        localStorage.setItem('theme', 'dark');
    } else {
        document.documentElement.removeAttribute('data-theme');
        localStorage.setItem('theme', 'light');
    }
};

/* ─── 1. BASE DE DATOS ─── */
/* ─── 1. BASE DE DATOS (Sincronizada con Backend Real) ─── */
const DB = {
  cache: {},
  getHeaders() {
    const token = localStorage.getItem('token');
    return {
      'Content-Type': 'application/json',
      'Authorization': token ? `Bearer ${token}` : ''
    };
  },
  
  handleError(res) {
    // 401 = sesión inválida. 403 = rol sin permiso: no debe cerrar la sesión.
    if (res.status === 401) {
       logout();
       throw new Error('No autorizado');
    }
    if (!res.ok) {
       const err = new Error(res.status === 403 ? 'Sin permiso' : `HTTP ${res.status}`);
       err.status = res.status;
       throw err;
    }
    return res;
  },

  collections: ['pacientes', 'citas', 'pagos', 'historia', 'presupuestos', 'gastos', 'inventario', 'tareas', 'odontogramas', 'archivos', 'recetas', 'usuarios', 'antecedentes', 'periodontogramas', 'ortodoncia', 'prestaciones', 'tratamientos_detalles', 'abonos_tratamientos', 'sillones', 'laboratorios_ordenes'],

  async reload(cols) {
    await Promise.all(cols.map(async (col) => {
      try {
        const res = await fetch(`/api/${col}`, { headers: this.getHeaders() }).then(r => this.handleError(r));
        this.cache[col] = await res.json();
      } catch (e) {
        if (e.status === 403) { this.cache[col] = []; return; }
        throw e;
      }
    }));
  },

  // Inicialización (carga todo del servidor a la caché local, en paralelo)
  async init() {
    if (!localStorage.getItem('token')) return; // No init si no hay login
    try {
      await this.reload(this.collections);
    } catch (e) {
      console.error('Error conectando al backend:', e);
      if(e.message !== 'No autorizado') showToast('Error conectando al servidor', 'error');
    }
  },
  
  get(n) { 
      return this.cache[n] || []; 
  },
  
  add(n, item) {
    const l = this.get(n);
    l.push(item);
    this.cache[n] = l;
    
    fetch(`/api/${n}`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(item)
    }).then(r => this.handleError(r)).then(res => res.json()).then(savedItem => {
        const i = l.indexOf(item);
        if (i !== -1) l[i] = savedItem;
    }).catch(err => {
        const i = l.indexOf(item);
        if (i !== -1) l.splice(i, 1);
        showToast(err.status === 403 ? 'Tu rol no tiene permiso para guardar aquí' : 'Error de red al guardar', 'error');
    });
    return item;
  },
  
  update(n, id, p) {
    const l = this.get(n);
    const i = l.findIndex(x => x.id === id);
    let original = null;
    if (i !== -1) {
        original = { ...l[i] };
        Object.assign(l[i], p);
    }
    fetch(`/api/${n}/${id}`, {
        method: 'PUT',
        headers: this.getHeaders(),
        body: JSON.stringify(p)
    }).then(r => this.handleError(r)).catch(()=>{
        if (i !== -1 && original) {
            Object.assign(l[i], original);
            // We'd ideally re-render here, but just a toast for now
        }
        showToast('Error al actualizar (revertido)', 'error');
    });
  },
  
  remove(n, id) {
    const l = this.get(n);
    const original = l.find(x => x.id === id);
    this.cache[n] = l.filter(x => x.id !== id);
    fetch(`/api/${n}/${id}`, { method: 'DELETE', headers: this.getHeaders() })
      .then(r => this.handleError(r)).catch(()=>{
         if (original) {
            const nl = this.get(n);
            nl.push(original);
            this.cache[n] = nl;
         }
         showToast('Error al eliminar (revertido)', 'error');
      });
  },
  
  find(n, id) {
    return this.get(n).find(x => x.id === id) || null;
  }
};

/* ─── AUTHENTICATION ─── */
async function handleLogin(e) {
  e.preventDefault();
  const u = document.getElementById('login-user').value;
  const p = document.getElementById('login-pass').value;
  
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: u, password: p })
    });
    
    const data = await res.json();
    if (res.ok && data.success) {
      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));
      checkAuth();
      await DB.init();
      refreshDashboard();
      // Renderizar vistas si se quedó una abierta
      const activeSection = document.querySelector('.nav-item--active')?.dataset?.section;
      if(activeSection && activeSection !== 'dashboard') navigateTo(activeSection);
    } else {
      showToast(data.error || 'Error al iniciar sesión', 'error');
    }
  } catch (error) {
    showToast('Error de conexión', 'error');
  }
}

function logout() {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  checkAuth();
}

function checkAuth() {
  const token = localStorage.getItem('token');
  const loginScreen = document.getElementById('login-screen');
  const mainLayout = document.getElementById('main-layout');
  const sidebar = document.getElementById('sidebar');
  
  if (token) {
    loginScreen.style.display = 'none';
    mainLayout.style.display = 'flex';
    sidebar.style.display = 'flex';
    
    // Update user info
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    const ini = (user.username || 'U').substring(0,2).toUpperCase();
    document.getElementById('sidebar-username').textContent = user.username;
    document.getElementById('sidebar-rol').textContent = user.rol;
    document.getElementById('sidebar-avatar').textContent = ini;
    document.getElementById('topbar-username').textContent = user.username;
    document.getElementById('topbar-avatar').textContent = ini;
    
    applyRoles(user);
  } else {
    loginScreen.style.display = 'flex';
    mainLayout.style.display = 'none';
    sidebar.style.display = 'none';
  }
}

const ROLES_PERMISSIONS = {
  administrador: {
    nombre: 'Administrador(a)',
    descripcion: 'Acceso total y sin restricciones a todos los módulos clínicos, financieros, inventario, reportes y control de usuarios.',
    secciones: ['dashboard', 'citas', 'pacientes', 'historia', 'gabinete', 'recetas', 'presupuestos', 'aranceles', 'laboratorio', 'pagos', 'gastos', 'inventario', 'tareas', 'reportes', 'usuarios']
  },
  doctor: {
    nombre: 'Doctor(a) / Odontólogo(a)',
    descripcion: 'Control clínico completo: agenda multi-sillón, expedientes, odontograma FDI, periodontograma, ortodoncia, gabinete de rayos X, recetas, presupuestos, aranceles, laboratorio dental y cobros.',
    secciones: ['dashboard', 'citas', 'pacientes', 'historia', 'gabinete', 'recetas', 'presupuestos', 'aranceles', 'laboratorio', 'pagos', 'tareas']
  },
  asistente: {
    nombre: 'Asistente Dental',
    descripcion: 'Apoyo clínico y operativo: consulta de citas, visualización de expedientes y odontograma, gabinete radiográfico, control de inventario de insumos, recepción de órdenes de laboratorio y tareas asignadas.',
    secciones: ['dashboard', 'citas', 'pacientes', 'historia', 'gabinete', 'inventario', 'laboratorio', 'tareas']
  },
  recepcion: {
    nombre: 'Recepción / Caja',
    descripcion: 'Atención y administración de pacientes: control de agenda de citas, alta y búsqueda de pacientes, entrega de presupuestos, cobro en caja de pagos y recepción de paquetes de laboratorio.',
    secciones: ['dashboard', 'citas', 'pacientes', 'presupuestos', 'laboratorio', 'pagos', 'tareas']
  }
};

function applyRoles(user) {
    const rol = user.rol || 'recepcion';
    const config = ROLES_PERMISSIONS[rol] || ROLES_PERMISSIONS['recepcion'];
    const permitidas = config.secciones;

    // Mostrar u ocultar cada elemento de navegación según las secciones permitidas del rol
    document.querySelectorAll('.sidebar__nav .nav-item[data-section]').forEach(el => {
        const sec = el.getAttribute('data-section');
        if (sec === 'dashboard') {
            el.style.display = 'flex';
            return;
        }
        if (permitidas.includes(sec)) {
            el.style.display = 'flex';
        } else {
            el.style.display = 'none';
        }
    });

    // Control de la sección y divisor de Usuarios (estrictamente exclusivo de administrador)
    const navDivAdmin = document.getElementById('nav-divider-admin');
    const navItemUsuarios = document.getElementById('nav-item-usuarios');
    if (rol === 'administrador') {
        if (navDivAdmin) navDivAdmin.style.display = 'block';
        if (navItemUsuarios) navItemUsuarios.style.display = 'flex';
    } else {
        if (navDivAdmin) navDivAdmin.style.display = 'none';
        if (navItemUsuarios) navItemUsuarios.style.display = 'none';
    }
}

/* ─── SEED (Movido al Backend) ─── */
function seedData() { 
    // Ya no se usa localmente, lo maneja DB.init()
}

/* ─── 2. UTILIDADES ─── */
const pad=n=>String(n).padStart(2,'0');
function fmt(d){return`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`}
function addDays(d,n){const r=new Date(d);r.setDate(r.getDate()+n);return r}
function todayStr(){return fmt(new Date())}
function escH(s){return String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;')}

// Stock calculado en el servidor (UPDATE stock = stock ± n): dos equipos no se pisan el inventario.
async function registrarMovimientoInventario(insumo, tipo, cantidad) {
  try {
    const res = await fetch('/api/inventario/movimiento', {
      method: 'POST',
      headers: DB.getHeaders(),
      body: JSON.stringify({ insumo, tipo, cantidad, fecha: todayStr() })
    }).then(r => DB.handleError(r));
    const row = await res.json();
    const list = DB.get('inventario');
    const i = list.findIndex(x => x.id === row.id);
    if (i === -1) list.push(row); else list[i] = row;
    DB.cache.inventario = list;
    if (document.querySelector('.nav-item--active')?.dataset?.section === 'inventario') renderInventario();
  } catch (e) {
    showToast(e.status === 403 ? 'Tu rol no tiene permiso sobre inventario' : 'Error: el movimiento de inventario NO se registró', 'error');
  }
}
function fmtMoney(n){return'$ '+Number(n||0).toLocaleString('es-MX',{minimumFractionDigits:0,maximumFractionDigits:0})}
function prettyDate(d){if(!d)return'-';return new Date(d+'T00:00:00').toLocaleDateString('es-MX',{year:'numeric',month:'short',day:'numeric'})}

/* ─── ODONTOGRAMA LOGIC ─── */
let currentPacienteOdonto = null;

/* ─── ODONTOGRAMA MULTI-DENTICIÓN (OPCIÓN 1 - DENTALINK) ─── */
let currentOdontoMode = 'adulto'; // 'adulto', 'infantil', 'mixto'

function setOdontoMode(mode, btn) {
  currentOdontoMode = mode;
  if (btn) {
    btn.parentElement.querySelectorAll('.filter-tab').forEach(b => b.classList.remove('filter-tab--active'));
    btn.classList.add('filter-tab--active');
  }
  if (currentPacienteOdonto) {
    renderOdontograma(currentPacienteOdonto);
  }
}

function renderOdontograma(pacienteNombre) {
  const container = document.getElementById('odontograma-container');
  if (!container) return;
  container.innerHTML = '';
  if (!pacienteNombre) return;
  
  let cuadrantes = [];
  if (currentOdontoMode === 'adulto') {
    cuadrantes = [
      { label: 'Maxilar Superior (Permanente: 18 - 28)', piezas: [18,17,16,15,14,13,12,11, 21,22,23,24,25,26,27,28] },
      { label: 'Mandíbula Inferior (Permanente: 48 - 38)', piezas: [48,47,46,45,44,43,42,41, 31,32,33,34,35,36,37,38] }
    ];
  } else if (currentOdontoMode === 'infantil') {
    cuadrantes = [
      { label: 'Maxilar Superior Deciduo / Temporal (55 - 65)', piezas: [55,54,53,52,51, 61,62,63,64,65] },
      { label: 'Mandíbula Inferior Decidua / Temporal (85 - 75)', piezas: [85,84,83,82,81, 71,72,73,74,75] }
    ];
  } else if (currentOdontoMode === 'mixto') {
    cuadrantes = [
      { label: 'Maxilar Superior Permanente', piezas: [18,17,16,15,14,13,12,11, 21,22,23,24,25,26,27,28] },
      { label: 'Maxilar Superior Temporal (Deciduo)', piezas: [55,54,53,52,51, 61,62,63,64,65] },
      { label: 'Mandíbula Inferior Temporal (Deciduo)', piezas: [85,84,83,82,81, 71,72,73,74,75] },
      { label: 'Mandíbula Inferior Permanente', piezas: [48,47,46,45,44,43,42,41, 31,32,33,34,35,36,37,38] }
    ];
  }
  
  const odontogramasData = DB.get('odontogramas').filter(o => o.nombre_paciente === pacienteNombre);

  cuadrantes.forEach(bloque => {
    const blockWrapper = document.createElement('div');
    blockWrapper.style.width = '100%';
    blockWrapper.style.marginBottom = '12px';

    const labelDiv = document.createElement('div');
    labelDiv.style.fontSize = '11px';
    labelDiv.style.fontWeight = '600';
    labelDiv.style.color = 'var(--gray-500)';
    labelDiv.style.textAlign = 'center';
    labelDiv.style.marginBottom = '4px';
    labelDiv.textContent = bloque.label;
    blockWrapper.appendChild(labelDiv);

    const filaDiv = document.createElement('div');
    filaDiv.className = 'odontograma-fila';
    filaDiv.style.display = 'flex';
    filaDiv.style.justifyContent = 'center';
    filaDiv.style.gap = currentOdontoMode === 'infantil' ? '12px' : '6px';

    bloque.piezas.forEach(diente => {
      const dData = odontogramasData.filter(o => o.diente == diente);
      const isAusente = dData.some(o => o.cara === 'C' && o.estado === 'ausente');
      const isCorona = dData.some(o => o.cara === 'C' && o.estado === 'corona');

      // Obtener clases para cada cara
      const getCaraClass = (caraId) => {
        if (isCorona) return 'cara'; // Corona se pinta todo vía CSS del contenedor
        const registro = dData.find(o => o.cara === caraId);
        return registro ? `cara ${registro.estado}` : 'cara';
      };

      const dienteHtml = `
        <div class="diente-container ${isAusente ? 'diente-ausente' : ''} ${isCorona ? 'diente-corona' : ''}" data-diente="${diente}">
          <div class="diente-numero">${diente}</div>
          <svg class="diente-svg" viewBox="0 0 30 30" onclick="handleDienteClick(event, ${diente})">
            <!-- Arriba (Vestibular/Palatino) -->
            <polygon points="0,0 30,0 22,8 8,8" class="${getCaraClass('T')}" data-cara="T" />
            <!-- Abajo (Lingual/Vestibular) -->
            <polygon points="8,22 22,22 30,30 0,30" class="${getCaraClass('B')}" data-cara="B" />
            <!-- Izquierda (Distal/Mesial) -->
            <polygon points="0,0 8,8 8,22 0,30" class="${getCaraClass('L')}" data-cara="L" />
            <!-- Derecha (Mesial/Distal) -->
            <polygon points="30,0 30,30 22,22 22,8" class="${getCaraClass('R')}" data-cara="R" />
            <!-- Centro (Oclusal) -->
            <polygon points="8,8 22,8 22,22 8,22" class="${getCaraClass('C')}" data-cara="C" />
          </svg>
        </div>
      `;
      filaDiv.innerHTML += dienteHtml;
    });
    blockWrapper.appendChild(filaDiv);
    container.appendChild(blockWrapper);
  });
}

function handleDienteClick(e, diente) {
  if (!currentPacienteOdonto) {
    showToast('Seleccione primero un paciente en la lista superior', 'warning');
    return;
  }
  // Cerrar menú anterior si existe
  const oldMenu = document.getElementById('odonto-menu');
  if (oldMenu) oldMenu.remove();

  const cara = e.target.getAttribute('data-cara');
  if (!cara) return; // Clic fuera del polígono

  const caraNombres = {
    'C': 'Oclusal / Incisal',
    'T': 'Vestibular (Superior)',
    'B': 'Lingual / Palatino (Inferior)',
    'L': 'Mesial / Izquierda',
    'R': 'Distal / Derecha'
  };
  const nombreCara = caraNombres[cara] || cara;

  // Obtener prestaciones del catálogo
  const prestaciones = DB.get('prestaciones');

  // Construir categorías
  const categoriasMap = {};
  prestaciones.forEach(p => {
    const cat = p.categoria || 'General';
    if (!categoriasMap[cat]) categoriasMap[cat] = [];
    categoriasMap[cat].push(p);
  });

  const menu = document.createElement('div');
  menu.id = 'odonto-menu';
  menu.className = 'odontograma-menu dentalink-popup';
  
  // Ajustar posición para que no se desborde en la ventana
  let posX = e.pageX + 10;
  let posY = e.pageY - 10;
  if (posX + 330 > window.innerWidth) posX = window.innerWidth - 340;
  if (posY + 420 > window.innerHeight + window.scrollY) posY = Math.max(10, window.innerHeight + window.scrollY - 430);
  menu.style.left = `${posX}px`;
  menu.style.top = `${posY}px`;

  let htmlPrestaciones = '';
  Object.keys(categoriasMap).forEach(cat => {
    htmlPrestaciones += `<div class="odonto-menu-category-title">${escH(cat)}</div>`;
    categoriasMap[cat].forEach(p => {
      htmlPrestaciones += `
        <div class="odonto-menu-item" onclick="seleccionarPrestacionParaDiente(${diente}, '${cara}', '${p.id}')">
          <span class="odonto-item-name">${escH(p.nombre)}</span>
          <span class="odonto-item-price">$${Number(p.precio).toLocaleString()}</span>
        </div>
      `;
    });
  });

  menu.innerHTML = `
    <div class="odonto-menu-header">
      <div>
        <div class="odonto-menu-title">Pieza #${diente}</div>
        <div class="odonto-menu-subtitle">Cara: ${nombreCara}</div>
      </div>
      <button class="odonto-menu-close" onclick="document.getElementById('odonto-menu')?.remove()">&times;</button>
    </div>

    <div class="odonto-menu-quick-actions">
      <button class="quick-btn quick-realizado" onclick="aplicarEstadoDirecto(${diente}, '${cara}', 'resina', 'Ya Realizado / Preexistente')">
        <span class="quick-dot dot-blue"></span> Ya Realizado (Azul)
      </button>
      <button class="quick-btn quick-corona" onclick="aplicarEstadoDirecto(${diente}, 'C', 'corona', 'Corona / Prótesis')">
        👑 Corona
      </button>
      <button class="quick-btn quick-ausente" onclick="aplicarEstadoDirecto(${diente}, 'C', 'ausente', 'Diente Ausente')">
        ❌ Ausente
      </button>
      <button class="quick-btn quick-limpiar" onclick="aplicarEstadoDirecto(${diente}, '${cara}', 'limpio', 'Limpiar Superficie')">
        🧹 Limpiar
      </button>
    </div>

    <div class="odonto-menu-search">
      <input type="text" placeholder="Buscar prestación o arancel..." id="odonto-search-prestacion" oninput="filtrarPrestacionesMenu(this.value)">
    </div>

    <div class="odonto-menu-list" id="odonto-prestaciones-container">
      ${htmlPrestaciones}
    </div>
  `;

  document.body.appendChild(menu);

  // Cerrar menú al hacer clic fuera
  setTimeout(() => {
    document.addEventListener('click', function closeMenu(evt) {
      if (menu && !menu.contains(evt.target) && !e.target.contains(evt.target)) {
        menu.remove();
        document.removeEventListener('click', closeMenu);
      }
    });
  }, 10);
}

function filtrarPrestacionesMenu(q) {
  const val = (q || '').toLowerCase();
  const items = document.querySelectorAll('#odonto-prestaciones-container .odonto-menu-item');
  items.forEach(it => {
    const text = it.textContent.toLowerCase();
    it.style.display = text.includes(val) ? 'flex' : 'none';
  });
}

function aplicarEstadoDirecto(diente, cara, estado, label) {
  saveOdontograma(diente, cara, estado);
  document.getElementById('odonto-menu')?.remove();
  showToast(`Pieza #${diente}: ${label}`, 'info');
}

function seleccionarPrestacionParaDiente(diente, cara, prestacionId) {
  const p = DB.get('prestaciones').find(x => x.id === prestacionId);
  if (!p) return;

  // 1. Marcar odontograma en rojo (planificado / hallazgo)
  saveOdontograma(diente, cara, 'caries');

  // 2. Registrar en desglose de tratamientos del presupuesto
  DB.add('tratamientos_detalles', {
    nombre_paciente: currentPacienteOdonto,
    diente: String(diente),
    cara: cara,
    id_prestacion: p.id,
    nombre_prestacion: p.nombre,
    precio: p.precio,
    descuento: 0,
    total: p.precio,
    realizado: 0,
    pagado: 0,
    liquidado: 0,
    createdAt: new Date().toISOString()
  });

  document.getElementById('odonto-menu')?.remove();
  showToast(`Agregado al plan: ${p.nombre} ($${p.precio})`, 'success');
  setTimeout(() => {
    loadOdontogramaPaciente();
  }, 120);
}

function renderPlanTratamientoOdonto(paciente) {
  const tbody = document.getElementById('plan-tratamiento-tbody');
  const emptyMsg = document.getElementById('plan-tratamiento-empty');
  const totalBadge = document.getElementById('odonto-total-badge');
  if (!tbody) return;

  const tratamientos = DB.get('tratamientos_detalles').filter(t => t.nombre_paciente === paciente);
  
  if (tratamientos.length === 0) {
    tbody.innerHTML = '';
    if (emptyMsg) emptyMsg.style.display = 'block';
    if (totalBadge) totalBadge.textContent = 'Total: $0';
    return;
  }

  if (emptyMsg) emptyMsg.style.display = 'none';

  let totalMonto = 0;
  let totalPagado = 0;
  let totalSaldo = 0;

  tbody.innerHTML = tratamientos.map(item => {
    const itemTotal = Number(item.total || item.precio || 0);
    const itemPagado = Number(item.pagado || 0);
    const itemSaldo = Math.max(0, itemTotal - itemPagado);
    totalMonto += itemTotal;
    totalPagado += itemPagado;
    totalSaldo += itemSaldo;

    const isRealizado = Number(item.realizado) === 1;
    const badgeEstado = isRealizado
      ? '<span class="badge badge-blue">✓ Realizado</span>'
      : '<span class="badge badge-red">⏳ Planificado</span>';
    
    const saldoBadge = itemSaldo <= 0
      ? '<span class="badge" style="background:#dcfce7; color:#15803d; font-weight:700;">✓ Pagado</span>'
      : `<span class="badge" style="background:#fee2e2; color:#b91c1c; font-weight:700;">$${itemSaldo.toLocaleString()}</span>`;

    const caraLabel = item.cara === 'C' ? 'Oclusal' : 
                     item.cara === 'T' ? 'Vestibular' :
                     item.cara === 'B' ? 'Lingual/Palatino' :
                     item.cara === 'L' ? 'Mesial' :
                     item.cara === 'R' ? 'Distal' : (item.cara || 'Pieza');

    return `
      <tr>
        <td><strong>#${escH(item.diente || '-')}</strong></td>
        <td><small style="color:var(--gray-600);">${escH(caraLabel)}</small></td>
        <td>${escH(item.nombre_prestacion || 'Tratamiento')}</td>
        <td><strong>$${itemTotal.toLocaleString()}</strong></td>
        <td><strong style="color:var(--blue);">$${itemPagado.toLocaleString()}</strong></td>
        <td>${saldoBadge}</td>
        <td>${badgeEstado}</td>
        <td style="white-space:nowrap;">
          ${itemSaldo > 0 ? `<button class="btn-primary" style="padding: 3px 8px; font-size: 11px; margin-right: 4px; background:#10b981; border-color:#059669;" onclick="abrirModalAbonoTratamiento('${item.id}')">💵 Abonar</button>` : ''}
          ${!isRealizado ? `<button class="btn-primary" style="padding: 3px 8px; font-size: 11px; margin-right: 4px;" onclick="marcarTratamientoRealizado('${item.id}')">✓ Realizar</button>` : ''}
          <button class="btn-secondary" style="padding: 3px 8px; font-size: 11px; color: var(--red);" onclick="eliminarTratamientoDetalle('${item.id}')">🗑️</button>
        </td>
      </tr>
    `;
  }).join('');

  if (totalBadge) {
    totalBadge.innerHTML = `Presupuesto: <strong>$${totalMonto.toLocaleString()}</strong> | Pagado: <strong style="color:#059669;">$${totalPagado.toLocaleString()}</strong> | Saldo: <strong style="color:#dc2626;">$${totalSaldo.toLocaleString()}</strong>`;
  }
}

function abrirModalAbonoTratamiento(id) {
  const item = DB.get('tratamientos_detalles').find(t => t.id === id);
  if (!item) return;

  const itemTotal = Number(item.total || item.precio || 0);
  const itemPagado = Number(item.pagado || 0);
  const itemSaldo = Math.max(0, itemTotal - itemPagado);

  const caraNombres = { 'C': 'Oclusal', 'T': 'Vestibular', 'B': 'Lingual/Palatino', 'L': 'Mesial', 'R': 'Distal' };
  const caraStr = caraNombres[item.cara] || item.cara || 'Pieza';

  document.getElementById('abono-tratamiento-id').value = item.id;
  document.getElementById('abono-info-pieza').textContent = `Pieza #${item.diente} (${caraStr})`;
  document.getElementById('abono-info-prestacion').textContent = item.nombre_prestacion;
  document.getElementById('abono-info-costo').textContent = `$${itemTotal.toLocaleString()}`;
  document.getElementById('abono-info-pagado').textContent = `$${itemPagado.toLocaleString()}`;
  document.getElementById('abono-info-saldo').textContent = `$${itemSaldo.toLocaleString()}`;

  document.getElementById('abono-monto').value = itemSaldo;
  document.getElementById('abono-monto').max = itemSaldo;
  document.getElementById('abono-fecha').value = todayStr();
  document.getElementById('abono-notas').value = '';

  document.getElementById('modal-abono-tratamiento')?.removeAttribute('hidden');
}

async function guardarAbonoTratamiento(e) {
  e.preventDefault();
  const id = document.getElementById('abono-tratamiento-id').value;
  const item = DB.get('tratamientos_detalles').find(t => t.id === id);
  if (!item) return;

  const monto = parseFloat(document.getElementById('abono-monto').value) || 0;
  const metodo = document.getElementById('abono-metodo').value;
  const doctor = document.getElementById('abono-doctor').value;
  const fecha = document.getElementById('abono-fecha').value || todayStr();
  const notas = document.getElementById('abono-notas').value;

  if (monto <= 0) return showToast('El monto debe ser mayor a 0', 'error');

  // Una sola petición transaccional: saldo del tratamiento + abono + pago de caja se guardan juntos o no se guarda nada.
  let result;
  try {
    const res = await fetch(`/api/tratamientos_detalles/${encodeURIComponent(item.id)}/abonos`, {
      method: 'POST',
      headers: DB.getHeaders(),
      body: JSON.stringify({ monto, metodo, doctor, fecha, notas })
    });
    if (res.status === 401) return logout();
    result = await res.json();
    if (!res.ok) return showToast(result.error || 'No se pudo registrar el abono', 'error');
  } catch (err) {
    return showToast('Error de red: el abono NO se registró', 'error');
  }

  Object.assign(item, result.tratamiento);
  DB.cache.abonos_tratamientos = [...DB.get('abonos_tratamientos'), result.abono];
  DB.cache.pagos = [...DB.get('pagos'), result.pago];

  closeModal('abono-tratamiento');
  showToast(`Abono de $${monto.toLocaleString()} registrado con éxito`, 'success');
  setTimeout(() => {
    loadOdontogramaPaciente();
  }, 120);
}

function marcarTratamientoRealizado(id) {
  const item = DB.get('tratamientos_detalles').find(t => t.id === id);
  if (!item) return;

  // 1. Actualizar tratamientos_detalles a realizado = 1
  DB.update('tratamientos_detalles', id, {
    realizado: 1,
    fecha_realizado: todayStr()
  });

  // 2. Actualizar el odontograma para que se pinte en azul (resina / realizado)
  if (item.diente && item.cara) {
    const records = DB.get('odontogramas');
    const odontoRecord = records.find(o => o.nombre_paciente === item.nombre_paciente && String(o.diente) === String(item.diente) && o.cara === item.cara);
    if (odontoRecord) {
      DB.update('odontogramas', odontoRecord.id, { estado: 'resina' }); // 'resina' pinta azul en CSS
    } else {
      DB.add('odontogramas', {
        nombre_paciente: item.nombre_paciente,
        diente: String(item.diente),
        cara: item.cara,
        estado: 'resina'
      });
    }
  }

  // 3. Registrar automáticamente nota en evolución clínica (historia)
  DB.add('historia', {
    nombre_paciente: item.nombre_paciente,
    fecha: todayStr(),
    diente_zona: `Pieza #${item.diente} (${item.cara || 'General'})`,
    tratamiento: item.nombre_prestacion,
    descripcion: `Tratamiento realizado exitosamente. Costo: $${item.total || item.precio}`
  });

  showToast(`Tratamiento marcado como realizado: ${item.nombre_prestacion}`, 'success');
  setTimeout(() => {
    loadOdontogramaPaciente();
  }, 120);
}

function eliminarTratamientoDetalle(id) {
  const item = DB.get('tratamientos_detalles').find(t => t.id === id);
  if (!item) return;
  
  // Limpiar el odontograma si corresponde
  if (item.diente && item.cara) {
    const records = DB.get('odontogramas');
    const odontoRecord = records.find(o => o.nombre_paciente === item.nombre_paciente && String(o.diente) === String(item.diente) && o.cara === item.cara);
    if (odontoRecord) {
      DB.remove('odontogramas', odontoRecord.id);
    }
  }

  DB.remove('tratamientos_detalles', id);
  showToast('Procedimiento eliminado del plan', 'info');
  setTimeout(() => {
    loadOdontogramaPaciente();
  }, 120);
}

function saveOdontograma(diente, cara, estado) {
  if (!currentPacienteOdonto) return;
  // Buscar si ya existe el registro para ese diente y cara del paciente
  const records = DB.get('odontogramas');
  const existente = records.find(o => o.nombre_paciente === currentPacienteOdonto && o.diente == diente && o.cara == cara);
  
  if (estado === 'limpio') {
    if (existente) DB.remove('odontogramas', existente.id);
  } else {
    if (existente) {
      DB.update('odontogramas', existente.id, { estado });
    } else {
      DB.add('odontogramas', { nombre_paciente: currentPacienteOdonto, diente: String(diente), cara, estado });
    }
  }
  
  setTimeout(() => renderOdontograma(currentPacienteOdonto), 100);
}

function loadOdontogramaPaciente() {
  const select = document.getElementById('odontograma-paciente-select');
  const paciente = select.value;
  currentPacienteOdonto = paciente;
  
  if (paciente) {
    document.getElementById('odontograma-layout').style.display = 'flex';
    document.getElementById('historia-global-container').style.display = 'none';
    renderOdontograma(paciente);
    renderPlanTratamientoOdonto(paciente);
    
    // Filtrar tabla historia a este paciente
    const trs = document.getElementById('historia-paciente-tbody');
    trs.innerHTML = '';
    DB.get('historia').filter(h => h.nombre_paciente === paciente).reverse().forEach(item => {
      trs.innerHTML += `<tr><td>${item.fecha}</td><td>${escH(item.diente_zona||'-')}</td><td>${escH(item.tratamiento)}</td><td>${escH(item.descripcion)}</td><td><button class="btn-secondary" onclick="DB.remove('historia','${item.id}');loadOdontogramaPaciente()">Eliminar</button></td></tr>`;
    });
    
    // Cargar antecedentes
    loadAntecedentes(paciente);
    // Renderizar periodontograma
    renderPeriodontograma(paciente);
    // Renderizar ortodoncia
    renderOrtodoncia(paciente);

  } else {
    document.getElementById('odontograma-layout').style.display = 'none';
    document.getElementById('historia-global-container').style.display = 'block';
  }
}

function switchHistoriaTab(tabId, btnElement) {
  // Manejo de botones (UI)
  const tabs = btnElement.parentElement.querySelectorAll('.filter-tab');
  tabs.forEach(t => t.classList.remove('filter-tab--active'));
  btnElement.classList.add('filter-tab--active');

  // Mostrar el tab correspondiente
  document.getElementById('hist-tab-odontograma').style.display = 'none';
  document.getElementById('hist-tab-antecedentes').style.display = 'none';
  document.getElementById('hist-tab-periodontograma').style.display = 'none';
  document.getElementById('hist-tab-ortodoncia').style.display = 'none';

  if (tabId === 'odontograma') {
      document.getElementById('hist-tab-odontograma').style.display = 'flex';
  } else {
      document.getElementById('hist-tab-' + tabId).style.display = 'block';
  }
}

function loadAntecedentes(paciente) {
  const data = DB.get('antecedentes').find(a => a.nombre_paciente === paciente);
  document.getElementById('ant-alergias').value = data ? data.alergias : '';
  document.getElementById('ant-enfermedades').value = data ? data.enfermedades : '';
  document.getElementById('ant-medicamentos').value = data ? data.medicamentos_actuales : '';
  document.getElementById('ant-alertas').value = data ? data.alertas_medicas : '';
}

function saveAntecedentes() {
  if (!currentPacienteOdonto) return showToast('Seleccione un paciente', 'error');
  const alergias = document.getElementById('ant-alergias').value;
  const enfermedades = document.getElementById('ant-enfermedades').value;
  const medicamentos = document.getElementById('ant-medicamentos').value;
  const alertas = document.getElementById('ant-alertas').value;
  
  const existente = DB.get('antecedentes').find(a => a.nombre_paciente === currentPacienteOdonto);
  if (existente) {
      DB.update('antecedentes', existente.id, { alergias, enfermedades, medicamentos_actuales: medicamentos, alertas_medicas: alertas });
  } else {
      DB.add('antecedentes', { nombre_paciente: currentPacienteOdonto, alergias, enfermedades, medicamentos_actuales: medicamentos, alertas_medicas: alertas });
  }
  showToast('Antecedentes guardados', 'success');
}

function renderOrtodoncia(paciente) {
  const data = DB.get('ortodoncia').filter(o => o.nombre_paciente === paciente);
  data.sort((a,b) => b.fecha.localeCompare(a.fecha)); // Most recent first
  const tb = document.getElementById('ortodoncia-tbody');
  if(!tb) return;
  if (!data.length) {
      tb.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--gray-400);">Sin registros de ortodoncia</td></tr>';
      return;
  }
  tb.innerHTML = data.map(o => `
      <tr>
          <td>${prettyDate(o.fecha)}</td>
          <td>${escH(o.aparatologia || '-')}</td>
          <td>${escH(o.ligas || '-')}</td>
          <td>${escH(o.higiene || '-')}</td>
          <td>${escH(o.notas || '-')}</td>
          <td><div class="td-actions"><button class="btn-icon" title="Editar" onclick="openModal('ortodoncia', DB.find('ortodoncia', '${o.id}'))">${editIcon}</button><button class="btn-icon btn-icon--danger" title="Eliminar" onclick="quickDelete('ortodoncia', '${o.id}')">${delIcon}</button></div></td>
      </tr>
  `).join('');
}

function renderPeriodontograma(paciente) {
    const tb = document.getElementById('tb-periodontograma');
    if (!tb) return;
    const data = DB.get('periodontogramas').filter(p => p.nombre_paciente === paciente);
    
    // Dientes Superiores (18-11, 21-28)
    const superiores = [18,17,16,15,14,13,12,11, 21,22,23,24,25,26,27,28];
    // Dientes Inferiores (48-41, 31-38)
    const inferiores = [48,47,46,45,44,43,42,41, 31,32,33,34,35,36,37,38];

    let html = `
      <tr>
        <th style="background:#f9fafb; width:120px;">Diente</th>
        ${superiores.map(d => `<th style="background:#eff6ff;">${d}</th>`).join('')}
      </tr>
      <tr>
        <td style="background:#f9fafb; font-weight:bold;">Sondaje V/P</td>
        ${superiores.map(d => {
            const r = data.find(p => String(p.diente) === String(d));
            return `<td>${r ? r.sondaje : '-'}</td>`;
        }).join('')}
      </tr>
      <tr>
        <td style="background:#f9fafb; font-weight:bold;">Sangrado / Mov.</td>
        ${superiores.map(d => {
            const r = data.find(p => String(p.diente) === String(d));
            const m = r ? r.movilidad : '0';
            const bg = r && r.sangrado ? '#fee2e2' : 'transparent';
            const color = r && r.sangrado ? '#b91c1c' : '#374151';
            return `<td style="background:${bg}; color:${color}; font-weight:bold;">${m > 0 ? `M${m}` : ''}</td>`;
        }).join('')}
      </tr>
      <tr style="height:20px;"></tr>
      <tr>
        <th style="background:#f9fafb; width:120px;">Diente</th>
        ${inferiores.map(d => `<th style="background:#eff6ff;">${d}</th>`).join('')}
      </tr>
      <tr>
        <td style="background:#f9fafb; font-weight:bold;">Sondaje V/L</td>
        ${inferiores.map(d => {
            const r = data.find(p => String(p.diente) === String(d));
            return `<td>${r ? r.sondaje : '-'}</td>`;
        }).join('')}
      </tr>
      <tr>
        <td style="background:#f9fafb; font-weight:bold;">Sangrado / Mov.</td>
        ${inferiores.map(d => {
            const r = data.find(p => String(p.diente) === String(d));
            const m = r ? r.movilidad : '0';
            const bg = r && r.sangrado ? '#fee2e2' : 'transparent';
            const color = r && r.sangrado ? '#b91c1c' : '#374151';
            return `<td style="background:${bg}; color:${color}; font-weight:bold;">${m > 0 ? `M${m}` : ''}</td>`;
        }).join('')}
      </tr>
    `;
    tb.innerHTML = html;
}

function savePeriodontograma(e) {
    e.preventDefault();
    if (!currentPacienteOdonto) return showToast('Seleccione un paciente en la Historia Clínica primero', 'error');
    
    const diente = document.getElementById('perio-diente').value;
    const sondaje = document.getElementById('perio-sondaje').value;
    const sangrado = document.getElementById('perio-sangrado').checked;
    const movilidad = document.getElementById('perio-movilidad').value;
    
    const existente = DB.get('periodontogramas').find(p => p.nombre_paciente === currentPacienteOdonto && String(p.diente) === String(diente));
    
    if (existente) {
        DB.update('periodontogramas', existente.id, { sondaje, sangrado, movilidad, fecha: todayStr() });
    } else {
        DB.add('periodontogramas', { nombre_paciente: currentPacienteOdonto, diente, sondaje, sangrado, movilidad, fecha: todayStr() });
    }
    
    closeModal('periodontograma');
    showToast('Sondaje guardado', 'success');
    renderPeriodontograma(currentPacienteOdonto);
}


/* ─── GABINETE LOGIC ─── */
let currentGabinetePaciente = null;

function actualizarInfoRolModal(rol) {
  const descEl = document.getElementById('u-rol-desc');
  if (!descEl) return;
  const descripciones = {
    administrador: '👑 <strong>Administrador(a):</strong> Acceso total y sin restricciones a todos los módulos clínicos, financieros (caja, pagos y gastos), aranceles, inventario, reportes y control de usuarios.',
    doctor: '🩺 <strong>Doctor(a) / Odontólogo(a):</strong> Control clínico completo: agenda multi-sillón, expedientes, odontograma FDI, periodontograma, ortodoncia, gabinete de rayos X, recetas, presupuestos, aranceles, laboratorio dental y cobros.',
    asistente: '🧤 <strong>Asistente Dental:</strong> Apoyo clínico y operativo: consulta de citas, visualización de expedientes y odontograma, gabinete radiográfico, control de inventario de insumos, recepción de órdenes de laboratorio y tareas asignadas.',
    recepcion: '📋 <strong>Recepción / Caja:</strong> Atención y administración de pacientes: control de agenda de citas, alta y búsqueda de pacientes, entrega de presupuestos, cobro en caja de pagos y recepción de paquetes de laboratorio.'
  };
  descEl.innerHTML = descripciones[rol] || descripciones['doctor'];
}

function renderUsuarios() {
  const t = document.getElementById('tb-usuarios');
  if (!t) return;
  const users = DB.get('usuarios');
  if (users.length === 0) {
    t.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:15px; color:var(--gray-400);">No hay usuarios registrados</td></tr>';
    return;
  }

  const roleMeta = {
    administrador: {
      badge: '<span class="badge" style="background:#fee2e2; color:#b91c1c; font-weight:700;">Administrador(a)</span>',
      alcance: 'Acceso total y configuración de todo el sistema'
    },
    doctor: {
      badge: '<span class="badge" style="background:#dbeafe; color:#1e40af; font-weight:700;">Doctor(a)</span>',
      alcance: 'Clínica, Odontograma FDI, Citas, Recetas, Presupuestos, Rayos X y Lab'
    },
    asistente: {
      badge: '<span class="badge" style="background:#fef3c7; color:#92400e; font-weight:700;">Asistente Dental</span>',
      alcance: 'Citas, Odontograma, Gabinete, Insumos/Inventario y Recepción de Lab'
    },
    recepcion: {
      badge: '<span class="badge" style="background:#dcfce7; color:#15803d; font-weight:700;">Recepción / Caja</span>',
      alcance: 'Agenda de Citas, Alta de Pacientes, Cobros en Caja, Presupuestos y Lab'
    }
  };

  t.innerHTML = users.map(u => {
    const meta = roleMeta[u.rol] || {
      badge: `<span class="badge" style="background:var(--gray-200); color:var(--gray-800);">${escH(u.rol)}</span>`,
      alcance: 'Acceso general'
    };

    return `
      <tr>
        <td><strong>${escH(u.username)}</strong> ${u.username === 'admin' ? '<small style="color:var(--gray-500);">(Principal)</small>' : ''}</td>
        <td>${meta.badge}</td>
        <td><small style="color:var(--gray-600);">${meta.alcance}</small></td>
        <td>
          <button class="btn-icon" style="color:var(--blue); margin-right:4px;" onclick="editUsuario('${u.id}')" title="Editar Rol o Contraseña">✏️</button>
          ${u.username === 'admin' ? '' : `<button class="btn-icon" style="color:var(--red);" onclick="eliminarUsuario('${u.id}')" title="Eliminar Usuario">${delIcon}</button>`}
        </td>
      </tr>
    `;
  }).join('');
}

function editUsuario(id) {
    const u = DB.get('usuarios').find(x => x.id === id);
    if (!u) return;
    document.getElementById('u-username').value = u.username;
    document.getElementById('u-password').value = '';
    document.getElementById('u-password').required = false; // Contraseña opcional al editar
    const helpEl = document.getElementById('u-password-help');
    if (helpEl) helpEl.style.display = 'block';
    document.getElementById('u-rol').value = u.rol;
    document.getElementById('form-usuario').dataset.editId = id;
    const titleEl = document.getElementById('modal-usuario-title');
    if (titleEl) titleEl.textContent = `Editar Usuario: ${u.username}`;
    actualizarInfoRolModal(u.rol);
    document.getElementById('modal-usuario').removeAttribute('hidden');
}

async function saveUsuario(e) {
  e.preventDefault();
  const form = document.getElementById('form-usuario');
  const editId = form.dataset.editId;
  const username = document.getElementById('u-username').value.trim();
  const password = document.getElementById('u-password').value;
  const rol = document.getElementById('u-rol').value;

  if (!username) return showToast('El nombre de usuario es obligatorio', 'error');
  if (!editId && (!password || password.length < 6)) {
    return showToast('La contraseña debe tener al menos 6 caracteres', 'error');
  }

  const payload = { username, rol };
  if (password && password.trim().length > 0) payload.password = password;

  try {
    let res;
    if (editId) {
      res = await fetch(`/api/usuarios/${editId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + localStorage.getItem('token')
        },
        body: JSON.stringify(payload)
      });
    } else {
      res = await fetch('/api/usuarios', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + localStorage.getItem('token')
        },
        body: JSON.stringify(payload)
      });
    }

    const data = await res.json();
    if (!res.ok) {
      return showToast(data.error || 'Error al guardar usuario', 'error');
    }

    // Actualizar caché de usuarios desde el backend
    const refreshRes = await fetch('/api/usuarios', {
      headers: { 'Authorization': 'Bearer ' + localStorage.getItem('token') }
    });
    if (refreshRes.ok) {
      DB.cache.usuarios = await refreshRes.json();
    }

    closeModal('usuario');
    renderUsuarios();
    showToast(editId ? `Usuario "${username}" actualizado` : `Usuario "${username}" creado exitosamente`, 'success');
  } catch (err) {
    showToast('Error de conexión al guardar el usuario', 'error');
  }
}

async function eliminarUsuario(id) {
  const u = DB.get('usuarios').find(x => x.id === id);
  if (!u) return;
  if (u.username === 'admin') {
    return showToast('No es posible eliminar el usuario administrador principal', 'warning');
  }
  if (!confirm(`¿Estás seguro de que deseas eliminar la cuenta de "${u.username}"?`)) return;

  try {
    const res = await fetch(`/api/usuarios/${id}`, {
      method: 'DELETE',
      headers: { 'Authorization': 'Bearer ' + localStorage.getItem('token') }
    });
    if (res.ok) {
      DB.cache.usuarios = (DB.cache.usuarios || []).filter(x => x.id !== id);
      renderUsuarios();
      showToast(`Usuario "${u.username}" eliminado del sistema`, 'info');
    } else {
      showToast('Error al eliminar usuario', 'error');
    }
  } catch (e) {
    showToast('Error de conexión al eliminar usuario', 'error');
  }
}

// Aliases globales de compatibilidad
window.saveData = (e, col) => {
  if (col === 'usuarios') return saveUsuario(e);
};
window.deleteData = (col, id) => {
  if (col === 'usuarios') return eliminarUsuario(id);
  quickDelete(col, id);
};

function renderGabinete() {
  const select = document.getElementById('gabinete-paciente-select');
  if (select) {
    const currentVal = select.value;
    select.innerHTML = '<option value="">-- Seleccionar Paciente --</option>';
    DB.get('pacientes').forEach(p => {
      select.innerHTML += `<option value="${escH(p.nombre)}">${escH(p.nombre)}</option>`;
    });
    if (currentVal) select.value = currentVal;
  }
  loadGabinetePaciente();
}

function loadGabinetePaciente() {
  const select = document.getElementById('gabinete-paciente-select');
  const paciente = select.value;
  currentGabinetePaciente = paciente;
  
  const gallery = document.getElementById('gabinete-gallery');
  gallery.innerHTML = '';
  
  if (!paciente) {
    gallery.innerHTML = '<div id="gabinete-empty" class="table-empty"><p>Selecciona un paciente para ver sus archivos</p></div>';
    return;
  }
  
  const archivos = DB.get('archivos').filter(a => a.nombre_paciente === paciente).reverse();
  if (archivos.length === 0) {
    gallery.innerHTML = '<div id="gabinete-empty" class="table-empty"><p>El paciente no tiene imágenes subidas</p></div>';
    return;
  }
  
  archivos.forEach(archivo => {
    // Si no es imagen (ej. PDF), mostramos un icono genérico o el texto
    const isImage = (archivo.mime_type && archivo.mime_type.startsWith('image/')) || 
                    archivo.original_name.match(/\.(jpeg|jpg|gif|png|webp|bmp)$/i);
    const viewUrl = escH(archivo.url || '');
    const src = isImage ? viewUrl : 'https://upload.wikimedia.org/wikipedia/commons/8/87/PDF_file_icon.svg';
    const sizeText = archivo.size_bytes ? ` <span style="color:var(--text-muted,#64748b);font-size:10px;">(${Math.round(archivo.size_bytes / 1024)} KB)</span>` : '';
    
    gallery.innerHTML += `
      <div class="gabinete-item">
        <a href="${viewUrl}" target="_blank" title="Clic para ver o descargar">
          <img src="${src}" class="gabinete-img" title="${escH(archivo.original_name)}" alt="Archivo" loading="lazy">
        </a>
        <div class="gabinete-title">${escH(archivo.original_name)}${sizeText}</div>
        <div class="gabinete-date">${prettyDate((archivo.createdAt||todayStr()).split('T')[0])}</div>
        <button class="btn-secondary" onclick="deleteArchivo('${archivo.id}')" style="padding: 4px; font-size: 10px;">Eliminar</button>
      </div>
    `;
  });
}

// Función de compresión ultraligera en navegador (Ahorra hasta 95% de espacio en Turso Cloud)
function compressImageBeforeUpload(file, maxDimension = 1280, quality = 0.82) {
  return new Promise((resolve) => {
    if (!file.type || !file.type.startsWith('image/') || file.type === 'image/svg+xml' || file.type === 'image/gif') {
      return resolve(file);
    }
    const reader = new FileReader();
    reader.onerror = () => resolve(file);
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = () => resolve(file);
      img.onload = () => {
        let width = img.width;
        let height = img.height;
        if (width <= maxDimension && height <= maxDimension && file.size < 250 * 1024) {
          return resolve(file);
        }
        if (width > height) {
          if (width > maxDimension) {
            height = Math.round((height * maxDimension) / width);
            width = maxDimension;
          }
        } else {
          if (height > maxDimension) {
            width = Math.round((width * maxDimension) / height);
            height = maxDimension;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob((blob) => {
          if (!blob || blob.size >= file.size) {
            return resolve(file);
          }
          const baseName = file.name.replace(/\.[^/.]+$/, "");
          const optimizedFile = new File([blob], `${baseName}.jpg`, { type: 'image/jpeg', lastModified: Date.now() });
          console.log(`[Optimización] ${(file.size/1024).toFixed(1)} KB -> ${(optimizedFile.size/1024).toFixed(1)} KB (${Math.round((1 - optimizedFile.size/file.size)*100)}% ahorro)`);
          resolve(optimizedFile);
        }, 'image/jpeg', quality);
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

async function uploadFile(event) {
  if (!currentGabinetePaciente) {
    showToast('Selecciona un paciente primero', 'error');
    event.target.value = '';
    return;
  }
  
  const rawFile = event.target.files[0];
  if (!rawFile) return;

  showToast('Optimizando imagen...', 'info');

  try {
    const file = await compressImageBeforeUpload(rawFile);
    const formData = new FormData();
    formData.append('file', file);
    formData.append('paciente', currentGabinetePaciente);
    
    const res = await fetch('/api/upload', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + localStorage.getItem('token') },
      body: formData
    });
    const data = await res.json();
    
    if (res.ok) {
      const ahorro = rawFile.size > file.size ? ` (Ahorro: ${Math.round((1 - file.size/rawFile.size)*100)}%)` : '';
      showToast(`Archivo guardado en la nube${ahorro}`);
      // Solo se agrega el nuevo registro: recargar las 20 colecciones multiplicaba lecturas en Turso.
      DB.cache.archivos = [...DB.get('archivos'), data.archivo];
      renderGabinete();
    } else {
      showToast(data.error || 'Error al subir archivo', 'error');
    }
  } catch(e) {
    console.error('Error al subir:', e);
    showToast('Error de red al subir', 'error');
  }
  
  event.target.value = ''; // Reset input
}

function deleteArchivo(id) {
  if (confirm('¿Eliminar este archivo?')) {
    DB.remove('archivos', id);
    setTimeout(() => renderGabinete(), 100);
  }
}


/* ─── RECETAS LOGIC ─── */
function renderRecetas() {
  const select = document.getElementById('receta-paciente');
  if (select) {
    const currentVal = select.value;
    select.innerHTML = '<option value="">-- Seleccionar Paciente --</option>';
    DB.get('pacientes').forEach(p => {
      select.innerHTML += `<option value="${escH(p.nombre)}">${escH(p.nombre)}</option>`;
    });
    if (currentVal) select.value = currentVal;
  }
  
  const tbody = document.getElementById('recetas-tbody');
  if (tbody) {
    tbody.innerHTML = '';
    const recetas = DB.get('recetas').slice().reverse();
    const printIconSmall = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14" style="margin-right:4px;"><polyline points="6 9 6 2 18 2 18 9"></polyline><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path><rect x="6" y="14" width="12" height="8"></rect></svg>';
    const waIconSmall = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>';
    
    recetas.forEach(r => {
      tbody.innerHTML += `<tr>
        <td>${prettyDate(r.fecha)}</td>
        <td><strong>${escH(r.nombre_paciente)}</strong></td>
        <td>${escH(r.medicamentos).substring(0, 50)}...</td>
        <td>
          <div class="td-actions">
            <button class="btn-secondary" onclick="reimprimirReceta('${r.id}')" title="Imprimir Receta">${printIconSmall}Imprimir</button>
            <button class="btn-icon btn-icon--whatsapp" onclick="enviarRecetaWhatsApp('${r.id}')" title="Enviar por WhatsApp">${waIconSmall}</button>
            <button class="btn-icon btn-icon--danger" title="Eliminar" onclick="quickDelete('recetas','${r.id}')">${delIcon}</button>
          </div>
        </td>
      </tr>`;
    });
  }
}

function aplicarDatosRecetaImpresion({ paciente, fecha, edad, peso, medicamentos, id }) {
  document.getElementById('print-paciente').textContent = paciente || '_________________';
  document.getElementById('print-fecha').textContent = prettyDate(fecha || todayStr());
  document.getElementById('print-edad').textContent = edad || '___';
  document.getElementById('print-peso').textContent = peso || '___';
  document.getElementById('print-medicamentos').textContent = medicamentos || '';
  
  const folioEl = document.getElementById('print-receta-folio');
  if (folioEl) {
    const sufijo = id ? String(id).slice(-4).toUpperCase() : String(Math.floor(1000 + Math.random() * 9000));
    folioEl.textContent = `FOLIO: REC-${new Date().getFullYear()}-${sufijo}`;
  }
  
  // Alertas Médicas desde antecedentes
  const alertaEl = document.getElementById('print-receta-alerta');
  if (alertaEl) {
    const ant = DB.get('antecedentes').find(a => a.nombre_paciente === paciente);
    const avisos = [];
    if (ant?.alergias && ant.alergias.trim()) avisos.push(`Alergias: ${ant.alergias.trim()}`);
    if (ant?.alertas_medicas && ant.alertas_medicas.trim()) avisos.push(`Condición: ${ant.alertas_medicas.trim()}`);
    if (avisos.length > 0) {
      alertaEl.style.display = 'block';
      alertaEl.innerHTML = `<strong>⚠️ ALERTA MÉDICA:</strong> ${escH(avisos.join(' • '))}`;
    } else {
      alertaEl.style.display = 'none';
      alertaEl.innerHTML = '';
    }
  }
}

function updateRecetaPreview() {
  const paciente = document.getElementById('receta-paciente').value;
  const edad = document.getElementById('receta-edad').value;
  const peso = document.getElementById('receta-peso').value;
  const medicamentos = document.getElementById('receta-medicamentos').value;
  aplicarDatosRecetaImpresion({ paciente, fecha: todayStr(), edad, peso, medicamentos });
}

function imprimirRecetaActual() {
  const paciente = document.getElementById('receta-paciente').value;
  if (!paciente) return showToast('Selecciona un paciente primero', 'error');
  const edad = document.getElementById('receta-edad').value;
  const peso = document.getElementById('receta-peso').value;
  const medicamentos = document.getElementById('receta-medicamentos').value;
  if (!medicamentos.trim()) return showToast('Escribe los medicamentos e indicaciones', 'error');

  aplicarDatosRecetaImpresion({ paciente, fecha: todayStr(), edad, peso, medicamentos });
  document.body.classList.add('printing-receta');
  window.print();
  setTimeout(() => document.body.classList.remove('printing-receta'), 1000);
}

function guardarReceta() {
  const paciente = document.getElementById('receta-paciente').value;
  if (!paciente) return showToast('Selecciona un paciente', 'error');
  const edad = document.getElementById('receta-edad').value;
  const peso = document.getElementById('receta-peso').value;
  const medicamentos = document.getElementById('receta-medicamentos').value;
  if (!medicamentos.trim()) return showToast('Escribe los medicamentos', 'error');
  
  const payload = {
    nombre_paciente: paciente,
    edad,
    peso,
    medicamentos,
    fecha: todayStr()
  };
  
  DB.add('recetas', payload);
  showToast('Receta guardada exitosamente', 'success');
  
  aplicarDatosRecetaImpresion({ paciente, fecha: todayStr(), edad, peso, medicamentos });
  document.body.classList.add('printing-receta');
  window.print();
  setTimeout(() => document.body.classList.remove('printing-receta'), 1000);
  
  // Limpiar campos
  document.getElementById('receta-edad').value = '';
  document.getElementById('receta-peso').value = '';
  document.getElementById('receta-medicamentos').value = '';
  
  setTimeout(() => renderRecetas(), 200);
}

function reimprimirReceta(id) {
  const r = DB.get('recetas').find(x => x.id === id);
  if (!r) return;
  aplicarDatosRecetaImpresion({ paciente: r.nombre_paciente, fecha: r.fecha, edad: r.edad, peso: r.peso, medicamentos: r.medicamentos, id: r.id });
  document.body.classList.add('printing-receta');
  window.print();
  setTimeout(() => document.body.classList.remove('printing-receta'), 1000);
}

function enviarRecetaWhatsApp(id) {
  const r = DB.get('recetas').find(x => x.id === id);
  if (!r) return;
  enviarMensajeRecetaPaciente(r.nombre_paciente, r.medicamentos, r.fecha);
}

function enviarRecetaActualWhatsApp() {
  const paciente = document.getElementById('receta-paciente').value;
  if (!paciente) return showToast('Selecciona un paciente', 'error');
  const medicamentos = document.getElementById('receta-medicamentos').value;
  if (!medicamentos.trim()) return showToast('Escribe los medicamentos', 'error');
  enviarMensajeRecetaPaciente(paciente, medicamentos, todayStr());
}

function enviarMensajeRecetaPaciente(nombrePaciente, medicamentos, fecha) {
  const pac = DB.get('pacientes').find(p => p.nombre === nombrePaciente);
  let telefono = pac?.telefono || '';
  if (!telefono) {
    const inputTel = prompt(`El paciente ${nombrePaciente} no tiene teléfono registrado. Ingrésalo a continuación (10 dígitos):`);
    if (!inputTel) return;
    telefono = inputTel;
  }
  telefono = telefono.replace(/\D/g, '');
  if (telefono.length === 10) telefono = '52' + telefono;
  
  const msg = `Hola ${nombrePaciente}, le saluda la Dra. Rosa Ávila de Clínica Dental Nube (Distrito Domo).\n\nLe comparto su receta médica emitida el ${prettyDate(fecha)}:\n\n${medicamentos}\n\n📍 Distrito Domo, Av. Manuel Ordoñez 725, El Lechugal, Santa Catarina, N.L.\n📞 Citas / Urgencias: 81 1221 9911\n\nCualquier duda con su medicación, quedamos a sus órdenes.`;
  window.open(`https://wa.me/${telefono}?text=${encodeURIComponent(msg)}`, '_blank');
}

/* ─── 4. NAVEGACIÓN Y RENDER ─── */
const SECTIONS=['dashboard','citas','pacientes','historia','gabinete','recetas','presupuestos','aranceles','laboratorio','pagos','gastos','inventario','tareas','reportes','usuarios'];
const TITLES={dashboard:'Dashboard',citas:'Citas',pacientes:'Pacientes',historia:'Historia Clínica',gabinete:'Gabinete',recetas:'Recetas Médicas',presupuestos:'Presupuestos',aranceles:'Catálogo de Aranceles',laboratorio:'Laboratorio Dental',pagos:'Pagos',gastos:'Gastos',inventario:'Inventario',tareas:'Tareas / CRM',reportes:'Reportes',usuarios:'Usuarios y Roles'};
const tableFilters={citas:'all',presupuestos:'all',tareas:'all'};

function navigateTo(s){
  if(!SECTIONS.includes(s))return;
  const user = JSON.parse(localStorage.getItem('user') || '{}');
  const rol = user.rol || 'recepcion';
  const config = ROLES_PERMISSIONS[rol] || ROLES_PERMISSIONS['recepcion'];

  if (s !== 'dashboard' && !config.secciones.includes(s)) {
    showToast(`Tu rol de "${config.nombre}" no tiene permisos para acceder a ${TITLES[s] || s}`, 'warning');
    return;
  }

  SECTIONS.forEach(x=>{const el=document.getElementById('section-'+x);if(el)el.classList.toggle('section--active',x===s)});
  document.querySelectorAll('.nav-item').forEach(l=>l.classList.toggle('nav-item--active',l.dataset.section===s));
  document.getElementById('topbar-title').textContent=TITLES[s]||s;
  const renders={dashboard:refreshDashboard,citas:renderCitas,pacientes:renderPacientes,historia:renderHistoria,presupuestos:renderPresupuestos,aranceles:renderAranceles,laboratorio:renderLaboratorio,pagos:renderPagos,gastos:renderGastos,inventario:renderInventario,tareas:renderTareas,reportes:renderReportes,gabinete:renderGabinete,recetas:renderRecetas,usuarios:renderUsuarios};
  renders[s]?.();
  document.getElementById('sidebar')?.classList.remove('open');
}

function filterTable(btn,section,val){
  tableFilters[section]=val;
  btn.closest('.filter-tabs').querySelectorAll('.filter-tab').forEach(t=>t.classList.remove('filter-tab--active'));
  btn.classList.add('filter-tab--active');
  const renders={citas:renderCitas,presupuestos:renderPresupuestos,tareas:renderTareas};
  renders[section]?.();
}

/* ─── 4. DASHBOARD ─── */
function refreshDashboard(){
  const h=todayStr(),citas=DB.get('citas'),pagos=DB.get('pagos'),pac=DB.get('pacientes'),gastos=DB.get('gastos'),tareas=DB.get('tareas');
  const citasHoy=citas.filter(c=>c.fecha===h).length;
  const ingresosHoy=pagos.filter(p=>p.fecha===h).reduce((s,p)=>s+(p.monto||0),0);
  const gastosHoy=gastos.filter(g=>g.fecha===h).reduce((s,g)=>s+(g.monto||0),0);
  const tareasPend=tareas.filter(t=>t.estado==='pendiente').length;

  document.getElementById('dashboard-stats').innerHTML=`
    <div class="stat-card"><div class="stat-card__icon stat-card__icon--blue"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/></svg></div><div><p class="stat-card__label">Citas hoy</p><p class="stat-card__value">${citasHoy}</p></div></div>
    <div class="stat-card"><div class="stat-card__icon stat-card__icon--green"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg></div><div><p class="stat-card__label">Ingresos hoy</p><p class="stat-card__value">${fmtMoney(ingresosHoy)}</p></div></div>
    <div class="stat-card"><div class="stat-card__icon stat-card__icon--red"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg></div><div><p class="stat-card__label">Gastos hoy</p><p class="stat-card__value">${fmtMoney(gastosHoy)}</p></div></div>
    <div class="stat-card"><div class="stat-card__icon stat-card__icon--purple"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.582-7 8-7s8 3 8 7"/></svg></div><div><p class="stat-card__label">Pacientes</p><p class="stat-card__value">${pac.length}</p></div></div>
    <div class="stat-card"><div class="stat-card__icon stat-card__icon--orange"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg></div><div><p class="stat-card__label">Tareas pendientes</p><p class="stat-card__value">${tareasPend}</p></div></div>`;

  const pending=citas.filter(c=>c.fecha===h&&c.estado==='pendiente').length;
  const b=document.getElementById('notif-badge');if(b){b.textContent=pending;b.dataset.count=pending}
}

/* Feed */
const feedIcons={cita:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',pago:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>',paciente:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.582-7 8-7s8 3 8 7"/></svg>',historia:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M12 18v-6"/><path d="M9 15h6"/></svg>',inventario:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8"/></svg>',tarea:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 11 12 14 22 4"/></svg>',gasto:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>',error:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/></svg>'};
const feedDots={cita:'blue',pago:'green',paciente:'purple',historia:'teal',inventario:'orange',tarea:'blue',gasto:'red',error:'red',presupuesto:'orange'};

function addFeedItem({title,sub,type}){
  const feed=document.getElementById('activity-feed');if(!feed)return;
  const li=document.createElement('li');li.className='feed-item';
  li.innerHTML=`<div class="feed-item__dot feed-item__dot--${feedDots[type]||'blue'}">${feedIcons[type]||feedIcons.cita}</div><div class="feed-item__body"><p class="feed-item__title">${escH(title)}</p><p class="feed-item__sub">${escH(sub)}</p><p class="feed-item__time">Ahora</p></div>`;
  feed.prepend(li);while(feed.children.length>20)feed.removeChild(feed.lastChild);
}

/* ─── 5. RENDER FUNCTIONS ─── */
const editIcon='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
const delIcon='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';
const waIcon='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>';
const checkIcon='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>';

/* ─── 5. MULTI-SILLÓN Y AGENDA (OPCIÓN 3 - DENTALINK) ─── */
let currentSillonFilter = 'all';

function filterCitasSillon(btn, sillonId) {
  currentSillonFilter = sillonId;
  if (btn) {
    btn.closest('.filter-tabs').querySelectorAll('.filter-tab').forEach(t => t.classList.remove('filter-tab--active'));
    btn.classList.add('filter-tab--active');
  }
  renderCitas();
}

function renderCitas() {
  let data = DB.get('citas');
  const q = (document.getElementById('search-citas')?.value || '').toLowerCase();
  if (q) data = data.filter(c => c.nombre_paciente.toLowerCase().includes(q) || (c.motivo || '').toLowerCase().includes(q));

  // Filtrado por sillón físico
  if (currentSillonFilter !== 'all') {
    data = data.filter(c => (c.id_sillon || 'sillon_1') === currentSillonFilter);
  }

  // Mapa de colores y nombres de sillones
  const sillonesMap = {
    'sillon_1': { nombre: 'Sillón 1 (Principal)', color: '#3b82f6' },
    'sillon_2': { nombre: 'Sillón 2 (Quirúrgico)', color: '#10b981' },
    'sillon_3': { nombre: 'Sillón 3 (Odonto / Orto)', color: '#f59e0b' }
  };
  (DB.get('sillones') || []).forEach(s => {
    sillonesMap[s.id] = { nombre: s.nombre, color: s.color || '#3b82f6' };
  });

  // Initialize Mini Calendar
  if (!window.miniCalendar) {
    const miniEl = document.getElementById('mini-calendar');
    if (miniEl) {
      window.miniCalendar = new FullCalendar.Calendar(miniEl, {
        initialView: 'dayGridMonth',
        locale: 'es',
        headerToolbar: { left: 'prev', center: 'title', right: 'next' },
        fixedWeekCount: false,
        showNonCurrentDates: false,
        height: 'auto',
        contentHeight: 'auto',
        dateClick: function(info) {
          if (window.calendar) {
            window.calendar.gotoDate(info.dateStr);
            window.calendar.changeView('timeGridDay');
            
            // Highlight the selected day in mini calendar
            document.querySelectorAll('#mini-calendar .fc-daygrid-day').forEach(el => el.style.backgroundColor = '');
            info.dayEl.style.backgroundColor = 'var(--blue-50)';
          }
        }
      });
      window.miniCalendar.render();
    }
  }

  // Initialize Main Calendar
  if (!window.calendar) {
    const el = document.getElementById('citas-calendar');
    if (el) {
      window.calendar = new FullCalendar.Calendar(el, {
        initialView: 'timeGridWeek',
        locale: 'es',
        headerToolbar: {
          left: 'prev,next today',
          center: 'title',
          right: 'dayGridMonth,timeGridWeek,timeGridDay'
        },
        scrollTime: '08:00:00',
        businessHours: [
          { daysOfWeek: [1, 2, 3, 4, 5], startTime: '09:00', endTime: '19:00' },
          { daysOfWeek: [6], startTime: '09:00', endTime: '15:00' }
        ],
        nowIndicator: true,
        slotLabelFormat: {
          hour: 'numeric',
          minute: '2-digit',
          omitZeroMinute: true,
          hour12: true
        },
        allDaySlot: false,
        events: [],
        eventClick: function(info) {
          openModal('cita', DB.find('citas', info.event.id));
        },
        dateClick: function(info) {
          let time = '';
          if (info.dateStr.includes('T')) {
            time = info.dateStr.split('T')[1].substring(0, 5);
          }
          openModal('cita', { fecha: info.dateStr.split('T')[0], hora: time, id_sillon: currentSillonFilter !== 'all' ? currentSillonFilter : 'sillon_1' });
        },
        datesSet: function(info) {
          // Sync mini calendar to main calendar's view when navigating prev/next
          if (window.miniCalendar) {
            window.miniCalendar.gotoDate(info.start);
          }
        }
      });
      window.calendar.render();
    }
  }

  if (window.calendar) {
    const evts = data.map(c => {
      const sInfo = sillonesMap[c.id_sillon || 'sillon_1'] || { nombre: 'Sillón 1', color: '#3b82f6' };
      let color = sInfo.color;
      let statusIcon = '';
      if (c.estado === 'en_espera') {
        color = '#f59e0b'; // ámbar sala de espera
        statusIcon = '🛋️ ';
      } else if (c.estado === 'en_sillon') {
        color = '#8b5cf6'; // violeta clínico en atención
        statusIcon = '💺 ';
      } else if (c.estado === 'completada') {
        color = '#059669'; // verde esmeralda
        statusIcon = '✅ ';
      } else if (c.estado === 'cancelada') {
        color = '#ef4444'; // rojo
        statusIcon = '❌ ';
      }

      const sillShort = sInfo.nombre.includes('Sillón 1') ? 'S1' : sInfo.nombre.includes('Sillón 2') ? 'S2' : sInfo.nombre.includes('Sillón 3') ? 'S3' : 'S';
      let titleStr = `${statusIcon}[${sillShort}] ${c.nombre_paciente}`;
      if (c.motivo) titleStr += ' - ' + c.motivo;
      if (c.doctor) titleStr += ` (${c.doctor.split(' ')[0]})`;

      return {
        id: c.id,
        title: titleStr,
        start: c.fecha + 'T' + (c.hora || '09:00:00'),
        backgroundColor: color,
        borderColor: color
      };
    });
    
    const currentEvents = window.calendar.getEventSources();
    if (currentEvents.length > 0) currentEvents[0].remove();
    window.calendar.addEventSource(evts);
    
    if (window.miniCalendar) {
      const miniEvents = window.miniCalendar.getEventSources();
      if (miniEvents.length > 0) miniEvents[0].remove();
      // Solo mostramos puntitos en el mini calendario para saber si hay citas
      window.miniCalendar.addEventSource(evts.map(e => ({ start: e.start, display: 'list-item', color: e.backgroundColor })));
    }
    
    setTimeout(() => {
       window.calendar.render();
       if(window.miniCalendar) window.miniCalendar.render();
    }, 50);
  }

  // Actualizar contador del badge y vista de sala de espera
  const enEsperaHoy = DB.get('citas').filter(c => c.fecha === todayStr() && c.estado === 'en_espera');
  const badgeEl = document.getElementById('badge-sala-espera-count');
  if (badgeEl) {
    badgeEl.textContent = enEsperaHoy.length;
    badgeEl.style.display = enEsperaHoy.length > 0 ? 'inline-block' : 'none';
  }
  if (currentCitasView === 'espera') {
    renderSalaEspera();
  }
}

/* ─── SALA DE ESPERA & CHECK-IN (OPCIÓN 5 - DENTALINK) ─── */
let currentCitasView = 'calendario'; // 'calendario' | 'espera'

function switchCitasView(view, btn) {
  currentCitasView = view;
  if (btn) {
    btn.parentElement.querySelectorAll('.filter-tab').forEach(b => b.classList.remove('filter-tab--active'));
    btn.classList.add('filter-tab--active');
  }

  const calContainer = document.getElementById('citas-calendario-container');
  const esperaContainer = document.getElementById('citas-sala-espera-container');

  if (view === 'calendario') {
    if (calContainer) calContainer.style.display = 'flex';
    if (esperaContainer) esperaContainer.style.display = 'none';
    setTimeout(() => {
      if (window.calendar) window.calendar.render();
      if (window.miniCalendar) window.miniCalendar.render();
    }, 50);
  } else {
    if (calContainer) calContainer.style.display = 'none';
    if (esperaContainer) esperaContainer.style.display = 'flex';
    renderSalaEspera();
  }
}

function renderSalaEspera() {
  const kanban = document.getElementById('sala-espera-kanban');
  if (!kanban) return;

  const hoy = todayStr();
  const fechaLabel = document.getElementById('sala-espera-fecha-label');
  if (fechaLabel) {
    const d = new Date();
    const opciones = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    fechaLabel.textContent = d.toLocaleDateString('es-MX', opciones);
  }

  // Filtrar citas del día de hoy
  const citasHoy = DB.get('citas').filter(c => c.fecha === hoy);

  // Clasificar en los 4 estados de flujo
  const porLlegar = citasHoy.filter(c => (!c.estado || c.estado === 'pendiente' || c.estado === 'confirmada'));
  const enEspera = citasHoy.filter(c => c.estado === 'en_espera');
  const enSillon = citasHoy.filter(c => c.estado === 'en_sillon');
  const atendidos = citasHoy.filter(c => c.estado === 'completada');

  // Actualizar badge en la pestaña
  const badgeCount = document.getElementById('badge-sala-espera-count');
  if (badgeCount) {
    badgeCount.textContent = enEspera.length;
    badgeCount.style.display = enEspera.length > 0 ? 'inline-block' : 'none';
  }

  // Helper para calcular minutos transcurridos
  const now = new Date();
  const getMinutosTranscurridos = (horaStr) => {
    if (!horaStr) return 0;
    const parts = horaStr.split(':');
    const citaDate = new Date();
    citaDate.setHours(parseInt(parts[0], 10), parseInt(parts[1], 10), 0, 0);
    const diffMs = now - citaDate;
    return Math.max(0, Math.floor(diffMs / 60000));
  };

  const sillonesMap = {
    'sillon_1': 'Sillón 1 (Principal)',
    'sillon_2': 'Sillón 2 (Quirúrgico)',
    'sillon_3': 'Sillón 3 (Odonto / Orto)'
  };
  (DB.get('sillones') || []).forEach(s => { sillonesMap[s.id] = s.nombre; });

  // Renderizar 4 Columnas Kanban
  kanban.innerHTML = `
    <!-- COLUMNA 1: POR LLEGAR -->
    <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 14px; display: flex; flex-direction: column;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; padding-bottom: 8px; border-bottom: 2px solid #cbd5e1;">
        <span style="font-weight: 700; font-size: 13px; color: #475569; display: flex; align-items: center; gap: 6px;">🚪 Por Llegar</span>
        <span class="badge" style="background: #e2e8f0; color: #475569; font-weight: 700;">${porLlegar.length}</span>
      </div>
      <div style="display: flex; flex-direction: column; gap: 10px; flex: 1;">
        ${porLlegar.length === 0 ? '<div style="text-align: center; color: #94a3b8; font-size: 12px; padding: 25px 0;">No hay más citas por llegar hoy</div>' :
          porLlegar.map(c => `
            <div style="background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px; box-shadow: var(--shadow-sm);">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                <span style="font-size: 11px; font-weight: 700; color: var(--blue);">${c.hora || '--:--'}</span>
                <span style="font-size: 10px; color: #64748b;">${escH(sillonesMap[c.id_sillon || 'sillon_1'] || 'Sillón')}</span>
              </div>
              <strong style="font-size: 13px; color: #1e293b; display: block; margin-bottom: 2px;">${escH(c.nombre_paciente)}</strong>
              <div style="font-size: 11px; color: #64748b; margin-bottom: 10px;">${escH(c.motivo || 'Consulta')} • <span style="color:#0284c7;">${escH(c.doctor || 'Dra. Rosa')}</span></div>
              <button class="btn-primary" style="width: 100%; font-size: 11px; padding: 6px; justify-content: center;" onclick="hacerCheckInCita('${c.id}')">
                🛎️ Check-in (Llegó a Clínica)
              </button>
            </div>
          `).join('')}
      </div>
    </div>

    <!-- COLUMNA 2: EN SALA DE ESPERA -->
    <div style="background: #fffbeb; border: 1px solid #fef3c7; border-radius: 12px; padding: 14px; display: flex; flex-direction: column;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; padding-bottom: 8px; border-bottom: 2px solid #f59e0b;">
        <span style="font-weight: 700; font-size: 13px; color: #b45309; display: flex; align-items: center; gap: 6px;">🛋️ En Sala de Espera</span>
        <span class="badge" style="background: #f59e0b; color: #fff; font-weight: 700;">${enEspera.length}</span>
      </div>
      <div style="display: flex; flex-direction: column; gap: 10px; flex: 1;">
        ${enEspera.length === 0 ? '<div style="text-align: center; color: #d97706; font-size: 12px; padding: 25px 0;">Sala de espera despejada</div>' :
          enEspera.map(c => {
            const mins = getMinutosTranscurridos(c.hora_llegada || c.hora);
            const badgeBg = mins > 25 ? '#fee2e2' : mins > 12 ? '#fef3c7' : '#dcfce7';
            const badgeColor = mins > 25 ? '#b91c1c' : mins > 12 ? '#b45309' : '#15803d';
            return `
              <div style="background: #fff; border: 1px solid #fde68a; border-radius: 8px; padding: 12px; box-shadow: var(--shadow-sm);">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                  <span style="font-size: 10px; padding: 2px 6px; border-radius: 4px; font-weight: 700; background: ${badgeBg}; color: ${badgeColor};">⏱️ Esperando: ${mins} min</span>
                  <span style="font-size: 10px; color: #78716c;">Llegó: ${c.hora_llegada || c.hora}</span>
                </div>
                <strong style="font-size: 13px; color: #1e293b; display: block; margin-bottom: 2px;">${escH(c.nombre_paciente)}</strong>
                <div style="font-size: 11px; color: #64748b; margin-bottom: 10px;">${escH(c.motivo || 'Consulta')} • <span style="color:#0284c7;">${escH(c.doctor || 'Dra. Rosa')}</span></div>
                <button class="btn-primary" style="width: 100%; font-size: 11px; padding: 6px; justify-content: center; background:#f59e0b; border-color:#d97706;" onclick="pasarASillonCita('${c.id}')">
                  💺 Pasar a Sillón (${escH(sillonesMap[c.id_sillon || 'sillon_1'] ? sillonesMap[c.id_sillon || 'sillon_1'].split(' ')[0] : 'S1')})
                </button>
              </div>
            `;
          }).join('')}
      </div>
    </div>

    <!-- COLUMNA 3: EN SILLÓN / ATENCIÓN -->
    <div style="background: #f5f3ff; border: 1px solid #ede9fe; border-radius: 12px; padding: 14px; display: flex; flex-direction: column;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; padding-bottom: 8px; border-bottom: 2px solid #8b5cf6;">
        <span style="font-weight: 700; font-size: 13px; color: #6d28d9; display: flex; align-items: center; gap: 6px;">🩺 En Sillón / Consulta</span>
        <span class="badge" style="background: #8b5cf6; color: #fff; font-weight: 700;">${enSillon.length}</span>
      </div>
      <div style="display: flex; flex-direction: column; gap: 10px; flex: 1;">
        ${enSillon.length === 0 ? '<div style="text-align: center; color: #7c3aed; font-size: 12px; padding: 25px 0;">No hay pacientes en sillón</div>' :
          enSillon.map(c => {
            const mins = getMinutosTranscurridos(c.hora_atencion || c.hora);
            return `
              <div style="background: #fff; border: 1px solid #ddd6fe; border-radius: 8px; padding: 12px; box-shadow: var(--shadow-sm);">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                  <span style="font-size: 10px; font-weight: 700; background: #e0e7ff; color: #4338ca; padding: 2px 6px; border-radius: 4px;">${escH(sillonesMap[c.id_sillon || 'sillon_1'] || 'Sillón 1')}</span>
                  <span style="font-size: 10px; color: #6b7280;">En consulta: ${mins} min</span>
                </div>
                <strong style="font-size: 13px; color: #1e293b; display: block; margin-bottom: 2px;">${escH(c.nombre_paciente)}</strong>
                <div style="font-size: 11px; color: #64748b; margin-bottom: 10px;">${escH(c.motivo || 'Tratamiento')} • <span style="color:#7c3aed; font-weight:600;">${escH(c.doctor || 'Dra. Rosa')}</span></div>
                <button class="btn-primary" style="width: 100%; font-size: 11px; padding: 6px; justify-content: center; background:#10b981; border-color:#059669;" onclick="finalizarAtencionCita('${c.id}')">
                  🏁 Finalizar Atención
                </button>
              </div>
            `;
          }).join('')}
      </div>
    </div>

    <!-- COLUMNA 4: ATENDIDOS HOY -->
    <div style="background: #f0fdf4; border: 1px solid #dcfce7; border-radius: 12px; padding: 14px; display: flex; flex-direction: column;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; padding-bottom: 8px; border-bottom: 2px solid #10b981;">
        <span style="font-weight: 700; font-size: 13px; color: #047857; display: flex; align-items: center; gap: 6px;">✅ Atendidos Hoy</span>
        <span class="badge" style="background: #10b981; color: #fff; font-weight: 700;">${atendidos.length}</span>
      </div>
      <div style="display: flex; flex-direction: column; gap: 10px; flex: 1;">
        ${atendidos.length === 0 ? '<div style="text-align: center; color: #059669; font-size: 12px; padding: 25px 0;">Aún no hay citas finalizadas hoy</div>' :
          atendidos.map(c => `
            <div style="background: #fff; border: 1px solid #bbf7d0; border-radius: 8px; padding: 12px; box-shadow: var(--shadow-sm);">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                <span style="font-size: 10px; color: #166534; font-weight:600;">Finalizó: ${c.hora_fin || c.hora}</span>
                <span style="font-size: 10px; color: #6b7280;">${escH(c.doctor || 'Dra. Rosa')}</span>
              </div>
              <strong style="font-size: 13px; color: #1e293b; display: block; margin-bottom: 2px;">${escH(c.nombre_paciente)}</strong>
              <div style="font-size: 11px; color: #64748b; margin-bottom: 8px;">${escH(c.motivo || 'Atendido')}</div>
              <button class="btn-secondary" style="width: 100%; font-size: 11px; padding: 5px; justify-content: center;" onclick="openModal('pago', { nombre_paciente: '${escH(c.nombre_paciente)}', concepto: '${escH(c.motivo || 'Consulta')}' })">
                💵 Registrar Pago / Abono
              </button>
            </div>
          `).join('')}
      </div>
    </div>
  `;
}

function hacerCheckInCita(id) {
  const now = new Date();
  const horaActual = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  DB.update('citas', id, { estado: 'en_espera', hora_llegada: horaActual });
  showToast('Paciente registrado en Sala de Espera', 'success');
  renderSalaEspera();
  renderCitas();
}

function pasarASillonCita(id) {
  const now = new Date();
  const horaActual = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  DB.update('citas', id, { estado: 'en_sillon', hora_atencion: horaActual });
  showToast('Paciente ingresado al sillón clínico', 'info');
  renderSalaEspera();
  renderCitas();
}

function finalizarAtencionCita(id) {
  const cita = DB.find('citas', id);
  const now = new Date();
  const horaActual = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  DB.update('citas', id, { estado: 'completada', hora_fin: horaActual });
  showToast('Atención finalizada con éxito', 'success');
  renderSalaEspera();
  renderCitas();
  if (cita && confirm(`¿Deseas registrar un cobro o abono ahora para "${cita.nombre_paciente}"?`)) {
    openModal('pago', { nombre_paciente: cita.nombre_paciente, concepto: cita.motivo || 'Consulta Dental' });
  }
}

function renderPacientes(){
  let data=DB.get('pacientes');const q=(document.getElementById('search-pacientes')?.value||'').toLowerCase();
  if(q)data=data.filter(p=>p.nombre.toLowerCase().includes(q)||(p.correo||'').toLowerCase().includes(q));
  data.sort((a,b)=>a.nombre.localeCompare(b.nombre));
  const tb=document.getElementById('pacientes-tbody'),em=document.getElementById('pacientes-empty');
  if(!data.length){tb.innerHTML='';em.hidden=false;return}em.hidden=true;
  
  const presups = DB.get('presupuestos');
  const pagos = DB.get('pagos');
  
  tb.innerHTML=data.map(p=>{
      // Calc saldo
      const pPresups = presups.filter(x => x.nombre_paciente === p.nombre && x.estado === 'aprobado');
      const pPagos = pagos.filter(x => x.nombre_paciente === p.nombre);
      const totalDeuda = pPresups.reduce((sum, item) => sum + (item.monto || 0), 0);
      const totalPagado = pPagos.reduce((sum, item) => sum + (item.monto || 0), 0);
      const saldo = totalDeuda - totalPagado;
      
      const saldoHtml = saldo > 0 
          ? `<span style="color: var(--red); font-weight: bold;">-${fmtMoney(saldo)} (Deuda)</span>`
          : `<span style="color: var(--green); font-weight: bold;">${fmtMoney(Math.abs(saldo))} (A Favor/Ok)</span>`;
          
      return `<tr><td><strong>${escH(p.nombre)}</strong></td><td>${escH(p.telefono||'-')}</td><td>${escH(p.correo||'-')}</td><td>${prettyDate(p.createdAt?.slice(0,10))}</td><td>${saldoHtml}</td><td><div class="td-actions"><button class="btn-icon btn-icon--whatsapp" title="WhatsApp" onclick="enviarWhatsApp('paciente','${p.id}')">${waIcon}</button><button class="btn-icon" title="Editar" onclick="openModal('paciente',DB.find('pacientes','${p.id}'))">${editIcon}</button><button class="btn-icon btn-icon--danger" title="Eliminar" onclick="quickDelete('pacientes','${p.id}')">${delIcon}</button></div></td></tr>`;
  }).join('');
}

function renderHistoria(){
  const select = document.getElementById('odontograma-paciente-select');
  if (select) {
    const currentVal = select.value;
    select.innerHTML = '<option value="">-- Seleccionar Paciente --</option>';
    DB.get('pacientes').forEach(p => {
      select.innerHTML += `<option value="${escH(p.nombre)}">${escH(p.nombre)}</option>`;
    });
    if (currentVal) select.value = currentVal;
  }

  const tbody = document.querySelector('#table-historia tbody');
  if (!tbody) return;
  tbody.innerHTML = '';
  let data = DB.get('historia');
  const term = (document.getElementById('search-historia')?.value || '').toLowerCase();
  
  if (term) {
      data = data.filter(e => e.nombre_paciente.toLowerCase().includes(term) || (e.tratamiento || '').toLowerCase().includes(term));
  }
  
  data.sort((a,b)=>(b.fecha||'').localeCompare(a.fecha||''));
  
  tbody.innerHTML = data.map(e => `<tr>
    <td><strong>${escH(e.nombre_paciente)}</strong></td>
    <td>${prettyDate(e.fecha)}</td>
    <td>${escH(e.diente_zona||'-')}</td>
    <td>${escH(e.tratamiento)}</td>
    <td>${escH(e.descripcion||'-')}</td>
    <td>
      <div class="td-actions">
        <button class="btn-icon btn-icon--danger" title="Eliminar" onclick="quickDelete('historia','${e.id}')">Del</button>
      </div>
    </td>
  </tr>`).join('');
  
  if (select && select.value) loadOdontogramaPaciente();
}


function renderPresupuestos(){
  let data=DB.get('presupuestos');const q=(document.getElementById('search-presupuestos')?.value||'').toLowerCase();
  if(q)data=data.filter(p=>p.nombre_paciente.toLowerCase().includes(q));
  if(tableFilters.presupuestos!=='all')data=data.filter(p=>p.estado===tableFilters.presupuestos);
  data.sort((a,b)=>(b.fecha||'').localeCompare(a.fecha||''));
  const tb=document.getElementById('presupuestos-tbody'),em=document.getElementById('presupuestos-empty');
  if(!data.length){tb.innerHTML='';em.hidden=false;return}em.hidden=true;
  
  const printIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16"><polyline points="6 9 6 2 18 2 18 9"></polyline><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path><rect x="6" y="14" width="12" height="8"></rect></svg>';
  
  tb.innerHTML=data.map(p=>{
      // Try parsing tratamientos to render a nice summary
      let trSummary = escH(p.tratamientos);
      try {
          const parsed = JSON.parse(p.tratamientos);
          if (Array.isArray(parsed)) {
              trSummary = '<ul style="margin:0; padding-left:15px; font-size:12px; color:var(--gray-600);">' + 
                          parsed.map(i => `<li style="margin-bottom:2px">${escH(i.concepto)} <strong style="color:var(--gray-900);float:right;margin-left:10px;">${fmtMoney(i.costo)}</strong></li>`).join('') + 
                          '</ul>';
          }
      } catch(e) {}
      
      return `<tr><td><strong>${escH(p.nombre_paciente)}</strong></td><td>${trSummary}</td><td style="font-weight:700; vertical-align:top;">${fmtMoney(p.monto)}</td><td><span class="tag tag--${p.estado}">${p.estado}</span></td><td>${prettyDate(p.fecha)}</td><td><div class="td-actions">
        ${p.estado==='pendiente' ? `<button class="btn-icon btn-icon--green" title="Aprobar" onclick="quickUpdate('presupuestos','${p.id}',{estado:'aprobado'})">${checkIcon}</button>` : ''}
        <button class="btn-icon" title="Imprimir Presupuesto" onclick="imprimirPresupuesto('${p.id}')" style="color:var(--gray-600)">${printIcon}</button>
        <button class="btn-icon btn-icon--whatsapp" title="Enviar Presupuesto por WhatsApp" onclick="enviarPresupuestoWhatsApp('${p.id}')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg></button>
        <button class="btn-icon" title="Editar" onclick="openModal('presupuesto',DB.find('presupuestos','${p.id}'))">${editIcon}</button>
        <button class="btn-icon btn-icon--danger" title="Eliminar" onclick="quickDelete('presupuestos','${p.id}')">${delIcon}</button>
      </div></td></tr>`;
  }).join('');
}

/* ─── CATÁLOGO DE ARANCELES (ESTILO DENTALINK) ─── */
let currentArancelesCategory = 'all';

function filterAranceles(btn, cat) {
  currentArancelesCategory = cat;
  if (btn) {
    btn.parentElement.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('filter-tab--active'));
    btn.classList.add('filter-tab--active');
  }
  renderAranceles();
}

function renderAranceles() {
  const tbody = document.getElementById('aranceles-tbody');
  const empty = document.getElementById('aranceles-empty');
  if (!tbody) return;

  const q = (document.getElementById('search-aranceles')?.value || '').toLowerCase().trim();
  let list = DB.get('prestaciones');

  if (currentArancelesCategory !== 'all') {
    list = list.filter(p => p.categoria === currentArancelesCategory);
  }

  if (q) {
    list = list.filter(p => 
      (p.nombre && p.nombre.toLowerCase().includes(q)) || 
      (p.codigo && p.codigo.toLowerCase().includes(q)) || 
      (p.categoria && p.categoria.toLowerCase().includes(q))
    );
  }

  if (list.length === 0) {
    tbody.innerHTML = '';
    if (empty) empty.hidden = false;
    return;
  }

  if (empty) empty.hidden = true;

  tbody.innerHTML = list.map(p => {
    const aplicaBadge = p.aplica_a === 'cara' ? '<span class="badge" style="background:#e0f2fe; color:#0369a1;">Superficie / Cara</span>' :
                        p.aplica_a === 'boca_completa' ? '<span class="badge" style="background:#fef3c7; color:#b45309;">Boca Completa</span>' :
                        '<span class="badge" style="background:#f3e8ff; color:#7e22ce;">Pieza Dental</span>';

    return `
      <tr>
        <td><code>${escH(p.codigo || '-')}</code></td>
        <td><span class="tag tag--info">${escH(p.categoria || 'General')}</span></td>
        <td><strong>${escH(p.nombre)}</strong></td>
        <td>${aplicaBadge}</td>
        <td><strong style="color:var(--green); font-size:14px;">$${Number(p.precio).toLocaleString()} MXN</strong></td>
        <td>
          <button class="btn-secondary" style="padding:4px 8px; font-size:11px; margin-right:4px;" onclick="editarArancelPorId('${p.id}')">✏️ Editar</button>
          <button class="btn-secondary" style="padding:4px 8px; font-size:11px; color:var(--red);" onclick="eliminarArancel('${p.id}')">🗑️</button>
        </td>
      </tr>
    `;
  }).join('');
}

function editarArancelPorId(id) {
  const p = DB.get('prestaciones').find(x => x.id === id);
  if (p) openModal('arancel', p);
}

function eliminarArancel(id) {
  if (!confirm('¿Deseas eliminar este arancel del catálogo?')) return;
  DB.remove('prestaciones', id);
  showToast('Arancel eliminado', 'info');
  renderAranceles();
}

function saveArancel(e) {
  e.preventDefault();
  const id = document.getElementById('arancel-id').value;
  const codigo = document.getElementById('arancel-codigo').value.trim();
  const categoria = document.getElementById('arancel-categoria').value;
  const nombre = document.getElementById('arancel-nombre').value.trim();
  const precio = parseFloat(document.getElementById('arancel-precio').value) || 0;
  const aplica_a = document.getElementById('arancel-aplica').value;

  if (!nombre) return showToast('El nombre es obligatorio', 'error');

  if (id) {
    DB.update('prestaciones', id, { codigo, categoria, nombre, precio, aplica_a });
    showToast('Arancel actualizado', 'success');
  } else {
    DB.add('prestaciones', {
      codigo: codigo || ('ARAN-' + Math.floor(Math.random()*1000)),
      categoria,
      nombre,
      precio,
      aplica_a,
      createdAt: new Date().toISOString()
    });
    showToast('Nuevo arancel registrado', 'success');
  }

  closeModal('arancel');
  renderAranceles();
}

/* ─── LABORATORIO DENTAL (OPCIÓN 4 - DENTALINK) ─── */
let currentLaboratorioFilter = 'all';

function filterLaboratorio(btn, filter) {
  currentLaboratorioFilter = filter;
  if (btn) {
    btn.closest('.filter-tabs').querySelectorAll('.filter-tab').forEach(t => t.classList.remove('filter-tab--active'));
    btn.classList.add('filter-tab--active');
  }
  renderLaboratorio();
}

function renderLaboratorio() {
  let data = DB.get('laboratorios_ordenes');
  const q = (document.getElementById('search-laboratorio')?.value || '').toLowerCase();
  if (q) {
    data = data.filter(o => 
      (o.nombre_paciente || '').toLowerCase().includes(q) ||
      (o.folio || '').toLowerCase().includes(q) ||
      (o.trabajo || '').toLowerCase().includes(q) ||
      (o.laboratorio_nombre || '').toLowerCase().includes(q)
    );
  }

  // KPIs
  const allOrders = DB.get('laboratorios_ordenes');
  const activasCount = allOrders.filter(o => o.estado === 'enviado' || o.estado === 'en_proceso').length;
  const recibidasCount = allOrders.filter(o => o.estado === 'recibido').length;
  const totalCosto = allOrders.reduce((sum, o) => sum + (Number(o.costo_laboratorio) || 0), 0);

  const elActivas = document.getElementById('lab-activas-count');
  const elRecibidas = document.getElementById('lab-recibidas-count');
  const elTotalCosto = document.getElementById('lab-total-costo');
  if (elActivas) elActivas.textContent = activasCount;
  if (elRecibidas) elRecibidas.textContent = recibidasCount;
  if (elTotalCosto) elTotalCosto.textContent = fmtMoney(totalCosto);

  // Filtrado por estado de pestaña
  if (currentLaboratorioFilter !== 'all') {
    data = data.filter(o => o.estado === currentLaboratorioFilter);
  }

  // Ordenar por fecha estimada de entrega
  data.sort((a, b) => (a.fecha_entrega_estimada || '').localeCompare(b.fecha_entrega_estimada || ''));

  const tbody = document.getElementById('laboratorio-tbody');
  const empty = document.getElementById('laboratorio-empty');
  if (!tbody) return;

  if (data.length === 0) {
    tbody.innerHTML = '';
    if (empty) empty.hidden = false;
    return;
  }

  if (empty) empty.hidden = true;

  tbody.innerHTML = data.map(o => {
    let badgeEstado = '';
    if (o.estado === 'enviado') {
      badgeEstado = '<span class="badge" style="background:#dbeafe; color:#1e40af; font-size:11px;">Enviado</span>';
    } else if (o.estado === 'en_proceso') {
      badgeEstado = '<span class="badge" style="background:#fef3c7; color:#92400e; font-size:11px;">En Proceso</span>';
    } else if (o.estado === 'recibido') {
      badgeEstado = '<span class="badge" style="background:#dcfce7; color:#166534; font-weight:700; font-size:11px;">✓ Recibido en Clínica</span>';
    } else if (o.estado === 'instalado') {
      badgeEstado = '<span class="badge" style="background:#f3e8ff; color:#6b21a8; font-weight:700; font-size:11px;">★ Instalado</span>';
    }

    const folioText = o.folio || ('LAB-' + (o.id || '').slice(-4).toUpperCase());
    const colorBadge = o.color_guia 
      ? `<span class="badge" style="background:#fef3c7; color:#92400e; font-size:11px;">${escH(o.color_guia)}</span>`
      : '<span style="color:var(--gray-400);">-</span>';

    return `
      <tr>
        <td><code style="font-size:11px; font-weight:700;">${escH(folioText)}</code></td>
        <td><strong>${escH(o.nombre_paciente)}</strong></td>
        <td><span class="tag tag--info">${escH(o.diente || 'Pieza')}</span></td>
        <td>${escH(o.trabajo)}</td>
        <td>${escH(o.laboratorio_nombre)}</td>
        <td>${colorBadge}</td>
        <td><small style="color:var(--gray-600);">${prettyDate(o.fecha_envio)}</small></td>
        <td><strong>${prettyDate(o.fecha_entrega_estimada)}</strong></td>
        <td><strong style="color:var(--green);">${fmtMoney(o.costo_laboratorio)}</strong></td>
        <td>${badgeEstado}</td>
        <td style="white-space:nowrap;">
          ${(o.estado !== 'recibido' && o.estado !== 'instalado') ? `
            <button class="btn-primary" style="padding:3px 7px; font-size:11px; background:#10b981; border-color:#059669; margin-right:4px;" onclick="marcarOrdenRecibida('${o.id}')" title="Marcar como recibido en clínica">📦 Recibir</button>
          ` : ''}
          ${o.estado === 'recibido' ? `
            <button class="btn-primary" style="padding:3px 7px; font-size:11px; background:#8b5cf6; border-color:#7c3aed; margin-right:4px;" onclick="marcarOrdenInstalada('${o.id}')" title="Marcar como instalado en paciente">🦷 Instalar</button>
          ` : ''}
          <button class="btn-icon" title="Editar" onclick="openModal('laboratorio', DB.find('laboratorios_ordenes', '${o.id}'))">${editIcon}</button>
          <button class="btn-icon" style="color:var(--red);" title="Eliminar" onclick="quickDelete('laboratorios_ordenes', '${o.id}')">${delIcon}</button>
        </td>
      </tr>
    `;
  }).join('');
}

function marcarOrdenRecibida(id) {
  const o = DB.get('laboratorios_ordenes').find(x => x.id === id);
  if (!o) return;
  DB.update('laboratorios_ordenes', id, {
    estado: 'recibido',
    fecha_recibido: todayStr()
  });
  showToast(`Trabajo protésico recibido en clínica (${o.folio || 'Orden'}). ¡Listo para cita de instalación!`, 'success');
  renderLaboratorio();
}

function marcarOrdenInstalada(id) {
  const o = DB.get('laboratorios_ordenes').find(x => x.id === id);
  if (!o) return;
  DB.update('laboratorios_ordenes', id, {
    estado: 'instalado'
  });

  // Registrar automáticamente en la evolución clínica del expediente del paciente
  DB.add('historia', {
    nombre_paciente: o.nombre_paciente,
    fecha: todayStr(),
    diente_zona: `Pieza #${o.diente || 'General'}`,
    tratamiento: `Colocación / Instalación de ${o.trabajo}`,
    descripcion: `Trabajo de laboratorio terminado e instalado exitosamente por ${o.doctor || 'Doctor(a)'}. Lab Técnico: ${o.laboratorio_nombre}, Tono: ${o.color_guia || 'N/A'}. Ajuste oclusal y pulido satisfactorio.`
  });

  showToast(`Prótesis instalada en paciente ${o.nombre_paciente}. Se registró nota en su evolución clínica.`, 'success');
  renderLaboratorio();
}

function guardarOrdenLaboratorio(e) {
  e.preventDefault();
  const id = document.getElementById('lab-id').value;
  const paciente = document.getElementById('lab-paciente').value;
  const diente = document.getElementById('lab-diente').value.trim();
  const trabajo = document.getElementById('lab-trabajo').value;
  const labNombre = document.getElementById('lab-nombre').value.trim();
  const color = document.getElementById('lab-color').value.trim();
  const costo = parseFloat(document.getElementById('lab-costo').value) || 0;
  const fechaEnvio = document.getElementById('lab-fecha-envio').value || todayStr();
  const fechaEntrega = document.getElementById('lab-fecha-entrega').value;
  const doctor = document.getElementById('lab-doctor').value || 'Dra. Rosa Avila';
  const estado = document.getElementById('lab-estado').value || 'enviado';
  const notas = document.getElementById('lab-notas').value.trim();

  if (!paciente) return showToast('Seleccione un paciente', 'error');
  if (!fechaEntrega) return showToast('La fecha estimada de entrega es obligatoria', 'error');

  if (id) {
    DB.update('laboratorios_ordenes', id, {
      nombre_paciente: paciente,
      diente: diente,
      trabajo: trabajo,
      laboratorio_nombre: labNombre,
      color_guia: color,
      costo_laboratorio: costo,
      fecha_envio: fechaEnvio,
      fecha_entrega_estimada: fechaEntrega,
      doctor: doctor,
      estado: estado,
      notas: notas
    });
    showToast('Orden de laboratorio actualizada', 'success');
  } else {
    const folio = 'LAB-' + Date.now().toString().slice(-6);
    DB.add('laboratorios_ordenes', {
      folio: folio,
      nombre_paciente: paciente,
      diente: diente,
      trabajo: trabajo,
      laboratorio_nombre: labNombre,
      color_guia: color,
      costo_laboratorio: costo,
      fecha_envio: fechaEnvio,
      fecha_entrega_estimada: fechaEntrega,
      doctor: doctor,
      estado: estado,
      notas: notas,
      createdAt: new Date().toISOString()
    });
    showToast(`Orden ${folio} enviada a laboratorio`, 'success');
  }

  closeModal('laboratorio');
  renderLaboratorio();
}

function renderPagos(){
  let data=DB.get('pagos');const q=(document.getElementById('search-pagos')?.value||'').toLowerCase();
  if(q)data=data.filter(p=>p.nombre_paciente.toLowerCase().includes(q));
  data.sort((a,b)=>(b.fecha||'').localeCompare(a.fecha||''));
  const h=todayStr();
  document.getElementById('pagos-hoy').textContent=fmtMoney(data.filter(p=>p.fecha===h).reduce((s,p)=>s+(p.monto||0),0));
  document.getElementById('pagos-total').textContent=fmtMoney(data.reduce((s,p)=>s+(p.monto||0),0));
  document.getElementById('pagos-count').textContent=data.length;
  const tb=document.getElementById('pagos-tbody'),em=document.getElementById('pagos-empty');
  if(!data.length){tb.innerHTML='';em.hidden=false;return}em.hidden=true;
  const printIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16"><polyline points="6 9 6 2 18 2 18 9"></polyline><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path><rect x="6" y="14" width="12" height="8"></rect></svg>';
  tb.innerHTML=data.map(p=>`<tr><td><strong>${escH(p.nombre_paciente)}</strong></td><td style="color:var(--green);font-weight:700">${fmtMoney(p.monto)}</td><td>${escH(p.concepto||'-')}</td><td>${escH(p.metodo||'-')}</td><td>${prettyDate(p.fecha)}</td><td><div class="td-actions"><button class="btn-icon" title="Imprimir Ticket" onclick="imprimirTicketPago('${p.id}')" style="color:var(--gray-600)">${printIcon}</button><button class="btn-icon btn-icon--danger" title="Eliminar" onclick="quickDelete('pagos','${p.id}')">${delIcon}</button></div></td></tr>`).join('');
}

function renderGastos(){
  let data=DB.get('gastos');const q=(document.getElementById('search-gastos')?.value||'').toLowerCase();
  if(q)data=data.filter(g=>g.concepto.toLowerCase().includes(q));
  data.sort((a,b)=>(b.fecha||'').localeCompare(a.fecha||''));
  const h=todayStr(),now=new Date();
  document.getElementById('gastos-hoy').textContent=fmtMoney(data.filter(g=>g.fecha===h).reduce((s,g)=>s+(g.monto||0),0));
  document.getElementById('gastos-mes').textContent=fmtMoney(data.filter(g=>{const d=new Date(g.fecha+'T00:00:00');return d.getMonth()===now.getMonth()&&d.getFullYear()===now.getFullYear()}).reduce((s,g)=>s+(g.monto||0),0));
  document.getElementById('gastos-total').textContent=fmtMoney(data.reduce((s,g)=>s+(g.monto||0),0));
  const tb=document.getElementById('gastos-tbody'),em=document.getElementById('gastos-empty');
  if(!data.length){tb.innerHTML='';em.hidden=false;return}em.hidden=true;
  tb.innerHTML=data.map(g=>`<tr><td><strong>${escH(g.concepto)}</strong></td><td style="color:var(--red);font-weight:700">${fmtMoney(g.monto)}</td><td>${escH(g.metodo||'Efectivo')}</td><td>${prettyDate(g.fecha)}</td><td><div class="td-actions"><button class="btn-icon btn-icon--danger" title="Eliminar" onclick="quickDelete('gastos','${g.id}')">${delIcon}</button></div></td></tr>`).join('');
}

function renderInventario(){
  let data=DB.get('inventario');const q=(document.getElementById('search-inventario')?.value||'').toLowerCase();
  if(q)data=data.filter(i=>i.insumo.toLowerCase().includes(q));
  data.sort((a,b)=>a.insumo.localeCompare(b.insumo));
  const tb=document.getElementById('inventario-tbody'),em=document.getElementById('inventario-empty');
  if(!data.length){tb.innerHTML='';em.hidden=false;return}em.hidden=true;
  tb.innerHTML=data.map(i=>`<tr><td><strong>${escH(i.insumo)}</strong></td><td>${i.stock}</td><td>${i.ultimo_qty||'-'} unidades</td><td><span class="tag tag--${i.ultimo_tipo}">${i.ultimo_tipo}</span></td><td>${prettyDate(i.fecha)}</td><td><div class="td-actions"><button class="btn-icon btn-icon--danger" title="Eliminar" onclick="quickDelete('inventario','${i.id}')">${delIcon}</button></div></td></tr>`).join('');
}

function renderTareas(){
  let data=DB.get('tareas');const q=(document.getElementById('search-tareas')?.value||'').toLowerCase();
  if(q)data=data.filter(t=>t.descripcion.toLowerCase().includes(q)||(t.responsable||'').toLowerCase().includes(q));
  if(tableFilters.tareas!=='all')data=data.filter(t=>t.estado===tableFilters.tareas);
  data.sort((a,b)=>(a.fecha_limite||'z').localeCompare(b.fecha_limite||'z'));
  const tb=document.getElementById('tareas-tbody'),em=document.getElementById('tareas-empty');
  if(!data.length){tb.innerHTML='';em.hidden=false;return}em.hidden=true;
  tb.innerHTML=data.map(t=>`<tr><td>${escH(t.descripcion)}</td><td><strong>${escH(t.responsable||'-')}</strong></td><td>${prettyDate(t.fecha_limite)}</td><td><span class="tag tag--${t.estado}">${t.estado}</span></td><td><div class="td-actions">${t.estado==='pendiente'?`<button class="btn-icon btn-icon--green" title="Completar" onclick="quickUpdate('tareas','${t.id}',{estado:'completada'})">${checkIcon}</button>`:''}<button class="btn-icon btn-icon--danger" title="Eliminar" onclick="quickDelete('tareas','${t.id}')">${delIcon}</button></div></td></tr>`).join('');
}


function enviarWhatsApp(tipo, idRelacionado) {
    let telefono = '';
    let mensaje = '';
    let nombrePaciente = '';

    if (tipo === 'cita') {
        const cita = DB.find('citas', idRelacionado);
        if (!cita) return;
        nombrePaciente = cita.nombre_paciente;
        
        // Buscar teléfono en pacientes
        const paciente = DB.get('pacientes').find(p => p.nombre === nombrePaciente);
        if (paciente && paciente.telefono) {
            telefono = paciente.telefono;
        }
        
        mensaje = `Hola ${nombrePaciente}, nos comunicamos de CareDent para recordarte tu cita programada para el ${prettyDate(cita.fecha)} a las ${cita.hora}. Por favor confírmanos tu asistencia. ¡Te esperamos!`;
    } else if (tipo === 'paciente') {
        const paciente = DB.find('pacientes', idRelacionado);
        if (!paciente) return;
        nombrePaciente = paciente.nombre;
        if (paciente.telefono) telefono = paciente.telefono;
        
        mensaje = `Hola ${nombrePaciente}, nos comunicamos de la clínica dental. `;
    }

    if (!telefono) {
        showToast('El paciente no tiene un número de teléfono registrado.', 'error');
        return;
    }

    // Limpiar número (quitar espacios, guiones, etc.)
    telefono = telefono.replace(/\D/g, '');
    
    // Asumir lada de México si tiene 10 dígitos (ajustable)
    if (telefono.length === 10) telefono = '52' + telefono;

    const url = `https://wa.me/${telefono}?text=${encodeURIComponent(mensaje)}`;
    window.open(url, '_blank');
}


function imprimirCorteCaja() {
    document.body.classList.add('printing-corte');
    window.print();
    setTimeout(() => {
        document.body.classList.remove('printing-corte');
    }, 1000);
}

/* Quick actions */
function quickUpdate(col,id,patch){DB.update(col,id,patch);const renders={citas:renderCitas,presupuestos:renderPresupuestos,tareas:renderTareas};renders[col]?.();refreshDashboard();showToast('Actualizado','success')}
function quickDelete(col,id){if(!confirm('¿Eliminar este registro?'))return;DB.remove(col,id);const renders={citas:renderCitas,pacientes:renderPacientes,historia:renderHistoria,presupuestos:renderPresupuestos,laboratorios_ordenes:renderLaboratorio,pagos:renderPagos,gastos:renderGastos,inventario:renderInventario,tareas:renderTareas,recetas:renderRecetas,ortodoncia:()=>currentPacienteOdonto?renderOrtodoncia(currentPacienteOdonto):null};renders[col]?.();refreshDashboard();showToast('Eliminado','info')}

/* ─── 6. REPORTES ─── */
function renderReportes(){
  const periodo=document.getElementById('reporte-periodo')?.value||'todo';
  const now=new Date();
  function inP(ds){if(!ds)return false;const d=new Date(ds+'T00:00:00');if(periodo==='hoy')return fmt(d)===fmt(now);if(periodo==='semana'){const s=addDays(now,-now.getDay());return d>=new Date(fmt(s)+'T00:00:00')&&d<=now}if(periodo==='mes')return d.getMonth()===now.getMonth()&&d.getFullYear()===now.getFullYear();return true}
  const fc=DB.get('citas').filter(c=>inP(c.fecha)),fp=DB.get('pagos').filter(p=>inP(p.fecha)),fg=DB.get('gastos').filter(g=>inP(g.fecha)),pac=DB.get('pacientes'),ft=DB.get('tareas');
  const totalIngresos=fp.reduce((s,p)=>s+(p.monto||0),0);
  const totalGastos=fg.reduce((s,g)=>s+(g.monto||0),0);

  document.getElementById('rpt-kpis').innerHTML=`
    <div class="report-kpi"><div class="report-kpi__icon report-kpi__icon--blue"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/></svg></div><p class="report-kpi__value">${fc.length}</p><p class="report-kpi__label">Citas</p></div>
    <div class="report-kpi"><div class="report-kpi__icon report-kpi__icon--green"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg></div><p class="report-kpi__value">${fc.filter(c=>c.estado==='completada').length}</p><p class="report-kpi__label">Completadas</p></div>
    <div class="report-kpi"><div class="report-kpi__icon report-kpi__icon--red"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></div><p class="report-kpi__value">${fc.filter(c=>c.estado==='cancelada').length}</p><p class="report-kpi__label">Canceladas</p></div>
    <div class="report-kpi"><div class="report-kpi__icon report-kpi__icon--purple"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.582-7 8-7s8 3 8 7"/></svg></div><p class="report-kpi__value">${pac.length}</p><p class="report-kpi__label">Pacientes</p></div>
    <div class="report-kpi"><div class="report-kpi__icon report-kpi__icon--green"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="5" width="20" height="14" rx="2"/></svg></div><p class="report-kpi__value">${fmtMoney(totalIngresos)}</p><p class="report-kpi__label">Ingresos</p></div>
    <div class="report-kpi"><div class="report-kpi__icon report-kpi__icon--red"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="1" x2="12" y2="23"/></svg></div><p class="report-kpi__value">${fmtMoney(totalGastos)}</p><p class="report-kpi__label">Gastos</p></div>`;

  // Balance Chart (Ingresos vs Gastos)
  const balance=totalIngresos-totalGastos;
  const byMethod={};fp.forEach(p=>{byMethod[p.metodo||'Sin definir']=(byMethod[p.metodo||'Sin definir']||0)+(p.monto||0)});
  
  if (window.Chart) {
      const ctxBalance = document.getElementById('chart-balance');
      if (ctxBalance) {
          if (Chart.getChart(ctxBalance)) Chart.getChart(ctxBalance).destroy();
          new Chart(ctxBalance, {
              type: 'doughnut',
              data: {
                  labels: ['Ingresos', 'Gastos'],
                  datasets: [{
                      data: [totalIngresos, totalGastos],
                      backgroundColor: ['#10b981', '#ef4444'],
                      borderWidth: 0
                  }]
              },
              options: {
                  responsive: true,
                  maintainAspectRatio: false,
                  cutout: '70%',
                  plugins: { legend: { position: 'bottom' } }
              }
          });
      }
  }
  
  const balanceText = document.getElementById('rpt-balance-text');
  if (balanceText) {
      balanceText.innerHTML = `
        <div class="income-big ${balance>=0?'income-big--green':'income-big--red'}">${fmtMoney(balance)}</div>
        <p class="income-label">Balance (Ingresos − Gastos)</p>
        ${Object.entries(byMethod).map(([m,v])=>`<div class="income-method"><span class="income-method__name">${escH(m)}</span><span class="income-method__val">${fmtMoney(v)}</span></div>`).join('')||'<p style="color:var(--gray-400);font-size:12px">Sin pagos</p>'}
      `;
  }
    
  // CORTE DE CAJA
  const efe = byMethod['Efectivo'] || 0;
  const tar = byMethod['Tarjeta'] || 0;
  const tra = byMethod['Transferencia'] || 0;
  const gastosEfectivo = fg.filter(g => !g.metodo || g.metodo === 'Efectivo').reduce((s, g) => s + (g.monto || 0), 0);
  const gastosTarjeta = totalGastos - gastosEfectivo;
  const efNeto = efe - gastosEfectivo;
  
  if (document.getElementById('rpt-corte-caja')) {
    document.getElementById('rpt-corte-caja').innerHTML = `
      <div style="display:flex;justify-content:space-between;margin-bottom:5px;"><span>Efectivo:</span> <strong>${fmtMoney(efe)}</strong></div>
      <div style="display:flex;justify-content:space-between;margin-bottom:5px;"><span>Tarjeta:</span> <strong>${fmtMoney(tar)}</strong></div>
      <div style="display:flex;justify-content:space-between;margin-bottom:5px;"><span>Transferencia:</span> <strong>${fmtMoney(tra)}</strong></div>
      <hr style="margin:10px 0;border-top:1px solid #e5e7eb;">
      ${gastosEfectivo > 0 ? `<div style="display:flex;justify-content:space-between;margin-bottom:5px;color:var(--red);"><span>Gastos en Efectivo (Se restan):</span> <strong>${fmtMoney(gastosEfectivo)}</strong></div>` : ''}
      ${gastosTarjeta > 0 ? `<div style="display:flex;justify-content:space-between;margin-bottom:5px;color:var(--orange);"><span>Gastos con Tarjeta/Transf.:</span> <strong>${fmtMoney(gastosTarjeta)}</strong></div>` : ''}
      <div style="display:flex;justify-content:space-between;margin-bottom:5px;font-size:16px;color:var(--green);"><span><strong>Efectivo Neto en Caja:</strong></span> <strong>${fmtMoney(efNeto)}</strong></div>
      <div style="display:flex;justify-content:space-between;font-size:16px;color:var(--blue);"><span><strong>Ingreso Total:</strong></span> <strong>${fmtMoney(totalIngresos)}</strong></div>
    `;
  }
  
  // PRODUCCIÓN POR DOCTOR
  if (document.getElementById('rpt-doctores-tbody')) {
    const byDoc = {};
    fp.forEach(p => {
        const doc = p.doctor || 'Clínica / Sin Asignar';
        byDoc[doc] = (byDoc[doc] || 0) + (p.monto || 0);
    });
    const tbDoc = Object.entries(byDoc).sort((a,b)=>b[1]-a[1]).map(([d, v]) => `
        <tr><td>${escH(d)}</td><td style="color:var(--blue);font-weight:bold;">${fmtMoney(v)}</td></tr>
    `).join('');
    document.getElementById('rpt-doctores-tbody').innerHTML = tbDoc || '<tr><td colspan="2" style="text-align:center;">No hay ingresos</td></tr>';
  }
  
  // PREPARAR TICKET DE IMPRESIÓN
  if (document.getElementById('corte-fecha-impresion')) {
    document.getElementById('corte-fecha-impresion').textContent = new Date().toLocaleString('es-MX');
    document.getElementById('corte-periodo').textContent = document.getElementById('reporte-periodo').options[document.getElementById('reporte-periodo').selectedIndex].text;
    document.getElementById('corte-ingresos').innerHTML = `
      Efectivo: ${fmtMoney(efe)}<br>
      Tarjeta: ${fmtMoney(tar)}<br>
      Transferencia: ${fmtMoney(tra)}<br>
      <strong>TOTAL INGRESOS: ${fmtMoney(totalIngresos)}</strong>
    `;
    document.getElementById('corte-gastos').innerHTML = fg.map(g => `${escH(g.concepto)} (${escH(g.metodo||'Efectivo')}): ${fmtMoney(g.monto)}`).join('<br>') + `<br><strong>TOTAL GASTOS: ${fmtMoney(totalGastos)}</strong><br><small>Gastos en efectivo: ${fmtMoney(gastosEfectivo)}</small>`;
    document.getElementById('corte-neto').textContent = fmtMoney(efNeto);
  }


  // Bar chart Motivos
  const byMot={};fc.forEach(c=>{byMot[c.motivo||'Otro']=(byMot[c.motivo||'Otro']||0)+1});
  const sorted=Object.entries(byMot).sort((a,b)=>b[1]-a[1]).slice(0,6);
  
  if (window.Chart && sorted.length > 0) {
      const ctxMotivos = document.getElementById('chart-motivos');
      if (ctxMotivos) {
          if (Chart.getChart(ctxMotivos)) Chart.getChart(ctxMotivos).destroy();
          new Chart(ctxMotivos, {
              type: 'bar',
              data: {
                  labels: sorted.map(s => s[0]),
                  datasets: [{
                      label: 'Citas',
                      data: sorted.map(s => s[1]),
                      backgroundColor: '#3b82f6',
                      borderRadius: 4
                  }]
              },
              options: {
                  responsive: true,
                  maintainAspectRatio: false,
                  plugins: { legend: { display: false } },
                  scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } }
              }
          });
      }
  }

  // Last 10 citas
  const l10=[...fc].sort((a,b)=>(b.fecha+b.hora).localeCompare(a.fecha+a.hora)).slice(0,10);
  document.getElementById('rpt-citas-tbody').innerHTML=l10.map(c=>`<tr><td>${escH(c.nombre_paciente)}</td><td>${prettyDate(c.fecha)} ${escH(c.hora)}</td><td>${escH(c.motivo)}</td><td><span class="tag tag--${c.estado}">${c.estado}</span></td></tr>`).join('')||'<tr><td colspan="4" style="text-align:center;color:var(--gray-400);padding:20px">Sin datos</td></tr>';
}

/* ─── 7. MODAL SYSTEM ─── */
let modalType=null,modalEditId=null;
function openModal(type,editData){
  modalType=type;modalEditId=editData?.id||null;
  const ov=document.getElementById('modal-overlay'),title=document.getElementById('modal-title'),body=document.getElementById('modal-body'),sub=document.getElementById('modal-submit');
  const isE=!!editData;
  const pacOpts=()=>DB.get('pacientes').map(p=>`<option value="${escH(p.nombre)}" ${editData?.nombre_paciente===p.nombre?'selected':''}>${escH(p.nombre)}</option>`).join('');
  const motivoOpts=()=>['Consulta','Limpieza','Extracción','Ortodoncia','Revisión','Blanqueamiento','Radiografía','Corona','Implante','Emergencia','Otro'].map(m=>`<option ${editData?.motivo===m?'selected':''}>${m}</option>`).join('');

  if(type==='usuario' || type==='periodontograma' || type==='arancel' || type==='laboratorio'){
     document.getElementById('modal-'+type)?.removeAttribute('hidden');
     if(type==='usuario'){
         document.getElementById('form-usuario').reset();
         delete document.getElementById('form-usuario').dataset.editId;
         const titleEl = document.getElementById('modal-usuario-title');
         if (titleEl) titleEl.textContent = 'Nuevo Usuario';
         document.getElementById('u-password').required=true;
         const helpEl = document.getElementById('u-password-help');
         if (helpEl) helpEl.style.display = 'none';
         document.getElementById('u-rol').value = 'doctor';
         actualizarInfoRolModal('doctor');
     } else if(type==='arancel'){
         document.getElementById('form-arancel').reset();
         document.getElementById('arancel-id').value = editData?.id || '';
         document.getElementById('modal-arancel-title').textContent = editData ? 'Editar Arancel' : 'Nuevo Arancel / Prestación';
         if(editData){
           document.getElementById('arancel-codigo').value = editData.codigo || '';
           document.getElementById('arancel-categoria').value = editData.categoria || 'Operatorias y Resinas';
           document.getElementById('arancel-nombre').value = editData.nombre || '';
           document.getElementById('arancel-precio').value = editData.precio || 0;
           document.getElementById('arancel-aplica').value = editData.aplica_a || 'cara';
         }
     } else if(type==='laboratorio'){
         document.getElementById('form-laboratorio').reset();
         const pSelect = document.getElementById('lab-paciente');
         if (pSelect) {
           pSelect.innerHTML = '<option value="">Seleccionar Paciente...</option>' + 
             DB.get('pacientes').map(p => `<option value="${escH(p.nombre)}" ${editData?.nombre_paciente === p.nombre ? 'selected' : ''}>${escH(p.nombre)}</option>`).join('');
         }
         document.getElementById('modal-laboratorio-title').textContent = editData ? `Editar Orden: ${editData.folio || 'Laboratorio'}` : 'Nueva Orden de Laboratorio Dental';
         document.getElementById('lab-id').value = editData?.id || '';
         document.getElementById('lab-diente').value = editData?.diente || '';
         document.getElementById('lab-trabajo').value = editData?.trabajo || 'Corona Zirconia Monolítica';
         document.getElementById('lab-nombre').value = editData?.laboratorio_nombre || '';
         document.getElementById('lab-color').value = editData?.color_guia || '';
         document.getElementById('lab-costo').value = editData?.costo_laboratorio || '';
         document.getElementById('lab-fecha-envio').value = editData?.fecha_envio || todayStr();
         document.getElementById('lab-fecha-entrega').value = editData?.fecha_entrega_estimada || fmt(addDays(new Date(), 5));
         document.getElementById('lab-doctor').value = editData?.doctor || 'Dra. Rosa Avila';
         document.getElementById('lab-estado').value = editData?.estado || 'enviado';
         document.getElementById('lab-notas').value = editData?.notas || '';
     }
     return;
  }

  if(type==='cita'){
    title.textContent=isE?'Editar Cita':'Nueva Cita';sub.textContent=isE?'Actualizar':'Agendar';
    const sillonesList = DB.get('sillones').length > 0 ? DB.get('sillones') : [
      { id: 'sillon_1', nombre: 'Sillón 1 (Principal)' },
      { id: 'sillon_2', nombre: 'Sillón 2 (Quirúrgico)' },
      { id: 'sillon_3', nombre: 'Sillón 3 (Odonto / Orto)' }
    ];
    const sillonOpts = () => sillonesList.map(s => `<option value="${s.id}" ${(editData?.id_sillon || 'sillon_1') === s.id ? 'selected' : ''}>${escH(s.nombre)}</option>`).join('');

    body.innerHTML=`
      <div class="form-group"><label class="form-label">Paciente *</label><select class="form-input form-select" id="f-pac" required><option value="">Seleccionar...</option>${pacOpts()}</select></div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Sillón / Unidad Dental *</label><select class="form-input form-select" id="f-sillon">${sillonOpts()}</select></div>
        <div class="form-group"><label class="form-label">Doctor(a) *</label><input class="form-input" id="f-doctor" value="${escH(editData?.doctor||'Dra. Rosa Avila')}" placeholder="Ej: Dra. Rosa Avila"></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Fecha *</label><input class="form-input" type="date" id="f-fecha" value="${editData?.fecha||todayStr()}"></div>
        <div class="form-group"><label class="form-label">Hora *</label><input class="form-input" type="time" id="f-hora" value="${editData?.hora||'09:00'}"></div>
      </div>
      <div class="form-group"><label class="form-label">Motivo de Consulta *</label><select class="form-input form-select" id="f-motivo"><option value="">Seleccionar...</option>${motivoOpts()}</select></div>
      ${isE?`<div class="form-group"><label class="form-label">Estado de la Cita</label><select class="form-input form-select" id="f-estado">
        <option value="pendiente" ${editData?.estado==='pendiente'?'selected':''}>📅 Agendada / Por Llegar</option>
        <option value="en_espera" ${editData?.estado==='en_espera'?'selected':''}>🛋️ En Sala de Espera (Llegó)</option>
        <option value="en_sillon" ${editData?.estado==='en_sillon'?'selected':''}>💺 En Sillón Dental (En Atención)</option>
        <option value="completada" ${editData?.estado==='completada'?'selected':''}>✅ Finalizada / Atendida</option>
        <option value="cancelada" ${editData?.estado==='cancelada'?'selected':''}>❌ Cancelada / No Asistió</option>
      </select></div>`:''}
    `;
  }else if(type==='paciente'){
    title.textContent=isE?'Editar Paciente':'Nuevo Paciente';sub.textContent=isE?'Actualizar':'Registrar';
    body.innerHTML=`<div class="form-group"><label class="form-label">Nombre completo</label><input class="form-input" id="f-nombre" placeholder="Juan Pérez" value="${escH(editData?.nombre||'')}"></div><div class="form-row"><div class="form-group"><label class="form-label">Teléfono</label><input class="form-input" id="f-tel" placeholder="555-123-4567" value="${escH(editData?.telefono||'')}"></div><div class="form-group"><label class="form-label">Correo</label><input class="form-input" type="email" id="f-correo" placeholder="correo@mail.com" value="${escH(editData?.correo||'')}"></div></div>`;
  }else if(type==='pago'){
    title.textContent='Registrar Pago';sub.textContent='Registrar';
    body.innerHTML=`<div class="form-group"><label class="form-label">Paciente</label><select class="form-input form-select" id="f-pac"><option value="">Seleccionar...</option>${pacOpts()}</select></div><div class="form-row"><div class="form-group"><label class="form-label">Monto ($)</label><input class="form-input" type="number" id="f-monto" placeholder="0" min="0" value="${editData?.monto||''}"></div><div class="form-group"><label class="form-label">Método</label><select class="form-input form-select" id="f-metodo"><option ${editData?.metodo==='Efectivo'?'selected':''}>Efectivo</option><option ${editData?.metodo==='Tarjeta'?'selected':''}>Tarjeta</option><option ${editData?.metodo==='Transferencia'?'selected':''}>Transferencia</option></select></div></div><div class="form-row"><div class="form-group"><label class="form-label">Concepto</label><select class="form-input form-select" id="f-concepto"><option value="">Seleccionar...</option>${motivoOpts()}</select></div><div class="form-group"><label class="form-label">Doctor / Asistente</label><input class="form-input" id="f-doctor" placeholder="Ej: Dra. Rosa, Dr. Juan" value="${escH(editData?.doctor||'')}"></div></div>`;
  }else if(type==='historia'){
    title.textContent='Registrar Evolución Clínica';sub.textContent='Guardar';
    body.innerHTML=`<div class="form-group"><label class="form-label">Paciente</label><select class="form-input form-select" id="f-pac"><option value="">Seleccionar...</option>${pacOpts()}</select></div><div class="form-row"><div class="form-group"><label class="form-label">Diente / Zona</label><input class="form-input" id="f-diente" placeholder="Ej: Molar 36, Arcada sup."></div><div class="form-group"><label class="form-label">Tratamiento</label><input class="form-input" id="f-tratamiento" placeholder="Ej: Resina, Brackets"></div></div><div class="form-group"><label class="form-label">Descripción del procedimiento</label><textarea class="form-input form-textarea" id="f-desc" placeholder="Detalles del procedimiento realizado..."></textarea></div>`;
  }else if(type==='ortodoncia'){
    title.textContent=isE?'Editar Ortodoncia':'Nueva Evolución Ortodoncia';sub.textContent=isE?'Actualizar':'Guardar';
    body.innerHTML=`<div class="form-group"><label class="form-label">Paciente</label><select class="form-input form-select" id="f-pac"><option value="">Seleccionar...</option>${pacOpts()}</select></div><div class="form-row"><div class="form-group"><label class="form-label">Aparatología</label><input class="form-input" id="f-aparato" placeholder="Ej. Brackets MBT, Expansor" value="${escH(editData?.aparatologia||'')}"></div><div class="form-group"><label class="form-label">Arcos / Ligas</label><input class="form-input" id="f-ligas" placeholder="Ej. NiTi 0.14, Cadena 13-23" value="${escH(editData?.ligas||'')}"></div></div><div class="form-row"><div class="form-group"><label class="form-label">Higiene</label><select class="form-input form-select" id="f-higiene"><option ${editData?.higiene==='Buena'?'selected':''}>Buena</option><option ${editData?.higiene==='Regular'?'selected':''}>Regular</option><option ${editData?.higiene==='Mala'?'selected':''}>Mala</option></select></div><div class="form-group"><label class="form-label">Fecha</label><input class="form-input" type="date" id="f-fecha" value="${editData?.fecha||todayStr()}"></div></div><div class="form-group"><label class="form-label">Notas / Tracción</label><textarea class="form-input form-textarea" id="f-notas" placeholder="Instrucciones al paciente, uso de elásticos...">${escH(editData?.notas||'')}</textarea></div>`;
  }else if(type==='presupuesto'){
    title.textContent=isE?'Editar Presupuesto':'Nuevo Presupuesto';sub.textContent=isE?'Actualizar':'Crear';
    body.innerHTML=`<div class="form-group"><label class="form-label">Paciente</label><select class="form-input form-select" id="f-pac"><option value="">Seleccionar...</option>${pacOpts()}</select></div>
    
    <div class="form-group">
      <label class="form-label">Desglose de Tratamientos</label>
      <div id="p-items-container"></div>
      <button type="button" class="btn-add-row" onclick="addPItem()">+ Añadir Tratamiento</button>
    </div>
    
    <div class="form-group" style="display:flex; justify-content:space-between; align-items:center; background:var(--gray-50); padding:10px; border-radius:6px; border:1px solid var(--gray-200);">
        <label class="form-label" style="margin:0;">Monto Total Automático ($)</label>
        <input class="form-input" type="number" id="f-monto" placeholder="0" min="0" value="${editData?.monto||'0'}" style="width:120px; font-weight:bold; background:#fff; text-align:right;" readonly>
    </div>
    
    ${isE ? `<div class="form-group" style="margin-top:15px;"><label class="form-label">Estado</label><select class="form-input form-select" id="f-estado"><option ${editData.estado==='pendiente'?'selected':''}>pendiente</option><option ${editData.estado==='aprobado'?'selected':''}>aprobado</option><option ${editData.estado==='rechazado'?'selected':''}>rechazado</option></select></div>` : ''}`;
    
    setTimeout(() => {
        if(isE && editData.tratamientos) {
            try {
                const items = JSON.parse(editData.tratamientos);
                if (Array.isArray(items)) {
                    items.forEach(i => addPItem(i.concepto, i.costo, i.fase));
                } else {
                    addPItem(editData.tratamientos, editData.monto);
                }
            } catch(e) {
                addPItem(editData.tratamientos, editData.monto);
            }
        } else {
            addPItem(); // 1 fila vacia
        }
    }, 10);
  }else if(type==='gasto'){
    title.textContent='Registrar Gasto';sub.textContent='Registrar';
    body.innerHTML=`<div class="form-group"><label class="form-label">Concepto</label><input class="form-input" id="f-concepto" placeholder="Ej: Renta, Material, Luz"></div><div class="form-row"><div class="form-group"><label class="form-label">Monto ($)</label><input class="form-input" type="number" id="f-monto" placeholder="0" min="0"></div><div class="form-group"><label class="form-label">Método de Pago</label><select class="form-input form-select" id="f-metodo"><option>Efectivo</option><option>Tarjeta</option><option>Transferencia</option></select></div></div>`;
  }else if(type==='inventario'){
    title.textContent='Movimiento de Inventario';sub.textContent='Registrar';
    body.innerHTML=`<div class="form-group"><label class="form-label">Nombre del insumo</label><input class="form-input" id="f-insumo" placeholder="Ej: Guantes de látex"></div><div class="form-row"><div class="form-group"><label class="form-label">Cantidad</label><input class="form-input" type="number" id="f-qty" placeholder="0" min="1"></div><div class="form-group"><label class="form-label">Tipo de movimiento</label><select class="form-input form-select" id="f-tipo"><option value="ingreso">Ingreso</option><option value="egreso">Egreso</option></select></div></div>`;
  }else if(type==='tarea'){
    title.textContent='Nueva Tarea / CRM';sub.textContent='Crear';
    body.innerHTML=`<div class="form-group"><label class="form-label">Descripción de la tarea</label><textarea class="form-input form-textarea" id="f-desc" placeholder="Ej: Llamar para confirmar cita"></textarea></div><div class="form-row"><div class="form-group"><label class="form-label">Responsable</label><input class="form-input" id="f-responsable" placeholder="Nombre"></div><div class="form-group"><label class="form-label">Fecha límite</label><input class="form-input" type="date" id="f-fecha" value="${todayStr()}"></div></div>`;
  }
  ov.removeAttribute('hidden');setTimeout(()=>body.querySelector('input,select,textarea')?.focus(),80);
}
function closeModal(customId){
  if (customId) {
    document.getElementById('modal-' + customId)?.setAttribute('hidden', '');
  } else {
    document.getElementById('modal-overlay')?.setAttribute('hidden', '');
    modalType = null;
    modalEditId = null;
  }
}
function submitModal(){
  const v=id=>{const el=document.getElementById(id);return el?el.value.trim():''};
  const req=(fields,labels)=>{const missing=fields.map((f,i)=>v(f)?null:labels[i]).filter(Boolean);if(missing.length){showToast('Falta: '+missing.join(', '),'error');return false}return true};

  if(modalType==='cita'){
    if(!req(['f-pac','f-fecha','f-hora','f-motivo'],['Paciente','Fecha','Hora','Motivo']))return;
    const idSillon = v('f-sillon') || 'sillon_1';
    const sillonesList = DB.get('sillones');
    const sillonObj = sillonesList.find(s => s.id === idSillon);
    const nombreSillon = sillonObj ? sillonObj.nombre : (idSillon === 'sillon_2' ? 'Sillón 2 (Quirúrgico)' : idSillon === 'sillon_3' ? 'Sillón 3 (Odonto / Orto)' : 'Sillón 1 (Principal)');
    const doctorCita = v('f-doctor') || 'Dra. Rosa Avila';
    const fechaCita = v('f-fecha');
    const horaCita = v('f-hora');

    // Validación de conflicto físico en el sillón (Candado de sobrecupo)
    const conflicto = DB.get('citas').find(c => 
      c.id !== modalEditId &&
      c.fecha === fechaCita &&
      c.hora === horaCita &&
      (c.id_sillon || 'sillon_1') === idSillon &&
      c.estado !== 'cancelada'
    );

    if (conflicto) {
      const confirmar = confirm(`⚠️ ALERTA DE CONFLICTO EN SILLÓN:\nEl "${nombreSillon}" ya tiene una cita programada a las ${horaCita} con el paciente "${conflicto.nombre_paciente}".\n\n¿Desea registrar de todos modos o prefiere cancelar para elegir otro sillón u horario?`);
      if (!confirmar) return;
    }

    const payload = {
      nombre_paciente: v('f-pac'),
      id_sillon: idSillon,
      nombre_sillon: nombreSillon,
      doctor: doctorCita,
      fecha: fechaCita,
      hora: horaCita,
      motivo: v('f-motivo'),
      estado: modalEditId ? (v('f-estado') || 'pendiente') : 'pendiente'
    };

    if(modalEditId) DB.update('citas', modalEditId, payload);
    else DB.add('citas', payload);
    addFeedItem({title:`${modalEditId?'Cita actualizada':'Nueva cita'}: ${v('f-pac')}`,sub:`[${nombreSillon}] ${v('f-motivo')} – ${fechaCita} ${horaCita}`,type:'cita'});
  }else if(modalType==='paciente'){
    if(!req(['f-nombre'],['Nombre']))return;
    if(modalEditId)DB.update('pacientes',modalEditId,{nombre:v('f-nombre'),telefono:v('f-tel'),correo:v('f-correo')});
    else DB.add('pacientes',{nombre:v('f-nombre'),telefono:v('f-tel'),correo:v('f-correo')});
    addFeedItem({title:`${modalEditId?'Paciente actualizado':'Nuevo paciente'}: ${v('f-nombre')}`,sub:v('f-tel')||v('f-correo'),type:'paciente'});
  }else if(modalType==='pago'){
    if(!req(['f-pac','f-monto','f-concepto'],['Paciente','Monto','Concepto']))return;
    if(modalEditId) DB.update('pagos',modalEditId,{nombre_paciente:v('f-pac'),monto:parseFloat(v('f-monto')),concepto:v('f-concepto'),metodo:v('f-metodo'),doctor:v('f-doctor'),fecha:todayStr()});
    else DB.add('pagos',{nombre_paciente:v('f-pac'),monto:parseFloat(v('f-monto')),concepto:v('f-concepto'),metodo:v('f-metodo'),doctor:v('f-doctor'),fecha:todayStr()});
    addFeedItem({title:`Pago ${fmtMoney(v('f-monto'))} – ${v('f-pac')}`,sub:v('f-concepto'),type:'pago'});
  }else if(modalType==='historia'){
    if(!req(['f-pac','f-diente','f-tratamiento'],['Paciente','Diente/Zona','Tratamiento']))return;
    DB.add('historia',{nombre_paciente:v('f-pac'),diente_zona:v('f-diente'),tratamiento:v('f-tratamiento'),descripcion:v('f-desc'),fecha:todayStr()});
    addFeedItem({title:`Evolución: ${v('f-pac')}`,sub:`${v('f-diente')} – ${v('f-tratamiento')}`,type:'historia'});
  }else if(modalType==='ortodoncia'){
    if(!req(['f-pac','f-fecha'],['Paciente','Fecha']))return;
    if(modalEditId) DB.update('ortodoncia',modalEditId,{nombre_paciente:v('f-pac'),aparatologia:v('f-aparato'),ligas:v('f-ligas'),higiene:v('f-higiene'),notas:v('f-notas'),fecha:v('f-fecha')});
    else DB.add('ortodoncia',{nombre_paciente:v('f-pac'),aparatologia:v('f-aparato'),ligas:v('f-ligas'),higiene:v('f-higiene'),notas:v('f-notas'),fecha:v('f-fecha')});
    addFeedItem({title:`Ortodoncia: ${v('f-pac')}`,sub:`Evolución ${v('f-fecha')}`,type:'historia'});
  }else if(modalType==='presupuesto'){
    // Recopilar items dinámicos
    const concepts = Array.from(document.querySelectorAll('.p-item-concepto')).map(el => el.value.trim());
    const costos = Array.from(document.querySelectorAll('.p-item-costo')).map(el => parseFloat(el.value) || 0);
    const fases = Array.from(document.querySelectorAll('.p-item-fase')).map(el => el.value);
    
    let items = [];
    let sum = 0;
    for(let i = 0; i < concepts.length; i++) {
        if (concepts[i] || costos[i] > 0) {
            items.push({ fase: fases[i] || 'Fase 1: Higiene/Prevención', concepto: concepts[i] || 'Tratamiento', costo: costos[i] });
            sum += costos[i];
        }
    }
    
    if(!req(['f-pac'],['Paciente']))return;
    if(items.length === 0) { showToast('Debes añadir al menos un tratamiento', 'error'); return; }
    
    const tratamientosJSON = JSON.stringify(items);
    
    if(modalEditId) {
        DB.update('presupuestos', modalEditId, {nombre_paciente:v('f-pac'), tratamientos:tratamientosJSON, monto:sum, estado:v('f-estado')||'pendiente'});
        addFeedItem({title:`Presupuesto Actualizado: ${v('f-pac')}`,sub:`${fmtMoney(sum)} (Modificado)`,type:'presupuesto'});
    } else {
        DB.add('presupuestos',{nombre_paciente:v('f-pac'),tratamientos:tratamientosJSON,monto:sum,estado:'pendiente',fecha:todayStr()});
        addFeedItem({title:`Presupuesto: ${v('f-pac')}`,sub:`${fmtMoney(sum)}`,type:'presupuesto'});
    }
  }else if(modalType==='gasto'){
    if(!req(['f-concepto','f-monto'],['Concepto','Monto']))return;
    DB.add('gastos',{concepto:v('f-concepto'),monto:parseFloat(v('f-monto')),metodo:v('f-metodo')||'Efectivo',fecha:todayStr()});
    addFeedItem({title:`Gasto: ${v('f-concepto')}`,sub:fmtMoney(v('f-monto')),type:'gasto'});
  }else if(modalType==='inventario'){
    if(!req(['f-insumo','f-qty'],['Insumo','Cantidad']))return;
    const insumo=v('f-insumo'),qty=parseInt(v('f-qty')),tipo=v('f-tipo');
    registrarMovimientoInventario(insumo,tipo,qty);
    addFeedItem({title:`Inventario: ${insumo}`,sub:`${tipo==='ingreso'?'+':'-'}${qty} unidades`,type:'inventario'});
  }else if(modalType==='tarea'){
    if(!req(['f-desc','f-responsable','f-fecha'],['Descripción','Responsable','Fecha']))return;
    DB.add('tareas',{descripcion:v('f-desc'),responsable:v('f-responsable'),fecha_limite:v('f-fecha'),estado:'pendiente'});
    addFeedItem({title:`Tarea: ${v('f-desc').slice(0,40)}`,sub:`Responsable: ${v('f-responsable')}`,type:'tarea'});
  }
  showToast('Guardado correctamente','success');closeModal();
  // Refresh all relevant views
  [renderCitas,renderPacientes,renderHistoria,renderPresupuestos,renderLaboratorio,renderPagos,renderGastos,renderInventario,renderTareas,refreshDashboard].forEach(fn=>fn());
}

/* ─── 8. NLP MOTOR (8 ACCIONES) ─── */
function nlpProcess(text){
  const lo=text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  let action='DESCONOCIDO';

  // Priority-ordered action detection
  if(/historia|evolucion|odontograma|procedimiento\s+cl|anota.*(?:resina|molar|diente|bracket|endo|corona|pulp)/.test(lo)) action='REGISTRAR_EVOLUCION_CLINICA';
  else if(/presupuesto|cotizacion|cotizar/.test(lo)) action='CREAR_PRESUPUESTO';
  else if(/inventario|almacen|insumo|(?:lleg|entr|sal)(?:aron|o|en).*(?:caja|guante|material|resina|anestesia)|stock/.test(lo)) action='ACTUALIZAR_INVENTARIO';
  else if(/gasto|factura|pagamos.*(?:renta|luz|agua|material)|se\s+pago.*(?:renta|luz|servicio)|renta\s+del/.test(lo)) action='REGISTRAR_GASTO';
  else if(/tarea|recordatorio|crm|seguimiento|(?:envi|llam|mandar|contactar).*(?:encuesta|mensaje|correo|whatsapp)/.test(lo)) action='CREAR_TAREA_CRM';
  else if(/agenda|cita|programa|reserva/.test(lo)) action='AGENDAR_CITA';
  else if(/pag[o]|cobr[oae]|efectivo|tarjeta|transferencia/.test(lo)) action='REGISTRAR_PAGO';
  else if(/registra.*paciente|nuevo\s*paciente|crea.*paciente|agrega.*paciente/.test(lo)) action='CREAR_PACIENTE';

  // ── Extract fields ──
  let nombre=null; const nm=text.match(/(?:(?:a|de|para|paciente)\s+)([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)*)/u); if(nm)nombre=nm[1];
  // Nombre fallback for historia: "historia de Luis Perez"
  if(!nombre){const nm2=text.match(/(?:historia|evolucion|evolución)\s+(?:de\s+)?([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)*)/ui);if(nm2)nombre=nm2[1]}

  let fecha=null,hora=null;const today=new Date();
  if(/manana|mañana/.test(lo))fecha=fmt(addDays(today,1));
  else if(/hoy/.test(lo))fecha=todayStr();
  else if(/pasado\s+ma[nñ]ana/.test(lo))fecha=fmt(addDays(today,2));
  else if(/viernes/.test(lo)){let d=new Date(today);const diff=(5-d.getDay()+7)%7||7;d.setDate(d.getDate()+diff);fecha=fmt(d)}
  else if(/lunes/.test(lo)){let d=new Date(today);const diff=(1-d.getDay()+7)%7||7;d.setDate(d.getDate()+diff);fecha=fmt(d)}
  else{const months={enero:1,febrero:2,marzo:3,abril:4,mayo:5,junio:6,julio:7,agosto:8,septiembre:9,octubre:10,noviembre:11,diciembre:12};const dm=lo.match(/(\d{1,2})\s+de\s+([a-z]+)/);if(dm&&months[dm[2]])fecha=`${today.getFullYear()}-${pad(months[dm[2]])}-${pad(parseInt(dm[1]))}`}

  const hm=lo.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm|de la tarde|de la manana)?/);
  if(hm){let h=parseInt(hm[1]);const m=hm[2]?parseInt(hm[2]):0;const mod=hm[3]||'';if(/(pm|tarde)/.test(mod)&&h<12)h+=12;if(/(am|manana)/.test(mod)&&h===12)h=0;if(h>=1&&h<=23)hora=`${pad(h)}:${pad(m)}`}

  let monto=null;const mm=text.match(/\$?\s*(\d[\d,]*(?:\.\d{1,2})?)\s*(pesos|mxn)?/i);
  if(mm&&(action==='REGISTRAR_PAGO'||action==='CREAR_PRESUPUESTO'||action==='REGISTRAR_GASTO'))monto=parseFloat(mm[1].replace(/,/g,''));

  let motivo=null;
  const kws=['limpieza','extraccion','consulta','revision','ortodoncia','blanqueamiento','radiografia','relleno','corona','implante','emergencia','endodoncia','brackets','resina','pulpotomia'];
  for(const k of kws){if(lo.includes(k)){motivo=k.charAt(0).toUpperCase()+k.slice(1);break}}
  if(!motivo){const cm=text.match(/(?:por|para|concepto)\s+(?:su|una?|el|la)?\s*([a-záéíóúñ ]{3,30})/i);if(cm)motivo=cm[1].trim().replace(/^\w/,c=>c.toUpperCase())}

  let telefono=null;const tm=text.match(/\b(\d{3}[-\s]?\d{3}[-\s]?\d{4}|\d{10})\b/);if(tm)telefono=tm[1];
  let correo=null;const em=text.match(/[\w.-]+@[\w.-]+\.\w+/);if(em)correo=em[0];
  let metodo=null;if(/efectivo/.test(lo))metodo='Efectivo';else if(/tarjeta/.test(lo))metodo='Tarjeta';else if(/transferencia/.test(lo))metodo='Transferencia';

  // Fields specific to new actions
  let diente_zona=null;const dz=text.match(/(?:molar|diente|pieza|zona|arcada)\s*(\d{0,2}\s*[a-záéíóúñ]*)/i);if(dz)diente_zona=dz[0].trim().replace(/^\w/,c=>c.toUpperCase());
  let item=null,cantidad=null,responsable=null;

  if(action==='ACTUALIZAR_INVENTARIO'){
    const qm=text.match(/(\d+)\s+(?:cajas?\s+de\s+)?(.+?)(?:\s+al\s+almacen|\s+a\s+inventario|\s*$)/i);
    if(qm){cantidad=parseInt(qm[1]);item=qm[2].trim().replace(/^\w/,c=>c.toUpperCase())}
    if(!item){const im=text.match(/(?:de|insumo|material)\s+(.+?)(?:\s*,|\s*$)/i);if(im)item=im[1].trim()}
  }
  if(action==='REGISTRAR_EVOLUCION_CLINICA'){
    item=motivo; // treatment
    if(!diente_zona){const dz2=lo.match(/(?:en\s+(?:el|la|los)?\s*)([a-z0-9 ]+(?:molar|diente|pieza|premolar|incisivo|canino|arcada)[a-z0-9 ]*)/i);if(dz2)diente_zona=dz2[1].trim().replace(/^\w/,c=>c.toUpperCase())}
  }
  if(action==='REGISTRAR_GASTO'){
    const gm=text.match(/(?:gasto|pago|pagamos|factura)\s+(?:de\s+|por\s+)?(.+?)(?:\s+(?:de|por)\s+\$?\s*\d|\s*$)/i);
    if(gm)motivo=gm[1].trim().replace(/^\w/,c=>c.toUpperCase());
    if(!motivo){
      // Try extracting concept like "Renta del local"
      const gm2=text.match(/(?:renta|luz|agua|internet|material|nomina|sueldo|mantenimiento)[a-záéíóúñ\s]*/i);
      if(gm2)motivo=gm2[0].trim().replace(/^\w/,c=>c.toUpperCase());
    }
  }
  if(action==='CREAR_TAREA_CRM'){
    const rm=text.match(/(?:que|para que)\s+(\w+)/i);if(rm)responsable=rm[1].charAt(0).toUpperCase()+rm[1].slice(1);
    if(!responsable){const rm2=text.match(/(?:responsable|asignar a|asigna a)\s+(\w+)/i);if(rm2)responsable=rm2[1].charAt(0).toUpperCase()+rm2[1].slice(1)}
    // Description: the whole task description
    motivo=text.replace(/^.*?(?:recordatorio|tarea)\s+(?:para\s+)?(?:que\s+)?/i,'').trim();
    if(motivo.length<3)motivo=null;
  }
  if(action==='CREAR_PRESUPUESTO'){
    const tm2=text.match(/(?:tratamientos?|procedimientos?)\s*:?\s*(.+?)(?:\s+(?:por|de|con)\s+\$?\s*\d|\s*$)/i);
    if(tm2)item=tm2[1].trim();
  }

  // ── Validate ──
  let status='SUCCESS',message='OK';const errors=[];
  if(action==='AGENDAR_CITA'){if(!nombre)errors.push('el nombre del paciente');if(!fecha)errors.push('la fecha');if(!hora)errors.push('la hora');if(!motivo)errors.push('el motivo de la cita')}
  else if(action==='REGISTRAR_PAGO'){if(!nombre)errors.push('el nombre del paciente');if(!monto)errors.push('el monto');if(!motivo)errors.push('el concepto del pago')}
  else if(action==='CREAR_PACIENTE'){if(!nombre)errors.push('el nombre completo');if(!telefono)errors.push('el teléfono')}
  else if(action==='REGISTRAR_EVOLUCION_CLINICA'){if(!nombre)errors.push('el nombre del paciente');if(!diente_zona)errors.push('el diente o zona');if(!motivo&&!item)errors.push('la descripción del procedimiento')}
  else if(action==='CREAR_PRESUPUESTO'){if(!nombre)errors.push('el nombre del paciente');if(!item&&!motivo)errors.push('los tratamientos');if(!monto)errors.push('el monto total estimado')}
  else if(action==='ACTUALIZAR_INVENTARIO'){if(!item)errors.push('el nombre del insumo');if(!cantidad)errors.push('la cantidad')}
  else if(action==='REGISTRAR_GASTO'){if(!motivo)errors.push('el concepto del gasto');if(!monto)errors.push('el monto')}
  else if(action==='CREAR_TAREA_CRM'){if(!motivo)errors.push('la descripción de la tarea');if(!responsable)errors.push('el responsable');if(!fecha)errors.push('la fecha límite')}
  else{status='ERROR';message='No se reconoció ninguna acción. Intenta con: agendar cita, registrar pago, crear paciente, historia clínica, presupuesto, inventario, gasto o tarea.'}

  if(action!=='DESCONOCIDO'&&errors.length){status='ERROR';message=`Falta${errors.length>1?'n':''}: ${errors.join(', ')}.`}

  return{action_type:action,status,data:{nombre_paciente:nombre,fecha_hora:(fecha&&hora)?`${fecha} ${hora}`:fecha||null,monto,motivo_o_concepto:motivo,telefono,item_o_tratamiento:item,cantidad,diente_o_zona:diente_zona,responsable,correo:correo||null,metodo_pago:metodo},message};
}

/* NLP Execute */
function nlpExecute(r){
  if(r.status!=='SUCCESS')return;const d=r.data;
  if(r.action_type==='AGENDAR_CITA'){const[f,h]=d.fecha_hora.split(' ');DB.add('citas',{nombre_paciente:d.nombre_paciente,fecha:f,hora:h,motivo:d.motivo_o_concepto,estado:'pendiente'});addFeedItem({title:`Cita: ${d.nombre_paciente}`,sub:`${d.motivo_o_concepto} – ${d.fecha_hora}`,type:'cita'})}
  else if(r.action_type==='REGISTRAR_PAGO'){DB.add('pagos',{nombre_paciente:d.nombre_paciente,monto:d.monto,concepto:d.motivo_o_concepto,metodo:d.metodo_pago||'Sin definir',fecha:todayStr()});addFeedItem({title:`Pago ${fmtMoney(d.monto)} – ${d.nombre_paciente}`,sub:d.motivo_o_concepto,type:'pago'})}
  else if(r.action_type==='CREAR_PACIENTE'){DB.add('pacientes',{nombre:d.nombre_paciente,telefono:d.telefono,correo:d.correo||''});addFeedItem({title:`Nuevo paciente: ${d.nombre_paciente}`,sub:d.telefono,type:'paciente'})}
  else if(r.action_type==='REGISTRAR_EVOLUCION_CLINICA'){DB.add('historia',{nombre_paciente:d.nombre_paciente,diente_zona:d.diente_o_zona,tratamiento:d.item_o_tratamiento||d.motivo_o_concepto,descripcion:d.motivo_o_concepto,fecha:todayStr()});addFeedItem({title:`Evolución: ${d.nombre_paciente}`,sub:`${d.diente_o_zona} – ${d.item_o_tratamiento||d.motivo_o_concepto}`,type:'historia'})}
  else if(r.action_type==='CREAR_PRESUPUESTO'){DB.add('presupuestos',{nombre_paciente:d.nombre_paciente,tratamientos:d.item_o_tratamiento||d.motivo_o_concepto,monto:d.monto,estado:'pendiente',fecha:todayStr()});addFeedItem({title:`Presupuesto: ${d.nombre_paciente}`,sub:fmtMoney(d.monto),type:'presupuesto'})}
  else if(r.action_type==='ACTUALIZAR_INVENTARIO'){
    const tipo=(/sal|egres|us[oó]|gast/.test(d.motivo_o_concepto?.toLowerCase()||''))?'egreso':'ingreso';
    registrarMovimientoInventario(d.item_o_tratamiento,tipo,d.cantidad);
    addFeedItem({title:`Inventario: ${d.item_o_tratamiento}`,sub:`${tipo==='ingreso'?'+':'-'}${d.cantidad}`,type:'inventario'})}
  else if(r.action_type==='REGISTRAR_GASTO'){DB.add('gastos',{concepto:d.motivo_o_concepto,monto:d.monto,fecha:todayStr()});addFeedItem({title:`Gasto: ${d.motivo_o_concepto}`,sub:fmtMoney(d.monto),type:'gasto'})}
  else if(r.action_type==='CREAR_TAREA_CRM'){DB.add('tareas',{descripcion:d.motivo_o_concepto,responsable:d.responsable,fecha_limite:d.fecha_hora?.split(' ')[0]||todayStr(),estado:'pendiente'});addFeedItem({title:`Tarea: ${d.motivo_o_concepto?.slice(0,40)}`,sub:`Responsable: ${d.responsable}`,type:'tarea'})}
  showToast('Acción ejecutada correctamente','success');refreshDashboard();
}

/* NLP UI */
const HINTS={AGENDAR_CITA:'📅 Ej: "Agenda a Carlos mañana a las 4pm para limpieza"',REGISTRAR_PAGO:'💳 Ej: "Paco pagó 500 en efectivo por consulta"',CREAR_PACIENTE:'👤 Ej: "Registra paciente Ana García tel 555-123-4567"',REGISTRAR_EVOLUCION_CLINICA:'🦷 Ej: "Anota en la historia de Luis que le pusimos resina en el molar 36"',CREAR_PRESUPUESTO:'📄 Ej: "Presupuesto para María: limpieza + blanqueamiento por $3500"',ACTUALIZAR_INVENTARIO:'📦 Ej: "Llegaron 50 cajas de guantes de látex al almacén"',REGISTRAR_GASTO:'💸 Ej: "Gasto de renta del local por $15000"',CREAR_TAREA_CRM:'✅ Ej: "Recordatorio para que Ana envíe encuesta este viernes"'};
function setAction(t){document.getElementById('nlp-hint').textContent=HINTS[t]||'';document.getElementById('nlp-hint').classList.add('visible');document.getElementById('nlp-input')?.focus()}
function processNlpInput(){
  const inp=document.getElementById('nlp-input'),text=inp?.value?.trim();if(!text){inp?.focus();return}
  const result=nlpProcess(text);
  const re=document.getElementById('nlp-response'),bg=document.getElementById('response-badge'),ac=document.getElementById('response-action'),js=document.getElementById('response-json');
  bg.textContent=result.status;bg.className=`response-badge response-badge--${result.status.toLowerCase()}`;
  ac.textContent=result.action_type;js.textContent=JSON.stringify(result,null,2);
  re.removeAttribute('hidden');re.scrollIntoView({behavior:'smooth',block:'nearest'});
  if(result.status==='SUCCESS')nlpExecute(result);
  else addFeedItem({title:'Error NLP',sub:result.message,type:'error'});
}
function clearNlpInput(){document.getElementById('nlp-input').value='';document.getElementById('nlp-response')?.setAttribute('hidden','');document.getElementById('nlp-hint')?.classList.remove('visible');document.getElementById('nlp-input')?.focus()}

/* ─── 9. TOAST ─── */
function showToast(msg,type='info'){const c=document.getElementById('toast-container');if(!c)return;const t=document.createElement('div');t.className=`toast toast--${type}`;t.innerHTML=`<span>${{success:'✓',error:'✕',info:'ℹ'}[type]||'ℹ'}</span> ${escH(msg)}`;c.appendChild(t);setTimeout(()=>{t.style.animation='toastOut .25s ease forwards';setTimeout(()=>t.remove(),300)},3500)}

/* ─── 10. INIT ─── */
document.addEventListener('DOMContentLoaded', async () => {
  checkAuth();
  await DB.init(); // Cargar caché de SQLite
  
  document.getElementById('current-date').textContent=new Date().toLocaleDateString('es-MX',{weekday:'long',year:'numeric',month:'long',day:'numeric'});
  document.querySelectorAll('.nav-item').forEach(l=>l.addEventListener('click',e=>{e.preventDefault();navigateTo(l.dataset.section)}));
  document.getElementById('sidebar-toggle')?.addEventListener('click',()=>document.getElementById('sidebar')?.classList.toggle('open'));
  document.getElementById('modal-overlay')?.addEventListener('click',e=>{if(e.target.id==='modal-overlay')closeModal()});
  document.addEventListener('keydown',e=>{if(e.key==='Escape')closeModal()});
  document.getElementById('nlp-input')?.addEventListener('keydown',e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();processNlpInput()}});
  
  refreshDashboard();
  // Al arrancar, si hay una vista activa diferente a dashboard se debe renderizar también
  const activeSection = document.querySelector('.nav-item--active')?.dataset?.section;
  if(activeSection && activeSection !== 'dashboard') navigateTo(activeSection);
});


function addPItem(concepto = '', costo = '', fase = 'Fase 1: Higiene/Prevención') {
    const container = document.getElementById('p-items-container');
    if (!container) return;
    const div = document.createElement('div');
    div.className = 'p-row';
    div.innerHTML = `
        <select class="form-input p-item-fase" style="width: 150px;">
          <option ${fase === 'Fase 1: Higiene/Prevención' ? 'selected' : ''}>Fase 1: Higiene/Prevención</option>
          <option ${fase === 'Fase 2: Cirugía/Endodoncia' ? 'selected' : ''}>Fase 2: Cirugía/Endodoncia</option>
          <option ${fase === 'Fase 3: Rehabilitación' ? 'selected' : ''}>Fase 3: Rehabilitación</option>
        </select>
        <input type="text" class="form-input p-item-concepto" placeholder="Concepto / Tratamiento" value="${escH(concepto)}" style="flex: 1;">
        <input type="number" class="form-input p-item-costo" placeholder="Costo $" min="0" value="${costo}" oninput="calcPTotal()" style="width: 100px;">
        <button type="button" class="btn-remove-row" onclick="deletePItem(this)" title="Borrar">✕</button>
    `;
    container.appendChild(div);
    calcPTotal();
}
function deletePItem(btn) {
    btn.parentElement.remove();
    calcPTotal();
}
function calcPTotal() {
    const costos = Array.from(document.querySelectorAll('.p-item-costo')).map(el => parseFloat(el.value) || 0);
    const total = costos.reduce((a,b) => a + b, 0);
    const fMonto = document.getElementById('f-monto');
    if (fMonto) fMonto.value = total;
}
function imprimirPresupuesto(id) {
  let p = DB.find('presupuestos', id);
  let pacienteNombre = p ? p.nombre_paciente : currentPacienteOdonto;
  
  if (!p && !pacienteNombre) {
    showToast('No se encontró el presupuesto especificado', 'error');
    return;
  }
  
  const paciente = DB.get('pacientes').find(pac => pac.nombre === pacienteNombre);
  const detalles = DB.get('tratamientos_detalles').filter(d => d.nombre_paciente === pacienteNombre);
  
  const dDate = document.getElementById('print-p-fecha');
  if (dDate) dDate.textContent = prettyDate(p?.fecha || todayStr());
  
  const dFolio = document.getElementById('print-p-folio');
  if (dFolio) dFolio.textContent = `FOLIO: PRES-${p?.id ? String(p.id).slice(-6).toUpperCase() : Math.floor(Math.random() * 89999 + 10000)}`;

  const dPac = document.getElementById('print-p-paciente');
  if (dPac) dPac.textContent = pacienteNombre;

  const dTel = document.getElementById('print-p-telefono');
  if (dTel) dTel.textContent = paciente?.telefono || 'No registrado';

  const dFirma = document.getElementById('print-p-firma-paciente');
  if (dFirma) dFirma.textContent = pacienteNombre;

  const tbody = document.getElementById('print-p-tbody');
  let subtotal = 0;
  let totalAbonado = 0;

  if (detalles.length > 0) {
    // Desglose detallado por diente/prestación desde el odontograma
    tbody.innerHTML = detalles.map(d => {
      const precio = Number(d.precio) || 0;
      const pagado = Number(d.pagado) || 0;
      const saldo = Math.max(0, precio - pagado);
      subtotal += precio;
      totalAbonado += pagado;

      const piezaLabel = d.diente ? `#${d.diente}` : 'General';
      const caraLabel = d.cara || 'Integral';
      return `
        <tr>
          <td style="padding: 10px; border-bottom: 1px solid #e5e7eb; font-weight:700; color:#4A6B5D;">${escH(piezaLabel)}</td>
          <td style="padding: 10px; border-bottom: 1px solid #e5e7eb; color: #4b5563;">${escH(caraLabel)}</td>
          <td style="padding: 10px; border-bottom: 1px solid #e5e7eb;"><strong>${escH(d.nombre_prestacion)}</strong></td>
          <td style="padding: 10px; border-bottom: 1px solid #e5e7eb; text-align: right;">${fmtMoney(precio)}</td>
          <td style="padding: 10px; border-bottom: 1px solid #e5e7eb; text-align: right; color:#059669;">${fmtMoney(pagado)}</td>
          <td style="padding: 10px; border-bottom: 1px solid #e5e7eb; text-align: right; font-weight:700; color:#b91c1c;">${fmtMoney(saldo)}</td>
        </tr>
      `;
    }).join('');
  } else if (p) {
    // Si es un presupuesto creado manualmente
    let items = [];
    try {
      items = JSON.parse(p.tratamientos);
      if (!Array.isArray(items)) throw new Error('Not array');
    } catch(e) {
      items = [{ concepto: p.tratamientos, costo: p.monto }];
    }
    subtotal = p.monto || 0;
    tbody.innerHTML = items.map(i => `
      <tr>
        <td style="padding: 10px; border-bottom: 1px solid #e5e7eb; font-weight:700; color:#4A6B5D;">General</td>
        <td style="padding: 10px; border-bottom: 1px solid #e5e7eb; color: #4b5563;">Clínica</td>
        <td style="padding: 10px; border-bottom: 1px solid #e5e7eb;"><strong>${escH(i.concepto)}</strong></td>
        <td style="padding: 10px; border-bottom: 1px solid #e5e7eb; text-align: right;">${fmtMoney(i.costo)}</td>
        <td style="padding: 10px; border-bottom: 1px solid #e5e7eb; text-align: right; color:#059669;">$0.00</td>
        <td style="padding: 10px; border-bottom: 1px solid #e5e7eb; text-align: right; font-weight:700; color:#b91c1c;">${fmtMoney(i.costo)}</td>
      </tr>
    `).join('');
  }

  const saldoPendiente = Math.max(0, subtotal - totalAbonado);
  const elSub = document.getElementById('print-p-subtotal');
  if (elSub) elSub.textContent = fmtMoney(subtotal);
  const elAbo = document.getElementById('print-p-abonado');
  if (elAbo) elAbo.textContent = fmtMoney(totalAbonado);
  const elTot = document.getElementById('print-p-total');
  if (elTot) elTot.textContent = fmtMoney(saldoPendiente);

  document.body.classList.add('printing-presupuesto');
  window.print();
  setTimeout(() => {
    document.body.classList.remove('printing-presupuesto');
  }, 1000);
}

function imprimirPresupuestoDesdeOdonto() {
  if (!currentPacienteOdonto) {
    showToast('Seleccione primero un paciente en el odontograma', 'warning');
    return;
  }
  const detalles = DB.get('tratamientos_detalles').filter(d => d.nombre_paciente === currentPacienteOdonto);
  if (detalles.length === 0) {
    showToast('El paciente no tiene tratamientos agregados en el odontograma aún', 'warning');
    return;
  }
  imprimirPresupuesto(null);
}

function enviarPresupuestoWhatsApp(id) {
  const p = DB.get('presupuestos').find(x => String(x.id) === String(id));
  if (!p) return showToast('Presupuesto no encontrado', 'error');
  
  const pac = DB.get('pacientes').find(pac => pac.nombre === p.nombre_paciente);
  let telefono = pac?.telefono || '';
  if (!telefono) {
    const inputTel = prompt(`El paciente ${p.nombre_paciente} no tiene teléfono registrado. Ingrésalo a continuación (10 dígitos):`);
    if (!inputTel) return;
    telefono = inputTel;
  }
  telefono = telefono.replace(/\D/g, '');
  if (telefono.length === 10) telefono = '52' + telefono;

  let conceptos = '';
  try {
    const parsed = JSON.parse(p.tratamientos);
    if (Array.isArray(parsed)) {
      conceptos = parsed.map(i => `• ${i.concepto}: ${fmtMoney(i.costo)}`).join('\n');
    } else {
      conceptos = `• ${p.tratamientos}: ${fmtMoney(p.monto)}`;
    }
  } catch(e) {
    conceptos = `• ${p.tratamientos}: ${fmtMoney(p.monto)}`;
  }

  const folio = `PRES-${String(p.id).slice(-6).toUpperCase()}`;
  const msg = `Hola ${p.nombre_paciente}, le saluda la Dra. Rosa Ávila de Clínica Dental Nube (Distrito Domo).\n\nLe comparto el resumen de su Presupuesto Dental (${folio}):\n\n${conceptos}\n\n💰 Total del Plan: ${fmtMoney(p.monto)}\n📅 Vigencia: 30 días naturales.\n💳 Formas de pago: Efectivo, Tarjeta y Transferencia SPEI.\n\n📍 Ubicación: Distrito Domo, Av. Manuel Ordoñez 725, El Lechugal, Santa Catarina, N.L.\n📞 Citas / WhatsApp: 81 1221 9911\n\n¿Le gustaría que agendemos su primera cita para comenzar?`;
  window.open(`https://wa.me/${telefono}?text=${encodeURIComponent(msg)}`, '_blank');
}

function imprimirTicketPago(id) {
    const p = DB.get('pagos').find(x => String(x.id) === String(id));
    if (!p) {
        console.error("Pago no encontrado con id:", id);
        return;
    }
    
    const dDate = document.getElementById('print-pago-fecha');
    if (dDate) dDate.textContent = prettyDate(p.fecha);
    
    const dFolio = document.getElementById('print-pago-id');
    if (dFolio) {
        if (p.rowid) {
            dFolio.textContent = String(p.rowid).padStart(4, '0');
        } else {
            dFolio.textContent = String(p.id).slice(-6).toUpperCase();
        }
    }

    const dPac = document.getElementById('print-pago-paciente');
    if (dPac) dPac.textContent = p.nombre_paciente;

    const dConc = document.getElementById('print-pago-concepto');
    if (dConc) dConc.textContent = p.concepto || 'Pago de tratamiento';

    const dMet = document.getElementById('print-pago-metodo');
    if (dMet) dMet.textContent = p.metodo || 'Efectivo';

    const dMonto = document.getElementById('print-pago-monto');
    if (dMonto) dMonto.textContent = fmtMoney(p.monto);
    
    document.body.classList.add('printing-pago');
    window.print();
    setTimeout(() => {
        document.body.classList.remove('printing-pago');
    }, 500);
}

// --- Sincronización con Google Calendar (Dra. Rosa Ávila) ---
async function syncGoogleCalendar() {
    const btn = document.getElementById('btn-sync-google');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16" style="margin-right:6px;"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.3"/></svg>Sincronizando...`;
    }
    showToast('Consultando agenda de Google Calendar (dra.avilaodontologia@gmail.com)...', 'info');

    try {
        const res = await fetch('/api/calendar/sync', {
            method: 'POST',
            headers: DB.getHeaders()
        });
        const data = await res.json();

        if (data.success) {
            showToast(`✅ Sincronización exitosa: ${data.importados} citas importadas (${data.totalGoogle} eventos en Google)`, 'success');
            await DB.reload(['citas', 'pacientes']);
            renderCitas();
            if (typeof renderSalaEspera === 'function') renderSalaEspera();
        } else {
            showToast(`Aviso: ${data.reason || 'Verifica la variable GOOGLE_CREDENTIALS en Vercel'}`, 'warning');
        }
    } catch (err) {
        console.error('Error al sincronizar Google Calendar:', err);
        showToast('Error al conectar con el servicio de calendario', 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16" style="margin-right:6px;"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.3"/></svg>Sync Google Calendar`;
        }
    }
}
