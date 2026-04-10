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

// Multer — temp storage for uploaded STL files
const upload = multer({ dest: os.tmpdir() });

// ─── Root ────────────────────────────────────────────────────────
app.get('/', function(req, res) {
  res.json({
    status: 'ok',
    service: 'Slicer3D API',
    version: '1.1.0',
    endpoints: {
      slice: 'POST /slice  (multipart: file=STL, profile=bambu_a1_mini|ender3_se|prusa_mk4)',
      health: 'GET /health'
    }
  });
});

// ─── Health check ───────────────────────────────────────────────
app.get('/health', function(req, res) {
  exec('prusa-slicer --version 2>&1 || echo "not_found"', function(err, stdout) {
    res.json({
      status: 'ok',
      prusaslicer: stdout.includes('not_found') ? 'not installed' : stdout.trim(),
      uptime: process.uptime()
    });
  });
});

// ─── Main slice endpoint ─────────────────────────────────────────
app.post('/slice', upload.single('file'), function(req, res) {
  if (!req.file) {
    return res.status(400).json({ error: 'No STL file uploaded' });
  }

  var profile = (req.body && req.body.profile) || (req.query && req.query.profile) || 'bambu_a1_mini';
  var stlPath  = req.file.path;
  var outDir   = os.tmpdir();
  var gcodeOut = path.join(outDir, req.file.filename + '.gcode');
  var profileFile = path.join(__dirname, 'profiles', profile + '.ini');

  if (!fs.existsSync(profileFile)) {
    fs.unlinkSync(stlPath);
    return res.status(400).json({ error: "Profile '" + profile + "' not found" });
  }

  // PrusaSlicer CLI: --export-gcode --load <profile.ini> -o <output.gcode> <input.stl>
  var cmd = [
    'prusa-slicer',
    '--export-gcode',
    '--load "' + profileFile + '"',
    '-o "' + gcodeOut + '"',
    '"' + stlPath + '"'
  ].join(' ');

  exec(cmd, { timeout: 120000 }, function(err, stdout, stderr) {
    try { fs.unlinkSync(stlPath); } catch(e) {}

    if (err) {
      console.error('Slice error:', stderr);
      try { fs.unlinkSync(gcodeOut); } catch(e) {}
      return res.status(500).json({
        error: 'Slice failed',
        detail: stderr.substring(0, 500)
      });
    }

    try {
      var result = parseGcode(gcodeOut);
      fs.unlinkSync(gcodeOut);
      res.json({
        ok: true,
        grams: result.grams,
        time_min: result.time_min,
        filament_m: result.filament_m,
        profile: profile
      });
    } catch(parseErr) {
      try { fs.unlinkSync(gcodeOut); } catch(e) {}
      res.status(500).json({ error: 'Could not parse gcode', detail: parseErr.message });
    }
  });
});

// ─── Parse gcode (PrusaSlicer / OrcaSlicer format) ───────────────
function parseGcode(gcodeFile) {
  var content = fs.readFileSync(gcodeFile, 'utf8');
  var lines   = content.split('\n');

  var grams      = null;
  var time_min   = null;
  var filament_m = null;

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];

    // ; filament used [g] = 36.81
    if (line.indexOf('filament used [g]') !== -1) {
      var m = line.match(/=\s*([\d.]+)/);
      if (m) grams = parseFloat(m[1]);
    }
    // ; filament used [mm] = 12150.00
    if (line.indexOf('filament used [mm]') !== -1) {
      var m2 = line.match(/=\s*([\d.]+)/);
      if (m2) filament_m = parseFloat(m2[1]) / 1000;
    }
    // ; estimated printing time (normal mode) = 2h 29m 5s
    if (line.indexOf('estimated printing time') !== -1) {
      var h  = line.match(/(\d+)h/);
      var mi = line.match(/(\d+)m/);
      var s  = line.match(/(\d+)s/);
      var hours   = h  ? parseInt(h[1])  : 0;
      var minutes = mi ? parseInt(mi[1]) : 0;
      var seconds = s  ? parseInt(s[1])  : 0;
      time_min = hours * 60 + minutes + seconds / 60;
    }
    // ; total filament used [g] = 36.81  (Bambu format)
    if (line.indexOf('total filament used [g]') !== -1) {
      var m3 = line.match(/=\s*([\d.]+)/);
      if (m3) grams = parseFloat(m3[1]);
    }
  }

  if (grams === null || time_min === null) {
    throw new Error('Could not extract grams or time from gcode');
  }

  return { grams: grams, time_min: Math.round(time_min), filament_m: filament_m };
}

app.listen(PORT, function() {
  console.log('Slicer3D API running on port ' + PORT);
  console.log('Health: http://localhost:' + PORT + '/health');
});
