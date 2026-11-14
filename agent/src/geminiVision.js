const fs = require('fs');
const path = require('path');
const config = require('./config');

/**
 * Obtiene el buffer y mime-type de una imagen (sea archivo local, base64 o URL)
 */
async function obtenerImagenBase64(datos) {
    // 1. Archivo local guardado por multer o ruta directa
    if (datos.foto_archivo_local && fs.existsSync(datos.foto_archivo_local)) {
        const ext = path.extname(datos.foto_archivo_local).toLowerCase();
        let mime = 'image/jpeg';
        if (ext === '.png') mime = 'image/png';
        if (ext === '.webp') mime = 'image/webp';
        const buffer = fs.readFileSync(datos.foto_archivo_local);
        return { base64: buffer.toString('base64'), mime };
    }

    // 2. Base64 directo (en foto_base64 o en foto_url)
    const rawB64 = (datos.foto_base64 && typeof datos.foto_base64 === 'string')
        ? datos.foto_base64
        : ((datos.foto_url && typeof datos.foto_url === 'string' && datos.foto_url.startsWith('data:image/')) ? datos.foto_url : null);
    if (rawB64) {
        const match = rawB64.match(/^data:(image\/\w+);base64,(.+)$/);
        if (match) {
            return { mime: match[1], base64: match[2] };
        }
        return { mime: 'image/jpeg', base64: rawB64 };
    }

    // 3. Foto URL local (ej. http://localhost:.../uploads/...) o externa
    if (datos.foto_url && typeof datos.foto_url === 'string') {
        // Si es una URL de uploads local
        const uploadsMatch = datos.foto_url.match(/\/uploads\/([^/?#]+)/);
        if (uploadsMatch) {
            const localFile = path.resolve(__dirname, '../uploads', uploadsMatch[1]);
            if (fs.existsSync(localFile)) {
                const ext = path.extname(localFile).toLowerCase();
                let mime = ext === '.png' ? 'image/png' : (ext === '.webp' ? 'image/webp' : 'image/jpeg');
                const buffer = fs.readFileSync(localFile);
                return { base64: buffer.toString('base64'), mime };
            }
        }

        // Descarga externa por HTTP si es remota
        if (/^https?:\/\//i.test(datos.foto_url)) {
            try {
                const res = await fetch(datos.foto_url, { signal: AbortSignal.timeout(6000) });
                if (res.ok) {
                    const arrayBuf = await res.arrayBuffer();
                    const mime = res.headers.get('content-type') || 'image/jpeg';
                    return { base64: Buffer.from(arrayBuf).toString('base64'), mime };
                }
            } catch (err) {
                console.warn('⚠️ No se pudo descargar imagen externa para Gemini:', err.message);
            }
        }
    }

    return null;
}

/**
 * Analiza la foto y la coherencia de la denuncia utilizando Gemini 2.5 Flash
 */
async function validarDenunciaConGemini(datos) {
    const apiKey = config.geminiApiKey;
    if (!apiKey) {
        return {
            ejecutado: false,
            motivo: 'GEMINI_API_KEY no configurada'
        };
    }

    const imgData = await obtenerImagenBase64(datos);
    if (!imgData) {
        return {
            ejecutado: false,
            motivo: 'No se suministró imagen válida para análisis visual'
        };
    }

    const prompt = `
Eres el agente perito forense de validación de imágenes y denuncias ciudadanas de recolección de residuos urbanos para el sistema EcoRuta de la Municipalidad de Asunción.
Audita rigurosamente la imagen adjunta como PERITO FORENSE DIGITAL para determinar si es una fotografía real capturada en vivo con la cámara del teléfono en la vía pública, o si es una FALSA DENUNCIA / FOTO DE INTERNET / ARCHIVO (STOCK PHOTO) / CAPTURA DE PANTALLA / SPAM.

Datos reportados por el ciudadano:
- Categoría denunciada: "${datos.categoria || 'VERTEDERO_CLANDESTINO'}"
- Descripción: "${datos.descripcion || ''}"
- Barrio / Ubicación: "${datos.barrio || 'Sin especificar'}"
- Fuente de captura declarada: "${datos.fuente_captura || 'CAMERA_LIVE'}"
- Timestamp de captura: "${datos.timestamp_captura || 'No especificado'}"

CRITERIOS FORENSES DE RECHAZO ESTRICTO (es_valida: false, es_falsa_denuncia: true):
1. FOTOS DESCARGADAS DE INTERNET / GOOGLE / STOCK PHOTOS: Rechaza cualquier imagen que parezca foto de archivo o banco de imágenes (Shutterstock, Getty, Freepik, prensa web), iluminación profesional de estudio, composición publicitaria, o escenarios claramente de otro país/ciudad (camiones, matrículas, señalética en otro idioma o arquitectura ajena a Paraguay).
2. CAPTURAS DE PANTALLA (SCREENSHOTS) O FOTOS A OTRA PANTALLA: Rechaza imágenes con bordes de navegador web, barras de estado de celular (batería, hora, señal), botones de interfaz de redes sociales/buscadores, marcas de agua, textos superpuestos, o artefactos de píxeles/efecto moiré por haberle tomado foto a un monitor de computadora o televisor.
3. ARTEFACTOS DE COMPRESIÓN WEB O RECORTE ARTIFICIAL: Rechaza imágenes con marcos blancos/negros de recorte, miniaturas pixeladas descargadas de Google Images o memes.
4. AUSENCIA DE INCIDENCIA REAL DE RESIDUOS: La imagen NO muestra residuos, basura, escombros, ramas de poda, contenedores rebasados o animales muertos en vía pública (ej: selfies, interiores de casas, oficinas, mascotas vivas, calles limpias, fotos negras o totalmente borrosas).
5. CONTRADICCIÓN CON EL REPORTE: La imagen contradice flagrantemente la descripción o busca burlar el sistema.

CRITERIOS DE DENUNCIA VÁLIDA (es_valida: true, es_falsa_denuncia: false):
1. Es una fotografía auténtica tomada en el lugar de los hechos con cámara móvil en vivo (perspectiva natural a nivel de calle, sin marcas de agua ni bordes de pantalla).
2. Se observan claramente residuos sólidos, bolsas de basura amontonadas, vertederos clandestinos, contenedores desbordados, restos de poda o escombros en la vía pública que requieren recolección municipal.

Responde ÚNICAMENTE en JSON con el siguiente esquema estricto:
{
  "es_falsa_denuncia": boolean,
  "es_valida": boolean,
  "es_foto_internet_o_captura": boolean,
  "confianza": number, // entre 0.0 y 1.0
  "categoria_detectada": string, // "VERTEDERO_CLANDESTINO", "CONTENEDOR_LLENO", "RESIDUO_VOLUMINOSO", "RESTOS_PODA", "ANIMAL_MUERTO", "FOTO_INTERNET_STOCK", u "OTRO"
  "elementos_visibles": string[],
  "justificacion": string, // explicación forense concisa de lo observado
  "motivo_rechazo": string | null // si es falsa denuncia o foto de internet/pantalla, explicar claramente por qué fue bloqueada
}
`;

    const modelosCandidatos = [
        'gemini-2.5-flash',
        'gemini-2.0-flash',
        'gemini-flash-lite-latest'
    ];

    const requestBody = {
        contents: [
            {
                role: 'user',
                parts: [
                    { text: prompt },
                    {
                        inline_data: {
                            mime_type: imgData.mime,
                            data: imgData.base64
                        }
                    }
                ]
            }
        ],
        generationConfig: {
            temperature: 0.1,
            response_mime_type: 'application/json'
        }
    };

    let ultimoError = null;
    for (const modelo of modelosCandidatos) {
        try {
            const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent?key=${apiKey}`;
            const res = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody),
                signal: AbortSignal.timeout(10000)
            });

            if (!res.ok) {
                const errText = await res.text();
                ultimoError = `HTTP ${res.status} (${modelo}): ${errText}`;
                continue; // intentar siguiente modelo
            }

            const data = await res.json();
            const rawJsonText = data.candidates?.[0]?.content?.parts?.[0]?.text;
            if (!rawJsonText) {
                ultimoError = `Respuesta vacía de ${modelo}`;
                continue;
            }

            const parsed = JSON.parse(rawJsonText);
            return {
                ejecutado: true,
                modelo,
                ...parsed
            };
        } catch (err) {
            ultimoError = `${modelo}: ${err.message}`;
        }
    }

    console.error('❌ Error en consulta a Gemini Vision:', ultimoError);
    return {
        ejecutado: false,
        error: ultimoError
    };
}

module.exports = {
    validarDenunciaConGemini,
    obtenerImagenBase64
};
