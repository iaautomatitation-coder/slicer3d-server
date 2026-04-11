var express = require('express');
var multer = require('multer');
var cors = require('cors');
var fs = require('fs');
var path = require('path');
var exec = require('child_process').exec;

var app = express();
var upload = multer({ dest: '/tmp/uploads/' });

app.use(cors());
app.use(express.json());

// Servir archivos estáticos (cotizador)
app.use(express.static(__dirname));

app.get('/', function(req, res) {
  res.json({ status: 'ok', version: '3.0.0', engine: 'PrusaSlicer' });
});

app.get('/health', function(req, res) {
  exec('prusa-slicer --version 2>&1 || echo "not_found"', function(err, stdout) {
    res.json({ 
      status: 'ok', 
      slicer: stdout.includes('not_found') ? 'not installed' : stdout.trim().split('\n')[0], 
      uptime: process.uptime(),
      version: '3.0.0'
    });
  });
});

app.post('/slice', upload.single('file'), function(req, res) {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  var stlPath = req.file.path + '.stl'; fs.renameSync(req.file.path, stlPath);
  var gcodePath = stlPath + '.gcode';

  // Obtener parámetros del request (con defaults)
  var params = {
    layer_height: req.body.layer_height || '0.2',
    fill_density: req.body.fill_density || '15',
    perimeters: req.body.perimeters || '3',
    nozzle_diameter: req.body.nozzle_diameter || '0.4',
    filament_diameter: req.body.filament_diameter || '1.75',
    temperature: req.body.temperature || '220',
    bed_temperature: req.body.bed_temperature || '60',
    // Velocidades
    perimeter_speed: req.body.perimeter_speed || '60',
    infill_speed: req.body.infill_speed || '80',
    travel_speed: req.body.travel_speed || '150',
    first_layer_speed: req.body.first_layer_speed || '20',
    external_perimeter_speed: req.body.external_perimeter_speed || '40',
    solid_infill_speed: req.body.solid_infill_speed || '60',
    // Capas
    top_solid_layers: req.body.top_solid_layers || '4',
    bottom_solid_layers: req.body.bottom_solid_layers || '4',
    // Extras
    ironing: req.body.ironing || '0',
    support_material: req.body.support_material || 'none'
  };

  console.log('=== SLICE REQUEST ===');
  console.log('File:', req.file.originalname);
  console.log('Params:', JSON.stringify(params, null, 2));

  // Construir comando PrusaSlicer
  var cmd = 'prusa-slicer --export-gcode'
    + ' --layer-height ' + params.layer_height
    + ' --fill-density ' + params.fill_density + '%'
    + ' --perimeters ' + params.perimeters
    + ' --nozzle-diameter ' + params.nozzle_diameter
    + ' --filament-diameter ' + params.filament_diameter
    + ' --temperature ' + params.temperature
    + ' --bed-temperature ' + params.bed_temperature
    // Velocidades (PrusaSlicer usa mm/s directamente)
    + ' --perimeter-speed ' + params.perimeter_speed
    + ' --infill-speed ' + params.infill_speed
    + ' --travel-speed ' + params.travel_speed
    + ' --first-layer-speed ' + params.first_layer_speed
    + ' --external-perimeter-speed ' + params.external_perimeter_speed
    + ' --solid-infill-speed ' + params.solid_infill_speed
    // Capas sólidas
    + ' --top-solid-layers ' + params.top_solid_layers
    + ' --bottom-solid-layers ' + params.bottom_solid_layers;

  // Agregar ironing si está activo
  if (params.ironing === '1') {
    cmd += ' --ironing';
  }

  // Agregar soportes si están activos
  if (params.support_material === 'buildplate') {
    cmd += ' --support-material --support-material-buildplate-only';
  } else if (params.support_material === 'everywhere') {
    cmd += ' --support-material';
  }

  // Output y archivo de entrada
  cmd += ' --output "' + gcodePath + '"';
  cmd += ' "' + stlPath + '"';

  console.log('CMD:', cmd);

  exec(cmd, { timeout: 300000 }, function(err, stdout, stderr) {
    // Limpiar STL
    try { fs.unlinkSync(stlPath); } catch(e) {}

    if (err) {
      console.log('STDERR:', stderr);
      try { fs.unlinkSync(gcodePath); } catch(e) {}
      return res.status(500).json({ error: 'Slice failed', detail: stderr || err.message });
    }

    // Leer y parsear gcode
    var gcode;
    try {
      gcode = fs.readFileSync(gcodePath, 'utf8');
    } catch(e) {
      return res.status(500).json({ error: 'Gcode read failed', detail: e.message });
    }

    // Limpiar gcode
    try { fs.unlinkSync(gcodePath); } catch(e) {}

    // Parsear resultados
    var result = parseGcode(gcode);
    
    console.log('=== RESULT ===');
    console.log('Grams:', result.grams, 'Time:', result.time_min, 'min', 'Filament:', result.filament_m, 'm');
    
    res.json({
      ok: true,
      grams: result.grams,
      time_min: result.time_min,
      filament_m: result.filament_m
    });
  });
});

function parseGcode(gcode) {
  var lines = gcode.split('\n');
  var filament_mm = null;
  var filament_cm3 = null;
  var filament_g = null;
  var time_min = null;

  // Buscar en comentarios del gcode
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    
    // PrusaSlicer: ; filament used [mm] = 3687.2
    var matchMM = line.match(/;\s*filament used \[mm\]\s*=\s*([\d.]+)/i);
    if (matchMM) {
      filament_mm = parseFloat(matchMM[1]);
      console.log('[MATCH] PrusaSlicer mm:', filament_mm);
    }

    // PrusaSlicer: ; filament used [cm3] = 8.9
    var matchCM3 = line.match(/;\s*filament used \[cm3\]\s*=\s*([\d.]+)/i);
    if (matchCM3) {
      filament_cm3 = parseFloat(matchCM3[1]);
      console.log('[MATCH] PrusaSlicer cm3:', filament_cm3);
    }

    // PrusaSlicer: ; filament used [g] = 11.1
    var matchG = line.match(/;\s*filament used \[g\]\s*=\s*([\d.]+)/i);
    if (matchG) {
      filament_g = parseFloat(matchG[1]);
      console.log('[MATCH] PrusaSlicer g:', filament_g);
    }

    // PrusaSlicer: ; estimated printing time (normal mode) = 1h 7m 23s
    var matchTime = line.match(/;\s*estimated printing time.*?=\s*(.+)/i);
    if (matchTime) {
      time_min = parseTimeString(matchTime[1]);
      console.log('[MATCH] PrusaSlicer time:', matchTime[1], '->', time_min, 'min');
    }

    // Formato antiguo slic3r: ; filament used = 3687.2mm (8.9cm3)
    var matchOld = line.match(/;\s*filament used\s*=\s*([\d.]+)mm\s*\(([\d.]+)cm3\)/i);
    if (matchOld) {
      filament_mm = parseFloat(matchOld[1]);
      filament_cm3 = parseFloat(matchOld[2]);
      console.log('[MATCH] slic3r classic:', filament_mm + 'mm,', filament_cm3 + 'cm3');
    }
  }

  // Calcular gramos si no viene directo
  var grams = filament_g;
  if (!grams && filament_cm3) {
    grams = filament_cm3 * 1.24; // PLA density
    console.log('[CALC] g from cm3:', grams);
  }

  // Convertir mm a metros
  var filament_m = filament_mm ? filament_mm / 1000 : null;

  return {
    grams: grams ? Math.round(grams * 100) / 100 : null,
    time_min: time_min,
    filament_m: filament_m ? Math.round(filament_m * 100) / 100 : null
  };
}

function parseTimeString(timeStr) {
  // Parsear formatos como "1h 7m 23s", "45m 30s", "2h 30m", etc.
  var hours = 0, minutes = 0, seconds = 0;
  
  var hMatch = timeStr.match(/(\d+)\s*h/i);
  var mMatch = timeStr.match(/(\d+)\s*m/i);
  var sMatch = timeStr.match(/(\d+)\s*s/i);
  
  if (hMatch) hours = parseInt(hMatch[1]);
  if (mMatch) minutes = parseInt(mMatch[1]);
  if (sMatch) seconds = parseInt(sMatch[1]);
  
  return Math.round(hours * 60 + minutes + seconds / 60);
}

var PORT = process.env.PORT || 3000;
app.listen(PORT, function() {
  console.log('Slicer server v3.0.0 running on port ' + PORT);
  console.log('Engine: PrusaSlicer with dynamic parameters');
});
