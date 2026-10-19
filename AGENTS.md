# MEMORIA A LARGO PLAZO: DENTAADMIN NUBE (CAREDENT CLOUD)
> **Ubicación:** `c:\Users\RO106536\Documents\Perso\Proy_Gemini\DentaAdmin_Nube`  
> **Estado Operativo:** 🟡 Versión Web / SaaS en Desarrollo y Pruebas  
> **Descripción:** Adaptación basada en navegador de CareDent con autenticación remota y acceso multi-usuario.

---

## 📌 1. PROPÓSITO DEL PROYECTO
Proveer una solución web en la nube para que clínicas y consultorios puedan acceder a expedientes de pacientes, odontograma y agenda desde cualquier dispositivo (tablet, laptop o móvil) con control de acceso por roles.

---

## 🏗️ 2. ARQUITECTURA TÉCNICA
* **Backend:** Node.js + Express 5 (`server.js`).
* **Seguridad & Autenticación:** `bcrypt` para encriptación de contraseñas y `jsonwebtoken` (JWT) para sesiones sin estado.
* **Base de Datos:** SQLite 3 (`dentadmin.sqlite`) con abstracción en `database.js`.
* **Frontend:** Single-page web interface (`index.html`, `style.css`, `app.js`).
* **Variables de Entorno:** `.env` (almacena `JWT_SECRET`, puerto y credenciales de acceso).

---

## 🔑 3. ROLES Y MATRIZ DE PERMISOS
* **Administrador (`administrador`):**
  - **Alcance:** Control total sin restricciones.
  - **Módulos:** Dashboard, Citas (Multi-Sillón), Pacientes, Historia Clínica, Odontograma FDI, Gabinete de Imágenes, Recetas, Presupuestos, Catálogo de Aranceles, Laboratorio Dental, Pagos / Caja, Gastos / Egresos, Inventario, Tareas CRM, Reportes Financieros y **Gestión de Usuarios / Roles**.
* **Doctor(a) / Odontólogo(a) (`doctor`):**
  - **Alcance:** Control clínico completo y presupuestal de sus pacientes.
  - **Módulos Permitidos:** Dashboard, Citas, Pacientes, Historia Clínica / Odontograma, Gabinete, Recetas Médicas, Presupuestos, Catálogo de Aranceles, Laboratorio Dental (Órdenes de prótesis), Pagos y Tareas.
  - **Módulos Restringidos:** Gastos operativos de la clínica, Inventario general, Reportes gerenciales y Gestión de Usuarios.
* **Asistente Dental (`asistente`):**
  - **Alcance:** Apoyo clínico, gabinete radiográfico y control de insumos y materiales.
  - **Módulos Permitidos:** Dashboard, Citas, Pacientes, Historia Clínica (consulta), Gabinete, Inventario / Stock, Recepción de Laboratorio y Tareas.
  - **Módulos Restringidos:** Gastos, Pagos/Corte de caja, Presupuestos, Reportes y Gestión de Usuarios.
* **Recepción / Front-Desk (`recepcion`):**
  - **Alcance:** Atención al paciente, agenda, cobro en caja y entrega de presupuestos.
  - **Módulos Permitidos:** Dashboard, Citas (Multi-Sillón), Altas y búsqueda de Pacientes, Presupuestos, Cobro en Caja (Módulo Pagos y tickets), Recepción de paquetes de Laboratorio y CRM de Tareas.
  - **Módulos Restringidos:** Historia clínica dental profunda, Gabinete, Recetas médicas, Gastos de clínica, Reportes avanzados y Usuarios.

---

## 🔒 4. REGLAS INVARIANTES
* **SEGURIDAD PRIMERO:** Nunca almacenar contraseñas en texto plano; siempre pasar por el hash de `bcrypt`.
* **VERIFICACIÓN DE TOKEN:** Todas las rutas protegidas del API deben validar el middleware de autenticación JWT.
* **NO MEZCLAR CON `DentaAdmin_Full`:** Este proyecto NO usa Electron; corre como servicio web estándar ejecutable con `npm start` (`node server.js`).

---

## 🦷 5. MÓDULO CLÍNICO ESTILO DENTALINK (FDI + ARANCELES + PRESUPUESTO EN VIVO)
* **Catálogo de Aranceles (`prestaciones`):** Procedimientos clínicos agrupados por especialidad con precios base editables y alcance (`cara`, `diente`, `boca_completa`). 17 prestaciones clínicas reales precargadas por defecto.
* **Odontograma Interactivo Sincronizado:** Al hacer clic en una superficie/diente en el odontograma, se despliega el menú contextual estilo Dentalink con:
  - Búsqueda y listado categorizado de aranceles con chips de precios.
  - Opciones rápidas de diagnóstico: Ya Realizado / Preexistente (Azul), Corona Protésica (Oro), Diente Ausente (Cruz ✕) y Limpiar.
* **Desglose de Tratamientos (`tratamientos_detalles`):** Cada procedimiento asignado a un diente se registra con `realizado: 0` (Planificado / Rojo) y se vincula en tiempo real a la tabla del **Plan de Tratamiento & Presupuesto en Vivo**.
* **Acción 1-Clic de Realización Clínica:** Al presionar "✓ Realizar", el procedimiento pasa a `realizado: 1`, el diente cambia a Azul en el odontograma y se asienta automáticamente la nota en la Historia Clínica del paciente.

---

## 🚀 6. EXTENSIONES DENTALINK IMPLEMENTADAS (FASE 1: 1, 3 Y 4)
* **Opción 1: Financiero Dental - Abonos Directos por Tratamiento / Pieza (`abonos_tratamientos`):**
  - Cada tratamiento en el plan muestra: Costo Total, Ya Abonado, Saldo Pendiente y Badges de estado.
  - Botón "💵 Abonar" abre modal dedicado para registrar pagos parciales o totales directos a ese procedimiento.
  - Sincronización transparente con `pagos` para el corte de caja diario (`corte-neto`) sin descuadres.
  - Actualización automática de `pagado` y `liquidado: 1` en `tratamientos_detalles`.
* **Opción 3: Operatividad Clínica - Agenda Multi-Sillón Dental (`sillones` + `citas`):**
  - 3 Unidades físicas precargadas: Sillón 1 Principal (`#3b82f6`), Sillón 2 Quirúrgico (`#10b981`), Sillón 3 Odonto/Orto (`#f59e0b`).
  - Barra de pestañas en citas para filtrar la agenda por unidad física específica o vista global unificada.
  - Los eventos en el calendario FullCalendar se identifican con prefijo `[S1]`, `[S2]`, `[S3]` y su color de sillón correspondiente.
  - **Candado Anti-Sobrecupo:** Validación inteligente al agendar que alerta si un sillón físico ya tiene una cita ocupada en la misma fecha y hora.
* **Opción 4: Laboratorio Protésico (`laboratorios_ordenes`):**
  - Módulo completo en la barra lateral con 3 tarjetas de KPI (Órdenes Activas, Recibidas en Clínica y Costo Total Acumulado).
  - Pestañas de filtrado: Todas, En Laboratorio / Proceso, Recibidas y Terminadas/Instaladas.
  - Registro de órdenes protésicas con folio automático (`LAB-XXXXXX`), tipo de trabajo (Zirconia, E.max, Carillas, Guardas, etc.), técnico/laboratorio externo, guía de color/tono (A2, B1, etc.), fecha de envío y entrega estimada.
  - Acciones rápidas de flujo de trabajo: "📦 Recibir" (registra recepción en clínica) y "🦷 Instalar" (asienta nota automática en evolución clínica del expediente del paciente).

---

## 💎 7. EXTENSIONES DENTALINK IMPLEMENTADAS (FASE 2: ODONTOGRAMA INFANTIL, PRESUPUESTO FORMAL Y SALA DE ESPERA)
* **Odontograma Infantil / Deciduo & Mixto (Opción 1 Avanzada):**
  - Selector de modo: `[ 🦷 Adulto (32) ]`, `[ 👶 Infantil / Deciduo (20) ]`, `[ 🔄 Mixto (52) ]`.
  - Cuadrantes infantiles FDI: Superior (55-51, 61-65) e Inferior (85-81, 71-75).
  - Interactivo al 100%: selección de caras y aranceles funciona exactamente igual en piezas temporales que permanentes.
* **Presupuesto Formal Clínico Imprimible / PDF (Opción 4 Avanzada):**
  - Membrete profesional: logotipo clínica, datos de la Dra. Rosa Ávila, cédula profesional, dirección y WhatsApp.
  - Folio oficial automático (`PRES-XXXXX`), fecha de emisión y vigencia de 30 días naturales.
  - Desglose por Pieza, Superficie, Prestación Clínica, Arancel Unitario, Abonado y Saldo Pendiente.
  - Cuadro de condiciones de pago y formas aceptadas (Efectivo, Tarjeta, Transferencia SPEI, Abonos por fase).
  - Cláusula de validez y aceptación médica.
  - Doble línea de firma legal: Odontólogo Tratante vs Paciente / Tutor.
  - Botón directo "📄 Presupuesto Formal" desde el Odontograma y desde la sección de Presupuestos.
* **Sala de Espera y Monitor de Flujo de Pacientes en Vivo (Opción 5):**
  - Pestaña conmutable en Citas: `[ 📅 Calendario ]` vs `[ 🛋️ Sala de Espera / Flujo ]`.
  - Tablero Kanban en tiempo real con 4 etapas para el día de hoy:
    1. 🚪 **Por Llegar:** Pacientes agendados hoy con botón de 1 clic `🛎️ Check-in (Llegó a Clínica)`.
    2. 🛋️ **En Sala de Espera:** Pacientes en recepción con cronómetro en vivo (`⏱️ XX min esperando`) y botón `💺 Pasar a Sillón`.
    3. 🩺 **En Sillón Dental:** Pacientes en consulta con sillón asignado, doctor y tiempo transcurrido, más botón `🏁 Finalizar Atención`.
    4. ✅ **Atendidos Hoy:** Citas finalizadas hoy con enlace directo para registrar cobro/abono en caja.
  - Alertas visuales en el calendario: las citas cambian de color e ícono según el estado (`🛋️` Ámbar para Sala de Espera, `💺` Violeta para Sillón, `✅` Verde para Finalizada).
  - Badge numérico en tiempo real en la barra de pestañas que alerta a recepción y doctores sobre cuántos pacientes están en espera.---

## ☁️ 8. ARQUITECTURA DE DESPLIEGUE EN LA NUBE (TURSO CLOUD + VERCEL SERVERLESS)
* **Base de Datos Cloud:** Turso Database (LibSQL sobre AWS `us-east-1`).
  - URL: `libsql://caredent-db-rodarteggc-png.aws-us-east-1.turso.io`.
  - Migración completa de las 20 tablas clínicas y relacionales vía `@libsql/client`.
  - Usuarios precargados: `admin` (`admin123`) y `dra.rosa` (`doctora123`).
* **Backend Serverless (Vercel):**
  - Entrada: `api/index.js` montando la aplicación Express (`server.js`).
  - Rutas estáticas empaquetadas vía `vercel.json` (`includeFiles: index.html,app.js,style.css`) y `process.cwd()` para evitar errores `ENOENT` en Lambda.
  - Criptografía: Migrado a `bcryptjs` (JavaScript puro) para eliminar incompatibilidades de compilación binaria C++ (`node-gyp`) en Amazon Linux Lambda.
  - Filesystem Guard: En serverless, `/uploads` redirige de forma segura a `/tmp/uploads` con bloque `try/catch` para evitar fallos de lectura/escritura `EROFS` en el contenedor de Lambda.
  - Diagnóstico de Conexión: Endpoint `/api/health` para auditar el estado de conexión con Turso Cloud.
