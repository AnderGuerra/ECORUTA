# NEXO - Sistema de Ruteo Inteligente 🚚

Bienvenido a **NEXO**, una plataforma diseñada para optimizar la logística de reparto de PyMEs en Gran Asunción. Este sistema permite gestionar clientes, generar rutas óptimas para múltiples móviles y realizar un seguimiento en tiempo real de las entregas.

---

## 🛠️ Requisitos Previos

Antes de comenzar, asegúrate de tener instalado:
1. **Java JDK 17 o superior**.
2. **PostgreSQL** (el sistema usa el puerto `5000` por defecto).
3. **Navegador Web** (Chrome, Edge o Firefox).

---

## ⚡ Inicio Rápido (Recomendado)

Para levantar **todo el sistema automáticamente** (Base de Datos PostgreSQL, Servidor Backend y abrir el Frontend en el navegador):

1. Haz doble clic en el archivo **`iniciar_proyecto.bat`** (ubicado en la raíz del proyecto).
2. El script:
   - Verifica e inicia PostgreSQL en el puerto `5432` si no está corriendo.
   - Compila el código Java del backend si hubo cambios.
   - Inicia el servidor HTTP en el puerto `8080`.
   - Abre automáticamente la pantalla de login en tu navegador predeterminado.

---

## 🚀 Guía de Ejecución Manual (Paso a Paso)

Si prefieres ejecutar cada componente por separado:

### 1. Base de Datos
- Inicia PostgreSQL en tu sistema (puerto `5432`, base de datos `ruteo_db`).
- Para inicializar o resetear tablas: ejecuta `database/inicializar_db.bat`.

### 2. Backend (Java)
- Entra en la carpeta `backend/` y ejecuta **`compilar.bat`**.

### 3. Frontend (Navegador)
- Abre tu navegador en **`http://localhost:8080/login1.html`**.

---

## 🔑 Credenciales por Defecto

Para el primer acceso, utiliza las siguientes credenciales:
*   **Usuario**: `admin`
*   **Contraseña**: `nexo2025`

> [!IMPORTANT]
> El sistema cerrará la sesión automáticamente tras **5 minutos de inactividad** para proteger la información.

---

## 📂 Estructura del Proyecto

*   `/backend`: Código fuente en Java, librerías (`lib/`) y scripts de automatización (`.bat`).
*   `/frontend`: Interfaz de usuario (HTML, CSS, JS).
    *   `index.html`: Panel principal de gestión.
    *   `seguimiento.html`: Monitoreo en tiempo real por móvil.
    *   `estadisticas.html`: Dashboard de métricas y rendimiento.
*   `/database`: Scripts SQL adicionales y migraciones.

---

## 🌓 Características Especiales

*   **Modo Oscuro**: Activable desde el panel de Configuraciones.
*   **Seguridad**: Contraseñas encriptadas con BCrypt y protección por tokens de sesión.
*   **Integración WhatsApp**: Envío directo de rutas optimizadas a los choferes.

---
*Desarrollado para el proyecto UNIDA - Ruteo Inteligente 2026*
