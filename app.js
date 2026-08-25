/* ════════════════════════════════════════
   DentAdmin – app.js  (v2 – 8 acciones NLP)
   Persistencia: localStorage
════════════════════════════════════════ */
'use strict';

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
    if(res.status === 401 || res.status === 403) {
       logout();
       throw new Error('No autorizado');
    }
    return res;
  },

  // Inicialización (carga todo del servidor a la caché local)
  async init() {
    if (!localStorage.getItem('token')) return; // No init si no hay login
    try {
      const collections = ['pacientes', 'citas', 'pagos', 'historia', 'presupuestos', 'gastos', 'inventario', 'tareas'];
      for (const col of collections) {
        const res = await fetch(`/api/${col}`, { headers: this.getHeaders() }).then(r => this.handleError(r));
        this.cache[col] = await res.json();
      }
      // Revisar si necesitamos sembrar datos
      if (this.cache.pacientes.length === 0) {
        await fetch('/api/seed', { method: 'POST', headers: this.getHeaders() });
        // Recargar caché después de sembrar
        for (const col of collections) {
            const res = await fetch(`/api/${col}`, { headers: this.getHeaders() });
            this.cache[col] = await res.json();
        }
      }
    } catch (e) {
      console.error('Error conectando al backend:', e);
      if(e.message !== 'No autorizado') showToast('Error conectando al servidor', 'error');
    }
  },
  
  get(n) { 
      return this.cache[n] || []; 
  },
  
  add(n, item) {
    // 1. Lo mandamos al backend
    fetch(`/api/${n}`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(item)
    }).then(r => this.handleError(r)).then(res => res.json()).then(savedItem => {
        // 2. Actualizamos la caché con el ID real
        const l = this.get(n);
        l.push(savedItem);
        this.cache[n] = l;
    }).catch(()=>{});
    return item;
  },
  
  update(n, id, p) {
    fetch(`/api/${n}/${id}`, {
        method: 'PUT',
        headers: this.getHeaders(),
        body: JSON.stringify(p)
    }).then(r => this.handleError(r)).catch(()=>{});
    const l = this.get(n);
    const i = l.findIndex(x => x.id === id);
    if (i !== -1) Object.assign(l[i], p);
  },
  
  remove(n, id) {
    fetch(`/api/${n}/${id}`, { method: 'DELETE', headers: this.getHeaders() })
      .then(r => this.handleError(r)).catch(()=>{});
    this.cache[n] = this.get(n).filter(x => x.id !== id);
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
  } else {
    loginScreen.style.display = 'flex';
    mainLayout.style.display = 'none';
    sidebar.style.display = 'none';
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
function escH(s){return String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}
function fmtMoney(n){return'$ '+Number(n||0).toLocaleString('es-MX',{minimumFractionDigits:0,maximumFractionDigits:0})}
function prettyDate(d){if(!d)return'-';return new Date(d+'T00:00:00').toLocaleDateString('es-MX',{year:'numeric',month:'short',day:'numeric'})}

/* ─── 3. NAVEGACIÓN ─── */
const SECTIONS=['dashboard','citas','pacientes','historia','presupuestos','pagos','gastos','inventario','tareas','reportes'];
const TITLES={dashboard:'Dashboard',citas:'Citas',pacientes:'Pacientes',historia:'Historia Clínica',presupuestos:'Presupuestos',pagos:'Pagos',gastos:'Gastos',inventario:'Inventario',tareas:'Tareas / CRM',reportes:'Reportes'};
const tableFilters={citas:'all',presupuestos:'all',tareas:'all'};

function navigateTo(s){
  if(!SECTIONS.includes(s))return;
  SECTIONS.forEach(x=>{const el=document.getElementById('section-'+x);if(el)el.classList.toggle('section--active',x===s)});
  document.querySelectorAll('.nav-item').forEach(l=>l.classList.toggle('nav-item--active',l.dataset.section===s));
  document.getElementById('topbar-title').textContent=TITLES[s]||s;
  const renders={dashboard:refreshDashboard,citas:renderCitas,pacientes:renderPacientes,historia:renderHistoria,presupuestos:renderPresupuestos,pagos:renderPagos,gastos:renderGastos,inventario:renderInventario,tareas:renderTareas,reportes:renderReportes};
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
const checkIcon='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>';

function renderCitas(){
  let data=DB.get('citas');const q=(document.getElementById('search-citas')?.value||'').toLowerCase();
  if(q)data=data.filter(c=>c.nombre_paciente.toLowerCase().includes(q)||(c.motivo||'').toLowerCase().includes(q));
  if(tableFilters.citas!=='all')data=data.filter(c=>c.estado===tableFilters.citas);
  data.sort((a,b)=>(b.fecha+b.hora).localeCompare(a.fecha+a.hora));
  const tb=document.getElementById('citas-tbody'),em=document.getElementById('citas-empty');
  if(!data.length){tb.innerHTML='';em.hidden=false;return}em.hidden=true;
  tb.innerHTML=data.map(c=>`<tr><td><strong>${escH(c.nombre_paciente)}</strong></td><td>${prettyDate(c.fecha)}</td><td>${escH(c.hora)}</td><td>${escH(c.motivo)}</td><td><span class="tag tag--${c.estado}">${c.estado}</span></td><td><div class="td-actions">${c.estado==='pendiente'?`<button class="btn-icon btn-icon--green" title="Completar" onclick="quickUpdate('citas','${c.id}',{estado:'completada'})">${checkIcon}</button>`:''}<button class="btn-icon" title="Editar" onclick="openModal('cita',DB.find('citas','${c.id}'))">${editIcon}</button><button class="btn-icon btn-icon--danger" title="Eliminar" onclick="quickDelete('citas','${c.id}')">${delIcon}</button></div></td></tr>`).join('');
}

function renderPacientes(){
  let data=DB.get('pacientes');const q=(document.getElementById('search-pacientes')?.value||'').toLowerCase();
  if(q)data=data.filter(p=>p.nombre.toLowerCase().includes(q)||(p.correo||'').toLowerCase().includes(q));
  data.sort((a,b)=>a.nombre.localeCompare(b.nombre));
  const tb=document.getElementById('pacientes-tbody'),em=document.getElementById('pacientes-empty');
  if(!data.length){tb.innerHTML='';em.hidden=false;return}em.hidden=true;
  tb.innerHTML=data.map(p=>`<tr><td><strong>${escH(p.nombre)}</strong></td><td>${escH(p.telefono||'-')}</td><td>${escH(p.correo||'-')}</td><td>${prettyDate(p.createdAt?.slice(0,10))}</td><td><div class="td-actions"><button class="btn-icon" title="Editar" onclick="openModal('paciente',DB.find('pacientes','${p.id}'))">${editIcon}</button><button class="btn-icon btn-icon--danger" title="Eliminar" onclick="quickDelete('pacientes','${p.id}')">${delIcon}</button></div></td></tr>`).join('');
}

function renderHistoria(){
  let data=DB.get('historia');const q=(document.getElementById('search-historia')?.value||'').toLowerCase();
  if(q)data=data.filter(e=>e.nombre_paciente.toLowerCase().includes(q)||(e.tratamiento||'').toLowerCase().includes(q));
  data.sort((a,b)=>(b.fecha||'').localeCompare(a.fecha||''));
  const tb=document.getElementById('historia-tbody'),em=document.getElementById('historia-empty');
  if(!data.length){tb.innerHTML='';em.hidden=false;return}em.hidden=true;
  tb.innerHTML=data.map(e=>`<tr><td><strong>${escH(e.nombre_paciente)}</strong></td><td>${prettyDate(e.fecha)}</td><td>${escH(e.diente_zona||'-')}</td><td>${escH(e.tratamiento)}</td><td>${escH(e.descripcion||'-')}</td><td><div class="td-actions"><button class="btn-icon btn-icon--danger" title="Eliminar" onclick="quickDelete('historia','${e.id}')">${delIcon}</button></div></td></tr>`).join('');
}

function renderPresupuestos(){
  let data=DB.get('presupuestos');const q=(document.getElementById('search-presupuestos')?.value||'').toLowerCase();
  if(q)data=data.filter(p=>p.nombre_paciente.toLowerCase().includes(q));
  if(tableFilters.presupuestos!=='all')data=data.filter(p=>p.estado===tableFilters.presupuestos);
  data.sort((a,b)=>(b.fecha||'').localeCompare(a.fecha||''));
  const tb=document.getElementById('presupuestos-tbody'),em=document.getElementById('presupuestos-empty');
  if(!data.length){tb.innerHTML='';em.hidden=false;return}em.hidden=true;
  tb.innerHTML=data.map(p=>`<tr><td><strong>${escH(p.nombre_paciente)}</strong></td><td>${escH(p.tratamientos)}</td><td style="font-weight:700">${fmtMoney(p.monto)}</td><td><span class="tag tag--${p.estado}">${p.estado}</span></td><td>${prettyDate(p.fecha)}</td><td><div class="td-actions">${p.estado==='pendiente'?`<button class="btn-icon btn-icon--green" title="Aprobar" onclick="quickUpdate('presupuestos','${p.id}',{estado:'aprobado'})">${checkIcon}</button>`:''}
  <button class="btn-icon btn-icon--danger" title="Eliminar" onclick="quickDelete('presupuestos','${p.id}')">${delIcon}</button></div></td></tr>`).join('');
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
  tb.innerHTML=data.map(p=>`<tr><td><strong>${escH(p.nombre_paciente)}</strong></td><td style="color:var(--green);font-weight:700">${fmtMoney(p.monto)}</td><td>${escH(p.concepto||'-')}</td><td>${escH(p.metodo||'-')}</td><td>${prettyDate(p.fecha)}</td><td><div class="td-actions"><button class="btn-icon btn-icon--danger" title="Eliminar" onclick="quickDelete('pagos','${p.id}')">${delIcon}</button></div></td></tr>`).join('');
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
  tb.innerHTML=data.map(g=>`<tr><td><strong>${escH(g.concepto)}</strong></td><td style="color:var(--red);font-weight:700">${fmtMoney(g.monto)}</td><td>${prettyDate(g.fecha)}</td><td><div class="td-actions"><button class="btn-icon btn-icon--danger" title="Eliminar" onclick="quickDelete('gastos','${g.id}')">${delIcon}</button></div></td></tr>`).join('');
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

/* Quick actions */
function quickUpdate(col,id,patch){DB.update(col,id,patch);const renders={citas:renderCitas,presupuestos:renderPresupuestos,tareas:renderTareas};renders[col]?.();refreshDashboard();showToast('Actualizado','success')}
function quickDelete(col,id){if(!confirm('¿Eliminar este registro?'))return;DB.remove(col,id);const renders={citas:renderCitas,pacientes:renderPacientes,historia:renderHistoria,presupuestos:renderPresupuestos,pagos:renderPagos,gastos:renderGastos,inventario:renderInventario,tareas:renderTareas};renders[col]?.();refreshDashboard();showToast('Eliminado','info')}

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

  // Balance
  const balance=totalIngresos-totalGastos;
  const byMethod={};fp.forEach(p=>{byMethod[p.metodo||'Sin definir']=(byMethod[p.metodo||'Sin definir']||0)+(p.monto||0)});
  document.getElementById('rpt-balance').innerHTML=`
    <div class="income-big ${balance>=0?'income-big--green':'income-big--red'}">${fmtMoney(balance)}</div>
    <p class="income-label">Balance (Ingresos − Gastos)</p>
    ${Object.entries(byMethod).map(([m,v])=>`<div class="income-method"><span class="income-method__name">${escH(m)}</span><span class="income-method__val">${fmtMoney(v)}</span></div>`).join('')||'<p style="color:var(--gray-400);font-size:12px">Sin pagos</p>'}`;

  // Bar chart
  const byMot={};fc.forEach(c=>{byMot[c.motivo||'Otro']=(byMot[c.motivo||'Otro']||0)+1});
  const sorted=Object.entries(byMot).sort((a,b)=>b[1]-a[1]).slice(0,6);
  const mx=sorted.length?sorted[0][1]:1;
  document.getElementById('rpt-motivos').innerHTML=sorted.map(([l,v])=>`<div class="bar-row"><span class="bar-label">${escH(l)}</span><div class="bar-track"><div class="bar-fill" style="width:${(v/mx*100).toFixed(0)}%"></div><span class="bar-value">${v}</span></div></div>`).join('')||'<p style="color:var(--gray-400);font-size:12px">Sin datos</p>';

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

  if(type==='cita'){
    title.textContent=isE?'Editar Cita':'Nueva Cita';sub.textContent=isE?'Actualizar':'Agendar';
    body.innerHTML=`<div class="form-group"><label class="form-label">Paciente</label><select class="form-input form-select" id="f-pac"><option value="">Seleccionar...</option>${pacOpts()}</select></div><div class="form-row"><div class="form-group"><label class="form-label">Fecha</label><input class="form-input" type="date" id="f-fecha" value="${editData?.fecha||todayStr()}"></div><div class="form-group"><label class="form-label">Hora</label><input class="form-input" type="time" id="f-hora" value="${editData?.hora||'09:00'}"></div></div><div class="form-group"><label class="form-label">Motivo</label><select class="form-input form-select" id="f-motivo"><option value="">Seleccionar...</option>${motivoOpts()}</select></div>${isE?`<div class="form-group"><label class="form-label">Estado</label><select class="form-input form-select" id="f-estado">${['pendiente','completada','cancelada'].map(s=>`<option ${editData?.estado===s?'selected':''}>${s}</option>`).join('')}</select></div>`:''}`;
  }else if(type==='paciente'){
    title.textContent=isE?'Editar Paciente':'Nuevo Paciente';sub.textContent=isE?'Actualizar':'Registrar';
    body.innerHTML=`<div class="form-group"><label class="form-label">Nombre completo</label><input class="form-input" id="f-nombre" placeholder="Juan Pérez" value="${escH(editData?.nombre||'')}"></div><div class="form-row"><div class="form-group"><label class="form-label">Teléfono</label><input class="form-input" id="f-tel" placeholder="555-123-4567" value="${escH(editData?.telefono||'')}"></div><div class="form-group"><label class="form-label">Correo</label><input class="form-input" type="email" id="f-correo" placeholder="correo@mail.com" value="${escH(editData?.correo||'')}"></div></div>`;
  }else if(type==='pago'){
    title.textContent='Registrar Pago';sub.textContent='Registrar';
    body.innerHTML=`<div class="form-group"><label class="form-label">Paciente</label><select class="form-input form-select" id="f-pac"><option value="">Seleccionar...</option>${pacOpts()}</select></div><div class="form-row"><div class="form-group"><label class="form-label">Monto ($)</label><input class="form-input" type="number" id="f-monto" placeholder="0" min="0"></div><div class="form-group"><label class="form-label">Método</label><select class="form-input form-select" id="f-metodo"><option>Efectivo</option><option>Tarjeta</option><option>Transferencia</option></select></div></div><div class="form-group"><label class="form-label">Concepto</label><select class="form-input form-select" id="f-concepto"><option value="">Seleccionar...</option>${motivoOpts()}</select></div>`;
  }else if(type==='historia'){
    title.textContent='Registrar Evolución Clínica';sub.textContent='Guardar';
    body.innerHTML=`<div class="form-group"><label class="form-label">Paciente</label><select class="form-input form-select" id="f-pac"><option value="">Seleccionar...</option>${pacOpts()}</select></div><div class="form-row"><div class="form-group"><label class="form-label">Diente / Zona</label><input class="form-input" id="f-diente" placeholder="Ej: Molar 36, Arcada sup."></div><div class="form-group"><label class="form-label">Tratamiento</label><input class="form-input" id="f-tratamiento" placeholder="Ej: Resina, Brackets"></div></div><div class="form-group"><label class="form-label">Descripción del procedimiento</label><textarea class="form-input form-textarea" id="f-desc" placeholder="Detalles del procedimiento realizado..."></textarea></div>`;
  }else if(type==='presupuesto'){
    title.textContent='Nuevo Presupuesto';sub.textContent='Crear';
    body.innerHTML=`<div class="form-group"><label class="form-label">Paciente</label><select class="form-input form-select" id="f-pac"><option value="">Seleccionar...</option>${pacOpts()}</select></div><div class="form-group"><label class="form-label">Tratamientos</label><textarea class="form-input form-textarea" id="f-tratamientos" placeholder="Ej: Limpieza + Blanqueamiento + Corona diente 14"></textarea></div><div class="form-group"><label class="form-label">Monto total estimado ($)</label><input class="form-input" type="number" id="f-monto" placeholder="0" min="0"></div>`;
  }else if(type==='gasto'){
    title.textContent='Registrar Gasto';sub.textContent='Registrar';
    body.innerHTML=`<div class="form-group"><label class="form-label">Concepto</label><input class="form-input" id="f-concepto" placeholder="Ej: Renta, Material, Luz"></div><div class="form-group"><label class="form-label">Monto ($)</label><input class="form-input" type="number" id="f-monto" placeholder="0" min="0"></div>`;
  }else if(type==='inventario'){
    title.textContent='Movimiento de Inventario';sub.textContent='Registrar';
    body.innerHTML=`<div class="form-group"><label class="form-label">Nombre del insumo</label><input class="form-input" id="f-insumo" placeholder="Ej: Guantes de látex"></div><div class="form-row"><div class="form-group"><label class="form-label">Cantidad</label><input class="form-input" type="number" id="f-qty" placeholder="0" min="1"></div><div class="form-group"><label class="form-label">Tipo de movimiento</label><select class="form-input form-select" id="f-tipo"><option value="ingreso">Ingreso</option><option value="egreso">Egreso</option></select></div></div>`;
  }else if(type==='tarea'){
    title.textContent='Nueva Tarea / CRM';sub.textContent='Crear';
    body.innerHTML=`<div class="form-group"><label class="form-label">Descripción de la tarea</label><textarea class="form-input form-textarea" id="f-desc" placeholder="Ej: Llamar para confirmar cita"></textarea></div><div class="form-row"><div class="form-group"><label class="form-label">Responsable</label><input class="form-input" id="f-responsable" placeholder="Nombre"></div><div class="form-group"><label class="form-label">Fecha límite</label><input class="form-input" type="date" id="f-fecha" value="${todayStr()}"></div></div>`;
  }
  ov.removeAttribute('hidden');setTimeout(()=>body.querySelector('input,select,textarea')?.focus(),80);
}
function closeModal(){document.getElementById('modal-overlay')?.setAttribute('hidden','');modalType=null;modalEditId=null}
function submitModal(){
  const v=id=>{const el=document.getElementById(id);return el?el.value.trim():''};
  const req=(fields,labels)=>{const missing=fields.map((f,i)=>v(f)?null:labels[i]).filter(Boolean);if(missing.length){showToast('Falta: '+missing.join(', '),'error');return false}return true};

  if(modalType==='cita'){
    if(!req(['f-pac','f-fecha','f-hora','f-motivo'],['Paciente','Fecha','Hora','Motivo']))return;
    if(modalEditId)DB.update('citas',modalEditId,{nombre_paciente:v('f-pac'),fecha:v('f-fecha'),hora:v('f-hora'),motivo:v('f-motivo'),estado:v('f-estado')||'pendiente'});
    else DB.add('citas',{nombre_paciente:v('f-pac'),fecha:v('f-fecha'),hora:v('f-hora'),motivo:v('f-motivo'),estado:'pendiente'});
    addFeedItem({title:`${modalEditId?'Cita actualizada':'Nueva cita'}: ${v('f-pac')}`,sub:`${v('f-motivo')} – ${v('f-fecha')} ${v('f-hora')}`,type:'cita'});
  }else if(modalType==='paciente'){
    if(!req(['f-nombre'],['Nombre']))return;
    if(modalEditId)DB.update('pacientes',modalEditId,{nombre:v('f-nombre'),telefono:v('f-tel'),correo:v('f-correo')});
    else DB.add('pacientes',{nombre:v('f-nombre'),telefono:v('f-tel'),correo:v('f-correo')});
    addFeedItem({title:`${modalEditId?'Paciente actualizado':'Nuevo paciente'}: ${v('f-nombre')}`,sub:v('f-tel')||v('f-correo'),type:'paciente'});
  }else if(modalType==='pago'){
    if(!req(['f-pac','f-monto','f-concepto'],['Paciente','Monto','Concepto']))return;
    DB.add('pagos',{nombre_paciente:v('f-pac'),monto:parseFloat(v('f-monto')),concepto:v('f-concepto'),metodo:v('f-metodo'),fecha:todayStr()});
    addFeedItem({title:`Pago ${fmtMoney(v('f-monto'))} – ${v('f-pac')}`,sub:v('f-concepto'),type:'pago'});
  }else if(modalType==='historia'){
    if(!req(['f-pac','f-diente','f-tratamiento'],['Paciente','Diente/Zona','Tratamiento']))return;
    DB.add('historia',{nombre_paciente:v('f-pac'),diente_zona:v('f-diente'),tratamiento:v('f-tratamiento'),descripcion:v('f-desc'),fecha:todayStr()});
    addFeedItem({title:`Evolución: ${v('f-pac')}`,sub:`${v('f-diente')} – ${v('f-tratamiento')}`,type:'historia'});
  }else if(modalType==='presupuesto'){
    if(!req(['f-pac','f-tratamientos','f-monto'],['Paciente','Tratamientos','Monto']))return;
    DB.add('presupuestos',{nombre_paciente:v('f-pac'),tratamientos:v('f-tratamientos'),monto:parseFloat(v('f-monto')),estado:'pendiente',fecha:todayStr()});
    addFeedItem({title:`Presupuesto: ${v('f-pac')}`,sub:`${fmtMoney(v('f-monto'))} – ${v('f-tratamientos')}`,type:'presupuesto'});
  }else if(modalType==='gasto'){
    if(!req(['f-concepto','f-monto'],['Concepto','Monto']))return;
    DB.add('gastos',{concepto:v('f-concepto'),monto:parseFloat(v('f-monto')),fecha:todayStr()});
    addFeedItem({title:`Gasto: ${v('f-concepto')}`,sub:fmtMoney(v('f-monto')),type:'gasto'});
  }else if(modalType==='inventario'){
    if(!req(['f-insumo','f-qty'],['Insumo','Cantidad']))return;
    const insumo=v('f-insumo'),qty=parseInt(v('f-qty')),tipo=v('f-tipo');
    const existing=DB.get('inventario').find(i=>i.insumo.toLowerCase()===insumo.toLowerCase());
    if(existing){const newStock=tipo==='ingreso'?existing.stock+qty:Math.max(0,existing.stock-qty);DB.update('inventario',existing.id,{stock:newStock,ultimo_tipo:tipo,ultimo_qty:qty,fecha:todayStr()})}
    else DB.add('inventario',{insumo,stock:tipo==='ingreso'?qty:0,ultimo_tipo:tipo,ultimo_qty:qty,fecha:todayStr()});
    addFeedItem({title:`Inventario: ${insumo}`,sub:`${tipo==='ingreso'?'+':'-'}${qty} unidades`,type:'inventario'});
  }else if(modalType==='tarea'){
    if(!req(['f-desc','f-responsable','f-fecha'],['Descripción','Responsable','Fecha']))return;
    DB.add('tareas',{descripcion:v('f-desc'),responsable:v('f-responsable'),fecha_limite:v('f-fecha'),estado:'pendiente'});
    addFeedItem({title:`Tarea: ${v('f-desc').slice(0,40)}`,sub:`Responsable: ${v('f-responsable')}`,type:'tarea'});
  }
  showToast('Guardado correctamente','success');closeModal();
  // Refresh all relevant views
  [renderCitas,renderPacientes,renderHistoria,renderPresupuestos,renderPagos,renderGastos,renderInventario,renderTareas,refreshDashboard].forEach(fn=>fn());
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
    const existing=DB.get('inventario').find(i=>i.insumo.toLowerCase()===d.item_o_tratamiento?.toLowerCase());
    if(existing){const ns=tipo==='ingreso'?existing.stock+d.cantidad:Math.max(0,existing.stock-d.cantidad);DB.update('inventario',existing.id,{stock:ns,ultimo_tipo:tipo,ultimo_qty:d.cantidad,fecha:todayStr()})}
    else DB.add('inventario',{insumo:d.item_o_tratamiento,stock:tipo==='ingreso'?d.cantidad:0,ultimo_tipo:tipo,ultimo_qty:d.cantidad,fecha:todayStr()});
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
