-- =====================================================
-- Esquema limpio optimizado para drawDB y dbdiagram.io
-- Solo DDL: Tablas, Columnas y Claves Foráneas
-- =====================================================

CREATE TABLE usuarios (
    id SERIAL PRIMARY KEY,
    username VARCHAR(100) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    nombre VARCHAR(150),
    rol VARCHAR(50),
    activo BOOLEAN DEFAULT TRUE
);

CREATE TABLE clientes (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(150) NOT NULL,
    tipo_cliente VARCHAR(50),
    latitud DOUBLE PRECISION,
    longitud DOUBLE PRECISION,
    ciudad VARCHAR(100),
    cadena VARCHAR(100),
    activo BOOLEAN DEFAULT TRUE,
    url_google TEXT,
    usuario_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE
);

CREATE TABLE reglas_ruteo (
    id SERIAL PRIMARY KEY,
    categoria VARCHAR(100) UNIQUE NOT NULL,
    limite_por_movil INTEGER NOT NULL,
    activo BOOLEAN DEFAULT TRUE,
    usuario_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE
);

CREATE TABLE categorias (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL,
    activo BOOLEAN DEFAULT TRUE,
    usuario_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE
);

CREATE TABLE choferes (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(150) NOT NULL,
    telefono VARCHAR(50),
    activo BOOLEAN DEFAULT TRUE,
    usuario_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE
);

CREATE TABLE vehiculos (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL,
    chapa VARCHAR(50) NOT NULL,
    tipo VARCHAR(50) DEFAULT 'camion mediano',
    activo BOOLEAN DEFAULT TRUE,
    usuario_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE
);

CREATE TABLE rutas_generadas (
    token VARCHAR(100) PRIMARY KEY,
    movil_numero INTEGER,
    clientes_json TEXT,
    distancia_total DOUBLE PRECISION,
    tiempo_estimado INTEGER,
    chofer_id INTEGER REFERENCES choferes(id) ON DELETE SET NULL,
    vehiculo_id INTEGER REFERENCES vehiculos(id) ON DELETE SET NULL,
    chofer_nombre VARCHAR(150),
    vehiculo_nombre VARCHAR(100),
    fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    estado VARCHAR(50) DEFAULT 'en_curso',
    usuario_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE
);

CREATE TABLE entregas (
    id SERIAL PRIMARY KEY,
    ruta_token VARCHAR(100) REFERENCES rutas_generadas(token) ON DELETE CASCADE,
    cliente_id INTEGER REFERENCES clientes(id) ON DELETE CASCADE,
    estado VARCHAR(50) DEFAULT 'pendiente',
    observacion TEXT,
    orden_en_ruta INTEGER,
    fecha_actualizacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE denuncias (
    id SERIAL PRIMARY KEY,
    ticket VARCHAR(50) UNIQUE NOT NULL,
    nombre_ciudadano VARCHAR(150),
    telefono VARCHAR(50),
    descripcion TEXT NOT NULL,
    categoria VARCHAR(100) DEFAULT 'VERTEDERO_CLANDESTINO',
    barrio VARCHAR(100) NOT NULL,
    direccion_referencia TEXT,
    latitud DOUBLE PRECISION NOT NULL,
    longitud DOUBLE PRECISION NOT NULL,
    foto_url TEXT,
    estado VARCHAR(50) DEFAULT 'pendiente',
    usuario_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    cliente_id INTEGER REFERENCES clientes(id) ON DELETE SET NULL,
    ruta_token VARCHAR(100) REFERENCES rutas_generadas(token) ON DELETE SET NULL,
    observacion_cierre TEXT,
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    fecha_cierre TIMESTAMP
);
