import { useEffect, useRef, useState, useCallback } from 'react';
import { Camera, Play, Pause, Settings, Maximize2, ZoomIn, ZoomOut, RefreshCw, Circle } from 'lucide-react';

interface TrackedPart {
  id: number;
  x: number;
  y: number;
  width: number;
  height: number;
  vx: number;
  vy: number;
  partName: string;
  partCode: string;
  status: 'OK' | 'NG';
  confidence: number;
  measurements: { name: string; value: number; nominal: number; upper: number; lower: number; unit: string; status: 'OK' | 'NG' }[];
  trackId: number;
  framesSinceSpawn: number;
  opacity: number;
}

const PART_DEFS = [
  {
    partName: 'Spur Gear A', partCode: 'SG-001',
    dims: [
      { name: 'OD', nominal: 12.00, upper: 12.05, lower: 11.95, unit: 'mm' },
      { name: 'ID', nominal: 4.00, upper: 4.03, lower: 3.97, unit: 'mm' },
      { name: 'THK', nominal: 2.50, upper: 2.55, lower: 2.45, unit: 'mm' },
    ],
  },
  {
    partName: 'Holder B', partCode: 'HLD-002',
    dims: [
      { name: 'LEN', nominal: 25.00, upper: 25.10, lower: 24.90, unit: 'mm' },
      { name: 'WID', nominal: 15.00, upper: 15.08, lower: 14.92, unit: 'mm' },
      { name: 'HOLE', nominal: 5.00, upper: 5.05, lower: 4.95, unit: 'mm' },
    ],
  },
  {
    partName: 'Screw M3', partCode: 'SCR-003',
    dims: [
      { name: 'DIA', nominal: 3.00, upper: 3.02, lower: 2.98, unit: 'mm' },
      { name: 'HEAD', nominal: 5.50, upper: 5.55, lower: 5.45, unit: 'mm' },
    ],
  },
  {
    partName: 'Pin Shaft C', partCode: 'PIN-004',
    dims: [
      { name: 'DIA', nominal: 2.00, upper: 2.02, lower: 1.98, unit: 'mm' },
      { name: 'LEN', nominal: 10.00, upper: 10.05, lower: 9.95, unit: 'mm' },
    ],
  },
];

let globalTrackId = 1;
const CONVEYOR_SPEED = 0.8;
const MIN_GAP = 60;

function createPart(canvasW: number, canvasH: number): TrackedPart {
  const def = PART_DEFS[Math.floor(Math.random() * PART_DEFS.length)];
  const isNG = Math.random() < 0.12;
  const w = 90;
  const h = 70;

  const x = canvasW + 10;
  const beltCenterY = canvasH * 0.5;
  const y = beltCenterY - h / 2;
  const vx = -CONVEYOR_SPEED;
  const vy = 0;

  const measurements = def.dims.map((d) => {
    const dev = isNG && Math.random() < 0.5
      ? (Math.random() > 0.5 ? 0.08 : -0.08)
      : (Math.random() - 0.5) * (d.upper - d.lower) * 0.8;
    const val = parseFloat((d.nominal + dev).toFixed(3));
    return { ...d, value: val, status: (val >= d.lower && val <= d.upper ? 'OK' : 'NG') as 'OK' | 'NG' };
  });

  const hasNG = measurements.some((m) => m.status === 'NG');

  return {
    id: Date.now() + Math.random(),
    x, y, width: w, height: h, vx, vy,
    partName: def.partName, partCode: def.partCode,
    status: hasNG ? 'NG' : 'OK',
    confidence: parseFloat((88 + Math.random() * 12).toFixed(1)),
    measurements,
    trackId: globalTrackId++,
    framesSinceSpawn: 0,
    opacity: 0,
  };
}

function canSpawnWithoutOverlap(parts: TrackedPart[], canvasW: number): boolean {
  for (const p of parts) {
    if (p.x + p.width > canvasW - MIN_GAP) {
      return false;
    }
  }
  return true;
}

function drawDashedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string, time: number) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  ctx.lineDashOffset = -time * 0.05;
  ctx.strokeRect(x, y, w, h);
  ctx.setLineDash([]);

  // Corner brackets
  const cornerLen = 10;
  ctx.lineWidth = 3;
  ctx.strokeStyle = color;
  const corners = [
    [x, y, cornerLen, 0, 0, cornerLen],
    [x + w, y, -cornerLen, 0, 0, cornerLen],
    [x, y + h, cornerLen, 0, 0, -cornerLen],
    [x + w, y + h, -cornerLen, 0, 0, -cornerLen],
  ];
  corners.forEach(([cx, cy, dx1, dy1, dx2, dy2]) => {
    ctx.beginPath();
    ctx.moveTo(cx + dx1, cy + dy1);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx + dx2, cy + dy2);
    ctx.stroke();
  });
}

function drawMeasurementLine(
  ctx: CanvasRenderingContext2D,
  x1: number, y1: number, x2: number, y2: number,
  label: string, color: string, status: 'OK' | 'NG'
) {
  const arrowSize = 5;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();

  // Arrow ends
  const angle = Math.atan2(y2 - y1, x2 - x1);
  [0, Math.PI].forEach((offset) => {
    const px = offset === 0 ? x1 : x2;
    const py = offset === 0 ? y1 : y2;
    const a = offset === 0 ? angle : angle + Math.PI;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px + arrowSize * Math.cos(a - 0.5), py + arrowSize * Math.sin(a - 0.5));
    ctx.moveTo(px, py);
    ctx.lineTo(px + arrowSize * Math.cos(a + 0.5), py + arrowSize * Math.sin(a + 0.5));
    ctx.stroke();
  });

  // Label
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  ctx.font = '10px monospace';
  const textW = ctx.measureText(label).width;
  const pad = 3;

  const bgColor = status === 'OK' ? 'rgba(34,197,94,0.9)' : 'rgba(239,68,68,0.9)';
  ctx.fillStyle = bgColor;
  ctx.beginPath();
  ctx.roundRect(mx - textW / 2 - pad, my - 7 - pad, textW + pad * 2, 14 + pad, 3);
  ctx.fill();

  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, mx, my);
}

function drawGrid(ctx: CanvasRenderingContext2D, w: number, h: number, time: number) {
  ctx.strokeStyle = 'rgba(0,200,255,0.06)';
  ctx.lineWidth = 0.5;
  const spacing = 40;
  const offsetX = (time * 0.02) % spacing;
  for (let x = -spacing + offsetX; x < w + spacing; x += spacing) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
  }
  for (let y = 0; y < h; y += spacing) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
  }
}

function drawScanLine(ctx: CanvasRenderingContext2D, w: number, h: number, time: number) {
  const y = (time * 0.5) % (h + 60) - 30;
  const grad = ctx.createLinearGradient(0, y - 30, 0, y + 30);
  grad.addColorStop(0, 'rgba(0,200,255,0)');
  grad.addColorStop(0.5, 'rgba(0,200,255,0.08)');
  grad.addColorStop(1, 'rgba(0,200,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, y - 30, w, 60);
}

export function LiveTrackingPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const partsRef = useRef<TrackedPart[]>([]);
  const animRef = useRef<number>(0);
  const timeRef = useRef(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const [selectedPart, setSelectedPart] = useState<TrackedPart | null>(null);
  const [stats, setStats] = useState({ total: 0, ok: 0, ng: 0, fps: 30 });
  const [showOverlay, setShowOverlay] = useState(true);
  const [showMeasurements, setShowMeasurements] = useState(true);
  const [showGrid, setShowGrid] = useState(true);
  const statsRef = useRef({ total: 0, ok: 0, ng: 0 });
  const lastSpawnTimeRef = useRef(performance.now());
  const nextSpawnDelay = useRef(500 + Math.random() * 1000);
  const fpsFrames = useRef<number[]>([]);

  const animate = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const now = performance.now();
    fpsFrames.current.push(now);
    fpsFrames.current = fpsFrames.current.filter((t) => now - t < 1000);

    const W = canvas.width;
    const H = canvas.height;
    timeRef.current++;
    const t = timeRef.current;

    // Background
    ctx.fillStyle = '#0a0e1a';
    ctx.fillRect(0, 0, W, H);

    // Conveyor belt visual
    const beltY = H * 0.3;
    const beltH = H * 0.4;
    ctx.fillStyle = 'rgba(255,255,255,0.02)';
    ctx.fillRect(0, beltY, W, beltH);
    // Belt edge lines
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    ctx.setLineDash([8, 6]);
    ctx.beginPath();
    ctx.moveTo(0, beltY); ctx.lineTo(W, beltY);
    ctx.moveTo(0, beltY + beltH); ctx.lineTo(W, beltY + beltH);
    ctx.stroke();
    ctx.setLineDash([]);
    // Belt direction arrows
    for (let ax = ((t * 0.5) % 80); ax < W; ax += 80) {
      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      ctx.beginPath();
      ctx.moveTo(ax, beltY + beltH / 2 - 4);
      ctx.lineTo(ax - 10, beltY + beltH / 2);
      ctx.lineTo(ax, beltY + beltH / 2 + 4);
      ctx.fill();
    }

    // Grid
    if (showGrid) drawGrid(ctx, W, H, t);

    // Scan line
    drawScanLine(ctx, W, H, t);

    // Spawn parts using real time (ms)
    if (now - lastSpawnTimeRef.current > nextSpawnDelay.current) {
      if (partsRef.current.length < 5 && canSpawnWithoutOverlap(partsRef.current, W)) {
        partsRef.current.push(createPart(W, H));
        lastSpawnTimeRef.current = now;
        nextSpawnDelay.current = 500 + Math.random() * 1000; // 0.5 - 1.5 seconds
      }
    }

    // Update & draw parts
    const newParts: TrackedPart[] = [];
    for (const p of partsRef.current) {
      p.x += p.vx;
      p.y += p.vy;
      p.framesSinceSpawn++;
      p.opacity = Math.min(1, p.framesSinceSpawn / 30);

      // Remove off-screen
      if (p.x < -200 || p.x > W + 200 || p.y < -200 || p.y > H + 200) {
        statsRef.current.total++;
        if (p.status === 'OK') statsRef.current.ok++;
        else statsRef.current.ng++;
        continue;
      }
      newParts.push(p);

      ctx.globalAlpha = p.opacity;

      const color = p.status === 'OK' ? '#22c55e' : '#ef4444';
      const colorDim = p.status === 'OK' ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)';

      // Part body (simulated shape)
      ctx.fillStyle = colorDim;
      ctx.fillRect(p.x, p.y, p.width, p.height);

      // Inner "part" visual
      ctx.fillStyle = p.status === 'OK' ? 'rgba(34,197,94,0.25)' : 'rgba(239,68,68,0.25)';
      const inset = 8;
      ctx.beginPath();
      ctx.roundRect(p.x + inset, p.y + inset, p.width - inset * 2, p.height - inset * 2, 4);
      ctx.fill();

      // Center crosshair
      const cx = p.x + p.width / 2;
      const cy = p.y + p.height / 2;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.globalAlpha = p.opacity * 0.5;
      ctx.beginPath();
      ctx.moveTo(cx - 8, cy); ctx.lineTo(cx + 8, cy);
      ctx.moveTo(cx, cy - 8); ctx.lineTo(cx, cy + 8);
      ctx.stroke();
      ctx.globalAlpha = p.opacity;

      if (showOverlay) {
        // Bounding box
        drawDashedRect(ctx, p.x, p.y, p.width, p.height, color, t);

        // Track ID label (top-left)
        ctx.font = 'bold 10px monospace';
        const trackLabel = `#${p.trackId} ${p.partCode}`;
        const tw = ctx.measureText(trackLabel).width;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.roundRect(p.x, p.y - 18, tw + 10, 16, [3, 3, 0, 0]);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(trackLabel, p.x + 5, p.y - 10);

        // Status badge (top-right)
        const statusLabel = `${p.status} ${p.confidence}%`;
        const sw = ctx.measureText(statusLabel).width;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.roundRect(p.x + p.width - sw - 10, p.y - 18, sw + 10, 16, [3, 3, 0, 0]);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'right';
        ctx.fillText(statusLabel, p.x + p.width - 5, p.y - 10);
      }

      // Measurement lines & annotations
      if (showMeasurements && p.measurements.length >= 2) {
        // Horizontal measurement line (width)
        const m0 = p.measurements[0];
        drawMeasurementLine(
          ctx,
          p.x, p.y + p.height + 12,
          p.x + p.width, p.y + p.height + 12,
          `${m0.name}: ${m0.value}${m0.unit}`,
          m0.status === 'OK' ? '#22c55e' : '#ef4444',
          m0.status
        );

        // Vertical measurement line (height)
        const m1 = p.measurements[1];
        drawMeasurementLine(
          ctx,
          p.x + p.width + 12, p.y,
          p.x + p.width + 12, p.y + p.height,
          `${m1.name}: ${m1.value}${m1.unit}`,
          m1.status === 'OK' ? '#22c55e' : '#ef4444',
          m1.status
        );

        // Additional measurements as annotations (bottom-left)
        if (p.measurements.length > 2) {
          p.measurements.slice(2).forEach((m, i) => {
            const label = `${m.name}: ${m.value}${m.unit}`;
            ctx.font = '9px monospace';
            const lw = ctx.measureText(label).width;
            const ly = p.y + p.height + 28 + i * 16;
            const bgC = m.status === 'OK' ? 'rgba(34,197,94,0.85)' : 'rgba(239,68,68,0.85)';
            ctx.fillStyle = bgC;
            ctx.beginPath();
            ctx.roundRect(p.x, ly - 6, lw + 8, 14, 2);
            ctx.fill();
            ctx.fillStyle = '#fff';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillText(label, p.x + 4, ly + 1);
          });
        }
      }

      ctx.globalAlpha = 1;
    }
    partsRef.current = newParts;

    // HUD overlay top-left
    ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.beginPath();
    ctx.roundRect(10, 10, 200, 70, 6);
    ctx.fill();
    ctx.font = '10px monospace';
    ctx.fillStyle = '#00c8ff';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(`LIVE TRACKING - STATION 1`, 18, 18);
    ctx.fillStyle = '#aaa';
    ctx.fillText(`FPS: ${fpsFrames.current.length}  |  Objects: ${partsRef.current.length}`, 18, 32);
    ctx.fillText(`Total: ${statsRef.current.total}  OK: ${statsRef.current.ok}  NG: ${statsRef.current.ng}`, 18, 46);
    const ngRate = statsRef.current.total > 0 ? ((statsRef.current.ng / statsRef.current.total) * 100).toFixed(1) : '0.0';
    ctx.fillStyle = parseFloat(ngRate) > 5 ? '#ef4444' : '#22c55e';
    ctx.fillText(`NG Rate: ${ngRate}%`, 18, 60);

    // Recording indicator
    ctx.fillStyle = t % 60 < 30 ? '#ef4444' : 'transparent';
    ctx.beginPath();
    ctx.arc(W - 25, 25, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = '10px monospace';
    ctx.textAlign = 'right';
    ctx.fillText('REC', W - 38, 29);

    // Timestamp
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.beginPath();
    ctx.roundRect(W - 180, H - 30, 170, 22, 4);
    ctx.fill();
    ctx.fillStyle = '#aaa';
    ctx.font = '10px monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(new Date().toLocaleString('id-ID'), W - 18, H - 19);

    setStats({ total: statsRef.current.total, ok: statsRef.current.ok, ng: statsRef.current.ng, fps: fpsFrames.current.length });

    animRef.current = requestAnimationFrame(animate);
  }, [showOverlay, showMeasurements, showGrid]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resizeCanvas = () => {
      const parent = canvas.parentElement;
      if (parent) {
        canvas.width = parent.clientWidth;
        canvas.height = parent.clientHeight;
      }
    };
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    if (isPlaying) {
      animRef.current = requestAnimationFrame(animate);
    }

    return () => {
      window.removeEventListener('resize', resizeCanvas);
      cancelAnimationFrame(animRef.current);
    };
  }, [isPlaying, animate]);

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    const clicked = partsRef.current.find(
      (p) => mx >= p.x && mx <= p.x + p.width && my >= p.y && my <= p.y + p.height
    );
    setSelectedPart(clicked || null);
  };

  const resetStats = () => {
    statsRef.current = { total: 0, ok: 0, ng: 0 };
    globalTrackId = 1;
  };

  const ngRate = stats.total > 0 ? ((stats.ng / stats.total) * 100).toFixed(1) : '0.0';

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1>Live Tracking</h1>
          <p className="text-[var(--muted-foreground)] text-sm mt-1">Real-time camera feed dengan object tracking & dimensional analysis</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 px-2 py-1 rounded-full bg-green-100 text-green-700 text-xs">
            <Circle className="w-2 h-2 fill-green-500" /> Station 1 - Connected
          </div>
        </div>
      </div>

      <div className="grid lg:grid-cols-[1fr_320px] gap-4">
        {/* Camera Feed */}
        <div className="flex flex-col gap-3">
          <div className="relative bg-[#0a0e1a] rounded-xl overflow-hidden border border-[var(--border)] h-[480px]">
            <canvas
              ref={canvasRef}
              className="w-full h-full cursor-crosshair"
              onClick={handleCanvasClick}
            />
          </div>

          {/* Controls */}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => setIsPlaying(!isPlaying)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm text-white ${isPlaying ? 'bg-red-500 hover:bg-red-600' : 'bg-green-600 hover:bg-green-700'}`}
            >
              {isPlaying ? <><Pause className="w-4 h-4" /> Pause</> : <><Play className="w-4 h-4" /> Resume</>}
            </button>
            <button onClick={resetStats} className="flex items-center gap-2 px-3 py-2 border border-[var(--border)] rounded-lg text-sm hover:bg-[var(--accent)]">
              <RefreshCw className="w-4 h-4" /> Reset Counter
            </button>
            <div className="flex items-center gap-1 ml-auto">
              <button
                onClick={() => setShowOverlay(!showOverlay)}
                className={`px-3 py-2 rounded-lg text-xs border ${showOverlay ? 'bg-blue-600 text-white border-blue-600' : 'border-[var(--border)] hover:bg-[var(--accent)]'}`}
              >
                Bounding Box
              </button>
              <button
                onClick={() => setShowMeasurements(!showMeasurements)}
                className={`px-3 py-2 rounded-lg text-xs border ${showMeasurements ? 'bg-blue-600 text-white border-blue-600' : 'border-[var(--border)] hover:bg-[var(--accent)]'}`}
              >
                Measurements
              </button>
              <button
                onClick={() => setShowGrid(!showGrid)}
                className={`px-3 py-2 rounded-lg text-xs border ${showGrid ? 'bg-blue-600 text-white border-blue-600' : 'border-[var(--border)] hover:bg-[var(--accent)]'}`}
              >
                Grid
              </button>
            </div>
          </div>
        </div>

        {/* Side Panel */}
        <div className="flex flex-col gap-3 overflow-y-auto">
          {/* Live Stats */}
          <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-4">
            <h3 className="mb-3">Live Statistics</h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-blue-50 rounded-lg p-3 text-center">
                <div className="text-xl text-blue-700" style={{ fontWeight: 500 }}>{stats.total}</div>
                <div className="text-[11px] text-blue-600">Total Inspected</div>
              </div>
              <div className="bg-green-50 rounded-lg p-3 text-center">
                <div className="text-xl text-green-700" style={{ fontWeight: 500 }}>{stats.ok}</div>
                <div className="text-[11px] text-green-600">OK</div>
              </div>
              <div className="bg-red-50 rounded-lg p-3 text-center">
                <div className="text-xl text-red-700" style={{ fontWeight: 500 }}>{stats.ng}</div>
                <div className="text-[11px] text-red-600">NG</div>
              </div>
              <div className={`rounded-lg p-3 text-center ${parseFloat(ngRate) > 5 ? 'bg-red-50' : 'bg-green-50'}`}>
                <div className={`text-xl ${parseFloat(ngRate) > 5 ? 'text-red-700' : 'text-green-700'}`} style={{ fontWeight: 500 }}>{ngRate}%</div>
                <div className={`text-[11px] ${parseFloat(ngRate) > 5 ? 'text-red-600' : 'text-green-600'}`}>NG Rate</div>
              </div>
            </div>
            <div className="mt-3 flex items-center justify-between text-xs text-[var(--muted-foreground)]">
              <span>FPS: {stats.fps}</span>
              <span>Objects: {partsRef.current.length}</span>
            </div>
          </div>

          {/* Selected Part Detail */}
          <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-4">
            <h3 className="mb-3">Detail Part</h3>
            {selectedPart ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm" style={{ fontWeight: 500 }}>{selectedPart.partName}</div>
                    <div className="text-xs text-[var(--muted-foreground)]">{selectedPart.partCode} | Track #{selectedPart.trackId}</div>
                  </div>
                  <span className={`px-2 py-0.5 rounded-full text-xs ${selectedPart.status === 'OK' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                    {selectedPart.status}
                  </span>
                </div>
                <div className="text-xs text-[var(--muted-foreground)]">
                  Confidence: {selectedPart.confidence}%
                </div>
                <div className="space-y-2">
                  {selectedPart.measurements.map((m) => (
                    <div key={m.name} className={`p-2.5 rounded-lg text-xs ${m.status === 'OK' ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
                      <div className="flex items-center justify-between mb-1">
                        <span style={{ fontWeight: 500 }}>{m.name}</span>
                        <span className={`px-1.5 py-0.5 rounded text-[10px] ${m.status === 'OK' ? 'bg-green-200 text-green-800' : 'bg-red-200 text-red-800'}`}>{m.status}</span>
                      </div>
                      <div className={m.status === 'OK' ? 'text-green-700' : 'text-red-700'} style={{ fontWeight: 500 }}>
                        {m.value} {m.unit}
                      </div>
                      <div className="text-[var(--muted-foreground)] mt-0.5">
                        Nom: {m.nominal} | {m.lower} ~ {m.upper} {m.unit}
                      </div>
                      {/* Tolerance bar */}
                      <div className="mt-1.5 relative h-1.5 bg-gray-200 rounded-full overflow-hidden">
                        <div className={`absolute h-full rounded-full ${m.status === 'OK' ? 'bg-green-500' : 'bg-red-500'}`}
                          style={{ width: `${Math.max(5, Math.min(100, ((m.value - m.lower) / (m.upper - m.lower)) * 100))}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="text-center py-8 text-[var(--muted-foreground)]">
                <Camera className="w-8 h-8 mx-auto mb-2 opacity-40" />
                <p className="text-sm">Klik part pada feed untuk melihat detail</p>
              </div>
            )}
          </div>

          {/* Legend */}
          <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-4">
            <h3 className="mb-3">Keterangan</h3>
            <div className="space-y-2 text-xs">
              <div className="flex items-center gap-2">
                <div className="w-4 h-0.5 bg-green-500 border border-dashed border-green-500" />
                <span>Bounding Box OK (within tolerance)</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-0.5 bg-red-500 border border-dashed border-red-500" />
                <span>Bounding Box NG (out of tolerance)</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-1 bg-green-500 rounded" />
                <span className="text-green-700">Measurement OK</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-1 bg-red-500 rounded" />
                <span className="text-red-700">Measurement NG</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-[1px] bg-cyan-400 opacity-30" />
                <span>Grid reference overlay</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}