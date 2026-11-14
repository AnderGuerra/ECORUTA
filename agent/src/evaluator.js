const config = require('./config');
const { CATEGORIAS_VALIDAS, TERMINOS_GENERALES_RESIDUOS, PATRONES_SPAM, BARRIOS_JURISDICCION } = require('./rules');
const { validarDenunciaConGemini } = require('./geminiVision');

/**
 * Fórmula de Haversine para calcular distancia entre dos coordenadas en metros
 */
function calcularDistanciaMetros(lat1, lon1, lat2, lon2) {
    const R = 6371e3; // Radio de la Tierra en metros
    const phi1 = (lat1 * Math.PI) / 180;
    const phi2 = (lat2 * Math.PI) / 180;
    const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
    const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;

    const a =
        Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
        Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
}

/**
 * Evalúa la coherencia del texto y la foto contra la temática de residuos y detecta spam
 */
async function evaluarCoherenciaTextoFoto(datos) {
    const { descripcion = '', categoria = 'VERTEDERO_CLANDESTINO', foto_url = '' } = datos;
    const texto = descripcion.trim().toLowerCase();
    const problemas = [];
    let puntos = 1.0;

    // 1. Longitud básica
    if (texto.length < 8) {
        problemas.push('La descripción es demasiado escueta o carece de información útil');
        puntos -= 0.35;
    }

    // 2. Patrones de SPAM / Publicidad / Teclado aleatorio
    for (const patron of PATRONES_SPAM) {
        if (patron.test(texto)) {
            problemas.push('Se detectaron patrones compatibles con spam, publicidad o caracteres aleatorios');
            puntos -= 0.70;
            break;
        }
    }

    // 3. Relevancia semántica con el dominio de residuos y limpieza urbana
    const infoCat = CATEGORIAS_VALIDAS[categoria] || CATEGORIAS_VALIDAS.VERTEDERO_CLANDESTINO;
    const palabrasEsperadas = [...infoCat.palabrasClave, ...TERMINOS_GENERALES_RESIDUOS];

    let coincidencias = 0;
    for (const palabra of palabrasEsperadas) {
        if (texto.includes(palabra)) {
            coincidencias++;
        }
    }

    if (coincidencias === 0 && texto.length > 0) {
        problemas.push('El texto no menciona términos reconocidos de recolección, residuos, contenedores o poda');
        puntos -= 0.30;
    } else if (coincidencias >= 2) {
        puntos = Math.min(1.0, puntos + 0.15); // Bonificación por alta coherencia
    }

    // 4. Verificación de Foto (si fue suministrada)
    let fotoValida = false;
    let fotoScore = 0.5; // Neutral si no hay foto

    if (foto_url && foto_url.trim().length > 0) {
        const urlStr = foto_url.trim().toLowerCase();
        const esUrlValida = /^https?:\/\/.+/i.test(urlStr);

        if (!esUrlValida) {
            problemas.push('El formato del enlace de la fotografía no es una URL válida');
            fotoScore = 0.1;
        } else {
            // Verificar extensiones de imagen comunes o hosts confiables
            const extensiones = ['.jpg', '.jpeg', '.png', '.webp', 'images.unsplash.com', 'cloudinary', 'imgur'];
            const tieneExtension = extensiones.some(ext => urlStr.includes(ext));

            if (tieneExtension) {
                fotoValida = true;
                fotoScore = 0.95;
            } else {
                fotoValida = true;
                fotoScore = 0.70;
            }
        }
    } else {
        fotoScore = 0.60; // Foto opcional pero con puntaje neutro
    }

    const puntajeFinal = Math.max(0.0, Math.min(1.0, (puntos * 0.7) + (fotoScore * 0.3)));

    return {
        valido: puntajeFinal >= 0.55 && !problemas.some(p => p.includes('spam')),
        puntaje: parseFloat(puntajeFinal.toFixed(2)),
        problemas,
        coincidenciasSemanticas: coincidencias,
        fotoValida,
        categoriaReconocida: infoCat.codigo
    };
}

/**
 * Algoritmo Ray-Casting (Point-in-Polygon) para determinar si una coordenada (lat, lon)
 * se encuentra estrictamente dentro del polígono del límite municipal de Asunción.
 */
function puntoEnPoligono(lat, lon, polygon) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const yi = polygon[i][0], xi = polygon[i][1];
        const yj = polygon[j][0], xj = polygon[j][1];

        const intersect = ((yi > lat) !== (yj > lat)) &&
            (lon < (xj - xi) * (lat - yi) / ((yj - yi) || 1e-12) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
}

const CIUDADES_EXCLUIDAS_GRAN_ASUNCION = [
    'mariano roque alonso',
    'roque alonso',
    'm.r.a.',
    'luque',
    'lambare',
    'lambaré',
    'fernando de la mora',
    'fdo de la mora',
    'fdo. de la mora',
    'san lorenzo',
    'capiata',
    'capiatá',
    'ñemby',
    'nemby',
    'villa elisa',
    'limpio',
    'villa hayes',
    'itaugua',
    'itauguá',
    'aregua',
    'areguá'
];

const MENSAJE_FUERA_DE_COBERTURA = 'Fuera de zona de cobertura: Por el momento solo se admiten reportes dentro del municipio de Asunción';

/**
 * Geovalidación Dura: Valida que las coordenadas estén estrictamente dentro del municipio de Asunción
 * (excluyendo Mariano Roque Alonso, Luque, Lambaré, Fernando de la Mora, San Lorenzo, etc.)
 */
function evaluarGeovalidacion(datos) {
    const lat = parseFloat(datos.latitud);
    const lon = parseFloat(datos.longitud);
    const barrio = (datos.barrio || '').trim();
    const direccion = (datos.direccion_referencia || datos.direccion || '').trim();
    const problemas = [];

    if (isNaN(lat) || isNaN(lon) || (lat === 0 && lon === 0)) {
        return {
            valido: false,
            coordenadasInvalidas: true,
            fueraDeCobertura: false,
            puntaje: 0.0,
            dentroDeLimites: false,
            problemas: ['Coordenadas GPS inválidas o ausentes. Activa el GPS del dispositivo antes de enviar.']
        };
    }

    // 1. Comprobar Bounding Box municipal de Asunción (-25.368 a -25.225, -57.675 a -57.520)
    const { latMin, latMax, lonMin, lonMax } = config.geoBounds;
    const dentroBoundingBox = lat >= latMin && lat <= latMax && lon >= lonMin && lon <= lonMax;

    // 2. Comprobar Point-in-Polygon del límite municipal de Asunción
    const dentroPoligonoAsuncion = Array.isArray(config.asuncionPolygon)
        ? puntoEnPoligono(lat, lon, config.asuncionPolygon)
        : dentroBoundingBox;

    // 3. Comprobar mención explícita de ciudades vecinas fuera de Asunción
    const textoUbicacion = `${barrio} ${direccion}`
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');

    const mencionaCiudadExcluida = CIUDADES_EXCLUIDAS_GRAN_ASUNCION.some(ciudad => {
        const ciudadNorm = ciudad.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        return textoUbicacion.includes(ciudadNorm);
    });

    if (!dentroBoundingBox || !dentroPoligonoAsuncion || mencionaCiudadExcluida) {
        problemas.push(MENSAJE_FUERA_DE_COBERTURA);
        return {
            valido: false,
            coordenadasInvalidas: false,
            fueraDeCobertura: true,
            puntaje: 0.0,
            dentroDeLimites: false,
            problemas
        };
    }

    // Calcular distancia referencial en km
    const distCentroKm = calcularDistanciaMetros(lat, lon, -25.2867, -57.6333) / 1000;

    // Validación de barrio contra lista conocida de Asunción
    let barrioReconocido = false;
    if (barrio) {
        barrioReconocido = BARRIOS_JURISDICCION.some(b => b.toLowerCase() === barrio.toLowerCase());
    }

    const puntaje = barrioReconocido ? 1.0 : 0.85;

    return {
        valido: true,
        coordenadasInvalidas: false,
        fueraDeCobertura: false,
        puntaje,
        dentroDeLimites: true,
        distanciaCentroKm: parseFloat(distCentroKm.toFixed(2)),
        barrioReconocido,
        problemas
    };
}

/**
 * Detección de duplicados y spam por proximidad geográfica y temporal
 */
async function evaluarDuplicadosYSpam(datos, pool) {
    const lat = parseFloat(datos.latitud);
    const lon = parseFloat(datos.longitud);
    const categoria = datos.categoria || 'VERTEDERO_CLANDESTINO';

    if (!pool || isNaN(lat) || isNaN(lon)) {
        return {
            esDuplicado: false,
            puntaje: 1.0,
            reportesCercanos: [],
            mensaje: 'Omitida consulta de duplicados (sin coordenadas válidas o pool)'
        };
    }

    try {
        const query = `
            SELECT id, ticket, latitud, longitud, categoria, estado, barrio, direccion_referencia, fecha_creacion
            FROM denuncias
            WHERE estado IN ('pendiente', 'en_proceso')
              AND fecha_creacion >= NOW() - ($1 || ' HOURS')::INTERVAL
        `;
        const res = await pool.query(query, [config.duplicateWindowHours]);

        const cercanos = [];
        for (const fila of res.rows) {
            const fLat = parseFloat(fila.latitud);
            const fLon = parseFloat(fila.longitud);
            if (!isNaN(fLat) && !isNaN(fLon)) {
                const dist = calcularDistanciaMetros(lat, lon, fLat, fLon);
                if (dist <= config.duplicateRadiusMeters) {
                    cercanos.push({
                        id: fila.id,
                        ticket: fila.ticket,
                        distanciaMetros: Math.round(dist),
                        categoria: fila.categoria,
                        estado: fila.estado,
                        barrio: fila.barrio,
                        direccion: fila.direccion_referencia
                    });
                }
            }
        }

        const esDuplicado = cercanos.length > 0;
        const puntaje = esDuplicado ? 0.25 : 1.0;

        return {
            esDuplicado,
            puntaje,
            reportesCercanos: cercanos,
            totalCercanos: cercanos.length
        };
    } catch (err) {
        console.warn('⚠️ Error al consultar duplicados en base de datos:', err.message);
        return {
            esDuplicado: false,
            puntaje: 0.9,
            reportesCercanos: [],
            error: err.message
        };
    }
}

/**
 * Evalúa integralmente una denuncia emitiendo veredicto, puntuación y estado sugerido
 */
async function evaluarDenunciaCompleta(datos, pool) {
    // 0. VALIDACIÓN DURA DE GEOCERCA (ASUNCIÓN) ANTES DE LLAMAR A GEMINI O CONSULTAR BD
    const evalGeo = evaluarGeovalidacion(datos);
    if (!evalGeo.valido) {
        return {
            veredicto: 'RECHAZADA',
            puntuacionConfianza: 0.0,
            estadoAsignado: 'rechazada',
            fueraDeCobertura: Boolean(evalGeo.fueraDeCobertura),
            coordenadasInvalidas: Boolean(evalGeo.coordenadasInvalidas),
            observaciones: evalGeo.problemas.join('; '),
            motivos: evalGeo.problemas,
            metricas: {
                geovalidacion: evalGeo
            }
        };
    }

    // 0.5. VALIDACIÓN DE METADATOS DE CAPTURA EN VIVO (BLOQUEO DE GALERÍA / DESCARGAS WEB)
    const fuenteCaptura = String(datos.fuente_captura || '').toUpperCase();
    if (fuenteCaptura === 'GALLERY' || fuenteCaptura === 'GALERIA') {
        const msgGaleria = 'No se admiten imágenes subidas desde la galería. La evidencia debe capturarse en vivo con la cámara.';
        return {
            veredicto: 'RECHAZADA',
            puntuacionConfianza: 0.0,
            estadoAsignado: 'rechazada',
            observaciones: msgGaleria,
            motivos: [msgGaleria],
            metricas: { geovalidacion: evalGeo }
        };
    }

    if (datos.timestamp_captura) {
        const ts = Date.parse(datos.timestamp_captura);
        if (!isNaN(ts)) {
            const diffMinutos = Math.abs(Date.now() - ts) / (1000 * 60);
            if (diffMinutos > 60) {
                const msgTs = 'El timestamp de captura de la fotografía expiró (>60 min). Toma una foto en vivo actual.';
                return {
                    veredicto: 'RECHAZADA',
                    puntuacionConfianza: 0.0,
                    estadoAsignado: 'rechazada',
                    observaciones: msgTs,
                    motivos: [msgTs],
                    metricas: { geovalidacion: evalGeo }
                };
            }
        }
    }

    const evalTextoFoto = await evaluarCoherenciaTextoFoto(datos);
    const evalDuplicados = await evaluarDuplicadosYSpam(datos, pool);

    // Auditoría visual profunda y forense con Gemini Vision si hay imagen
    let evalGemini = { ejecutado: false };
    try {
        evalGemini = await validarDenunciaConGemini(datos);
        if (evalGemini.ejecutado) {
            console.log(`🤖 [Gemini Vision]: es_valida=${evalGemini.es_valida}, es_falsa=${evalGemini.es_falsa_denuncia}, es_internet=${evalGemini.es_foto_internet_o_captura}, confianza=${evalGemini.confianza}`);
        }
    } catch (gErr) {
        console.warn('⚠️ Error ejecutando Gemini Vision:', gErr.message);
    }

    // Ponderación de pesos para confianza global
    let puntosGemini = evalTextoFoto.puntaje;
    if (evalGemini.ejecutado) {
        puntosGemini = (evalGemini.es_falsa_denuncia || evalGemini.es_foto_internet_o_captura || !evalGemini.es_valida)
            ? 0.05
            : (evalGemini.confianza || 0.95);
    }

    // Geo: 30%, Texto-Foto/Gemini: 45%, Duplicados/Spam: 25%
    const puntuacionConfianza = parseFloat(
        (evalGeo.puntaje * 0.30 + puntosGemini * 0.45 + evalDuplicados.puntaje * 0.25).toFixed(2)
    );

    const motivos = [];
    let veredicto = 'VALIDA';
    let estadoAsignado = 'verificado';

    // 1. Verificación Forense de Falsa Denuncia o Foto de Internet detectada por Gemini Vision
    if (evalGemini.ejecutado) {
        if (evalGemini.es_falsa_denuncia || evalGemini.es_foto_internet_o_captura || !evalGemini.es_valida) {
            veredicto = 'RECHAZADA';
            estadoAsignado = 'rechazada';
            const motivoG = evalGemini.motivo_rechazo || evalGemini.justificacion || 'La foto fue identificada como imagen de internet/archivo o no evidencia residuos reales';
            motivos.push(`Auditoría Forense IA (Gemini Vision): ${motivoG}`);
        }
    }

    // 2. Reglas de descarte / bloqueo crítico geográfico
    if (!evalGeo.dentroDeLimites) {
        veredicto = 'RECHAZADA';
        estadoAsignado = 'rechazada';
        motivos.push(MENSAJE_FUERA_DE_COBERTURA);
    }

    // 3. Reglas de coherencia de texto si no fue rechazada previamente
    if (!evalTextoFoto.valido && veredicto !== 'RECHAZADA') {
        veredicto = 'RECHAZADA';
        estadoAsignado = 'rechazada';
        motivos.push(...evalTextoFoto.problemas);
    }

    // 4. Detección de duplicados
    if (evalDuplicados.esDuplicado) {
        const primerDuplicado = evalDuplicados.reportesCercanos[0];
        motivos.push(`Posible reporte duplicado a ${primerDuplicado.distanciaMetros}m del ticket activo ${primerDuplicado.ticket}`);
        if (veredicto !== 'RECHAZADA') {
            veredicto = 'SOSPECHOSA';
            estadoAsignado = 'requiere_revision';
        }
    }

    // 5. Umbral de confianza
    if (veredicto === 'VALIDA' && puntuacionConfianza < config.minConfidence) {
        veredicto = 'SOSPECHOSA';
        estadoAsignado = 'requiere_revision';
        motivos.push(`Puntuación de confianza (${puntuacionConfianza}) inferior al umbral mínimo (${config.minConfidence})`);
    }

    let observaciones = '';
    if (veredicto === 'VALIDA') {
        const extraGemini = evalGemini.ejecutado ? ` [IA Gemini: ${evalGemini.justificacion}]` : '';
        observaciones = `Aprobado por Agente EcoRuta (Confianza: ${(puntuacionConfianza * 100).toFixed(0)}%). Evidencia visual y geoespacial validada.${extraGemini}`;
    } else {
        observaciones = `Filtrado por Agente EcoRuta [${veredicto}]: ${motivos.join('; ')}`;
    }

    return {
        veredicto,
        puntuacionConfianza,
        estadoAsignado,
        observaciones,
        motivos,
        metricas: {
            coherenciaTextoFoto: evalTextoFoto,
            geovalidacion: evalGeo,
            antiSpamDuplicados: evalDuplicados,
            geminiVision: evalGemini
        }
    };
}

module.exports = {
    calcularDistanciaMetros,
    evaluarCoherenciaTextoFoto,
    evaluarGeovalidacion,
    evaluarDuplicadosYSpam,
    evaluarDenunciaCompleta
};
