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

// ─── Health check ───────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    service: 'Slicer3D API',
    version: '1.0.0',
    endpoints: {
      slice: 'POST /slice  (multipart: file=STL, profile=bambu_a1_mini|ender3_se|prusa_mk4)',
      health: 'GET /health'
    }
  });
});

app.get('/health', (req, res) => {
  // Check if OrcaSlicer is installed
  exec('orcaslicer --version 2>&1 || echo "not_found"', (err, stdout) => {
    res.json({
      status: 'ok',
      orcaslicer: stdout.includes('not_found') ? 'not installed' : stdout.trim(),
      uptime: process.uptime()
    });
  });
});

// ─── Main slice endpoint ─────────────────────────────────────────
app.post('/slice', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No STL file uploaded' });
  }

  const profile = req.profile || 'bambu_a1_mini';
  const stlPath = req.file.path;
  const outDir  = os.tmpdir();
  const gcodeOut = path.join(outDir, `${req.file.filename}.gcode`);
  const profileFile = path.join(__dirname, 'profiles', `${profile}.ini`);

  // Check profile exists
  if (!fs.existsSync(profileFile)) {
    fs.unlinkSync(stlPath);
    return res.status(400).json({ error: `Profile '${profile}' not found` });
  }

  const cmd = [
    'orcaslicer',
    `--load "${profileFile}"`,
    `--output "${gcodeOut}"`,
    `"${stlPath}"`
  ].join(' ');

  exec(cmd, { timeout: 120000 }, (err, stdout, stderr) => {
    // Clean up STL
    try { fs.unlinkSync(stlPath); } catch(e) {}

    if (err) {
      console.error('Slice error:', stderr);
      try { fs.unlinkSync(gcodeOut); } catch(e) {}
      return res.status(500).json({
        error: 'Slice failed',
        detail: stderr.substring(0, 500)
      });
    }

    // Parse gcode for filament usage and print time
    try {
      const result = parseGcode(gcodeOut);
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

// ─── Parse gcode output ──────────────────────────────────────────
function parseGcode(gcodeFile) {
  const content = fs.readFileSync(gcodeFile, 'utf8');
  const lines   = content.split('\n');

  let grams     = null;
  let time_min  = null;
  let filament_m = null;

  for (const line of lines) {
    // OrcaSlicer / PrusaSlicer format:
    // ; filament used [g] = 36.81
    if (line.includes('filament used [g]')) {
      const m = line.match(/=\s*([\d.]+)/);
      if (m) grams = parseFloat(m[1]);
    }
    // ; filament used [mm] = 2180.50
    if (line.includes('filament used [mm]')) {
      const m = line.match(/=\s*([\d.]+)/);
      if (m) filament_m = parseFloat(m[1]) / 1000;
    }
    // ; estimated printing time (normal mode) = 2h 29m 5s
    if (line.includes('estimated printing time')) {
      const h = line.match(/(\d+)h/);
      const mi = line.match(/(\d+)m/);
      const s  = line.match(/(\d+)s/);
      const hours   = h  ? parseInt(h[1])  : 0;
      const minutes = mi ? parseInt(mi[1]) : 0;
      const seconds = s  ? parseInt(s[1])  : 0;
      time_min = hours * 60 + minutes + seconds / 60;
    }
    // Bambu Studio format sometimes uses:
    // ; total filament used [g] = 36.81
    if (line.includes('total filament used [g]')) {
      const m = line.match(/=\s*([\d.]+)/);
      if (m) grams = parseFloat(m[1]);
    }
  }

  if (grams === null || time_min === null) {
    throw new Error('Could not extract grams or time from gcode');
  }

  return { grams, time_min: Math.round(time_min), filament_m };
}

app.listen(PORT, () => {
  console.log(`Slicer3D API running on port ${PORT}`);
  console.log(`Health: http://localhost:${PORT}/health`);
});
