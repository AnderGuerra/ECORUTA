import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:geolocator/geolocator.dart';
import 'package:http/http.dart' as http;
import 'package:image_picker/image_picker.dart';
import 'package:latlong2/latlong.dart';
import '../services/app_config.dart';
import '../services/auth_service.dart';
import 'rastreo_screen.dart';

class NuevaDenunciaScreen extends StatefulWidget {
  final bool standalone;
  const NuevaDenunciaScreen({super.key, this.standalone = false});

  @override
  State<NuevaDenunciaScreen> createState() => _NuevaDenunciaScreenState();
}

class _NuevaDenunciaScreenState extends State<NuevaDenunciaScreen> {
  File? _imagenEvidencia;
  Position? _posicionGps;
  DateTime? _fechaCaptura;

  String _categoriaSeleccionada = 'VERTEDERO_CLANDESTINO';
  final TextEditingController _descripcionController = TextEditingController();
  final TextEditingController _barrioController = TextEditingController(text: 'Sajonia');
  final TextEditingController _direccionController = TextEditingController();

  bool _obteniendoFoto = false;
  bool _obteniendoGps = false;
  bool _enviandoReporte = false;

  final MapController _mapController = MapController();
  final ImagePicker _picker = ImagePicker();

  final List<Map<String, dynamic>> _categorias = [
    {
      'id': 'VERTEDERO_CLANDESTINO',
      'nombre': 'Vertedero Clandestino / Basural',
      'icono': Icons.delete_forever_rounded,
      'color': Colors.brown.shade700,
    },
    {
      'id': 'CONTENEDOR_LLENO',
      'nombre': 'Contenedor Lleno / Desbordado',
      'icono': Icons.delete_sweep_rounded,
      'color': Colors.orange.shade800,
    },
    {
      'id': 'RESIDUO_VOLUMINOSO',
      'nombre': 'Residuo Voluminoso (Muebles/Chatarra)',
      'icono': Icons.weekend_rounded,
      'color': Colors.blueGrey.shade700,
    },
    {
      'id': 'RESTOS_PODA',
      'nombre': 'Restos de Poda / Ramas',
      'icono': Icons.park_rounded,
      'color': Colors.green.shade800,
    },
    {
      'id': 'ANIMAL_MUERTO',
      'nombre': 'Animal Muerto en Vía Pública',
      'icono': Icons.warning_amber_rounded,
      'color': Colors.red.shade800,
    },
  ];

  @override
  void initState() {
    super.initState();
    // Iniciar con geolocalización previa de cortesía
    _obtenerCoordenadasGps(silencioso: true);
  }

  @override
  void dispose() {
    _descripcionController.dispose();
    _barrioController.dispose();
    _direccionController.dispose();
    super.dispose();
  }

  // =========================================================================
  // FOTO + GPS SIMULTÁNEO
  // =========================================================================
  Future<void> _tomarFotoConCamara() async {
    try {
      setState(() => _obteniendoFoto = true);

      final XFile? foto = await _picker.pickImage(
        source: ImageSource.camera,
        imageQuality: 85,
        maxWidth: 1920,
        maxHeight: 1080,
      );

      if (foto == null) {
        setState(() => _obteniendoFoto = false);
        return;
      }

      setState(() {
        _imagenEvidencia = File(foto.path);
        _fechaCaptura = DateTime.now();
        _obteniendoFoto = false;
      });

      // Obtener de inmediato las coordenadas GPS exactas al momento de tomar la foto
      await _obtenerCoordenadasGps();
    } catch (e) {
      setState(() => _obteniendoFoto = false);
      _mostrarSnackBar('Error al acceder a la cámara: $e', esError: true);
    }
  }

  // Polígono estricto del límite municipal de Asunción, Paraguay
  static const List<List<double>> _asuncionPolygon = [
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
    [-25.3250, -57.6560], // Bañado Sur / Río Paraguay
  ];

  bool _puntoEnPoligonoAsuncion(double lat, double lon) {
    bool inside = false;
    for (int i = 0, j = _asuncionPolygon.length - 1; i < _asuncionPolygon.length; j = i++) {
      final double yi = _asuncionPolygon[i][0], xi = _asuncionPolygon[i][1];
      final double yj = _asuncionPolygon[j][0], xj = _asuncionPolygon[j][1];
      final double denom = (yj - yi) == 0 ? 1e-12 : (yj - yi);
      final bool intersect = ((yi > lat) != (yj > lat)) && (lon < (xj - xi) * (lat - yi) / denom + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  bool _estaDentroDeAsuncion(double lat, double lon, String barrio, String direccion) {
    if (lat.isNaN || lon.isNaN || (lat == 0 && lon == 0)) return false;
    if (lat < -25.368 || lat > -25.225 || lon < -57.675 || lon > -57.520) return false;
    if (!_puntoEnPoligonoAsuncion(lat, lon)) return false;

    final String texto = '$barrio $direccion'
        .toLowerCase()
        .replaceAll('á', 'a')
        .replaceAll('é', 'e')
        .replaceAll('í', 'i')
        .replaceAll('ó', 'o')
        .replaceAll('ú', 'u');
    const excluidas = [
      'mariano roque alonso',
      'roque alonso',
      'luque',
      'lambare',
      'fernando de la mora',
      'san lorenzo',
      'capiata',
      'ñemby',
      'nemby',
      'villa elisa',
      'limpio',
      'villa hayes',
      'itaugua',
      'aregua'
    ];
    for (final c in excluidas) {
      if (texto.contains(c)) return false;
    }
    return true;
  }

  Future<void> _obtenerCoordenadasGps({bool silencioso = false}) async {
    setState(() => _obteniendoGps = true);

    try {
      bool servicioHabilitado = await Geolocator.isLocationServiceEnabled();
      if (!servicioHabilitado) {
        if (!silencioso) {
          throw Exception('El GPS de tu celular está apagado. Por favor actívalo.');
        }
        return;
      }

      LocationPermission permiso = await Geolocator.checkPermission();
      if (permiso == LocationPermission.denied) {
        permiso = await Geolocator.requestPermission();
        if (permiso == LocationPermission.denied) {
          if (!silencioso) throw Exception('Permiso de ubicación denegado.');
          return;
        }
      }

      if (permiso == LocationPermission.deniedForever) {
        if (!silencioso) {
          throw Exception('Permisos de GPS denegados permanentemente en el celular.');
        }
        return;
      }

      final Position pos = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(
          accuracy: LocationAccuracy.high,
          timeLimit: Duration(seconds: 12),
        ),
      );

      setState(() {
        _posicionGps = pos;
      });

      WidgetsBinding.instance.addPostFrameCallback((_) {
        try {
          _mapController.move(LatLng(pos.latitude, pos.longitude), 16.0);
        } catch (_) {}
      });

      if (!silencioso) {
        _mostrarSnackBar('📍 Coordenadas GPS fijadas con exactitud.');
      }
    } catch (e) {
      if (!silencioso) {
        _mostrarSnackBar(e.toString(), esError: true);
      }
    } finally {
      setState(() => _obteniendoGps = false);
    }
  }

  // =========================================================================
  // ENVÍO AL AGENTE IA DE VALIDACIÓN Y ANTI-SPAM
  // =========================================================================
  Future<void> _enviarAlAgente() async {
    if (_imagenEvidencia == null) {
      _mostrarSnackBar('Toma una foto en vivo con la cámara de la acumulación de residuos', esError: true);
      return;
    }

    if (_posicionGps == null || (_posicionGps!.latitude == 0 && _posicionGps!.longitude == 0)) {
      _mostrarSnackBar('Captura la ubicación GPS real antes de enviar', esError: true);
      return;
    }

    final descripcion = _descripcionController.text.trim();
    final barrio = _barrioController.text.trim();
    final direccion = _direccionController.text.trim();

    if (descripcion.isEmpty || barrio.isEmpty) {
      _mostrarSnackBar('Completa el barrio y la descripción de los residuos', esError: true);
      return;
    }

    // Validación de geocerca en la App antes de enviar (solo Municipio de Asunción)
    final double lat = _posicionGps!.latitude;
    final double lon = _posicionGps!.longitude;
    if (!_estaDentroDeAsuncion(lat, lon, barrio, direccion)) {
      const msgCobertura =
          'Fuera de zona de cobertura: Por el momento solo se admiten reportes dentro del municipio de Asunción';
      _mostrarResultadoAgente(
        {
          'veredicto': 'RECHAZADA',
          'fuera_de_cobertura': true,
          'confianza': 0.0,
          'motivo': msgCobertura,
          'observaciones': msgCobertura,
          'motivos': [msgCobertura],
        },
        bloqueadoIa: true,
      );
      return;
    }

    setState(() => _enviandoReporte = true);

    try {
      final uri = Uri.parse(AppConfig.validarYEnviarUrl);
      final request = http.MultipartRequest('POST', uri);

      // Campos de la denuncia + metadatos de captura en vivo
      final auth = AuthService();
      request.fields['nombre_ciudadano'] = auth.nombre ?? 'Ciudadano';
      request.fields['telefono'] = '0981-000000';
      request.fields['categoria'] = _categoriaSeleccionada;
      request.fields['barrio'] = barrio;
      request.fields['direccion_referencia'] = direccion;
      request.fields['descripcion'] = descripcion;
      request.fields['latitud'] = lat.toString();
      request.fields['longitud'] = lon.toString();
      request.fields['fuente_captura'] = 'CAMERA_LIVE';
      request.fields['timestamp_captura'] = (_fechaCaptura ?? DateTime.now()).toIso8601String();

      // Archivo de imagen real tomado con la cámara
      final multipartFile = await http.MultipartFile.fromPath(
        'imagenEvidencia',
        _imagenEvidencia!.path,
      );
      request.files.add(multipartFile);

      final streamedResponse = await request.send().timeout(
        const Duration(seconds: 35),
        onTimeout: () => throw Exception('Tiempo de espera agotado al conectar con el Agente EcoRuta.'),
      );

      final response = await http.Response.fromStream(streamedResponse);
      final Map<String, dynamic> data = jsonDecode(response.body);

      if (!mounted) return;

      final bool esBloqueadoHttp = response.statusCode == 400 ||
          response.statusCode == 403 ||
          response.statusCode == 422 ||
          data['bloqueado_ia'] == true ||
          data['fuera_de_cobertura'] == true ||
          data['veredicto'] == 'RECHAZADA' ||
          data['success'] == false;

      if (!esBloqueadoHttp && data['ticket'] != null && data['ticket'].toString().isNotEmpty) {
        final String tkt = data['ticket'].toString();
        if (!AuthService().misTicketsRecientes.contains(tkt)) {
          AuthService().misTicketsRecientes.insert(0, tkt);
        }
      }

      _mostrarResultadoAgente(data, bloqueadoIa: esBloqueadoHttp);
    } catch (e) {
      if (!mounted) return;
      _mostrarSnackBar('Error al conectar con Agente EcoRuta: $e', esError: true);
    } finally {
      if (mounted) setState(() => _enviandoReporte = false);
    }
  }

  void _mostrarSnackBar(String msg, {bool esError = false}) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(msg),
        backgroundColor: esError ? Colors.red.shade700 : const Color(0xFF10B981),
        behavior: SnackBarBehavior.floating,
      ),
    );
  }

  void _mostrarResultadoAgente(Map<String, dynamic> data, {bool bloqueadoIa = false}) {
    final veredicto = bloqueadoIa ? 'RECHAZADA' : (data['veredicto'] ?? 'DESCONOCIDO');
    final ticket = data['ticket'] ?? '';
    final observaciones = data['observaciones'] ?? data['motivo'] ?? '';
    final motivos = (data['motivos'] as List<dynamic>?) ?? [];
    final double confianza = ((data['confianza'] ?? 0.0) as num).toDouble();
    final String? choferSugerido = data['chofer_sugerido_nombre']?.toString();

    final bool fueraDeCobertura = data['fuera_de_cobertura'] == true ||
        observaciones.toString().contains('Fuera de zona de cobertura');

    Color color;
    IconData icon;
    String titulo;

    if (veredicto == 'VALIDA' && !bloqueadoIa) {
      color = const Color(0xFF10B981);
      icon = Icons.verified_rounded;
      titulo = 'Reporte Validado y Pre-Asignado';
    } else if (veredicto == 'SOSPECHOSA' && !bloqueadoIa) {
      color = Colors.amber.shade800;
      icon = Icons.warning_rounded;
      titulo = 'Reporte en Revisión Operativa';
    } else if (fueraDeCobertura) {
      color = Colors.red.shade800;
      icon = Icons.location_off_rounded;
      titulo = 'Fuera de Zona de Cobertura';
    } else {
      color = Colors.red.shade700;
      icon = Icons.gpp_bad_rounded;
      titulo = 'Reporte No Admitido por IA Anti-Spam';
    }

    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (ctx) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
        icon: Icon(icon, color: color, size: 52),
        title: Text(
          titulo,
          textAlign: TextAlign.center,
          style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: color),
        ),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (veredicto != 'RECHAZADA' && ticket.toString().isNotEmpty) ...[
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: color.withValues(alpha: 0.08),
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: color.withValues(alpha: 0.3)),
                ),
                child: Column(
                  children: [
                    const Text('CÓDIGO DE TICKET', style: TextStyle(fontSize: 11, color: Colors.grey)),
                    const SizedBox(height: 2),
                    Text(
                      ticket.toString(),
                      style: TextStyle(fontSize: 20, fontWeight: FontWeight.w900, color: color),
                    ),
                    if (choferSugerido != null && choferSugerido.isNotEmpty) ...[
                      const SizedBox(height: 4),
                      Text(
                        'Chofer pre-asignado: $choferSugerido',
                        style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w600, color: Color(0xFF065F46)),
                      ),
                    ],
                  ],
                ),
              ),
              const SizedBox(height: 12),
            ] else ...[
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                  color: Colors.red.shade50,
                  borderRadius: BorderRadius.circular(10),
                  border: Border.all(color: Colors.red.shade200),
                ),
                child: Text(
                  'Tu reporte fue bloqueado antes de ingresar a la cola de recolección porque no superó la auditoría visual de Gemini IA.',
                  style: TextStyle(fontSize: 12, color: Colors.red.shade900, fontWeight: FontWeight.w600),
                ),
              ),
              const SizedBox(height: 10),
            ],
            Text(
              'Confianza IA: ${(confianza * 100).toStringAsFixed(0)}%',
              style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13),
            ),
            const SizedBox(height: 6),
            Text(observaciones.toString(), style: const TextStyle(fontSize: 13)),
            if (motivos.isNotEmpty) ...[
              const SizedBox(height: 8),
              const Text('Motivo del filtro IA:', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 12)),
              ...motivos.map(
                (m) => Padding(
                  padding: const EdgeInsets.only(top: 2),
                  child: Text('• $m', style: const TextStyle(fontSize: 12, color: Colors.red)),
                ),
              ),
            ],
          ],
        ),
        actions: [
          if (veredicto != 'RECHAZADA' && ticket.toString().isNotEmpty)
            TextButton.icon(
              onPressed: () {
                Navigator.pop(ctx);
                Navigator.push(
                  context,
                  MaterialPageRoute(
                    builder: (_) => RastreoScreen(standalone: true, initialTicket: ticket.toString()),
                  ),
                );
              },
              icon: const Icon(Icons.assignment_turned_in_outlined, size: 18),
              label: const Text('Ver en Mis Tickets'),
            ),
          ElevatedButton(
            style: ElevatedButton.styleFrom(
              backgroundColor: color,
              foregroundColor: Colors.white,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
            ),
            onPressed: () {
              Navigator.pop(ctx);
              if (veredicto == 'VALIDA' && !bloqueadoIa) {
                setState(() {
                  _imagenEvidencia = null;
                  _descripcionController.clear();
                  _direccionController.clear();
                });
              }
            },
            child: const Text('Entendido'),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final latDefecto = _posicionGps?.latitude ?? -25.2960;
    final lonDefecto = _posicionGps?.longitude ?? -57.6360;

    final content = SingleChildScrollView(
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // Banner Agente
          Container(
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: const Color(0xFFECFDF5),
              borderRadius: BorderRadius.circular(14),
              border: Border.all(color: const Color(0xFFA7F3D0)),
            ),
            child: const Row(
              children: [
                Icon(Icons.shield_outlined, color: Color(0xFF10B981), size: 28),
                SizedBox(width: 10),
                Expanded(
                  child: Text(
                    'Escudo EcoRuta: Cada reporte es validado en tiempo real con IA antispam y georreferenciación.',
                    style: TextStyle(fontSize: 12, color: Color(0xFF065F46), fontWeight: FontWeight.w500),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 18),

          // SECCIÓN 1: FOTOGRAFÍA
          const Text(
            '1. Fotografía de Evidencia',
            style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: Color(0xFF0F172A)),
          ),
          const SizedBox(height: 8),
          Container(
            height: 200,
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: Colors.grey.shade300),
            ),
            clipBehavior: Clip.antiAlias,
            child: _imagenEvidencia != null
                ? Stack(
                    fit: StackFit.expand,
                    children: [
                      Image.file(_imagenEvidencia!, fit: BoxFit.cover),
                      Positioned(
                        bottom: 8,
                        left: 8,
                        child: Container(
                          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                          decoration: BoxDecoration(
                            color: Colors.black.withValues(alpha: 0.6),
                            borderRadius: BorderRadius.circular(6),
                          ),
                          child: Text(
                            '📸 Captura: ${_fechaCaptura?.hour.toString().padLeft(2, '0')}:${_fechaCaptura?.minute.toString().padLeft(2, '0')}',
                            style: const TextStyle(color: Colors.white, fontSize: 11),
                          ),
                        ),
                      ),
                      Positioned(
                        top: 8,
                        right: 8,
                        child: CircleAvatar(
                          backgroundColor: Colors.black54,
                          child: IconButton(
                            icon: const Icon(Icons.refresh, color: Colors.white),
                            onPressed: _tomarFotoConCamara,
                          ),
                        ),
                      ),
                    ],
                  )
                : Center(
                    child: _obteniendoFoto
                        ? const CircularProgressIndicator(color: Color(0xFF10B981))
                        : Column(
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: [
                              const Icon(Icons.camera_alt_outlined, size: 48, color: Colors.grey),
                              const SizedBox(height: 8),
                              const Text(
                                'Captura exclusiva con cámara en vivo (sin galería)',
                                style: TextStyle(color: Colors.grey, fontSize: 12.5, fontWeight: FontWeight.w500),
                              ),
                              const SizedBox(height: 12),
                              ElevatedButton.icon(
                                style: ElevatedButton.styleFrom(
                                  backgroundColor: const Color(0xFF10B981),
                                  foregroundColor: Colors.white,
                                  padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
                                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                                ),
                                onPressed: _tomarFotoConCamara,
                                icon: const Icon(Icons.camera_alt),
                                label: const Text('Tomar Foto en Vivo (Cámara)'),
                              ),
                            ],
                          ),
                  ),
          ),
          const SizedBox(height: 20),

          // SECCIÓN 2: UBICACIÓN GPS
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text(
                '2. Ubicación GPS Exacta',
                style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: Color(0xFF0F172A)),
              ),
              TextButton.icon(
                onPressed: _obteniendoGps ? null : () => _obtenerCoordenadasGps(),
                icon: _obteniendoGps
                    ? const SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2))
                    : const Icon(Icons.my_location, size: 16),
                label: const Text('Actualizar GPS', style: TextStyle(fontSize: 12)),
              ),
            ],
          ),
          Container(
            height: 180,
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: Colors.grey.shade300),
            ),
            clipBehavior: Clip.antiAlias,
            child: FlutterMap(
              mapController: _mapController,
              options: MapOptions(
                initialCenter: LatLng(latDefecto, lonDefecto),
                initialZoom: 15.0,
                onTap: (_, latlng) {
                  setState(() {
                    _posicionGps = Position(
                      latitude: latlng.latitude,
                      longitude: latlng.longitude,
                      timestamp: DateTime.now(),
                      accuracy: 1.0,
                      altitude: 0.0,
                      heading: 0.0,
                      speed: 0.0,
                      speedAccuracy: 0.0,
                      altitudeAccuracy: 0.0,
                      headingAccuracy: 0.0,
                    );
                  });
                },
              ),
              children: [
                TileLayer(
                  urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
                  userAgentPackageName: 'com.ecoruta.app',
                ),
                MarkerLayer(
                  markers: [
                    Marker(
                      point: LatLng(latDefecto, lonDefecto),
                      width: 44,
                      height: 44,
                      child: const Icon(
                        Icons.location_on_rounded,
                        color: Colors.red,
                        size: 40,
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.only(top: 6),
            child: Text(
              _posicionGps != null
                  ? '📍 Lat: ${_posicionGps!.latitude.toStringAsFixed(5)}, Lon: ${_posicionGps!.longitude.toStringAsFixed(5)} (Toca el mapa para ajustar)'
                  : '⚠️ Esperando GPS... o toca el mapa para fijar punto.',
              style: TextStyle(fontSize: 11, color: Colors.grey.shade700),
            ),
          ),
          const SizedBox(height: 20),

          // SECCIÓN 3: CATEGORÍA Y DETALLES
          const Text(
            '3. Tipo de Residuo',
            style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: Color(0xFF0F172A)),
          ),
          const SizedBox(height: 8),
          DropdownButtonFormField<String>(
            initialValue: _categoriaSeleccionada,
            decoration: InputDecoration(
              border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
              filled: true,
              fillColor: Colors.white,
            ),
            items: _categorias.map((cat) {
              return DropdownMenuItem<String>(
                value: cat['id'],
                child: Row(
                  children: [
                    Icon(cat['icono'], color: cat['color'], size: 20),
                    const SizedBox(width: 8),
                    Text(cat['nombre'], style: const TextStyle(fontSize: 13)),
                  ],
                ),
              );
            }).toList(),
            onChanged: (val) {
              if (val != null) setState(() => _categoriaSeleccionada = val);
            },
          ),
          const SizedBox(height: 14),

          TextField(
            controller: _barrioController,
            decoration: InputDecoration(
              labelText: 'Barrio de Asunción',
              prefixIcon: const Icon(Icons.location_city_outlined),
              border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
              filled: true,
              fillColor: Colors.white,
            ),
          ),
          const SizedBox(height: 14),

          TextField(
            controller: _direccionController,
            decoration: InputDecoration(
              labelText: 'Dirección o Referencia',
              hintText: 'Ej. Calle Palma c/ Colón, frente a la plaza',
              prefixIcon: const Icon(Icons.signpost_outlined),
              border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
              filled: true,
              fillColor: Colors.white,
            ),
          ),
          const SizedBox(height: 14),

          TextField(
            controller: _descripcionController,
            maxLines: 3,
            decoration: InputDecoration(
              labelText: 'Descripción del foco de residuos',
              hintText: 'Describe la cantidad de basura acumulada, bolsas, ramas...',
              border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
              filled: true,
              fillColor: Colors.white,
            ),
          ),
          const SizedBox(height: 24),

          // BOTÓN ENVIAR
          ElevatedButton(
            onPressed: _enviandoReporte ? null : _enviarAlAgente,
            style: ElevatedButton.styleFrom(
              backgroundColor: const Color(0xFF10B981),
              foregroundColor: Colors.white,
              padding: const EdgeInsets.symmetric(vertical: 16),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
              elevation: 2,
            ),
            child: _enviandoReporte
                ? const Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      SizedBox(
                        width: 20,
                        height: 20,
                        child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                      ),
                      SizedBox(width: 12),
                      Text('Agente IA Validando Denuncia...', style: TextStyle(fontWeight: FontWeight.bold)),
                    ],
                  )
                : const Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(Icons.send_rounded),
                      SizedBox(width: 8),
                      Text(
                        'Enviar a Verificación EcoRuta',
                        style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
                      ),
                    ],
                  ),
          ),
          const SizedBox(height: 20),
        ],
      ),
    );

    if (!widget.standalone) return content;

    return Scaffold(
      backgroundColor: const Color(0xFFF8FAFC),
      appBar: AppBar(
        backgroundColor: const Color(0xFF064E3B),
        foregroundColor: Colors.white,
        title: const Text(
          'Reportar Incidencia',
          style: TextStyle(fontSize: 15, fontWeight: FontWeight.bold),
        ),
        actions: [
          TextButton.icon(
            style: TextButton.styleFrom(
              foregroundColor: Colors.white,
              padding: const EdgeInsets.symmetric(horizontal: 12),
            ),
            onPressed: () {
              // Verificar rol activo del usuario en sesión y volver al menú principal correspondiente
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
      ),
      body: SafeArea(child: content),
    );
  }
}
