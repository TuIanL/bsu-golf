const CONNECTIONS = [
  [11, 12],
  [11, 13],
  [13, 15],
  [12, 14],
  [14, 16],
  [11, 23],
  [12, 24],
  [23, 24],
  [23, 25],
  [25, 27],
  [24, 26],
  [26, 28],
  [15, 17],
  [16, 18],
  [15, 19],
  [16, 20],
];

function clamp(x, a, b) {
  return Math.max(a, Math.min(b, x));
}

function setCanvasSizeToVideo(canvas, video) {
  const rect = video.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(rect.width * dpr));
  const h = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
}

function drawOverlay({ canvas, landmarks, mirrored = true }) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!landmarks || landmarks.length === 0) return;

  const W = canvas.width;
  const H = canvas.height;

  // Mirror x only when video is CSS-flipped (camera mode)
  const pts = landmarks.map((p) => ({
    x: mirrored ? (1 - p.x) * W : p.x * W,
    y: p.y * H,
    v: p.visibility ?? 1,
  }));

  ctx.lineWidth = Math.max(2, Math.round(W / 400));
  ctx.strokeStyle = "rgba(80, 210, 255, 0.8)";

  for (const [a, b] of CONNECTIONS) {
    const pa = pts[a];
    const pb = pts[b];
    if (!pa || !pb) continue;
    const alpha = clamp(Math.min(pa.v, pb.v), 0, 1);
    ctx.globalAlpha = 0.15 + 0.85 * alpha;
    ctx.beginPath();
    ctx.moveTo(pa.x, pa.y);
    ctx.lineTo(pb.x, pb.y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // draw nodes
  for (const [i, p] of pts.entries()) {
    const r = Math.max(3, Math.round(W / 220));
    const alpha = clamp(p.v, 0, 1);
    ctx.fillStyle = `rgba(255, 205, 80, ${0.18 + 0.75 * alpha})`;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawTrajectory({ canvas, trajectory, view }) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "rgba(14, 20, 32, 1)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // grid
  ctx.strokeStyle = "rgba(60, 90, 130, 0.35)";
  ctx.lineWidth = 1;
  const stepX = canvas.width / 6;
  const stepY = canvas.height / 4;
  for (let i = 1; i < 6; i++) {
    ctx.beginPath();
    ctx.moveTo(i * stepX, 0);
    ctx.lineTo(i * stepX, canvas.height);
    ctx.stroke();
  }
  for (let j = 1; j < 4; j++) {
    ctx.beginPath();
    ctx.moveTo(0, j * stepY);
    ctx.lineTo(canvas.width, j * stepY);
    ctx.stroke();
  }

  if (!trajectory) return;

  const path = trajectory.path || [];
  const center = trajectory.center || [];
  if (path.length < 2 && center.length < 2) return;

  function mapPoint(p) {
    // Normalize x to canvas
    const x = (1 - p.x) * canvas.width;
    // Use y as inverted height to screen coord
    const y = (1 - p.y) * canvas.height;
    return { x, y };
  }

  // club path
  if (path.length >= 2) {
    ctx.strokeStyle = "rgba(80, 210, 255, 0.9)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let i = 0; i < path.length; i++) {
      const m = mapPoint(path[i]);
      if (i === 0) ctx.moveTo(m.x, m.y);
      else ctx.lineTo(m.x, m.y);
    }
    ctx.stroke();
  }

  // center shift
  if (center.length >= 2) {
    ctx.strokeStyle = "rgba(170, 100, 255, 0.75)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < center.length; i++) {
      const m = mapPoint(center[i]);
      if (i === 0) ctx.moveTo(m.x, m.y);
      else ctx.lineTo(m.x, m.y);
    }
    ctx.stroke();
  }

  // impact marker (latest point)
  if (trajectory.impact) {
    const p = mapPoint({ x: trajectory.impact.handsMid.x, y: trajectory.impact.handsMid.y });
    ctx.fillStyle = "rgba(255, 80, 120, 0.95)";
    ctx.beginPath();
    ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
    ctx.fill();
  }

  // label
  ctx.fillStyle = "rgba(230, 240, 255, 0.95)";
  ctx.font = "12px system-ui, -apple-system, Segoe UI, Roboto, Arial";
  ctx.fillText(`视角: ${view === "side" ? "侧面" : "正面"}（轨迹为2D代理）`, 12, 18);
}

export function createVisualization(els) {
  const overlay = els.overlay;
  const videoEl = els.video || document.getElementById("video");
  const trajectoryCanvas = els.trajectoryCanvas;

  function renderAll(payload, explanationStore, uploadMode = false) {
    if (!payload) return;
    if (videoEl) setCanvasSizeToVideo(overlay, videoEl);

    drawOverlay({ canvas: overlay, landmarks: payload.rawLandmarks, mirrored: !uploadMode });
    if (payload.score == null) return;

    drawTrajectory({
      canvas: trajectoryCanvas,
      trajectory: payload.trajectory,
      view: payload.debug?.view || "front",
    });

    const primary = payload.explanationKey;
    if (explanationStore && explanationStore.render) {
      explanationStore.render(els.explanation, primary);
    }
  }

  return { renderAll };
}

