const express = require('express');
const multer  = require('multer');
const cors    = require('cors');
const { exec } = require('child_process');
const fs   = require('fs');
const path = require('path');
const os   = require('os');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const upload = multer({ dest: os.tmpdir() });

app.get('/', function(req, res) {
  res.json({ status: 'ok', service: 'Slicer3D API', version: '1.4.0' });
});

app.get('/health', function(req, res) {
  exec('slic3r --version 2>&1 || echo "not_found"', function(err, stdout) {
    res.json({
      status: 'ok',
      slic3r: stdout.includes('not_found') ? 'not installed' : stdout.trim(),
      uptime: process.uptime()
    });
  });
});

app.post('/slice', upload.single('file'), function(req, res) {
  if (!req.file) {
    return res.status(400).json({ error: 'No STL file uploaded' });
  }

  var stlPath  = req.file.path;
  var gcodeOut = path.join(os.tmpdir(), req.file.filename + '.gcode');

  // slic3r 1.3.x CLI: slic3r input.stl --output output.gcode
  var cmd = 'slic3r'
    + ' --layer-height 0.2'
    + ' --fill-density 15'
    + ' --perimeters 3'
    + ' --nozzle-diameter 0.4'
    + ' --filament-diameter 1.75'
    + ' --temperature 220'
    + ' --bed-temperature 60'
    + ' --output "' + gcodeOut + '"'
    + ' "' + stlPath + '"';

  console.log('CMD:', cmd);

  exec(cmd, { timeout: 180000 }, function(err, stdout, stderr) {
    try { fs.unlinkSync(stlPath); } catch(e) {}

    if (err) {
      console.error('Slice error stdout:', stdout);
      console.error('Slice error stderr:', stderr);
      try { fs.unlinkSync(gcodeOut); } catch(e) {}
      return res.status(500).json({
        error: 'Slice failed',
        detail: (stderr || stdout || 'unknown').substring(0, 800)
      });
    }

    if (!fs.existsSync(gcodeOut)) {
      return res.status(500).json({ error: 'Slice failed', detail: 'No gcode generated' });
    }

    try {
      var result = parseGcode(gcodeOut);
      try { fs.unlinkSync(gcodeOut); } catch(e) {}
      res.json({ ok: true, grams: result.grams, time_min: result.time_min, filament_m: result.filament_m });
    } catch(parseErr) {
      try { fs.unlinkSync(gcodeOut); } catch(e) {}
      res.status(500).json({ error: 'Could not parse gcode', detail: parseErr.message });
    }
  });
});

function parseGcode(gcodeFile) {
  var content = fs.readFileSync(gcodeFile, 'utf8');
  var lines   = content.split('\n');
  var grams = null, time_min = null, filament_m = null;

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];

    // Slic3r 1.x: ; filament used = 2180.5mm (5.3cm3)
    if (line.indexOf('; filament used =') !== -1) {
      var mm  = line.match(/([\d.]+)mm/);
      var cm3 = line.match(/([\d.]+)cm3/);
      if (mm)  filament_m = parseFloat(mm[1]) / 1000;
      if (cm3) grams = parseFloat((parseFloat(cm3[1]) * 1.24).toFixed(2));
    }
    // ; estimated printing time = 2h 29m 5s
    if (line.indexOf('estimated printing time') !== -1) {
      var h  = line.match(/(\d+)h/);
      var mi = line.match(/(\d+)m/);
      var s  = line.match(/(\d+)s/);
      time_min = (h ? parseInt(h[1]) : 0) * 60
               + (mi ? parseInt(mi[1]) : 0)
               + (s  ? parseInt(s[1])  : 0) / 60;
    }
  }

  if (grams === null && filament_m !== null) {
    var r = 0.0875;
    grams = parseFloat((Math.PI * r * r * filament_m * 100 * 1.24).toFixed(2));
  }

  if (grams === null || time_min === null) {
    throw new Error('Could not parse gcode. Lines: ' + lines.length);
  }

  return { grams: grams, time_min: Math.round(time_min), filament_m: filament_m };
}

app.listen(PORT, function() {
  console.log('Slicer3D API v1.4.0 on port ' + PORT);
});
