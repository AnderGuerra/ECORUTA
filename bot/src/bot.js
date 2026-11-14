const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');

const { Telegraf, Markup } = require('telegraf');
const config = require('./config');
const { getDriverByTelegramId, getDriverByZone, registerOrUpdateDriver } = require('./drivers');
const { actualizarEstadoDenuncia, obtenerDenunciaPorId, obtenerCoordenadasRuta, actualizarEstadoRuta } = require('./db');

let bot = null;

const MOTIVOS_RECHAZO = {
    camion_lleno: 'Camión Lleno / Capacidad Máxima Alcanzada',
    fuera_camino: 'Ruta Fuera de Camino / Vía Inaccesible para Camión',
    desperfecto: 'Desperfecto Mecánico del Vehículo',
    fin_turno: 'Fin de Turno / Fuera de Horario Laboral'
};

/**
 * Inicializa y configura la instancia de Telegraf
 */
function initBot() {
    if (!config.telegramToken || config.telegramToken.trim() === '' || config.telegramToken.includes('123456789:ABCdef')) {
        console.warn('⚠️ [Telegram Bot]: TELEGRAM_BOT_TOKEN no configurado o es de ejemplo. El bot operará en modo Simulación/HTTP.');
        return null;
    }

    try {
        bot = new Telegraf(config.telegramToken);

        bot.use(async (ctx, next) => {
            if (ctx.from) {
                console.log(`📩 [Telegram Incoming] Mensaje de ${ctx.from.first_name} (ID: ${ctx.from.id})`);
            }
            return next();
        });

        bot.command('start', async (ctx) => {
            const telegramId = String(ctx.from.id);
            const isTestDriver = telegramId === config.testDriverTelegramId;
            const firstName = ctx.from.first_name || 'Conductor';

            const driverData = registerOrUpdateDriver(telegramId, {
                nombre: `${firstName} ${ctx.from.last_name || ''}`.trim(),
                zona: config.defaultZone,
                vehiculo: 'Camión Recolector #01',
                activo: true
            });

            let mensajeBienvenida = '';
            if (isTestDriver) {
                mensajeBienvenida = `🚛 *¡HOLA, ${firstName.toUpperCase()}! (CONDUCTOR DE PRUEBAS REGISTRADO)*\n\n` +
                    `✅ *ID de Telegram:* \`${telegramId}\`\n` +
                    `📍 *Zona Asignada:* *${driverData.zona}*\n` +
                    `🚚 *Vehículo:* ${driverData.vehiculo}\n` +
                    `🟢 *Estado:* ACTIVO Y LISTO PARA DESPACHO\n\n` +
                    `Has sido vinculado exitosamente al sistema de recolección inteligente de *NEXO EcoRuta*.\n` +
                    `Cuando se asuma o registre una denuncia en tu zona, recibirás aquí los avisos con ubicación y mapa interactivo.`;
            } else {
                mensajeBienvenida = `🚛 *¡BIENVENIDO AL SISTEMA DE CONDUCTORES NEXO!* \n\n` +
                    `👤 *Conductor:* ${driverData.nombre}\n` +
                    `🆔 *Telegram ID:* \`${telegramId}\`\n` +
                    `📍 *Zona Asignada:* *${driverData.zona}*\n` +
                    `🟢 *Estado:* REGISTRADO\n\n` +
                    `Usa /estado para consultar tu información operativa.`;
            }

            await ctx.replyWithMarkdown(mensajeBienvenida, {
                ...Markup.keyboard([
                    ['📋 Mi Estado Operativo', '📍 Ver Mi Zona']
                ]).resize()
            });
        });

        bot.command('estado', async (ctx) => {
            await responderEstadoConductor(ctx);
        });

        bot.hears('📋 Mi Estado Operativo', async (ctx) => {
            await responderEstadoConductor(ctx);
        });

        bot.hears('📍 Ver Mi Zona', async (ctx) => {
            const driver = getDriverByTelegramId(ctx.from.id);
            const zona = driver ? driver.zona : config.defaultZone;
            await ctx.reply(`📍 Tu zona asignada para recolección es: ${zona}`);
        });

        // ----------------------------------------------------
        // EVENTOS DE BOTONES INLINE: Aceptar Recolección (Denuncia Individual)
        // ----------------------------------------------------
        bot.action(/^accept_(\d+)$/, async (ctx) => {
            const denunciaId = ctx.match[1];
            console.log(`⚡ [Bot Action]: Conductor ${ctx.from.id} aceptó la denuncia #${denunciaId}`);

            await actualizarEstadoDenuncia(
                denunciaId,
                'en_proceso',
                `Aceptada por conductor Telegram ID ${ctx.from.id} a las ${new Date().toLocaleTimeString('es-PY')}`
            );

            await ctx.answerCbQuery('✅ ¡Recolección asumida! Dirígete al punto indicado.', { show_alert: true });

            const denuncia = await obtenerDenunciaPorId(denunciaId);
            const direccion = denuncia ? (denuncia.direccion_referencia || denuncia.barrio || 'Punto reportado') : 'Punto reportado';
            const tieneCoords = denuncia && denuncia.latitud != null && denuncia.longitud != null;
            const coordsTexto = tieneCoords ? `${denuncia.latitud}, ${denuncia.longitud}` : 'Ver en panel';
            const gmapsUrl = tieneCoords
                ? `https://www.google.com/maps?q=${denuncia.latitud},${denuncia.longitud}`
                : `http://localhost:8085/chofer.html`;

            const textoActualizado = `🚚 *RECOLECCIÓN EN CAMINO - DENUNCIA #${denunciaId}*\n\n` +
                `📍 *Lugar:* ${direccion}\n` +
                `🗺️ *Coordenadas GPS:* \`${coordsTexto}\`\n` +
                `👤 *Conductor asignado:* ${ctx.from.first_name || 'Conductor'}\n` +
                `⏰ *Hora de aceptación:* ${new Date().toLocaleTimeString('es-PY')}\n` +
                `📌 *Estado actual:* *EN PROCESO / EN CAMINO*\n\n` +
                `👉 *Cuando llegues y recojas los residuos, presiona el botón inferior para finalizar la orden.*`;

            await editMessageOrCaption(ctx, textoActualizado, {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([
                    [Markup.button.callback('🏁 Marcar como Recolectado', `complete_${denunciaId}`)],
                    [Markup.button.url('🗺️ Abrir en Google Maps / GPS', gmapsUrl)]
                ])
            });
        });

        // ----------------------------------------------------
        // EVENTOS DE BOTONES INLINE: Marcar como Recolectado
        // ----------------------------------------------------
        bot.action(/^complete_(\d+)$/, async (ctx) => {
            const denunciaId = ctx.match[1];
            console.log(`🏁 [Bot Action]: Conductor ${ctx.from.id} completó la recolección #${denunciaId}`);

            await actualizarEstadoDenuncia(
                denunciaId,
                'cerrada',
                `Recolectado y finalizado por conductor Telegram ID ${ctx.from.id} a las ${new Date().toLocaleTimeString('es-PY')}`
            );

            await ctx.answerCbQuery('🎉 ¡Excelente trabajo! Denuncia cerrada en el sistema.', { show_alert: true });

            const textoFinalizado = `🏁 *RECOLECCIÓN FINALIZADA CON ÉXITO - DENUNCIA #${denunciaId}* ✅\n\n` +
                `👤 *Conductor:* ${ctx.from.first_name || 'Conductor'}\n` +
                `🕒 *Hora de Cierre:* ${new Date().toLocaleTimeString('es-PY')} - ${new Date().toLocaleDateString('es-PY')}\n` +
                `📌 *Estado en el Sistema:* *RESUELTO / FINALIZADO (CERRADA)*\n\n` +
                `✨ *El punto de acopio ha quedado limpio y registrado en el panel central de EcoRuta.*`;

            await editMessageOrCaption(ctx, textoFinalizado, { parse_mode: 'Markdown' });
        });

        // ----------------------------------------------------
        // EVENTOS DE BOTONES INLINE: Menú de Motivos de Rechazo para Denuncia Individual
        // ----------------------------------------------------
        bot.action(/^reject_(\d+)$/, async (ctx) => {
            const denunciaId = ctx.match[1];
            console.log(`⚠️ [Bot Action]: Conductor ${ctx.from.id} abrió menú de rechazo para denuncia #${denunciaId}`);
            await ctx.answerCbQuery();

            const textoMenu = `⚠️ *RECHAZO DE ORDEN DE RECOLECCIÓN #${denunciaId}*\n\n` +
                `👤 *Chofer:* ${ctx.from.first_name || 'Conductor'}\n` +
                `Selecciona el motivo del rechazo para notificar al Centro de Despacho y reasignar la unidad:`;

            await editMessageOrCaption(ctx, textoMenu, {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([
                    [Markup.button.callback('🚛 Camión Lleno / Capacidad Máxima', `rej_den_${denunciaId}_camion_lleno`)],
                    [Markup.button.callback('🚧 Ruta Fuera de Camino / Inaccesible', `rej_den_${denunciaId}_fuera_camino`)],
                    [Markup.button.callback('⚠️ Desperfecto Mecánico', `rej_den_${denunciaId}_desperfecto`)],
                    [Markup.button.callback('⏱️ Fin de Turno / Fuera de Horario', `rej_den_${denunciaId}_fin_turno`)],
                    [Markup.button.callback('🔙 Cancelar (Aceptar)', `accept_${denunciaId}`)]
                ])
            });
        });

        bot.action(/^rej_den_(\d+)_([a-zA-Z0-9_]+)$/, async (ctx) => {
            const denunciaId = ctx.match[1];
            const codigoMotivo = ctx.match[2];
            const motivoTexto = MOTIVOS_RECHAZO[codigoMotivo] || 'Ruta no factible de realizar en este momento';

            console.log(`❌ [Bot Action]: Conductor ${ctx.from.id} rechazó denuncia #${denunciaId} por: ${motivoTexto}`);

            await actualizarEstadoDenuncia(
                denunciaId,
                `Rechazado: ${motivoTexto}`,
                `Rechazado por chofer Telegram ID ${ctx.from.id}: ${motivoTexto}`,
                motivoTexto
            );

            await ctx.answerCbQuery(`⚠️ Rechazado: ${motivoTexto}`, { show_alert: true });

            const textoRechazado = `❌ *ORDEN DE RECOLECCIÓN RECHAZADA - DENUNCIA #${denunciaId}*\n\n` +
                `👤 *Conductor:* ${ctx.from.first_name || 'Conductor'}\n` +
                `⚠️ *Motivo Indicado:* *${motivoTexto}*\n` +
                `🕒 *Hora:* ${new Date().toLocaleTimeString('es-PY')}\n\n` +
                `📢 *Alerta prioritaria enviada al despachador central para reasignar inmediatamente a otro camión.*`;

            await editMessageOrCaption(ctx, textoRechazado, { parse_mode: 'Markdown' });
        });

        // ----------------------------------------------------
        // EVENTOS DE RUTA COMPLETA: Aceptar Ruta
        // ----------------------------------------------------
        bot.action(/^acc_route_([a-zA-Z0-9]+)$/, async (ctx) => {
            const token = ctx.match[1];
            console.log(`⚡ [Bot Action]: Chofer ${ctx.from.id} ACEPTÓ la ruta ${token}`);

            await actualizarEstadoRuta(token, 'en_curso', `Aceptada por Telegram ID ${ctx.from.id}`);
            await ctx.answerCbQuery('✅ ¡Ruta aceptada! Iniciando itinerario de recolección.', { show_alert: true });

            // Obtener las coordenadas exactas del ticket/ruta desde PostgreSQL
            const infoCoords = await obtenerCoordenadasRuta(token);
            const tieneCoords = infoCoords && !isNaN(infoCoords.latitud) && !isNaN(infoCoords.longitud);
            const coordsStr = tieneCoords ? `${infoCoords.latitud}, ${infoCoords.longitud}` : 'Ver hoja de ruta';
            const gmapsNavUrl = tieneCoords
                ? `https://www.google.com/maps?q=${infoCoords.latitud},${infoCoords.longitud}`
                : `http://localhost:8085/ruta.html?token=${token}`;

            const textoAceptado = `🚚 *¡RUTA ACEPTADA EN CURSO!* 🚛\n\n` +
                `👤 *Chofer:* ${ctx.from.first_name || 'Conductor'}\n` +
                `🎫 *Token de Ruta:* \`${token}\`${infoCoords && infoCoords.ticket ? ` (Ticket: \`${infoCoords.ticket}\`)` : ''}\n` +
                `📍 *Coordenadas GPS Exactas:* \`${coordsStr}\`\n` +
                `⏰ *Hora de Aceptación:* ${new Date().toLocaleTimeString('es-PY')}\n` +
                `📌 *Estado:* *EN CAMINO / RECOLECCIÓN ACTIVA*\n\n` +
                `✨ *Cuando termines todas las paradas asignadas, presiona el botón inferior para finalizar la hoja de ruta.*`;

            await editMessageOrCaption(ctx, textoAceptado, {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([
                    [Markup.button.callback('🏁 Marcar Ruta como Finalizada', `fin_route_${token}`)],
                    [Markup.button.url('🗺️ Abrir Navegación en Google Maps', gmapsNavUrl)]
                ])
            });
        });

        // ----------------------------------------------------
        // EVENTOS DE RUTA COMPLETA: Finalizar Recorrido
        // ----------------------------------------------------
        bot.action(/^fin_route_([a-zA-Z0-9]+)$/, async (ctx) => {
            const token = ctx.match[1];
            console.log(`🏁 [Bot Action]: Chofer ${ctx.from.id} FINALIZÓ la ruta ${token}`);

            await actualizarEstadoRuta(token, 'finalizada', `Finalizada por Telegram ID ${ctx.from.id}`);
            await ctx.answerCbQuery('🎉 ¡Excelente trabajo! Hoja de ruta completada y cerrada.', { show_alert: true });

            const textoFinalizado = `🏁 *¡HOJA DE RUTA COMPLETADA CON ÉXITO!* ✅\n\n` +
                `👤 *Chofer:* ${ctx.from.first_name || 'Conductor'}\n` +
                `🎫 *Token:* \`${token}\`\n` +
                `🕒 *Hora de Cierre:* ${new Date().toLocaleTimeString('es-PY')} - ${new Date().toLocaleDateString('es-PY')}\n` +
                `📌 *Estado:* *FINALIZADA / RECOLECTADA*\n\n` +
                `🚛 *Todos los puntos y denuncias han sido registrados como completados en la central de EcoRuta.*`;

            await editMessageOrCaption(ctx, textoFinalizado, { parse_mode: 'Markdown' });
        });

        // ----------------------------------------------------
        // EVENTOS DE RUTA COMPLETA: Menú de Motivos de Rechazo
        // ----------------------------------------------------
        bot.action(/^rej_route_menu_([a-zA-Z0-9]+)$/, async (ctx) => {
            const token = ctx.match[1];
            console.log(`⚠️ [Bot Action]: Chofer ${ctx.from.id} abrió menú de rechazo para ruta ${token}`);
            await ctx.answerCbQuery();

            const textoMenu = `⚠️ *RECHAZO DE HOJA DE RUTA* 🎫 \`${token}\`\n\n` +
                `👤 *Chofer:* ${ctx.from.first_name || 'Conductor'}\n` +
                `Por favor, selecciona el motivo específico para informar al centro de operaciones:`;

            await editMessageOrCaption(ctx, textoMenu, {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([
                    [Markup.button.callback('🚛 Camión Lleno / Capacidad Máxima', `rej_reason_${token}_camion_lleno`)],
                    [Markup.button.callback('🚧 Ruta Fuera de Camino / Inaccesible', `rej_reason_${token}_fuera_camino`)],
                    [Markup.button.callback('⚠️ Desperfecto Mecánico', `rej_reason_${token}_desperfecto`)],
                    [Markup.button.callback('⏱️ Fin de Turno / Fuera de Horario', `rej_reason_${token}_fin_turno`)],
                    [Markup.button.callback('🔙 Cancelar (Volver)', `acc_route_${token}`)]
                ])
            });
        });

        // ----------------------------------------------------
        // EVENTOS DE RUTA COMPLETA: Confirmación de Rechazo con Motivo
        // ----------------------------------------------------
        bot.action(/^rej_reason_([a-zA-Z0-9]+)_([a-zA-Z0-9_]+)$/, async (ctx) => {
            const token = ctx.match[1];
            const codigoMotivo = ctx.match[2];

            const motivoTexto = MOTIVOS_RECHAZO[codigoMotivo] || 'Ruta no factible de realizar en este momento';
            console.log(`❌ [Bot Action]: Chofer ${ctx.from.id} rechazó ruta ${token} por: ${motivoTexto}`);

            // Actualizar en BD: marca ticket con "Rechazado: <Motivo>" y guarda al chofer en historial de descartados
            await actualizarEstadoRuta(token, 'rechazada_chofer', motivoTexto);

            await ctx.answerCbQuery(`⚠️ Ruta rechazada: ${motivoTexto}`, { show_alert: true });

            const textoRechazoFinal = `❌ *HOJA DE RUTA RECHAZADA* ❌\n\n` +
                `🎫 *Token de Ruta:* \`${token}\`\n` +
                `👤 *Chofer:* ${ctx.from.first_name || 'Conductor'}\n` +
                `⚠️ *Motivo Indicado:* *${motivoTexto}*\n` +
                `🕒 *Hora de Notificación:* ${new Date().toLocaleTimeString('es-PY')}\n\n` +
                `📢 *Se ha notificado al despachador central para reasignar inmediatamente los puntos y denuncias a otro camión.*`;

            await editMessageOrCaption(ctx, textoRechazoFinal, { parse_mode: 'Markdown' });
        });

        bot.catch((err, ctx) => {
            console.error(`💥 [Telegraf Error] en handler para update ${ctx.updateType}:`, err);
        });

        return bot;
    } catch (err) {
        console.error('❌ Error al inicializar bot Telegraf:', err.message);
        return null;
    }
}

async function responderEstadoConductor(ctx) {
    const driver = getDriverByTelegramId(ctx.from.id);
    const zona = driver ? driver.zona : config.defaultZone;
    const vehiculo = driver ? driver.vehiculo : 'Camión Recolector #01';
    const activo = driver ? (driver.activo ? '🟢 Activo' : '🔴 Inactivo') : '🟢 Activo';

    const info = `📋 *ESTADO OPERATIVO DEL CONDUCTOR*\n\n` +
        `👤 *Nombre:* ${ctx.from.first_name || 'Conductor'} ${ctx.from.last_name || ''}\n` +
        `🆔 *Telegram ID:* \`${ctx.from.id}\`\n` +
        `📍 *Zona Asignada:* *${zona}*\n` +
        `🚚 *Móvil Asignado:* ${vehiculo}\n` +
        `⚡ *Disponibilidad:* ${activo}\n\n` +
        `_Listo para recibir asignaciones automáticas de recolección._`;

    await ctx.replyWithMarkdown(info);
}

/**
 * Permite editar el mensaje tanto si fue enviado con foto (caption) como si fue texto normal
 */
async function editMessageOrCaption(ctx, text, extra = {}) {
    const isPhoto = Boolean(
        ctx.callbackQuery &&
        ctx.callbackQuery.message &&
        (ctx.callbackQuery.message.photo || ctx.callbackQuery.message.caption !== undefined)
    );

    try {
        if (isPhoto) {
            return await ctx.editMessageCaption(text, extra);
        } else {
            return await ctx.editMessageText(text, extra);
        }
    } catch (err) {
        console.warn('⚠️ Intento de edición principal falló, intentando método inverso:', err.message);
        if (isPhoto) {
            return await ctx.editMessageText(text, extra);
        } else {
            return await ctx.editMessageCaption(text, extra);
        }
    }
}

/**
 * Despacha proactivamente una denuncia al conductor correspondiente en Telegram
 */
async function despacharDenunciaAConductor(datosDenuncia) {
    let {
        denunciaId,
        ticket = `DEN-${denunciaId}`,
        zona = config.defaultZone,
        direccion = 'Sin dirección especificada',
        descripcion = 'Acumulación de residuos en vía pública',
        latitud = null,
        longitud = null,
        fotoUrl = null,
        telegramId = null
    } = datosDenuncia;

    // Si no vinieron coordenadas en el payload, recuperarlas directamente desde PostgreSQL
    if ((latitud === null || longitud === null || isNaN(parseFloat(latitud)) || isNaN(parseFloat(longitud))) && denunciaId) {
        const denDb = await obtenerDenunciaPorId(denunciaId);
        if (denDb) {
            latitud = denDb.latitud;
            longitud = denDb.longitud;
            if (!direccion || direccion === 'Sin dirección especificada') {
                direccion = denDb.direccion_referencia || denDb.barrio || direccion;
            }
        }
    }

    const latNum = parseFloat(latitud);
    const lonNum = parseFloat(longitud);
    if (isNaN(latNum) || isNaN(lonNum)) {
        throw new Error(`La denuncia #${denunciaId} no posee coordenadas GPS válidas para despachar`);
    }

    const conductor = getDriverByZone(zona);
    const targetChatId = (telegramId && String(telegramId).trim()) || (conductor ? conductor.telegramId : config.testDriverTelegramId);

    if (!targetChatId) {
        throw new Error(`No se encontró un Telegram Chat ID para la zona '${zona}'`);
    }

    const gmapsUrl = `https://www.google.com/maps?q=${latNum},${lonNum}`;

    const mensajeAlerta = `🚨 *¡NUEVA ALERTA DE RECOLECCIÓN DE BASURA!* 🚨\n\n` +
        `🎫 *Ticket / Ref:* \`${ticket}\` (ID: #${denunciaId})\n` +
        `📍 *Zona Operativa:* *${zona}*\n` +
        `📌 *Dirección:* ${direccion}\n` +
        `📝 *Descripción:* ${descripcion}\n` +
        `🗺️ *Coordenadas GPS Exactas:* \`${latNum}, ${lonNum}\`\n` +
        `🔗 *Google Maps:* [Abrir ubicación exacta](${gmapsUrl})\n\n` +
        `Selecciona una opción para responder al despacho:`;

    const inlineButtons = [
        [
            Markup.button.callback('✅ Aceptar Recolección', `accept_${denunciaId}`),
            Markup.button.callback('❌ Rechazar (Elegir Motivo)', `reject_${denunciaId}`)
        ],
        [
            Markup.button.url('🗺️ Ver en Mapa / Navegar', gmapsUrl)
        ]
    ];
    if (fotoUrl && fotoUrl.startsWith('http')) {
        inlineButtons[1].push(Markup.button.url('📷 Ver Foto', fotoUrl));
    }

    const botones = Markup.inlineKeyboard(inlineButtons);

    if (bot) {
        try {
            const sentMessage = await bot.telegram.sendMessage(targetChatId, mensajeAlerta, {
                parse_mode: 'Markdown',
                ...botones
            });

            try {
                if (latitud && longitud) {
                    await bot.telegram.sendLocation(targetChatId, parseFloat(latitud), parseFloat(longitud));
                }
            } catch (locErr) {
                console.warn('⚠️ No se pudo enviar pin de ubicación nativa:', locErr.message);
            }

            return {
                enviado: true,
                targetChatId,
                conductor: conductor ? conductor.nombre : 'Conductor Asignado',
                zona,
                messageId: sentMessage.message_id
            };
        } catch (tgError) {
            console.error(`❌ Error enviando mensaje por Telegram a Chat ID ${targetChatId}:`, tgError.message);
            return {
                enviado: false,
                targetChatId,
                conductor: conductor ? conductor.nombre : 'Conductor Asignado',
                error: tgError.message,
                simulado: false
            };
        }
    } else {
        console.log(`📢 [MODO SIMULACIÓN DESPACHO] Alerta generada para Telegram Chat ID ${targetChatId} (${zona}):`);
        return {
            enviado: false,
            simulado: true,
            targetChatId,
            conductor: conductor ? conductor.nombre : 'Conductor Asignado',
            zona,
            mensaje: 'Despacho procesado en modo simulación (configura TELEGRAM_BOT_TOKEN en .env para entrega real).'
        };
    }
}

/**
 * Despacha una hoja de ruta completa generada a un conductor por Telegram
 */
async function despacharRutaAConductor(datosRuta) {
    const {
        movilNumero = 1,
        token = '',
        denunciaId = null,
        ticket = '',
        barrio = '',
        latitud = null,
        longitud = null,
        chofer = {},
        vehiculo = {},
        clientes = [],
        distanciaTotal = 0,
        tiempoEstimado = 0,
        seguimientoUrl = ''
    } = datosRuta;

    const choferNombre = chofer.nombre || 'Conductor Asignado';
    const choferTelefono = chofer.telefono || '0991194963';
    const vehiculoNombre = vehiculo.nombre ? `${vehiculo.nombre}${vehiculo.chapa ? ' (' + vehiculo.chapa + ')' : ''}` : 'Camión Recolector #01';
    const targetChatId = (chofer.telegramId && String(chofer.telegramId).trim()) || config.testDriverTelegramId || '8727434553';

    // Resolver las coordenadas reales exactas del reporte (nunca usar centro fijo por defecto)
    const primerCliente = clientes[0] || {};
    let realLat = parseFloat(latitud ?? primerCliente.latitud ?? primerCliente.lat);
    let realLon = parseFloat(longitud ?? primerCliente.longitud ?? primerCliente.lon);

    if (isNaN(realLat) || isNaN(realLon) || (realLat === 0 && realLon === 0)) {
        if (denunciaId) {
            const denDb = await obtenerDenunciaPorId(denunciaId);
            if (denDb && !isNaN(parseFloat(denDb.latitud)) && !isNaN(parseFloat(denDb.longitud))) {
                realLat = parseFloat(denDb.latitud);
                realLon = parseFloat(denDb.longitud);
            }
        }
        if ((isNaN(realLat) || isNaN(realLon)) && token) {
            const coordsDb = await obtenerCoordenadasRuta(token);
            if (coordsDb) {
                realLat = coordsDb.latitud;
                realLon = coordsDb.longitud;
            }
        }
    }

    const tieneCoordsReales = !isNaN(realLat) && !isNaN(realLon) && (realLat !== 0 || realLon !== 0);
    const gmapsNavUrl = tieneCoordsReales
        ? `https://www.google.com/maps?q=${realLat},${realLon}`
        : `http://localhost:8085/ruta.html?token=${token}`;

    let mensaje = `🚛 *¡NUEVA HOJA DE RUTA ASIGNADA (MÓVIL ${movilNumero})!* 🚛\n\n` +
        `👤 *Chofer:* ${choferNombre}\n` +
        `📱 *Teléfono:* \`${choferTelefono}\`\n` +
        `🚚 *Vehículo:* ${vehiculoNombre}\n` +
        `📍 *Distancia Total:* ${distanciaTotal} km (~${tiempoEstimado} min)\n` +
        `📦 *Paradas / Puntos:* ${clientes.length || 1}\n` +
        `🎫 *Token de Ruta:* \`${token}\`${ticket ? ` (Ticket: \`${ticket}\`)` : ''}\n`;

    if (tieneCoordsReales) {
        mensaje += `🗺️ *Coordenadas GPS Exactas:* \`${realLat}, ${realLon}\`\n` +
            `🔗 *Ubicación Directa:* [Abrir en Google Maps](${gmapsNavUrl})\n`;
    }

    mensaje += `\n🗺️ *ITINERARIO DE RECOLECCIÓN:*\n`;

    if (clientes.length > 0) {
        clientes.forEach((c, i) => {
            const lat = parseFloat(c.latitud ?? c.lat ?? realLat);
            const lon = parseFloat(c.longitud ?? c.lon ?? realLon);
            mensaje += `*${i + 1}.* ${c.nombre || 'Punto de recolección'}\n` +
                `   📌 Coords: \`${lat}, ${lon}\`\n` +
                `   📍 [Ver en Google Maps](https://www.google.com/maps?q=${lat},${lon})\n`;
        });
    } else if (tieneCoordsReales) {
        mensaje += `*1.* Ticket ${ticket || token} - ${barrio || 'Punto reportado'}\n` +
            `   📌 Coords: \`${realLat}, ${realLon}\`\n` +
            `   📍 [Ver en Google Maps](${gmapsNavUrl})\n`;
    }

    const rutaFinalUrl = seguimientoUrl || `http://localhost:8085/ruta.html?token=${token}`;
    mensaje += `\n🔗 *Panel de Navegación en Vivo:*\n${rutaFinalUrl}\n\n` +
        `_Toca el botón abajo para abrir la navegación GPS en Google Maps con las coordenadas exactas del reclamo._`;

    const botones = Markup.inlineKeyboard([
        [
            Markup.button.callback('✅ Aceptar Ruta', `acc_route_${token}`),
            Markup.button.callback('❌ Rechazar Ruta', `rej_route_menu_${token}`)
        ],
        [
            Markup.button.url('🗺️ Navegar en Google Maps', gmapsNavUrl)
        ]
    ]);

    if (bot) {
        try {
            const sent = await bot.telegram.sendMessage(targetChatId, mensaje, {
                parse_mode: 'Markdown',
                ...botones
            });

            // Enviar también el pin nativo de ubicación en Telegram con las coordenadas reales del reclamo
            if (tieneCoordsReales) {
                try {
                    await bot.telegram.sendLocation(targetChatId, realLat, realLon);
                } catch (locErr) {
                    console.warn('⚠️ No se pudo enviar pin de ubicación nativa en ruta:', locErr.message);
                }
            }

            console.log(`✅ [Telegram Dispatch]: Ruta ${token} despachada al chofer ${choferNombre} (ChatId: ${targetChatId}, Coords: ${realLat}, ${realLon})`);
            return {
                success: true,
                enviado: true,
                messageId: sent.message_id,
                targetChatId,
                chofer: choferNombre,
                token
            };
        } catch (tgErr) {
            console.error('❌ Error enviando ruta por Telegram:', tgErr.message);
            return {
                success: false,
                enviado: false,
                error: tgErr.message,
                token
            };
        }
    } else {
        return {
            success: true,
            simulado: true,
            targetChatId,
            chofer: choferNombre,
            token,
            mensaje: 'Bot en modo simulación / HTTP'
        };
    }
}

module.exports = {
    initBot,
    despacharDenunciaAConductor,
    despacharRutaAConductor,
    getBotInstance: () => bot
};
