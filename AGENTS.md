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

## 🔑 3. ROLES Y PERMISOS
* **Administrador:** Acceso completo a caja, configuración de doctores, precios de tratamientos e inventario.
* **Odontólogo / Especialista:** Visualización y edición de odontograma, notas de evolución y recetas de sus pacientes asignados.
* **Recepción / Asistente:** Control de citas, altas de pacientes y registro de pagos.

---

## 🔒 4. REGLAS INVARIANTES
* **SEGURIDAD PRIMERO:** Nunca almacenar contraseñas en texto plano; siempre pasar por el hash de `bcrypt`.
* **VERIFICACIÓN DE TOKEN:** Todas las rutas protegidas del API deben validar el middleware de autenticación JWT.
* **NO MEZCLAR CON `DentaAdmin_Full`:** Este proyecto NO usa Electron; corre como servicio web estándar ejecutable con `npm start` (`node server.js`).
