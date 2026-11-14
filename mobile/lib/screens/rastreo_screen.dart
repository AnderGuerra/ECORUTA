import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import '../services/app_config.dart';
import '../services/auth_service.dart';

class RastreoScreen extends StatefulWidget {
  final bool standalone;
  final String? initialTicket;
  const RastreoScreen({
    super.key,
    this.standalone = false,
    this.initialTicket,
  });

  @override
  State<RastreoScreen> createState() => _RastreoScreenState();
}

class _RastreoScreenState extends State<RastreoScreen> {
  final TextEditingController _ticketController = TextEditingController();
  bool _buscando = false;
  bool _cargandoHistorial = false;
  Map<String, dynamic>? _denunciaEncontrada;
  List<Map<String, dynamic>> _misDenuncias = [];
  String? _errorMensaje;

  @override
  void initState() {
    super.initState();
    if (widget.initialTicket != null && widget.initialTicket!.isNotEmpty) {
      _ticketController.text = widget.initialTicket!;
      _buscarTicket();
    }
    _cargarMisDenuncias();
  }

  @override
  void dispose() {
    _ticketController.dispose();
    super.dispose();
  }

  Future<void> _cargarMisDenuncias() async {
    setState(() => _cargandoHistorial = true);
    final String ciudadano = AuthService().nombre ?? '';
    try {
      http.Response res;
      try {
        res = await http
            .get(Uri.parse(AppConfig.misTicketsUrl(ciudadano)))
            .timeout(const Duration(seconds: 8));
      } catch (_) {
        res = await http
            .get(Uri.parse(AppConfig.misTicketsBackendFallbackUrl(ciudadano)))
            .timeout(const Duration(seconds: 8));
      }

      if (res.statusCode == 200) {
        final decoded = jsonDecode(res.body);
        List<dynamic> rawList = [];
        if (decoded is List) {
          rawList = decoded;
        } else if (decoded is Map && decoded['denuncias'] is List) {
          rawList = decoded['denuncias'] as List<dynamic>;
        }
        if (mounted) {
          setState(() {
            _misDenuncias = rawList
                .whereType<Map>()
                .map((m) => Map<String, dynamic>.from(m))
                .toList();
          });
        }
      }
    } catch (_) {
      // Silencioso en caso de desconexión momentánea
    } finally {
      if (mounted) {
        setState(() => _cargandoHistorial = false);
      }
    }
  }

  Future<void> _buscarTicket([String? codigoOpcional]) async {
    final ticket = (codigoOpcional ?? _ticketController.text).trim().toUpperCase();
    if (ticket.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Ingresa un número de ticket ej. ECO-XXXX')),
      );
      return;
    }

    setState(() {
      _buscando = true;
      _denunciaEncontrada = null;
      _errorMensaje = null;
    });

    try {
      final res = await http.get(Uri.parse(AppConfig.rastreoUrl(ticket))).timeout(
        const Duration(seconds: 10),
      );

      final data = jsonDecode(res.body);

      if (res.statusCode == 200 && data['success'] == true) {
        setState(() {
          _denunciaEncontrada = Map<String, dynamic>.from(data['denuncia'] as Map);
        });
      } else {
        setState(() {
          _errorMensaje = data['mensaje'] ?? data['error'] ?? 'No se encontró la denuncia con ticket $ticket';
        });
      }
    } catch (e) {
      setState(() {
        _errorMensaje = 'Error al consultar ticket: $e';
      });
    } finally {
      if (mounted) setState(() => _buscando = false);
    }
  }

  Color _obtenerColorEstado(String? estado) {
    final st = (estado ?? '').toLowerCase();
    if (st.startsWith('rechazado:')) {
      return Colors.deepOrange.shade700;
    }
    switch (st) {
      case 'pre_asignado':
      case 'pendiente_aprobacion':
      case 'verificado':
      case 'pendiente':
      case 'requiere_revision':
        return Colors.amber.shade800;
      case 'en_proceso':
      case 'asignado':
      case 'reasignado':
        return Colors.blue.shade700;
      case 'cerrada':
        return const Color(0xFF10B981);
      case 'rechazada':
      case 'rechazado_ia':
        return Colors.red.shade700;
      default:
        return Colors.grey.shade700;
    }
  }

  String _etiquetaEstadoAmigable(String? estado) {
    final st = (estado ?? '').trim();
    final lower = st.toLowerCase();
    if (lower.startsWith('rechazado:')) {
      return 'EN REASIGNACIÓN ($st)';
    }
    switch (lower) {
      case 'pre_asignado':
      case 'pendiente_aprobacion':
        return 'EN REVISIÓN · PRE-ASIGNADO';
      case 'verificado':
      case 'pendiente':
      case 'requiere_revision':
        return 'EN REVISIÓN OPERATIVA';
      case 'en_proceso':
      case 'asignado':
        return 'ASIGNADO · EN RUTA';
      case 'reasignado':
        return 'REASIGNADO · EN RUTA';
      case 'cerrada':
        return 'RESUELTO / COMPLETADO';
      default:
        return st.isEmpty ? 'DESCONOCIDO' : st.toUpperCase();
    }
  }

  Widget _construirTarjetaTicket(Map<String, dynamic> d, {bool destacada = false}) {
    final estadoStr = d['estado']?.toString() ?? 'pre_asignado';
    final colorEst = _obtenerColorEstado(estadoStr);
    final choferAsignado = d['asignado_a']?.toString() ?? '';
    final choferSugerido = d['chofer_sugerido_nombre']?.toString() ?? '';
    final distKm = d['distancia_km'];
    final tiempoMin = d['tiempo_min'];

    return Card(
      elevation: destacada ? 3 : 1,
      margin: const EdgeInsets.only(bottom: 14),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(18),
        side: BorderSide(
          color: destacada ? colorEst.withValues(alpha: 0.5) : const Color(0xFFE2E8F0),
          width: destacada ? 1.5 : 1,
        ),
      ),
      color: Colors.white,
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(
                  d['ticket']?.toString() ?? 'Sin ticket',
                  style: const TextStyle(
                    fontSize: 17,
                    fontWeight: FontWeight.w900,
                    color: Color(0xFF0F172A),
                  ),
                ),
                Flexible(
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                    decoration: BoxDecoration(
                      color: colorEst.withValues(alpha: 0.12),
                      borderRadius: BorderRadius.circular(8),
                      border: Border.all(color: colorEst),
                    ),
                    child: Text(
                      _etiquetaEstadoAmigable(estadoStr),
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        color: colorEst,
                        fontWeight: FontWeight.bold,
                        fontSize: 11,
                      ),
                    ),
                  ),
                ),
              ],
            ),
            const Divider(height: 22),
            _itemDetalle(Icons.category_outlined, 'Categoría', d['categoria']),
            _itemDetalle(Icons.location_on_outlined, 'Barrio', d['barrio']),
            _itemDetalle(Icons.signpost_outlined, 'Dirección', d['direccion_referencia']),
            _itemDetalle(Icons.description_outlined, 'Descripción', d['descripcion']),
            if (distKm != null)
              _itemDetalle(
                Icons.route_outlined,
                'Ruta Calculada',
                '$distKm km (~${tiempoMin ?? 15} min)',
              ),
            if (choferAsignado.isNotEmpty)
              _itemDetalle(Icons.local_shipping_rounded, 'Chofer Asignado (En Ruta)', choferAsignado)
            else if (choferSugerido.isNotEmpty)
              _itemDetalle(Icons.person_pin_circle_outlined, 'Unidad Pre-Asignada (Por Confirmar)', choferSugerido),
            if (d['observacion_cierre'] != null && d['observacion_cierre'].toString().isNotEmpty)
              _itemDetalle(Icons.verified_outlined, 'Auditoría IA / Operativa', d['observacion_cierre']),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF8FAFC),
      appBar: widget.standalone
          ? AppBar(
              backgroundColor: const Color(0xFF064E3B),
              foregroundColor: Colors.white,
              title: const Text(
                'Mis Tickets y Denuncias',
                style: TextStyle(fontSize: 15, fontWeight: FontWeight.bold),
              ),
              actions: [
                IconButton(
                  icon: const Icon(Icons.refresh_rounded),
                  tooltip: 'Actualizar',
                  onPressed: _cargarMisDenuncias,
                ),
                TextButton.icon(
                  style: TextButton.styleFrom(
                    foregroundColor: Colors.white,
                    padding: const EdgeInsets.symmetric(horizontal: 10),
                  ),
                  onPressed: () {
                    // Verificar rol del usuario autenticado y volver al menú principal
                    final _ = AuthService().rol;
                    Navigator.of(context).popUntil((route) => route.isFirst);
                  },
                  icon: const Icon(Icons.home_rounded, size: 18, color: Color(0xFF34D399)),
                  label: const Text(
                    'Menú Principal',
                    style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700, color: Colors.white),
                  ),
                ),
              ],
            )
          : null,
      body: SafeArea(
        child: RefreshIndicator(
          onRefresh: _cargarMisDenuncias,
          child: SingleChildScrollView(
            physics: const AlwaysScrollableScrollPhysics(),
            padding: const EdgeInsets.all(20),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const Row(
                  children: [
                    Icon(Icons.manage_search_rounded, color: Color(0xFF10B981), size: 28),
                    SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        'Búsqueda por Código de Ticket',
                        style: TextStyle(
                          fontSize: 18,
                          fontWeight: FontWeight.bold,
                          color: Color(0xFF0F172A),
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 6),
                const Text(
                  'Ingresa el código de tu ticket (ej. ECO-XXXX) o revisa debajo el historial de denuncias.',
                  style: TextStyle(fontSize: 13, color: Color(0xFF64748B)),
                ),
                const SizedBox(height: 14),
                Row(
                  children: [
                    Expanded(
                      child: TextField(
                        controller: _ticketController,
                        textCapitalization: TextCapitalization.characters,
                        decoration: InputDecoration(
                          hintText: 'Ej. ECO-20261107-A6C2',
                          prefixIcon: const Icon(Icons.confirmation_number_outlined),
                          border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
                          filled: true,
                          fillColor: Colors.white,
                        ),
                        onSubmitted: (_) => _buscarTicket(),
                      ),
                    ),
                    const SizedBox(width: 10),
                    ElevatedButton(
                      onPressed: _buscando ? null : () => _buscarTicket(),
                      style: ElevatedButton.styleFrom(
                        backgroundColor: const Color(0xFF064E3B),
                        foregroundColor: Colors.white,
                        padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 16),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                      ),
                      child: _buscando
                          ? const SizedBox(
                              width: 18,
                              height: 18,
                              child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                            )
                          : const Icon(Icons.search_rounded),
                    ),
                  ],
                ),
                const SizedBox(height: 18),
                if (_errorMensaje != null)
                  Container(
                    margin: const EdgeInsets.only(bottom: 16),
                    padding: const EdgeInsets.all(14),
                    decoration: BoxDecoration(
                      color: Colors.red.shade50,
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(color: Colors.red.shade200),
                    ),
                    child: Row(
                      children: [
                        Icon(Icons.error_outline, color: Colors.red.shade700),
                        const SizedBox(width: 10),
                        Expanded(
                          child: Text(_errorMensaje!, style: TextStyle(color: Colors.red.shade900, fontSize: 13)),
                        ),
                      ],
                    ),
                  ),
                if (_denunciaEncontrada != null) ...[
                  const Text(
                    'RESULTADO DE BÚSQUEDA',
                    style: TextStyle(
                      fontSize: 11.5,
                      fontWeight: FontWeight.w800,
                      letterSpacing: 1.0,
                      color: Color(0xFF10B981),
                    ),
                  ),
                  const SizedBox(height: 8),
                  _construirTarjetaTicket(_denunciaEncontrada!, destacada: true),
                  const SizedBox(height: 10),
                ],

                // ==============================================================
                // SECCIÓN: MIS TICKETS / HISTORIAL DE DENUNCIAS
                // ==============================================================
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    const Text(
                      'HISTORIAL DE TICKETS Y ESTADO ACTUAL',
                      style: TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w800,
                        letterSpacing: 0.8,
                        color: Color(0xFF475569),
                      ),
                    ),
                    TextButton.icon(
                      onPressed: _cargandoHistorial ? null : _cargarMisDenuncias,
                      icon: const Icon(Icons.sync_rounded, size: 16),
                      label: const Text('Actualizar', style: TextStyle(fontSize: 12)),
                    ),
                  ],
                ),
                const SizedBox(height: 6),
                if (_cargandoHistorial)
                  const Padding(
                    padding: EdgeInsets.symmetric(vertical: 28),
                    child: Center(child: CircularProgressIndicator()),
                  )
                else if (_misDenuncias.isEmpty)
                  Container(
                    padding: const EdgeInsets.all(24),
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(16),
                      border: Border.all(color: const Color(0xFFE2E8F0)),
                    ),
                    child: const Column(
                      children: [
                        Icon(Icons.inbox_outlined, size: 38, color: Color(0xFF94A3B8)),
                        SizedBox(height: 8),
                        Text(
                          'No se encontraron tickets registrados aún.',
                          style: TextStyle(fontWeight: FontWeight.bold, color: Color(0xFF475569)),
                        ),
                        SizedBox(height: 4),
                        Text(
                          'Cuando envíes una denuncia válida desde la pantalla principal, aparecerá aquí con su estado en tiempo real.',
                          textAlign: TextAlign.center,
                          style: TextStyle(fontSize: 12, color: Color(0xFF64748B)),
                        ),
                      ],
                    ),
                  )
                else
                  ..._misDenuncias.map((d) => _construirTarjetaTicket(d)),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _itemDetalle(IconData icon, String titulo, dynamic valor) {
    if (valor == null || valor.toString().isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 18, color: const Color(0xFF10B981)),
          const SizedBox(width: 8),
          Expanded(
            child: RichText(
              text: TextSpan(
                style: const TextStyle(fontSize: 13, color: Color(0xFF334155)),
                children: [
                  TextSpan(text: '$titulo: ', style: const TextStyle(fontWeight: FontWeight.bold)),
                  TextSpan(text: valor.toString()),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}
