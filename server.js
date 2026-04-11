const express = require('express');
const multer  = require('multer');
const { exec } = require('child_process');
const fs   = require('fs');
const path = require('path');
const os   = require('os');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(function(req, res, next) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.use(express.json());
const upload = multer({ dest: os.tmpdir(), limits: { fileSize: 20 * 1024 * 1024 } });

app.get('/', function(req, res) { res.json({ status: 'ok', version: '1.7.0' }); });

app.get('/health', function(req, res) {
  exec('slic3r --version 2>&1 || echo "not_found"', function(err, stdout) {
    res.json({ status: 'ok', slic3r: stdout.includes('not_found') ? 'not installed' : stdout.trim(), uptime: process.uptime() });
  });
});

app.post('/slice', upload.single('file'), function(req, res) {
  if (!req.file) return res.status(400).json({ error: 'No STL file uploaded' });

  var tmpPath   = req.file.path;
  var stlPath   = tmpPath + '.stl';
  var gcodePath = tmpPath + '.gcode';

  try { fs.renameSync(tmpPath, stlPath); } catch(e) {
    return res.status(500).json({ error: 'rename failed', detail: e.message });
  }

  var cmd = 'slic3r'
    + ' --layer-height 0.2'
    + ' --fill-density 15'
    + ' --perimeters 3'
    + ' --nozzle-diameter 0.4'
    + ' --filament-diameter 1.75'
    + ' --temperature 220'
    + ' --bed-temperature 60'
    + ' --output "' + gcodePath + '"'
    + ' "' + stlPath + '"';

  console.log('CMD:', cmd);

  exec(cmd, { timeout: 300000 }, function(err, stdout, stderr) {
    try { fs.unlinkSync(stlPath); } catch(e) {}

    if (err) {
      console.error('STDERR:', stderr);
      console.error('STDOUT:', stdout);
      try { fs.unlinkSync(gcodePath); } catch(e) {}
      return res.status(500).json({ error: 'Slice failed', detail: (stderr||stdout||'unknown').substring(0,800) });
    }

    if (!fs.existsSync(gcodePath)) {
      return res.status(500).json({ error: 'No gcode generated', stdout: stdout, stderr: stderr });
    }

    // Log primeras 50 líneas del gcode para debug
    try {
      var sample = fs.readFileSync(gcodePath, 'utf8').split('\n').slice(0,50).join('\n');
      console.log('GCODE SAMPLE:\n', sample);
    } catch(e) {}

    try {
      var result = parseGcode(gcodePath);
      try { fs.unlinkSync(gcodePath); } catch(e) {}
      res.json({ ok: true, grams: result.grams, time_min: result.time_min, filament_m: result.filament_m });
    } catch(e) {
      try { fs.unlinkSync(gcodePath); } catch(x) {}
      res.status(500).json({ error: 'Parse failed', detail: e.message });
    }
  });
});

function parseGcode(f) {
  var content = fs.readFileSync(f, 'utf8');
  var lines = content.split('\n');
  var grams = null, time_min = null, filament_m = null;

  for (var i = 0; i < lines.length; i++) {
    var l = lines[i];

    // Slic3r 1.x formats:
    // ; filament used = 1234.5mm (2.3cm3)
    if (l.indexOf('; filament used =') !== -1) {
      var mm  = l.match(/([\d.]+)\s*mm/);
      var cm3 = l.match(/([\d.]+)\s*cm3/);
      if (mm)  filament_m = parseFloat(mm[1]) / 1000;
      if (cm3) grams = parseFloat((parseFloat(cm3[1]) * 1.24).toFixed(2));
    }
    // ; estimated printing time = 1h 2m 3s
    // ; estimated printing time (normal mode) = 1h 2m 3s
    if (l.indexOf('estimated printing time') !== -1) {
      var h  = l.match(/(\d+)h/);
      var mi = l.match(/(\d+)m/);
      var s  = l.match(/(\d+)s/);
      time_min = (h?parseInt(h[1]):0)*60 + (mi?parseInt(mi[1]):0) + (s?parseInt(s[1]):0)/60;
    }
    // ;TIME:8945 (CuraEngine/some slicers)
    if (l.indexOf(';TIME:') === 0) {
      var tm = l.match(/;TIME:(\d+)/);
      if (tm) time_min = parseInt(tm[1]) / 60;
    }
    // ;Filament used: 2.5m
    if (l.indexOf(';Filament used:') === 0) {
      var fm = l.match(/([\d.]+)m/);
      if (fm) filament_m = parseFloat(fm[1]);
    }
  }

  // Log lo que encontramos
  console.log('PARSE RESULT: grams=', grams, 'time_min=', time_min, 'filament_m=', filament_m);

  if (grams === null && filament_m !== null) {
    var r = 0.0875;
    grams = parseFloat((Math.PI * r * r * filament_m * 100 * 1.24).toFixed(2));
  }

  if (grams === null || time_min === null) {
    // Buscar cualquier línea con números útiles para debug
    var hints = lines.filter(function(l) { return l.indexOf(';') === 0; }).slice(0,30).join('\n');
    console.log('GCODE COMMENTS:', hints);
    throw new Error('Parse failed. Lines: ' + lines.length);
  }

  return { grams: grams, time_min: Math.round(time_min), filament_m: filament_m };
}

app.listen(PORT, function() { console.log('Slicer3D v1.7.0 on port ' + PORT); });
