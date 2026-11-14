-- =====================================================
-- NEXO / ECORUTA - Esquema de Base de Datos (PostgreSQL)
-- =====================================================

-- --------------------------------------------------
-- USUARIOS
-- --------------------------------------------------
CREATE TABLE IF NOT EXISTS usuarios (
    id SERIAL PRIMARY KEY,
    username TEXT UNIQUE,
    password TEXT,
    nombre TEXT,
    rol TEXT,
    activo BOOLEAN DEFAULT true,
    chofer_id INTEGER
);

INSERT INTO usuarios (username, password, nombre, rol, activo) VALUES ('admin', 'nexo2025', 'Gestor de Rutas y Denuncias', 'gestor', true)
    ON CONFLICT (username) DO NOTHING;
UPDATE usuarios SET rol = 'gestor' WHERE rol = 'admin';
INSERT INTO usuarios (username, password, nombre, rol, activo) VALUES ('superadmin', 'supernexo2025', 'Super Administrador', 'superadmin', true)
    ON CONFLICT (username) DO NOTHING;
INSERT INTO usuarios (username, password, nombre, rol, activo) VALUES ('gestor', 'gestor2026', 'Gestor de Rutas y Denuncias', 'gestor', true)
    ON CONFLICT (username) DO NOTHING;
INSERT INTO usuarios (username, password, nombre, rol, activo) VALUES ('ciudadano', 'ciudadano2026', 'Ciudadano Demo', 'ciudadano', true)
    ON CONFLICT (username) DO NOTHING;

-- --------------------------------------------------
-- CLIENTES (Puntos de Recolección)
-- --------------------------------------------------
CREATE TABLE IF NOT EXISTS clientes (
    id SERIAL PRIMARY KEY,
    nombre TEXT,
    tipo_cliente TEXT,
    latitud DOUBLE PRECISION,
    longitud DOUBLE PRECISION,
    ciudad TEXT,
    cadena TEXT,
    activo BOOLEAN DEFAULT true,
    url_google TEXT,
    usuario_id INTEGER DEFAULT 1 REFERENCES usuarios(id) ON DELETE CASCADE
);

-- --------------------------------------------------
-- REGLAS DE RUTEO
-- --------------------------------------------------
CREATE TABLE IF NOT EXISTS reglas_ruteo (
    id SERIAL PRIMARY KEY,
    categoria TEXT UNIQUE,
    limite_por_movil INTEGER,
    activo BOOLEAN DEFAULT true,
    usuario_id INTEGER DEFAULT 1 REFERENCES usuarios(id) ON DELETE CASCADE
);

-- --------------------------------------------------
-- CATEGORIAS
-- --------------------------------------------------
CREATE TABLE IF NOT EXISTS categorias (
    id SERIAL PRIMARY KEY,
    nombre TEXT,
    activo BOOLEAN DEFAULT true,
    usuario_id INTEGER DEFAULT 1 REFERENCES usuarios(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_categorias_nombre_usuario ON categorias (LOWER(nombre), usuario_id);

-- --------------------------------------------------
-- CHOFERES (Con Zona, Ubicación y Telegram ID)
-- --------------------------------------------------
CREATE TABLE IF NOT EXISTS choferes (
    id SERIAL PRIMARY KEY,
    nombre TEXT,
    telefono TEXT,
    zona TEXT DEFAULT '',
    telegram_id TEXT DEFAULT '',
    latitud DOUBLE PRECISION,
    longitud DOUBLE PRECISION,
    vehiculo_id INTEGER,
    activo BOOLEAN DEFAULT true,
    usuario_id INTEGER DEFAULT 1 REFERENCES usuarios(id) ON DELETE CASCADE
);

-- --------------------------------------------------
-- VEHICULOS
-- --------------------------------------------------
CREATE TABLE IF NOT EXISTS vehiculos (
    id SERIAL PRIMARY KEY,
    nombre TEXT,
    chapa TEXT,
    tipo TEXT DEFAULT 'camion mediano',
    activo BOOLEAN DEFAULT true,
    usuario_id INTEGER DEFAULT 1 REFERENCES usuarios(id) ON DELETE CASCADE
);

-- --------------------------------------------------
-- RUTAS GENERADAS
-- --------------------------------------------------
CREATE TABLE IF NOT EXISTS rutas_generadas (
    token TEXT PRIMARY KEY,
    movil_numero INTEGER,
    clientes_json TEXT,
    distancia_total DOUBLE PRECISION,
    tiempo_estimado INTEGER,
    chofer_id INTEGER REFERENCES choferes(id) ON DELETE SET NULL,
    vehiculo_id INTEGER REFERENCES vehiculos(id) ON DELETE SET NULL,
    chofer_nombre TEXT,
    vehiculo_nombre TEXT,
    fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    estado TEXT DEFAULT 'en_curso',
    usuario_id INTEGER DEFAULT 1 REFERENCES usuarios(id) ON DELETE CASCADE
);

-- --------------------------------------------------
-- ENTREGAS
-- --------------------------------------------------
CREATE TABLE IF NOT EXISTS entregas (
    id SERIAL PRIMARY KEY,
    ruta_token TEXT REFERENCES rutas_generadas(token) ON DELETE CASCADE,
    cliente_id INTEGER REFERENCES clientes(id) ON DELETE CASCADE,
    estado TEXT DEFAULT 'pendiente',
    observacion TEXT,
    orden_en_ruta INTEGER,
    fecha_actualizacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- --------------------------------------------------
-- DENUNCIAS CIUDADANAS Y DESPACHO AUTOMÁTICO
-- --------------------------------------------------
CREATE TABLE IF NOT EXISTS denuncias (
    id SERIAL PRIMARY KEY,
    ticket TEXT UNIQUE NOT NULL,
    nombre_ciudadano TEXT,
    telefono TEXT,
    descripcion TEXT NOT NULL,
    categoria TEXT DEFAULT 'VERTEDERO_CLANDESTINO',
    barrio TEXT NOT NULL,
    direccion_referencia TEXT,
    latitud DOUBLE PRECISION NOT NULL,
    longitud DOUBLE PRECISION NOT NULL,
    foto_url TEXT,
    estado TEXT DEFAULT 'verificado',
    motivo_rechazo TEXT,
    choferes_descartados TEXT DEFAULT '',
    distancia_km DOUBLE PRECISION DEFAULT 0.0,
    tiempo_min INTEGER DEFAULT 15,
    usuario_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    cliente_id INTEGER REFERENCES clientes(id) ON DELETE SET NULL,
    chofer_id INTEGER REFERENCES choferes(id) ON DELETE SET NULL,
    chofer_sugerido_id INTEGER REFERENCES choferes(id) ON DELETE SET NULL,
    chofer_sugerido_nombre TEXT,
    cuadrilla TEXT,
    asignado_a TEXT,
    ruta_token TEXT REFERENCES rutas_generadas(token) ON DELETE SET NULL,
    observacion_cierre TEXT,
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    fecha_cierre TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_denuncias_estado ON denuncias(estado);
CREATE INDEX IF NOT EXISTS idx_denuncias_barrio ON denuncias(barrio);
CREATE INDEX IF NOT EXISTS idx_denuncias_ticket ON denuncias(ticket);
CREATE INDEX IF NOT EXISTS idx_denuncias_usuario ON denuncias(usuario_id);
