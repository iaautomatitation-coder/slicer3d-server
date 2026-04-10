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
  res.json({ status: 'ok', service: 'Slicer3D API', version: '1.2.0' });
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

  var profile  = (req.body && req.body.profile) || (req.query && req.query.profile) || 'default';
  var stlPath  = req.file.path;
  var gcodeOut = path.join(os.tmpdir(), req.file.filename + '.gcode');
  var profileFile = path.join(__dirname, 'profiles', profile + '.ini');

  var cmd;
  if (fs.existsSync(profileFile)) {
    cmd = 'slic3r --export-gcode --load "' + profileFile + '" -o "' + gcodeOut + '" "' + stlPath + '"';
  } else {
    cmd = 'slic3r --export-gcode -o "' + gcodeOut + '" "' + stlPath + '"';
  }

  exec(cmd, { timeout: 120000 }, function(err, stdout, stderr) {
    try { fs.unlinkSync(stlPath); } catch(e) {}

    if (err) {
      console.error('Slice error:', stderr);
      try { fs.unlinkSync(gcodeOut); } catch(e) {}
      return res.status(500).json({ error: 'Slice failed', detail: stderr.substring(0, 500) });
    }

    try {
      var result = parseGcode(gcodeOut);
      fs.unlinkSync(gcodeOut);
      res.json({ ok: true, grams: result.grams, time_min: result.time_min, filament_m: result.filament_m, profile: profile });
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

    // Slic3r: ; filament used = 2180.5mm (5.3cm3)
    if (line.indexOf('; filament used =') !== -1) {
      var mm = line.match(/([\d.]+)mm/);
      var cm3 = line.match(/([\d.]+)cm3/);
      if (mm) filament_m = parseFloat(mm[1]) / 1000;
      if (cm3) grams = parseFloat((parseFloat(cm3[1]) * 1.24).toFixed(2));
    }
    // PrusaSlicer: ; filament used [g] = 36.81
    if (line.indexOf('filament used [g]') !== -1) {
      var m = line.match(/=\s*([\d.]+)/);
      if (m) grams = parseFloat(m[1]);
    }
    // PrusaSlicer: ; filament used [mm] = 2180.50
    if (line.indexOf('filament used [mm]') !== -1) {
      var m2 = line.match(/=\s*([\d.]+)/);
      if (m2) filament_m = parseFloat(m2[1]) / 1000;
    }
    // ; estimated printing time (normal mode) = 2h 29m 5s
    if (line.indexOf('estimated printing time') !== -1) {
      var h  = line.match(/(\d+)h/);
      var mi = line.match(/(\d+)m/);
      var s  = line.match(/(\d+)s/);
      time_min = (h ? parseInt(h[1]) : 0) * 60 + (mi ? parseInt(mi[1]) : 0) + (s ? parseInt(s[1]) : 0) / 60;
    }
  }

  if (grams === null && filament_m !== null) {
    var r = 0.0875;
    grams = parseFloat((Math.PI * r * r * filament_m * 100 * 1.24).toFixed(2));
  }

  if (grams === null || time_min === null) {
    throw new Error('Could not extract grams or time from gcode');
  }

  return { grams: grams, time_min: Math.round(time_min), filament_m: filament_m };
}

app.listen(PORT, function() {
  console.log('Slicer3D API running on port ' + PORT);
});
