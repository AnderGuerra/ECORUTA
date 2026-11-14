const { Pool } = require('pg');
const config = require('./config');

let pool = null;

function getPool() {
    if (!pool && config.databaseUrl) {
        try {
            pool = new Pool({
                connectionString: config.databaseUrl,
                ssl: config.databaseUrl.includes('sslmode=require') || config.databaseUrl.includes('aivencloud.com')
                    ? { rejectUnauthorized: false }
                    : false,
                connectionTimeoutMillis: 5000
            });

            pool.on('error', (err) => {
                console.error('⚠️ [PostgreSQL Pool Error]:', err.message);
            });
        } catch (err) {
            console.warn('⚠️ No se pudo inicializar el pool de PostgreSQL:', err.message);
        }
    }
    return pool;
}

/**
 * Obtiene los detalles de una denuncia por su ID
 */
async function obtenerDenunciaPorId(id) {
    const p = getPool();
    if (!p) return null;
    try {
        const res = await p.query('SELECT * FROM denuncias WHERE id = $1', [id]);
        return res.rows[0] || null;
    } catch (err) {
        console.warn(`⚠️ Error al consultar denuncia #${id} en BD:`, err.message);
        return null;
    }
}

/**
 * Obtiene las coordenadas exactas (latitud, longitud) asociadas a un token de ruta
 * consultando primero la denuncia vinculada y luego el JSON de paradas de la ruta.
 */
async function obtenerCoordenadasRuta(token) {
    const p = getPool();
    if (!p || !token) return null;
    try {
        const denRes = await p.query(
            'SELECT id, ticket, barrio, direccion_referencia, latitud, longitud FROM denuncias WHERE ruta_token = $1 LIMIT 1',
            [token]
        );
        if (denRes.rows.length > 0) {
            const d = denRes.rows[0];
            const lat = parseFloat(d.latitud);
            const lon = parseFloat(d.longitud);
            if (!isNaN(lat) && !isNaN(lon) && (lat !== 0 || lon !== 0)) {
                return {
                    latitud: lat,
                    longitud: lon,
                    ticket: d.ticket,
                    barrio: d.barrio,
                    direccion: d.direccion_referencia || d.barrio || ''
                };
            }
        }

        const rutaRes = await p.query('SELECT clientes_json FROM rutas_generadas WHERE token = $1 LIMIT 1', [token]);
        if (rutaRes.rows.length > 0 && rutaRes.rows[0].clientes_json) {
            const clientes = JSON.parse(rutaRes.rows[0].clientes_json);
            if (Array.isArray(clientes) && clientes.length > 0) {
                const c0 = clientes[0];
                const lat = parseFloat(c0.latitud ?? c0.lat);
                const lon = parseFloat(c0.longitud ?? c0.lon);
                if (!isNaN(lat) && !isNaN(lon) && (lat !== 0 || lon !== 0)) {
                    return {
                        latitud: lat,
                        longitud: lon,
                        ticket: c0.ticket || '',
                        barrio: c0.ciudad || '',
                        direccion: c0.nombre || ''
                    };
                }
            }
        }
    } catch (err) {
        console.warn(`⚠️ Error al obtener coordenadas reales para ruta ${token}:`, err.message);
    }
    return null;
}

/**
 * Agrega un choferId al CSV choferes_descartados sin duplicar
 */
function appendChoferDescartado(actualCsv, choferId) {
    if (!choferId) return actualCsv || '';
    const parts = String(actualCsv || '')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
    const idStr = String(choferId).trim();
    if (!parts.includes(idStr)) {
        parts.push(idStr);
    }
    return parts.join(',');
}

/**
 * Actualiza el estado de una denuncia en la base de datos (PostgreSQL)
 * Incluye soporte para Rechazado: <Motivo> y registro en historial de choferes descartados
 */
async function actualizarEstadoDenuncia(id, estado, observacion = '', motivoRechazo = null) {
    const p = getPool();
    if (!p) return { success: false, reason: 'Sin conexión a base de datos' };

    try {
        const denActual = await obtenerDenunciaPorId(id);

        if (estado === 'cerrada' || estado === 'RESUELTO' || estado === 'FINALIZADO') {
            const res = await p.query(
                `UPDATE denuncias 
                 SET estado = 'cerrada', observacion_cierre = $1, fecha_cierre = CURRENT_TIMESTAMP 
                 WHERE id = $2 
                 RETURNING *`,
                [observacion, id]
            );
            if (denActual && denActual.ruta_token) {
                await p.query(`UPDATE rutas_generadas SET estado = 'finalizada' WHERE token = $1`, [denActual.ruta_token]);
            }
            return { success: res.rowCount > 0, denuncia: res.rows[0] };
        }

        if (estado.toLowerCase().startsWith('rechazad')) {
            const motivoLimpio = motivoRechazo || observacion || 'Motivo operativo reportado por chofer';
            const estadoFormateado = estado.startsWith('Rechazado:') ? estado : `Rechazado: ${motivoLimpio}`;
            const choferAnteriorId = denActual ? denActual.chofer_id : null;
            const choferAnteriorNom = denActual ? (denActual.asignado_a || `Chofer #${choferAnteriorId || ''}`) : 'Chofer';
            const descartadosNuevo = appendChoferDescartado(denActual ? denActual.choferes_descartados : '', choferAnteriorId);

            const res = await p.query(
                `UPDATE denuncias 
                 SET estado = $1, 
                     motivo_rechazo = $2, 
                     choferes_descartados = $3, 
                     chofer_id = NULL, 
                     asignado_a = NULL, 
                     observacion_cierre = $4 
                 WHERE id = $5 
                 RETURNING *`,
                [
                    estadoFormateado,
                    motivoLimpio,
                    descartadosNuevo,
                    `Rechazado por ${choferAnteriorNom}: ${motivoLimpio}`,
                    id
                ]
            );

            if (denActual && denActual.ruta_token) {
                await p.query(
                    `UPDATE rutas_generadas SET estado = 'rechazada_chofer', chofer_id = NULL, chofer_nombre = '' WHERE token = $1`,
                    [denActual.ruta_token]
                );
            }

            // Registrar alerta prioritaria para el administrador
            if (denActual) {
                try {
                    await p.query(
                        `INSERT INTO alertas_operativas (tipo, descripcion, chofer_id, chofer_nombre, denuncia_id, denuncia_ticket, latitud, longitud, estado)
                         VALUES ('rechazo_ruta', $1, $2, $3, $4, $5, $6, $7, 'activa')`,
                        [
                            `Rechazado: ${motivoLimpio}`,
                            choferAnteriorId,
                            choferAnteriorNom,
                            denActual.id,
                            denActual.ticket,
                            denActual.latitud,
                            denActual.longitud
                        ]
                    );
                } catch (alErr) {
                    console.warn('⚠️ No se pudo insertar alerta operativa:', alErr.message);
                }
            }

            return { success: res.rowCount > 0, denuncia: res.rows[0] };
        }

        const res = await p.query(
            `UPDATE denuncias 
             SET estado = $1, observacion_cierre = $2 
             WHERE id = $3 
             RETURNING *`,
            [estado, observacion, id]
        );
        return { success: res.rowCount > 0, denuncia: res.rows[0] };
    } catch (err) {
        console.error(`❌ Error actualizando denuncia #${id} a estado '${estado}':`, err.message);
        return { success: false, error: err.message };
    }
}

/**
 * Actualiza el estado de una ruta y sus denuncias asociadas.
 * Si el chofer rechaza con motivo, marca el ticket como "Rechazado: <Motivo>"
 * y guarda al chofer en el historial de descartados (choferes_descartados).
 */
async function actualizarEstadoRuta(token, estado, motivo = '') {
    const p = getPool();
    if (!p) return { success: false, reason: 'Sin conexión a base de datos' };

    try {
        // Consultar ruta actual para saber qué chofer la tenía
        const rutaRes = await p.query('SELECT * FROM rutas_generadas WHERE token = $1', [token]);
        const rutaRow = rutaRes.rows[0] || null;
        const choferIdActual = rutaRow ? rutaRow.chofer_id : null;
        const choferNombreActual = rutaRow ? (rutaRow.chofer_nombre || 'Chofer') : 'Chofer';

        if (estado === 'rechazada_chofer' || estado === 'rechazada') {
            await p.query(
                `UPDATE rutas_generadas SET estado = 'rechazada_chofer', chofer_id = NULL, chofer_nombre = '' WHERE token = $1`,
                [token]
            );

            // Buscar todas las denuncias asociadas a este token
            const denRes = await p.query('SELECT * FROM denuncias WHERE ruta_token = $1', [token]);
            const estadoTicketRechazo = `Rechazado: ${motivo}`;

            for (const den of denRes.rows) {
                const cId = den.chofer_id || choferIdActual;
                const nuevosDescartados = appendChoferDescartado(den.choferes_descartados, cId);
                await p.query(
                    `UPDATE denuncias 
                     SET estado = $1, 
                         motivo_rechazo = $2, 
                         choferes_descartados = $3, 
                         chofer_id = NULL, 
                         asignado_a = NULL, 
                         observacion_cierre = $4 
                     WHERE id = $5`,
                    [
                        estadoTicketRechazo,
                        motivo,
                        nuevosDescartados,
                        `Rechazado por ${choferNombreActual} (${motivo}) — Requiere reasignación a siguiente unidad`,
                        den.id
                    ]
                );

                // Emitir alerta prioritaria al centro de despacho
                try {
                    await p.query(
                        `INSERT INTO alertas_operativas (tipo, descripcion, chofer_id, chofer_nombre, denuncia_id, denuncia_ticket, latitud, longitud, estado)
                         VALUES ('rechazo_ruta', $1, $2, $3, $4, $5, $6, $7, 'activa')`,
                        [
                            `Rechazado: ${motivo}`,
                            cId,
                            choferNombreActual,
                            den.id,
                            den.ticket,
                            den.latitud,
                            den.longitud
                        ]
                    );
                } catch (alErr) {
                    console.warn('⚠️ Error insertando alerta de rechazo:', alErr.message);
                }
            }
        } else if (estado === 'en_curso' || estado === 'aceptada_chofer') {
            await p.query('UPDATE rutas_generadas SET estado = $1 WHERE token = $2', ['en_curso', token]);
            await p.query(
                `UPDATE denuncias 
                 SET estado = 'en_proceso', 
                     motivo_rechazo = NULL,
                     observacion_cierre = $1 
                 WHERE ruta_token = $2`,
                [`Ruta en ejecución activa por ${choferNombreActual} (${motivo})`, token]
            );
        } else if (estado === 'finalizada' || estado === 'completada') {
            await p.query('UPDATE rutas_generadas SET estado = $1 WHERE token = $2', ['finalizada', token]);
            await p.query(
                `UPDATE denuncias 
                 SET estado = 'cerrada', 
                     fecha_cierre = CURRENT_TIMESTAMP, 
                     observacion_cierre = $1 
                 WHERE ruta_token = $2`,
                [`Recolección completada por ${choferNombreActual} (${motivo})`, token]
            );
        } else {
            await p.query('UPDATE rutas_generadas SET estado = $1 WHERE token = $2', [estado, token]);
        }

        console.log(`✅ [DB Ruta]: Token ${token} actualizado a estado '${estado}'`);
        return { success: true, token, estado };
    } catch (err) {
        console.error(`❌ Error actualizando ruta ${token}:`, err.message);
        return { success: false, error: err.message };
    }
}

module.exports = {
    getPool,
    obtenerDenunciaPorId,
    obtenerCoordenadasRuta,
    actualizarEstadoDenuncia,
    actualizarEstadoRuta
};
