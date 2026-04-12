const express = require('express');
const multer = require('multer');
const { execSync } = require('child_process');
const fs = require('fs');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const upload = multer({ dest: '/tmp/uploads/' });

app.get('/', (req, res) => {
    res.json({ 
        status: 'ok', 
        version: '4.1.0',
        features: ['FDM', 'SLA'],
        timestamp: new Date().toISOString()
    });
});

app.post('/slice', upload.single('file'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ ok: false, error: 'No file uploaded' });
    }

    const technology = req.body.technology || 'FDM';
    const stlPath = req.file.path + '.stl';
    fs.renameSync(req.file.path, stlPath);

    try {
        if (technology === 'SLA') {
            const result = calculateSLA(stlPath, req.body);
            cleanup(stlPath);
            return res.json(result);
        } else {
            const result = calculateFDM(stlPath, req.body);
            cleanup(stlPath);
            return res.json(result);
        }
    } catch (error) {
        cleanup(stlPath);
        return res.status(500).json({ ok: false, error: error.message });
    }
});

function parseSTL(buffer) {
    const vertices = [];
    const header = buffer.slice(0, 80).toString('utf8');
    const isAscii = header.startsWith('solid') && !header.includes('\0');
    
    if (isAscii) {
        const text = buffer.toString('utf8');
        const vertexRegex = /vertex\s+([-\d.eE+]+)\s+([-\d.eE+]+)\s+([-\d.eE+]+)/g;
        let match;
        while ((match = vertexRegex.exec(text)) !== null) {
            vertices.push([parseFloat(match[1]), parseFloat(match[2]), parseFloat(match[3])]);
        }
    } else {
        const numTriangles = buffer.readUInt32LE(80);
        let offset = 84;
        for (let i = 0; i < numTriangles; i++) {
            offset += 12;
            for (let j = 0; j < 3; j++) {
                vertices.push([
                    buffer.readFloatLE(offset),
                    buffer.readFloatLE(offset + 4),
                    buffer.readFloatLE(offset + 8)
                ]);
                offset += 12;
            }
            offset += 2;
        }
    }
    return vertices;
}

function calculateVolume(vertices) {
    let volume = 0;
    for (let i = 0; i < vertices.length; i += 3) {
        const v1 = vertices[i], v2 = vertices[i + 1], v3 = vertices[i + 2];
        if (!v1 || !v2 || !v3) continue;
        const crossX = v2[1] * v3[2] - v2[2] * v3[1];
        const crossY = v2[2] * v3[0] - v2[0] * v3[2];
        const crossZ = v2[0] * v3[1] - v2[1] * v3[0];
        volume += (v1[0] * crossX + v1[1] * crossY + v1[2] * crossZ) / 6;
    }
    return Math.abs(volume);
}

function calculateBoundingBox(vertices) {
    if (vertices.length === 0) return { size: [0, 0, 0] };
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (const v of vertices) {
        minX = Math.min(minX, v[0]); minY = Math.min(minY, v[1]); minZ = Math.min(minZ, v[2]);
        maxX = Math.max(maxX, v[0]); maxY = Math.max(maxY, v[1]); maxZ = Math.max(maxZ, v[2]);
    }
    return { size: [maxX - minX, maxY - minY, maxZ - minZ] };
}

function calculateSLA(stlPath, params) {
    const buffer = fs.readFileSync(stlPath);
    const vertices = parseSTL(buffer);
    const volumeMm3 = calculateVolume(vertices);
    const volumeCm3 = volumeMm3 / 1000;
    const bbox = calculateBoundingBox(vertices);
    const heightMm = bbox.size[2];
    
    const layerHeight = parseFloat(params.layer_height) || 0.05;
    const layers = Math.ceil(heightMm / layerHeight);
    
    const exposureTime = parseFloat(params.exposure_time) || 3.5;
    const bottomExposure = parseFloat(params.bottom_exposure) || 35;
    const bottomLayers = parseInt(params.bottom_layers) || 5;
    
    const liftDist = parseFloat(params.lift_distance) || 5;
    const liftSpeed = parseFloat(params.lift_speed) || 80;
    const retractSpeed = parseFloat(params.retract_speed) || 210;
    const restTime = parseFloat(params.rest_time) || 0.5;
    
    const liftTime = (liftDist / liftSpeed) * 60;
    const retractTime = (liftDist / retractSpeed) * 60;
    const moveTime = liftTime + retractTime + restTime;
    
    const actualBottomLayers = Math.min(bottomLayers, layers);
    const normalLayers = Math.max(0, layers - actualBottomLayers);
    
    const bottomTime = actualBottomLayers * (bottomExposure + moveTime);
    const normalTime = normalLayers * (exposureTime + moveTime);
    const timeMin = (bottomTime + normalTime) / 60;
    
    const mlResin = volumeCm3;
    
    return {
        ok: true, technology: 'SLA',
        ml_resin: parseFloat(mlResin.toFixed(2)),
        volume_cm3: parseFloat(volumeCm3.toFixed(2)),
        layers: layers,
        time_min: parseFloat(timeMin.toFixed(1)),
        time_formatted: formatTime(timeMin),
        height_mm: parseFloat(heightMm.toFixed(2)),
        width_mm: parseFloat(bbox.size[0].toFixed(2)),
        depth_mm: parseFloat(bbox.size[1].toFixed(2))
    };
}

function calculateFDM(stlPath, params) {
    const temperature = params.temperature || 210;
    const layerHeight = params.layer_height || 0.2;
    const fillDensity = params.fill_density || 15;
    const outputPath = stlPath.replace('.stl', '.gcode');
    
    const prusaCmd = `/usr/local/bin/squashfs-root/AppRun --export-gcode --layer-height ${layerHeight} --fill-density ${fillDensity}% --temperature ${temperature} --output ${outputPath} "${stlPath}" 2>&1`;
    try { execSync(prusaCmd, { timeout: 120000 }); } catch (e) {}
    
    if (!fs.existsSync(outputPath)) throw new Error('PrusaSlicer failed');
    
    const gcode = fs.readFileSync(outputPath, 'utf8');
    fs.unlinkSync(outputPath);
    const stats = parseGcode(gcode);
    
    return {
        ok: true, technology: 'FDM',
        grams: stats.grams,
        time_min: stats.timeMin,
        time_formatted: formatTime(stats.timeMin),
        meters: stats.meters,
        layers: stats.layers
    };
}

function parseGcode(gcode) {
    let grams = 0, timeMin = 0, meters = 0, layers = 0;
    const filamentMatch = gcode.match(/; filament used \[g\] = ([\d.]+)/);
    if (filamentMatch) grams = parseFloat(filamentMatch[1]);
    const timeMatch = gcode.match(/; estimated printing time[^=]*= (.+)/);
    if (timeMatch) {
        const t = timeMatch[1];
        const h = t.match(/(\d+)h/), m = t.match(/(\d+)m/), s = t.match(/(\d+)s/);
        timeMin = (h ? parseInt(h[1]) * 60 : 0) + (m ? parseInt(m[1]) : 0) + (s ? parseInt(s[1]) / 60 : 0);
    }
    const metersMatch = gcode.match(/; filament used \[mm\] = ([\d.]+)/);
    if (metersMatch) meters = parseFloat(metersMatch[1]) / 1000;
    const layerMatch = gcode.match(/; total layers count = (\d+)/);
    if (layerMatch) layers = parseInt(layerMatch[1]);
    return { grams, timeMin, meters, layers };
}

function formatTime(minutes) {
    const hrs = Math.floor(minutes / 60);
    const mins = Math.round(minutes % 60);
    return hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;
}

function cleanup(stlPath) {
    try { if (fs.existsSync(stlPath)) fs.unlinkSync(stlPath); } catch (e) {}
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Slicer Server v4.1.0 running on port ${PORT}`);
    console.log(`Features: FDM (PrusaSlicer) + SLA (calibrated formula)`);
});
