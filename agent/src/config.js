const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const config = {
    ecorutaBackendUrl: (process.env.ECORUTA_BACKEND_URL || 'http://localhost:8085').replace(/\/$/, ''),
    port: parseInt(process.env.PORT || '5050', 10),
    databaseUrl: process.env.DATABASE_URL || 'postgresql://postgres:Zelaya11@localhost:5432/ruteo_db',
    minConfidence: parseFloat(process.env.AGENT_MIN_CONFIDENCE || '0.70'),
    duplicateRadiusMeters: parseInt(process.env.AGENT_DUPLICATE_RADIUS_METERS || '150', 10),
    duplicateWindowHours: parseInt(process.env.AGENT_DUPLICATE_WINDOW_HOURS || '48', 10),
    geoBounds: {
        latMin: -25.368,
        latMax: -25.225,
        lonMin: -57.675,
        lonMax: -57.520
    },
    // Polígono estricto del límite municipal de Asunción, Paraguay
    // (Río Paraguay al Oeste/Norte, Arroyo Itay/Loma Pytá excluyendo Mariano Roque Alonso y Luque al Noreste/Este,
    // Av. Mme. Lynch/Calle Última/Defensores del Chaco excluyendo Fernando de la Mora al Sureste,
    // y Av. Cacique Lambaré/Itá Enramada excluyendo Lambaré al Sur)
    asuncionPolygon: [
        [-25.2750, -57.6680], // Ita Pyta Punta / Río Paraguay Oeste
        [-25.2660, -57.6420], // Bahía de Asunción / Chacarita Norte
        [-25.2420, -57.6050], // Banco San Miguel
        [-25.2250, -57.5750], // Zeballos Cué Norte (Ribera Río Paraguay)
        [-25.2340, -57.5540], // Límite Zeballos Cué / Sur de Mariano Roque Alonso
        [-25.2460, -57.5410], // Loma Pytá / Arroyo Itay (excluye Mariano Roque Alonso)
        [-25.2630, -57.5350], // Ñu Guasú / Arroyo Itay (excluye Luque)
        [-25.2850, -57.5370], // Av. Madame Lynch / CIT
        [-25.3030, -57.5410], // Av. Madame Lynch / Mcal. López
        [-25.3190, -57.5550], // Calle Última / Ruta Mcal. Estigarribia (excluye Fdo. de la Mora)
        [-25.3350, -57.5720], // 4 Mojones / Av. Defensores del Chaco
        [-25.3260, -57.5920], // Límite Norte de Lambaré / Av. Gral. Santos
        [-25.3330, -57.6160], // Límite Cerro Lambaré / Av. Perón
        [-25.3520, -57.6370], // Itá Enramada Sur / Río Paraguay
        [-25.3250, -57.6560]  // Bañado Sur / Río Paraguay
    ],
    geminiApiKey: process.env.GEMINI_API_KEY || ''
};

module.exports = config;
