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

app.get('/', function(req, res) { res.json({ status: 'ok', version: '2.0.0' }); });

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

  var cmd = 'prusa-slicer --export-gcode'
    + ' --layer-height 0.2'
    + ' --fill-density 15%'
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
  
  console.log('=== PARSER v2.0 ===');
  console.log('Total lines:', lines.length);

  var comments = [];
  for (var i = 0; i < lines.length; i++) {
    if (lines[i].trim().indexOf(';') === 0) {
      comments.push(lines[i]);
    }
  }
  
  console.log('=== GCODE COMMENTS (last 40) ===');
  var lastComments = comments.slice(-40);
  for (var j = 0; j < lastComments.length; j++) {
    console.log(lastComments[j]);
  }
  console.log('=== END COMMENTS ===');

  var filament_mm = null;
  var filament_cm3 = null;
  var filament_g = null;
  var time_seconds = null;

  for (var k = 0; k < comments.length; k++) {
    var line = comments[k];

    var match = line.match(/;\s*filament\s+used\s*=\s*([\d.]+)\s*mm\s*\(([\d.]+)\s*cm3\)/i);
    if (match) {
      filament_mm = parseFloat(match[1]);
      filament_cm3 = parseFloat(match[2]);
      console.log('[MATCH] slic3r classic:', filament_mm + 'mm,', filament_cm3 + 'cm3');
    }
    
    match = line.match(/;\s*filament\s+used\s*\[mm\]\s*=\s*([\d.]+)/i);
    if (match && filament_mm === null) {
      filament_mm = parseFloat(match[1]);
      console.log('[MATCH] prusaslicer mm:', filament_mm + 'mm');
    }
    
    match = line.match(/;\s*filament\s+used\s*\[cm3\]\s*=\s*([\d.]+)/i);
    if (match && filament_cm3 === null) {
      filament_cm3 = parseFloat(match[1]);
      console.log('[MATCH] prusaslicer cm3:', filament_cm3 + 'cm3');
    }
    
    match = line.match(/;\s*filament\s+used\s*\[g\]\s*=\s*([\d.]+)/i);
    if (match) {
      filament_g = parseFloat(match[1]);
      console.log('[MATCH] prusaslicer g:', filament_g + 'g');
    }
    
    match = line.match(/;\s*filament\s+used\s*=\s*([\d.]+)\s*mm(?!\s*\()/i);
    if (match && filament_mm === null) {
      filament_mm = parseFloat(match[1]);
      console.log('[MATCH] generic mm:', filament_mm + 'mm');
    }
    
    match = line.match(/;\s*Filament\s+used:\s*([\d.]+)\s*m/i);
    if (match && filament_mm === null) {
      filament_mm = parseFloat(match[1]) * 1000;
      console.log('[MATCH] cura m:', filament_mm + 'mm');
    }

    if (time_seconds === null) {
      match = line.match(/;\s*estimated\s+printing\s+time\s*\([^)]*\)\s*=\s*(.+)/i);
      if (match) {
        time_seconds = parseTimeStr(match[1]);
        if (time_seconds) console.log('[MATCH] time with mode:', time_seconds + 's');
      }
      
      if (time_seconds === null) {
        match = line.match(/;\s*estimated\s+printing\s+time\s*=\s*(.+)/i);
        if (match) {
          time_seconds = parseTimeStr(match[1]);
          if (time_seconds) console.log('[MATCH] time simple:', time_seconds + 's');
        }
      }
      
      match = line.match(/;\s*TIME:\s*(\d+)/i);
      if (match && time_seconds === null) {
        time_seconds = parseInt(match[1]);
        console.log('[MATCH] cura time:', time_seconds + 's');
      }
    }
  }

  if (filament_cm3 !== null && filament_g === null) {
    filament_g = filament_cm3 * 1.24;
    console.log('[CALC] g from cm3:', filament_g.toFixed(2) + 'g');
  }
  
  if (filament_mm !== null && filament_g === null) {
    var r = 0.0875;
    var length_cm = filament_mm / 10;
    var volume_cm3 = Math.PI * r * r * length_cm;
    filament_g = volume_cm3 * 1.24;
    console.log('[CALC] g from mm:', filament_g.toFixed(2) + 'g');
  }

  var filament_m = filament_mm !== null ? filament_mm / 1000 : null;
  var time_min = time_seconds !== null ? time_seconds / 60 : null;

  console.log('=== FINAL RESULT ===');
  console.log('grams:', filament_g, 'time_min:', time_min, 'filament_m:', filament_m);

  if (filament_g === null) {
    console.log('ERROR: No se encontro filamento en el gcode');
    throw new Error('Parse failed: filament not found. Lines: ' + lines.length);
  }

  return {
    grams: parseFloat(filament_g.toFixed(2)),
    time_min: time_min !== null ? Math.round(time_min) : null,
    filament_m: filament_m !== null ? parseFloat(filament_m.toFixed(2)) : null
  };
}

function parseTimeStr(str) {
  if (!str) return null;
  var total = 0;
  
  var d = str.match(/(\d+)\s*d/i);
  if (d) total += parseInt(d[1]) * 86400;
  
  var h = str.match(/(\d+)\s*h/i);
  if (h) total += parseInt(h[1]) * 3600;
  
  var m = str.match(/(\d+)\s*m(?!s)/i);
  if (m) total += parseInt(m[1]) * 60;
  
  var s = str.match(/(\d+)\s*s/i);
  if (s) total += parseInt(s[1]);
  
  return total > 0 ? total : null;
}

app.listen(PORT, function() { console.log('Slicer3D v2.0.0 on port ' + PORT); });
