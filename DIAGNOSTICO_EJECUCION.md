# 📋 Reporte de Diagnóstico y Ejecución End-to-End (ECORUTA)

**Fecha de Auditoría:** 2026-11-07  
**Rol:** DevOps & QA Senior  
**Workspace:** `c:\Users\Ander\Desktop\Ecoruta-main`

---

## 1. Resumen de Auditoría de Estructura y Configuración (Fase 1)

### 1.1 Módulos Identificados en el Workspace
| Módulo | Ruta | Tecnología / Stack | Propósito |
| :--- | :--- | :--- | :--- |
| **Backend Core & Web Server** | `backend/` | Java 17 (`com.sun.net.httpserver.HttpServer`), JDBC PostgreSQL, Gson | API REST principal (`/api/login`, `/api/denuncias`, `/api/choferes`, `/api/rutas-todas`, `/api/denuncias/asignar-punto`) y servidor de archivos estáticos de `frontend/` y `muni-demo/`. |
| **Agente IA & Anti-Spam** | `agent/` | Node.js (CommonJS), Express `^4.21.2`, Multer `^2.4.0`, `pg` `^8.13.1`, `dotenv` | Microservicio de pre-validación geoespacial, detección de duplicados, coherencia texto-foto y validación multimodal con Gemini Vision API (`/api/denuncias/validar-y-enviar`). |
| **Bot de Despacho Telegram** | `bot/` | Node.js (CommonJS), Express `^4.21.2`, Telegraf `^4.16.3`, `pg` `^8.13.1` | Microservicio de despacho interactivo de rutas y tickets a choferes vía Telegram y recepción de aceptaciones/rechazos con motivos (`/api/despacho/ruta`). |
| **Dashboard Administrativo & Portal Web** | `frontend/` y `muni-demo/` | HTML5, CSS3, JavaScript Vanilla, Leaflet.js | Panel administrativo unificado de 3 vistas (`index.html`), login (`login1.html`) y portal ciudadano web (`ciudadano.html`). |
| **Aplicación Móvil Ciudadana** | `mobile/` | Flutter / Dart (`sdk: ^3.13.1`), `http`, `geolocator`, `image_picker`, `flutter_map` | App móvil Android/iOS para captura de evidencia fotográfica + GPS en vivo, envío al Agente IA y rastreo de tickets (`ECO-XXXX`). |
| **Base de Datos** | `database/` | PostgreSQL (`schema.sql`, `CreacionDB.java`) | Esquema relacional para `usuarios`, `denuncias`, `choferes`, `vehiculos`, `clientes`, `rutas_generadas`, `entregas` y `alertas_operativas`. |

### 1.2 Verificación de Archivos `.env` y Secretos (Sanitizado)
* **`agent/.env`** (`410 bytes` — **PRESENTE Y VÁLIDO**):
  * `ECORUTA_BACKEND_URL=http://localhost:8085`
  * `PORT=5050`
  * `DATABASE_URL=[DEFINIDO - 54 chars]` (apunta a `localhost:5432/ruteo_db`)
  * `AGENT_MIN_CONFIDENCE=0.70`
  * `AGENT_DUPLICATE_RADIUS_METERS=150`
  * `AGENT_DUPLICATE_WINDOW_HOURS=48`
  * `AGENT_GEO_BOUNDS_LAT_MIN=-25.40`, `LAT_MAX=-25.18`, `LON_MIN=-57.72`, `LON_MAX=-57.48`
  * `GEMINI_API_KEY=[DEFINIDO - 53 chars]`
  * **Almacenamiento Multer:** Configurado en `agent/src/server.js` (líneas 10–22) hacia `agent/uploads/` con límite de `20 MB` por archivo.
* **`bot/.env`** (`280 bytes` — **PRESENTE Y VÁLIDO**):
  * `TELEGRAM_BOT_TOKEN=[DEFINIDO - 46 chars]`
  * `TEST_DRIVER_TELEGRAM_ID=8727434553`
  * `DEFAULT_ZONE=Zona Centro`
  * `PORT=4000`
  * `BACKEND_API_URL=http://localhost:8085`
  * `DATABASE_URL=[DEFINIDO - 54 chars]` (apunta a `localhost:5432/ruteo_db`)

### 1.3 Conflictos de Puertos Detectados
* **Puerto `8080` ocupado por servicio externo (`httpd` - Apache, PID `6688`):** El script `iniciar_proyecto.bat` (líneas 84 y 88) intenta abrir `http://localhost:8080/login1.html`, pero el backend Java (`Main.java` línea 424) escucha por defecto en el puerto **`8085`**.

---

## 2. Bitácora de Comandos Ejecutados (Fases 1 a 4)

| # | Fase | Comando Ejecutado | Directorio | Estado | Código Salida / Resultado |
| :-: | :--- | :--- | :--- | :---: | :--- |
| 1 | Fase 1 | `Get-ChildItem -Force \| Select-Object Mode, Name, Length` | `c:\Users\Ander\Desktop\Ecoruta-main` | **ÉXITO** | `0` — 12 directorios y 15 archivos raíz listados. |
| 2 | Fase 1 | `Get-ChildItem -Path . -Recurse -Depth 2 -Filter ".env*" -Force` | `c:\Users\Ander\Desktop\Ecoruta-main` | **ÉXITO** | `0` — Detectados `agent/.env` y `bot/.env` (+ `.env.example`). |
| 3 | Fase 1 | Auditoría segura de claves en `agent/.env` y `bot/.env` (`node -e ...`) | `c:\Users\Ander\Desktop\Ecoruta-main` | **ÉXITO** | `0` — Variables críticas definidas sin exponer secretos. |
| 4 | Fase 1 | `Get-NetTCPConnection -LocalPort 8080,8085,5050,4000,5432 -State Listen` | `c:\Users\Ander\Desktop\Ecoruta-main` | **ADVERTENCIA** | `0` — `5432` activo (PostgreSQL), `8080` ocupado por `httpd` (PID `6688`). |
| 5 | Fase 2 | `Get-ChildItem -Path agent/src, bot/src -Filter "*.js" \| ForEach-Object { node --check $_.FullName }` | `c:\Users\Ander\Desktop\Ecoruta-main` | **ÉXITO** | `0` — 14 archivos JS en `agent/src` y `bot/src` sin errores de sintaxis. |
| 6 | Fase 2 | Verificación de módulos Node (`dotenv`, `express`, `multer`, `pg`, `telegraf`) | `c:\Users\Ander\Desktop\Ecoruta-main` | **ÉXITO** | `0` — `Agent deps OK` / `Bot deps OK`. |
| 7 | Fase 2 | `javac -encoding UTF-8 -cp "backend/lib/*" -d backend/target/classes ... Main.java` | `c:\Users\Ander\Desktop\Ecoruta-main` | **ÉXITO** | `0` — Backend Java compilado sin errores. |
| 8 | Fase 2 | `flutter pub get` | `c:\Users\Ander\Desktop\Ecoruta-main\mobile` | **ADVERTENCIA** | `0` — Dependencias resueltas; 28 paquetes tienen versiones más nuevas disponibles. |
| 9 | Fase 2 | `flutter analyze --no-pub` | `c:\Users\Ander\Desktop\Ecoruta-main\mobile` | **ÉXITO** | `0` — `No issues found! (ran in 1.6s)`. |
| 10 | Fase 3 | Verificación de esquema PostgreSQL (`check_db.js` contra `localhost:5432/ruteo_db`) | `c:\Users\Ander\Desktop\Ecoruta-main` | **ÉXITO** | `0` — 10 tablas activas (`denuncias`: 18, `choferes`: 2, `usuarios`: 5, `rutas`: 5). |
| 11 | Fase 4 | `java -cp "backend/target/classes;backend/lib/*" com.ruteo.Main` | `c:\Users\Ander\Desktop\Ecoruta-main` | **ÉXITO** | Daemon activo en puerto `8085` (PID `6572`). |
| 12 | Fase 4 | `node agent/src/index.js` | `c:\Users\Ander\Desktop\Ecoruta-main` | **ÉXITO** | Daemon activo en puerto `5050` (PID `24964`). |
| 13 | Fase 4 | `node bot/src/index.js` | `c:\Users\Ander\Desktop\Ecoruta-main` | **ÉXITO** | Daemon activo en puerto `4000` (PID `27884`). |
| 14 | Fase 4 | `Invoke-RestMethod` Healthchecks (`:8085/api/health`, `:5050/health`, `:4000/health`) | `c:\Users\Ander\Desktop\Ecoruta-main` | **ÉXITO** | `0` — Los 3 servicios respondieron HTTP `200 OK`. |
| 15 | Fase 4 | `flutter devices` | `c:\Users\Ander\Desktop\Ecoruta-main\mobile` | **ÉXITO** | `0` — Detectados `Pixel 8 Pro (39300DLJG0001Q)`, `Chrome`, `Edge`. |
| 16 | Fase 4 | `adb.exe reverse tcp:8085 tcp:8085` y `adb.exe reverse tcp:5050 tcp:5050` | `c:\Users\Ander\Desktop\Ecoruta-main` | **ÉXITO** | `0` — Túneles USB reversos activos hacia el dispositivo físico. |
| 17 | Fase 4 | `flutter run -d 39300DLJG0001Q` | `c:\Users\Ander\Desktop\Ecoruta-main\mobile` | **ÉXITO** | Daemon activo — APK compilado (`78.1s`), instalado (`7.7s`) y corriendo en `Pixel 8 Pro`. |

---

## 3. Estado Actual de Servicios (En Vivo)

| Servicio | Tecnología | Puerto | PID / Dispositivo | Estado | URL / Endpoint de Acceso |
| :--- | :--- | :---: | :---: | :---: | :--- |
| **PostgreSQL Database** | PostgreSQL Server (`ruteo_db`) | `5432` | PID `8492` | 🟢 **ACTIVO** | `postgresql://localhost:5432/ruteo_db` |
| **Backend Principal & Web UI** | Java HTTP Server (`com.ruteo.Main`) | `8085` | PID `6572` (`task-228`) | 🟢 **ACTIVO** | `http://localhost:8085/index.html` \| Health: `http://localhost:8085/api/health` |
| **Agente IA & Anti-Spam** | Node.js / Express (`agent/src/index.js`) | `5050` | PID `24964` (`task-229`) | 🟢 **ACTIVO** | `http://localhost:5050/api/denuncias/validar-y-enviar` \| Health: `http://localhost:5050/health` |
| **Bot de Despacho Telegram** | Node.js / Express + Telegraf (`bot/src/index.js`) | `4000` | PID `27884` (`task-230`) | 🟢 **ACTIVO** | `http://localhost:4000/api/despacho/ruta` \| Health: `http://localhost:4000/health` |
| **App Móvil Ciudadana** | Flutter Debug (`com.example.reportes_municipales`) | `58389` (VM) | `Pixel 8 Pro` (`39300DLJG0001Q` / `task-243`) | 🟢 **ACTIVO** | Conectada vía `adb reverse` (`127.0.0.1:8085` y `127.0.0.1:5050`) \| DevTools: `http://127.0.0.1:58389/hquZh9EWg7k=/` |

---

## 4. Registro de Errores, Advertencias y Logs Críticos

### 4.1 Logs de Arranque Capturados

#### Backend Java (`task-228` — Puerto `8085`)
```text
✅ Conectado a PostgreSQL en: jdbc:postgresql://localhost:5432/ruteo_db
Comprobando esquema de base de datos...
✅ Esquema de base de datos verificado/creado con relaciones.
ℹ️ Inicialización de clientes de ejemplo deshabilitada.
⚠️ ADVERTENCIA: Usando contraseña por defecto. Configure DB_PASSWORD como variable de entorno para producción.
ℹ️ ORS_API_KEY no configurada. Las distancias usarán Haversine (estimación lineal).
🚀 Servidor iniciado en el puerto: 8085
```

#### Agente IA (`task-229` — Puerto `5050`)
```text
🛡️  ECORUTA - AGENTE DE VERIFICACIÓN Y ANTI-SPAM
📡 Ecoruta Backend:     http://localhost:8085
🔌 Puerto Agente:       5050
✅ Conexión con PostgreSQL verificada.
🚀 Servicio Agente activo en: http://0.0.0.0:5050
```

#### Bot de Telegram (`task-230` — Puerto `4000`)
```text
🚛 NEXO EcoRuta - Servicio de Bot de Telegram
📍 Zona por Defecto:        Zona Centro
🆔 Conductor de Pruebas:    Telegram ID 8727434553
🔌 Backend Java URL:        http://localhost:8085
✅ Conexión con PostgreSQL establecida con éxito.
🚀 Servidor HTTP de despacho listo en: http://localhost:4000
```

#### App Flutter en Dispositivo Físico (`task-243` — `Pixel 8 Pro`)
```text
Launching lib\main.dart on Pixel 8 Pro in debug mode...
Running Gradle task 'assembleDebug'...                             78,1s
√ Built build\app\outputs\flutter-apk\app-debug.apk
Installing build\app\outputs\flutter-apk\app-debug.apk...           7,7s
I/flutter (18237): [IMPORTANT:flutter/shell/platform/android/android_context_vk_impeller.cc(62)] Using the Impeller rendering backend (Vulkan).
D/FlutterGeolocator(18237): Geolocator foreground service connected
D/FlutterGeolocator(18237): Flutter engine connected. Connected engine count 1
I/Choreographer(18237): Skipped 1195 frames! The application may be doing too much work on its main thread.
W/UiContextUtils(18237): Requested context is a non-UI Context. Creating a UI-Context with display: 0.
```

---

### 4.2 Hallazgos Funcionales y de Código Detectados en la Auditoría

1. **Modelos de Gemini inexistentes en `agent/src/geminiVision.js`:**
   * En `agent/src/geminiVision.js` (líneas 110–114), el arreglo `modelosCandidatos` intenta invocar `'gemini-3.1-flash-lite'` y `'gemini-3.8-flash'`, los cuales no existen en la API `v1beta` de Google Generative Language (provocando fallos HTTP 404 en el primer y tercer intento y dependiendo únicamente del fallback `'gemini-flash-lite-latest'`). Deben actualizarse a modelos válidos como `'gemini-2.5-flash'` y `'gemini-2.0-flash'`.
2. **Incompatibilidad de campo de foto Base64 entre `frontend/ciudadano.html` y `agent/src/server.js`:**
   * En `frontend/ciudadano.html` (línea 3015), el formulario web envía la captura de cámara en Base64 dentro del campo `foto_url: "data:image/jpeg;base64,..."`.
   * Sin embargo, `agent/src/server.js` (línea 89) solo decodifica imágenes Base64 si vienen en `datos.foto_base64`, y `agent/src/geminiVision.js` (líneas 19–55) solo busca `data:image/...;base64` en `datos.foto_base64`, ignorándolo si viene en `datos.foto_url`. Como resultado, los reportes enviados desde `ciudadano.html` no pasan por Gemini Vision y guardan el string Base64 crudo en vez de un archivo en `/uploads/`.
3. **Validación de rechazo del Agente en `frontend/ciudadano.html`:**
   * En `frontend/ciudadano.html` (línea 3043), se evalúa `else if (aData.valido === false)`, pero `agent/src/server.js` (líneas 120–130) devuelve `{ success: true, veredicto: 'RECHAZADA', motivos: [...] }` sin la propiedad `valido`. Por ello, cuando el Agente IA rechaza una denuncia desde el portal web ciudadano, la interfaz web la muestra como exitosa en lugar de mostrar el motivo de rechazo.
4. **Colores de nuevos estados operativos en `mobile/lib/screens/rastreo_screen.dart`:**
   * En `mobile/lib/screens/rastreo_screen.dart` (líneas 65–80), el método `_obtenerColorEstado(String? estado)` contempla `pendiente`, `en_proceso`, `cerrada`, `rechazada` y `requiere_revision`, pero no contempla los estados del nuevo flujo (`verificado`, `reasignado`, ni `rechazado: <motivo>`), asignándoles color gris por defecto.
5. **Puerto incorrecto en `iniciar_proyecto.bat`:**
   * En `iniciar_proyecto.bat` (líneas 84 y 88), el script abre `http://localhost:8080/login1.html` en lugar de `http://localhost:8085/login1.html` (donde realmente inicia `com.ruteo.Main`, además de que el puerto `8080` está ocupado por Apache `httpd`).

---

## 5. Plan de Reparación Priorizado

| Prioridad | Archivo | Líneas Exactas | Problema Detectado | Acción Correctiva Recomendada |
| :---: | :--- | :---: | :--- | :--- |
| 🔴 **P1 (Alta)** | `agent/src/geminiVision.js` | `L110-L114` | Nombres de modelos inválidos (`gemini-3.1-flash-lite`, `gemini-3.8-flash`) causan latencia y errores 404 en llamadas a Gemini API. | Reemplazar `modelosCandidatos` por `['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-flash-lite-latest']`. |
| 🔴 **P1 (Alta)** | `agent/src/server.js` y `agent/src/geminiVision.js` | `server.js: L89-L101` `geminiVision.js: L19-L30` | `ciudadano.html` envía `foto_url` con formato `data:image/jpeg;base64,...`, pero el Agente solo procesa Base64 si viene en `foto_base64`. | En `server.js` (línea 89), detectar también si `datos.foto_url` inicia con `data:image/` para guardarlo en `/uploads/` y poblar `foto_archivo_local`. |
| 🟠 **P2 (Media)** | `frontend/ciudadano.html` | `L3038-L3046` | El portal web verifica `aData.valido === false` en vez de `aData.veredicto === 'RECHAZADA'`, mostrando como aprobados los reportes rechazados por IA. | Verificar `if (aData.veredicto === 'RECHAZADA')` y lanzar el error con `aData.motivos.join(', ')`. |
| 🟡 **P3 (Media)** | `mobile/lib/screens/rastreo_screen.dart` | `L65-L80` | Los estados `verificado`, `reasignado` y `Rechazado: <Motivo>` caen en el caso `default` (gris) en la pantalla de rastreo móvil. | Añadir soporte en `_obtenerColorEstado` para `'verificado'`, `'reasignado'` y `estado.startsWith('rechazado:')`. |
| 🟢 **P4 (Baja)** | `iniciar_proyecto.bat` | `L84, L88` | El lanzador `.bat` abre `http://localhost:8080/login1.html` (ocupado por Apache) cuando el backend escucha en `8085`. | Cambiar `localhost:8080` a `localhost:8085` en las líneas 84 y 88. |

