const fs = require('fs');
const path = require('path');

const geojsonPath = path.join(__dirname, '../frontend/data/barrios_asuncion.geojson');
const raw = fs.readFileSync(geojsonPath, 'utf8');
const data = JSON.parse(raw);

// Ray-casting algorithm to test if a point is inside a polygon
function pointInPolygon(pt, ring) {
    const x = pt[0], y = pt[1];
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const xi = ring[i][0], yi = ring[i][1];
        const xj = ring[j][0], yj = ring[j][1];
        const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
}

// Check inside Polygon or MultiPolygon
function isInsideGeometry(pt, geom) {
    if (geom.type === 'Polygon') {
        if (!pointInPolygon(pt, geom.coordinates[0])) return false;
        for (let k = 1; k < geom.coordinates.length; k++) {
            if (pointInPolygon(pt, geom.coordinates[k])) return false; // in hole
        }
        return true;
    } else if (geom.type === 'MultiPolygon') {
        for (const poly of geom.coordinates) {
            if (pointInPolygon(pt, poly[0])) {
                let inHole = false;
                for (let k = 1; k < poly.length; k++) {
                    if (pointInPolygon(pt, poly[k])) { inHole = true; break; }
                }
                if (!inHole) return true;
            }
        }
        return false;
    }
    return false;
}

// Bounding box of geometry
function getBBox(geom) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    function scanRing(ring) {
        for (const p of ring) {
            if (p[0] < minX) minX = p[0];
            if (p[0] > maxX) maxX = p[0];
            if (p[1] < minY) minY = p[1];
            if (p[1] > maxY) maxY = p[1];
        }
    }
    if (geom.type === 'Polygon') {
        geom.coordinates.forEach(scanRing);
    } else if (geom.type === 'MultiPolygon') {
        geom.coordinates.forEach(poly => poly.forEach(scanRing));
    }
    return { minX, maxX, minY, maxY };
}

const sqlLines = [];
let totalPoints = 0;

data.features.forEach((feat, idx) => {
    const props = feat.properties;
    const barrioName = props.barrio || props.name || `Barrio ${idx + 1}`;
    const geom = feat.geometry;
    const bbox = getBBox(geom);

    const validPoints = [];
    // Grid sampling inside the bbox to find distributed points
    const steps = 15;
    const stepX = (bbox.maxX - bbox.minX) / (steps + 1);
    const stepY = (bbox.maxY - bbox.minY) / (steps + 1);

    const candidates = [];
    for (let ix = 1; ix <= steps; ix++) {
        for (let iy = 1; iy <= steps; iy++) {
            const pt = [bbox.minX + ix * stepX, bbox.minY + iy * stepY];
            if (isInsideGeometry(pt, geom)) {
                candidates.push(pt);
            }
        }
    }

    if (candidates.length < 5) {
        // Fallback: random jitter around candidates or polygon vertices
        let ring = geom.type === 'Polygon' ? geom.coordinates[0] : geom.coordinates[0][0];
        for (let i = 0; i < ring.length && candidates.length < 5; i++) {
            const next = ring[(i + 1) % ring.length];
            const mid = [(ring[i][0] + next[0]) / 2, (ring[i][1] + next[1]) / 2];
            candidates.push(mid);
        }
    }

    // Select 5 well-spaced points from candidates
    if (candidates.length <= 5) {
        validPoints.push(...candidates);
    } else {
        const stepIdx = (candidates.length - 1) / 4;
        for (let k = 0; k < 5; k++) {
            const pick = candidates[Math.round(k * stepIdx)];
            validPoints.push(pick);
        }
    }

    validPoints.slice(0, 5).forEach((pt, pIdx) => {
        const lon = pt[0].toFixed(7);
        const lat = pt[1].toFixed(7);
        const ptName = `Punto ${pIdx + 1} - ${barrioName}`;
        const cleanBarrio = barrioName.replace(/'/g, "''");
        const cleanPtName = ptName.replace(/'/g, "''");
        sqlLines.push(
            `INSERT INTO clientes (nombre, tipo_cliente, latitud, longitud, ciudad, cadena, activo, usuario_id) ` +
            `VALUES ('${cleanPtName}', 'Punto de Recolección', ${lat}, ${lon}, 'Asunción', '${cleanBarrio}', true, 1);`
        );
        totalPoints++;
    });
});

const outSql = path.join(__dirname, 'puntos_barrios.sql');
fs.writeFileSync(outSql, sqlLines.join('\n'), 'utf8');

console.log(`✅ Generados ${totalPoints} puntos para ${data.features.length} barrios en ${outSql}`);
