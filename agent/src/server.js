const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const config = require('./config');
const { evaluarDenunciaCompleta } = require('./evaluator');
const { enviarDenunciaAEcoruta, consultarTicketEcoruta, listarTicketsCiudadano } = require('./ecorutaClient');
const { getPool } = require('./db');

const uploadsDir = path.resolve(__dirname, '../uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadsDir),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname) || '.jpg';
        cb(null, `evidencia-${Date.now()}-${Math.round(Math.random() * 1E6)}${ext}`);
    }
});
const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } });

function createAgentServer() {
    const app = express();
    const pool = getPool();

    app.use(express.json({ limit: '25mb' }));
    app.use(express.urlencoded({ extended: true, limit: '25mb' }));

    // Servir carpeta de evidencias fotográficas
    app.use('/uploads', express.static(uploadsDir));

    // CORS para permitir peticiones desde cualquier origen local/remoto
    app.use((req, res, next) => {
        res.header('Access-Control-Allow-Origin', '*');
        res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
        res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
        if (req.method === 'OPTIONS') return res.sendStatus(200);
        next();
    });

    // Health check
    app.get('/health', (req, res) => {
        res.json({
            status: 'UP',
            service: 'Ecoruta AI Validation & Anti-Spam Agent',
            ecorutaBackend: config.ecorutaBackendUrl,
            timestamp: new Date().toISOString()
        });
    });

    // ------------------------------------------------------------------
    // POST /api/denuncias/evaluar (Dry-run / Pre-validación en tiempo real)
    // ------------------------------------------------------------------
    app.post('/api/denuncias/evaluar', upload.any(), async (req, res) => {
        try {
            const resultado = await evaluarDenunciaCompleta(req.body, pool);
            res.json({
                success: true,
                evaluacion: resultado
            });
        } catch (err) {
            console.error('❌ Error en evaluación dry-run:', err.message);
            res.status(500).json({ error: err.message });
        }
    });

    // ------------------------------------------------------------------
    // POST /api/denuncias/validar-y-enviar (Flujo integral de validación y despacho)
    // ------------------------------------------------------------------
    app.post('/api/denuncias/validar-y-enviar', upload.any(), async (req, res) => {
        try {
            const datos = { ...req.body };

            // Parsear números si vienen como string de multipart/form-data
            if (datos.latitud !== undefined && datos.latitud !== '') datos.latitud = parseFloat(datos.latitud);
            if (datos.longitud !== undefined && datos.longitud !== '') datos.longitud = parseFloat(datos.longitud);

            // Validación estricta de presencia de coordenadas GPS reales (nunca usar centro fijo por defecto)
            if (
                datos.latitud === undefined ||
                datos.longitud === undefined ||
                isNaN(datos.latitud) ||
                isNaN(datos.longitud) ||
                (datos.latitud === 0 && datos.longitud === 0)
            ) {
                return res.status(400).json({
                    success: false,
                    valido: false,
                    bloqueado_ia: true,
                    veredicto: 'RECHAZADA',
                    motivo: 'Coordenadas GPS inválidas o ausentes. Activa el GPS antes de reportar.',
                    observaciones: 'No se suministraron coordenadas GPS válidas en la petición.'
                });
            }

            // 0. Si viene archivo de imagen por multipart
            const host = req.get('host') || `localhost:${config.port}`;
            const protocol = req.protocol || 'http';

            if (req.files && req.files.length > 0) {
                const archivo = req.files[0];
                datos.foto_url = `${protocol}://${host}/uploads/${archivo.filename}`;
                datos.foto_archivo_local = archivo.path;
                datos.foto_nombre_original = archivo.originalname || '';
                console.log(`📸 [Foto Recibida Multipart]: ${archivo.filename} (${(archivo.size / 1024).toFixed(1)} KB)`);
            } else if (
                (datos.foto_base64 && typeof datos.foto_base64 === 'string') ||
                (datos.foto_url && typeof datos.foto_url === 'string' && datos.foto_url.startsWith('data:image/'))
            ) {
                try {
                    const rawB64 = datos.foto_base64 || datos.foto_url;
                    const base64Data = rawB64.replace(/^data:image\/\w+;base64,/, '');
                    const filename = `evidencia-${Date.now()}-${Math.round(Math.random() * 1E6)}.jpg`;
                    const filepath = path.join(uploadsDir, filename);
                    fs.writeFileSync(filepath, Buffer.from(base64Data, 'base64'));
                    datos.foto_url = `${protocol}://${host}/uploads/${filename}`;
                    datos.foto_archivo_local = filepath;
                    console.log(`📸 [Foto Recibida Base64]: Guardada en ${filename}`);
                } catch (b64Err) {
                    console.warn('⚠️ Error al decodificar foto base64:', b64Err.message);
                }
            }

            // 1. Evaluación completa del Agente (Geocerca Asunción -> Metadatos Cámara -> Gemini Vision Forense -> Anti-Spam)
            console.log(`🛡️ [Agente Ecoruta]: Evaluando denuncia entrante en barrio '${datos.barrio || 'Sin barrio'}' (${datos.latitud}, ${datos.longitud})...`);
            const evaluacion = await evaluarDenunciaCompleta(datos, pool);

            console.log(`📊 [Veredicto Agente]: ${evaluacion.veredicto} (Confianza: ${(evaluacion.puntuacionConfianza * 100).toFixed(0)}%)`);

            // 2. CORTOCIRCUITO ESTRICTO: Si está fuera de cobertura de Asunción o si Gemini/Agente detectan denuncia falsa / foto de internet
            if (evaluacion.veredicto === 'RECHAZADA' || evaluacion.estadoAsignado === 'rechazada') {
                if (datos.foto_archivo_local && fs.existsSync(datos.foto_archivo_local)) {
                    try { fs.unlinkSync(datos.foto_archivo_local); } catch (_) {}
                }
                const motivoPrincipal = (evaluacion.motivos && evaluacion.motivos.length > 0)
                    ? evaluacion.motivos.join('; ')
                    : 'La imagen o el reporte no corresponden a una incidencia real de residuos urbanos.';

                const httpStatus = evaluacion.fueraDeCobertura ? 403 : (evaluacion.coordenadasInvalidas ? 400 : 422);
                console.warn(`🚫 [BLOQUEO AGENTE HTTP ${httpStatus}]: Denuncia descartada en cortocircuito -> ${motivoPrincipal}`);
                return res.status(httpStatus).json({
                    success: false,
                    valido: false,
                    bloqueado_ia: true,
                    fuera_de_cobertura: Boolean(evaluacion.fueraDeCobertura),
                    veredicto: 'RECHAZADA',
                    confianza: evaluacion.puntuacionConfianza,
                    ticket: null,
                    estado: evaluacion.fueraDeCobertura ? 'FUERA_DE_COBERTURA' : 'RECHAZADO_IA',
                    motivo: motivoPrincipal,
                    observaciones: evaluacion.observaciones,
                    motivos: evaluacion.motivos,
                    metricas: evaluacion.metricas
                });
            }

            // 3. Preparar payload validado con estado y observaciones decididas por el agente
            const payloadFinal = {
                ...datos,
                estado: evaluacion.estadoAsignado,
                observacion_cierre: evaluacion.observaciones
            };

            // 4. Enviar a Ecoruta Backend (donde se pre-asignará chofer sugerido para aprobación del gestor)
            const respuestaBackend = await enviarDenunciaAEcoruta(payloadFinal);

            // 5. Responder al cliente
            res.status(201).json({
                success: true,
                valido: true,
                bloqueado_ia: false,
                veredicto: evaluacion.veredicto,
                confianza: evaluacion.puntuacionConfianza,
                ticket: respuestaBackend.denuncia.ticket,
                estado: respuestaBackend.denuncia.estado || evaluacion.estadoAsignado,
                chofer_sugerido_id: respuestaBackend.denuncia.chofer_sugerido_id || null,
                chofer_sugerido_nombre: respuestaBackend.denuncia.chofer_sugerido_nombre || null,
                observaciones: evaluacion.observaciones,
                motivos: evaluacion.motivos,
                metricas: evaluacion.metricas,
                denuncia: respuestaBackend.denuncia
            });

        } catch (err) {
            console.error('❌ Error procesando y enviando reporte:', err.message);
            res.status(500).json({
                success: false,
                error: err.message
            });
        }
    });

    // ------------------------------------------------------------------
    // GET /api/denuncias/mis-tickets (Historial de tickets del ciudadano)
    // ------------------------------------------------------------------
    app.get('/api/denuncias/mis-tickets', async (req, res) => {
        try {
            const ciudadano = req.query.ciudadano || '';
            const resultado = await listarTicketsCiudadano(ciudadano);
            res.json(resultado);
        } catch (err) {
            console.error('❌ Error listando tickets de ciudadano:', err.message);
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // ------------------------------------------------------------------
    // GET /api/denuncias/rastreo/:ticket (Consulta y tracking para el ciudadano)
    // ------------------------------------------------------------------
    app.get('/api/denuncias/rastreo/:ticket', async (req, res) => {
        try {
            const ticket = req.params.ticket;
            const resultado = await consultarTicketEcoruta(ticket);
            if (!resultado.success) {
                return res.status(404).json(resultado);
            }
            res.json(resultado);
        } catch (err) {
            console.error('❌ Error en consulta de ticket:', err.message);
            res.status(500).json({ success: false, error: err.message });
        }
    });

    return app;
}

module.exports = { createAgentServer };
