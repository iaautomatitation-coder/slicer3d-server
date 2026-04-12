const express = require('express');
const multer = require('multer');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const NodeStl = require('node-stl');

const app = express();
app.use(cors());
app.use(express.json());

const upload = multer({ dest: '/tmp/uploads/' });

// Health check
app.get('/', (req, res) => {
    res.json({ 
        status: 'ok', 
        version: '4.0.0',
        features: ['FDM', 'SLA'],
        timestamp: new Date().toISOString()
    });
});

// Main slice endpoint - supports FDM and SLA
app.post('/slice', upload.single('file'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ ok: false, error: 'No file uploaded' });
    }

    const technology = req.body.technology || 'FDM';
    
    // Rename to .stl extension
    const stlPath = req.file.path + '.stl';
    fs.renameSync(req.file.path, stlPath);

    try {
        if (technology === 'SLA') {
            // SLA: Calculate using node-stl (volume-based)
            const result = calculateSLA(stlPath, req.body);
            cleanup(stlPath);
            return res.json(result);
        } else {
            // FDM: Use PrusaSlicer
            const result = calculateFDM(stlPath, req.body);
            cleanup(stlPath);
            return res.json(result);
        }
    } catch (error) {
        cleanup(stlPath);
        console.error('Slice error:', error);
        return res.status(500).json({ ok: false, error: error.message });
    }
});

// SLA Calculation using node-stl
function calculateSLA(stlPath, params) {
    const stl = new NodeStl(stlPath);
    
    // Volume in cm³ (= ml of resin)
    const volumeCm3 = stl.volume;
    
    // Bounding box [x, y, z] in mm
    const boundingBox = stl.boundingBox;
    const heightMm = boundingBox[2];
    const widthMm = boundingBox[0];
    const depthMm = boundingBox[1];
    
    // Layer parameters
    const layerHeight = parseFloat(params.layer_height) || 0.05; // 50 micras default
    const layers = Math.ceil(heightMm / layerHeight);
    
    // Exposure times (seconds)
    const normalExposure = parseFloat(params.exposure_time) || 8;
    const bottomExposure = parseFloat(params.bottom_exposure) || 60;
    const bottomLayers = parseInt(params.bottom_layers) || 5;
    const liftTime = parseFloat(params.lift_time) || 5; // tiempo de levantamiento por capa
    
    // Time calculation
    const bottomTime = bottomLayers * (bottomExposure + liftTime);
    const normalTime = (layers - bottomLayers) * (normalExposure + liftTime);
    const totalSeconds = bottomTime + normalTime;
    const timeMin = totalSeconds / 60;
    
    // Add support factor (typically 5-15% extra resin)
    const supportFactor = parseFloat(params.support_factor) || 1.10;
    const mlResin = volumeCm3 * supportFactor;
    
    // Surface area for reference
    const surfaceArea = stl.area; // cm²
    
    return {
        ok: true,
        technology: 'SLA',
        ml_resin: parseFloat(mlResin.toFixed(2)),
        volume_cm3: parseFloat(volumeCm3.toFixed(2)),
        layers: layers,
        time_min: parseFloat(timeMin.toFixed(1)),
        time_formatted: formatTime(timeMin),
        height_mm: parseFloat(heightMm.toFixed(2)),
        width_mm: parseFloat(widthMm.toFixed(2)),
        depth_mm: parseFloat(depthMm.toFixed(2)),
        surface_area_cm2: parseFloat(surfaceArea.toFixed(2)),
        layer_height_mm: layerHeight,
        exposure_time_s: normalExposure,
        bottom_exposure_s: bottomExposure,
        bottom_layers: bottomLayers
    };
}

// FDM Calculation using PrusaSlicer
function calculateFDM(stlPath, params) {
    const temperature = params.temperature || 210;
    const layerHeight = params.layer_height || 0.2;
    const fillDensity = params.fill_density || 15;
    
    // Build PrusaSlicer command
    const outputPath = stlPath.replace('.stl', '.gcode');
    const prusaCmd = `/usr/local/bin/squashfs-root/AppRun --export-gcode ` +
        `--layer-height ${layerHeight} ` +
        `--fill-density ${fillDensity}% ` +
        `--temperature ${temperature} ` +
        `--output ${outputPath} ` +
        `"${stlPath}" 2>&1`;

    try {
        execSync(prusaCmd, { timeout: 120000 });
    } catch (e) {
        // PrusaSlicer may return non-zero but still work
    }

    if (!fs.existsSync(outputPath)) {
        throw new Error('PrusaSlicer failed to generate gcode');
    }

    const gcode = fs.readFileSync(outputPath, 'utf8');
    fs.unlinkSync(outputPath);

    // Parse gcode for stats
    const stats = parseGcode(gcode);

    return {
        ok: true,
        technology: 'FDM',
        grams: stats.grams,
        time_min: stats.timeMin,
        time_formatted: formatTime(stats.timeMin),
        meters: stats.meters,
        layers: stats.layers,
        layer_height_mm: parseFloat(layerHeight),
        fill_density: fillDensity
    };
}

// Parse PrusaSlicer gcode for statistics
function parseGcode(gcode) {
    let grams = 0;
    let timeMin = 0;
    let meters = 0;
    let layers = 0;

    // PrusaSlicer comments
    const filamentMatch = gcode.match(/; filament used \[g\] = ([\d.]+)/);
    if (filamentMatch) grams = parseFloat(filamentMatch[1]);

    const timeMatch = gcode.match(/; estimated printing time[^=]*= (.+)/);
    if (timeMatch) {
        const timeStr = timeMatch[1];
        // Parse "1h 23m 45s" or "23m 45s" format
        const hours = timeStr.match(/(\d+)h/);
        const mins = timeStr.match(/(\d+)m/);
        const secs = timeStr.match(/(\d+)s/);
        timeMin = (hours ? parseInt(hours[1]) * 60 : 0) +
                  (mins ? parseInt(mins[1]) : 0) +
                  (secs ? parseInt(secs[1]) / 60 : 0);
    }

    const metersMatch = gcode.match(/; filament used \[mm\] = ([\d.]+)/);
    if (metersMatch) meters = parseFloat(metersMatch[1]) / 1000;

    const layerMatch = gcode.match(/; total layers count = (\d+)/);
    if (layerMatch) layers = parseInt(layerMatch[1]);

    return { grams, timeMin, meters, layers };
}

// Format time as "Xh Ym"
function formatTime(minutes) {
    const hrs = Math.floor(minutes / 60);
    const mins = Math.round(minutes % 60);
    if (hrs > 0) {
        return `${hrs}h ${mins}m`;
    }
    return `${mins}m`;
}

// Cleanup temp files
function cleanup(stlPath) {
    try {
        if (fs.existsSync(stlPath)) fs.unlinkSync(stlPath);
    } catch (e) {}
}

// STL info endpoint (without slicing)
app.post('/info', upload.single('file'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ ok: false, error: 'No file uploaded' });
    }

    const stlPath = req.file.path + '.stl';
    fs.renameSync(req.file.path, stlPath);

    try {
        const stl = new NodeStl(stlPath);
        cleanup(stlPath);

        return res.json({
            ok: true,
            volume_cm3: parseFloat(stl.volume.toFixed(2)),
            weight_g: parseFloat(stl.weight.toFixed(2)),
            bounding_box: stl.boundingBox.map(v => parseFloat(v.toFixed(2))),
            surface_area_cm2: parseFloat(stl.area.toFixed(2)),
            center_of_mass: stl.centerOfMass.map(v => parseFloat(v.toFixed(2))),
            is_watertight: stl.isWatertight
        });
    } catch (error) {
        cleanup(stlPath);
        return res.status(500).json({ ok: false, error: error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🖨️ Slicer Server v4.0.0 running on port ${PORT}`);
    console.log(`   Features: FDM (PrusaSlicer) + SLA (node-stl)`);
});
