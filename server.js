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

app.get('/', function(req, res) {
  res.json({ status: 'ok', service: 'Slicer3D API', version: '1.5.0' });
});

app.get('/health', function(req, res) {
  exec('slic3r --version 2>&1 || echo "not_found"', function(err, stdout) {
    res.json({ status: 'ok', slic3r: stdout.includes('not_found') ? 'not installed' : stdout.trim(), uptime: process.uptime() });
  });
});

app.post('/slice', upload.single('file'), function(req, res) {
  if (!req.file) return res.status(400).json({ error: 'No STL file uploaded' });
  var stlPath = req.file.path + '.stl';
  var gcodeOut = req.file.path + '.gcode';
  try { fs.renameSync(req.file.path, stlPath); } catch(e) { return res.status(500).json({ error: e.message }); }
  var cmd = 'slic3r --layer-height 0.2 --fill-density 15 --perimeters 3 --nozzle-diameter 0.4 --filament-diameter 1.75 --temperature 220 --bed-temperature 60 --output "' + gcodeOut + '" "' + stlPath + '"';
  console.log('CMD:', cmd);
  console.log('STL exists:', require('fs').existsSync(stlPathStl || stlPath));
  exec(cmd, { timeout: 300000 }, function(err, stdout, stderr) {
    try { fs.unlinkSync(stlPath); } catch(e) {}
    if (err) { try { fs.unlinkSync(gcodeOut); } catch(e) {} return res.status(500).json({ error: 'Slice failed', detail: (stderr||stdout||'unknown').substring(0,800) }); }
    if (!fs.existsSync(gcodeOut)) return res.status(500).json({ error: 'No gcode generated' });
    try {
      var result = parseGcode(gcodeOut);
      try { fs.unlinkSync(gcodeOut); } catch(e) {}
      res.json({ ok: true, grams: result.grams, time_min: result.time_min, filament_m: result.filament_m });
    } catch(e) { try { fs.unlinkSync(gcodeOut); } catch(x) {} res.status(500).json({ error: 'Parse failed', detail: e.message }); }
  });
});

function parseGcode(f) {
  var lines = fs.readFileSync(f, 'utf8').split('\n');
  var grams = null, time_min = null, filament_m = null;
  for (var i = 0; i < lines.length; i++) {
    var l = lines[i];
    if (l.indexOf('; filament used =') !== -1) {
      var mm = l.match(/([\d.]+)mm/); var cm3 = l.match(/([\d.]+)cm3/);
      if (mm) filament_m = parseFloat(mm[1]) / 1000;
      if (cm3) grams = parseFloat((parseFloat(cm3[1]) * 1.24).toFixed(2));
    }
    if (l.indexOf('estimated printing time') !== -1) {
      var h = l.match(/(\d+)h/); var mi = l.match(/(\d+)m/); var s = l.match(/(\d+)s/);
      time_min = (h?parseInt(h[1]):0)*60 + (mi?parseInt(mi[1]):0) + (s?parseInt(s[1]):0)/60;
    }
  }
  if (grams === null && filament_m !== null) { var r=0.0875; grams=parseFloat((Math.PI*r*r*filament_m*100*1.24).toFixed(2)); }
  if (grams === null || time_min === null) throw new Error('Parse failed. Lines: ' + lines.length);
  return { grams: grams, time_min: Math.round(time_min), filament_m: filament_m };
}

app.listen(PORT, function() { console.log('Slicer3D v1.5.0 on port ' + PORT); });
