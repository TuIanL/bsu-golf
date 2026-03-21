function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}

function clamp(x, a, b) {
  return Math.max(a, Math.min(b, x));
}

function dist(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function angleBetween(a, b, c) {
  // angle at b for points a-b-c
  const ab = { x: a.x - b.x, y: a.y - b.y };
  const cb = { x: c.x - b.x, y: c.y - b.y };
  const dot = ab.x * cb.x + ab.y * cb.y;
  const na = Math.sqrt(ab.x * ab.x + ab.y * ab.y);
  const nb = Math.sqrt(cb.x * cb.x + cb.y * cb.y);
  if (na < 1e-6 || nb < 1e-6) return 0;
  const cos = dot / (na * nb);
  const rad = Math.acos(clamp(cos, -1, 1));
  return (rad * 180) / Math.PI;
}

function mirrorLandmarksX(landmarks) {
  if (!landmarks) return landmarks;
  return landmarks.map((p) => ({ ...p, x: 1 - p.x }));
}

function getLm(landmarks, idx) {
  if (!landmarks || !landmarks[idx]) return null;
  return landmarks[idx];
}

function getMid(landmarks, idxA, idxB) {
  const a = getLm(landmarks, idxA);
  const b = getLm(landmarks, idxB);
  if (!a || !b) return null;
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
}

function computeVelocity(history, idx) {
  // returns array of velocities aligned to history entries (velocity at i compared to i-1)
  const out = [];
  for (let i = 1; i < history.length; i++) {
    const prev = history[i - 1].landmarks[idx];
    const cur = history[i].landmarks[idx];
    const dt = Math.max(1, history[i].t - history[i - 1].t); // ms
    if (!prev || !cur) {
      out.push(0);
      continue;
    }
    const dx = cur.x - prev.x;
    const dy = cur.y - prev.y;
    const v = Math.sqrt(dx * dx + dy * dy) / (dt / 1000); // normalized units per second
    out.push(v);
  }
  return out;
}

export function createSwingAnalyzer() {
  let lastScore = null;

  function reset() {
    lastScore = null;
  }

  function analyze({ rawLandmarks, analysisLandmarks, history, view, handedness, clubType }) {
    if (!history || history.length < 12) {
      return {
        issues: [],
        metrics: {},
        trajectory: { path: [], center: [] },
        explanationKey: null,
        debug: { view },
        rawLandmarks,
        ready: false,
      };
    }

    const mirrored = handedness === "left" ? mirrorLandmarksX(analysisLandmarks) : analysisLandmarks;

    const frame0 = history[0];
    const frameLast = history[history.length - 1];

    const idxLw = 15;
    const idxRw = 16;
    const idxLe = 13;
    const idxRe = 14;
    const idxLs = 11;
    const idxRs = 12;
    const idxLh = 23;
    const idxRh = 24;

    // Extract wrist/shoulder/hip tracks from history (mirrored already).
    const wristTrack = history.map((f) => {
      const L = getLm(f.landmarks, idxLw) || { x: 0, y: 0, z: 0, visibility: 0 };
      const R = getLm(f.landmarks, idxRw) || { x: 0, y: 0, z: 0, visibility: 0 };
      const shouldMid = getMid(f.landmarks, idxLs, idxRs) || { x: 0, y: 0, z: 0 };
      const hipMid = getMid(f.landmarks, idxLh, idxRh) || { x: 0, y: 0, z: 0 };
      const handVis = Math.max(L.visibility ?? 0, R.visibility ?? 0);
      return {
        t: f.t,
        L,
        R,
        handsMid: { x: (L.x + R.x) / 2, y: (L.y + R.y) / 2, z: (L.z + R.z) / 2 },
        shouldMid,
        hipMid,
        handVis,
      };
    });

    // Impact detection: peak wrist velocity near end of history
    const historyRecent = wristTrack.slice(Math.max(0, wristTrack.length - 40)); // last ~2-3s

    // Build velocity series for max between L/R wrists.
    let best = { i: -1, v: 0 };
    for (let i = 1; i < historyRecent.length; i++) {
      const a = historyRecent[i - 1];
      const b = historyRecent[i];
      const dt = Math.max(1, b.t - a.t);
      const vL = dist(a.L, b.L) / (dt / 1000);
      const vR = dist(a.R, b.R) / (dt / 1000);
      const v = Math.max(vL, vR) * Math.max(0.2, (a.handVis + b.handVis) / 2);
      if (v > best.v) best = { i, v };
    }
    const impactIndex = best.i;

    const minImpactVelocity = 0.65; // tuned for normalized units
    const impactFrame =
      impactIndex >= 0 && best.v > minImpactVelocity
        ? historyRecent[impactIndex]
        : historyRecent[historyRecent.length - 1];

    // Back-swing start: first time hands are above shoulders by threshold.
    const thresholdY = 0.08;
    let backStart = wristTrack[0];
    for (let i = 0; i < wristTrack.length; i++) {
      const f = wristTrack[i];
      const handY = Math.min(f.L.y, f.R.y);
      const shoulderY = f.shouldMid.y;
      if (handY < shoulderY - thresholdY) {
        backStart = f;
        break;
      }
    }

    // Transition: time when wrist y starts moving down (from up) after backStart.
    let transition = backStart;
    for (let i = Math.max(1, wristTrack.indexOf(backStart)); i < wristTrack.length; i++) {
      const prev = wristTrack[i - 1];
      const cur = wristTrack[i];
      const handYPrev = Math.min(prev.L.y, prev.R.y);
      const handYCur = Math.min(cur.L.y, cur.R.y);
      const dy = handYCur - handYPrev; // positive => moving down
      const wasUp = handYPrev < prev.shouldMid.y - thresholdY / 2;
      if (wasUp && dy > 0.003) {
        transition = cur;
        break;
      }
    }

    const impactT = impactFrame.t;
    const backStartT = backStart.t;
    const transitionT = transition.t;

    const backswingMs = clamp(transitionT - backStartT, 50, 2500);
    const downswingMs = clamp(impactT - transitionT, 50, 2500);
    const rhythmRatio = downswingMs / Math.max(80, backswingMs); // ~1.0 ideal-ish

    // Club head speed (proxy): peak wrist velocity around impact
    const speedEst = best.v; // normalized units/s
    // Convert to a plausible speed scale (heuristic).
    const clubHeadSpeed = speedEst * (view === "side" ? 60 : 55); // yields ~10-70 typical for normalized

    // Metrics from impact posture
    const impactLandmarks = mirrored; // latest mirrored landmarks
    const shoulderMid = getMid(impactLandmarks, idxLs, idxRs) || impactFrame.shouldMid;
    const hipMid = getMid(impactLandmarks, idxLh, idxRh) || impactFrame.hipMid;
    const Lw = getLm(impactLandmarks, idxLw) || impactFrame.L;
    const Rw = getLm(impactLandmarks, idxRw) || impactFrame.R;

    // Better: compute angle at right elbow between shoulder-elbow-wrist
    const rightShoulder = getLm(impactLandmarks, idxRs) || shoulderMid;
    const rightElbow = getLm(impactLandmarks, idxRe) || impactFrame.R;
    const rightWrist = getLm(impactLandmarks, idxRw) || impactFrame.R;
    const clubFaceAngle = angleBetween(rightShoulder, rightElbow, rightWrist); // 0-180

    // Strike efficiency: how centered hands are relative to hip and shoulders.
    const handMid = impactFrame.handsMid;
    const spineTilt = Math.abs(shoulderMid.y - hipMid.y);
    const handsHipDist = dist({ x: handMid.x, y: handMid.y }, hipMid);
    const handsShoulderDist = dist({ x: handMid.x, y: handMid.y }, shoulderMid);

    // Higher is better.
    let strikeEfficiency =
      100 -
      Math.abs(handsShoulderDist - handsHipDist) * 180 -
      Math.abs(spineTilt - 0.12) * 450;
    strikeEfficiency = clamp(strikeEfficiency, 0, 100);

    // Issue candidates (Top10)
    const issues = [];

    function addIssue(label, conf, fix) {
      issues.push({
        label,
        confidence: clamp01(conf),
        fix,
      });
    }

    // 1) Rhythm / tempo issues
    const fastBack = backswingMs < 280;
    const slowBack = backswingMs > 900;
    if (fastBack) addIssue("上杆过快", clamp01((280 - backswingMs) / 250), "放慢上杆，让转体更顺");
    if (slowBack) addIssue("上杆过慢", clamp01((backswingMs - 900) / 800), "加快手臂提升速度");
    if (rhythmRatio < 0.72) addIssue("下杆启动过早", clamp01((0.72 - rhythmRatio) / 0.72), "先完成转体再下杆");
    if (rhythmRatio > 1.55) addIssue("下杆过慢", clamp01((rhythmRatio - 1.55) / 1.55), "加快重心进入");

    // 2) Ball contact issues (front/side both work as proxies)
    // Topping proxy: hands too high at impact relative to shoulders
    const handY = Math.min(Lw.y, Rw.y);
    const shoulderY = shoulderMid.y;
    const toppingConf = clamp01((shoulderY - handY - 0.05) / 0.08);
    if (toppingConf > 0.15) addIssue("打顶", toppingConf, "下杆加深，击球瞬间降低手部高度");

    // Fat shot (hit thick) proxy: hands too low/forward relative to hips (approx)
    const hipY = hipMid.y;
    const thickConf = clamp01((handY - hipY + 0.02) / 0.10);
    if (thickConf > 0.15) addIssue("打厚", thickConf, "保持手臂长度，击球点更靠前");

    // 3) Direction issues (front view stronger)
    if (view === "front") {
      const wristX = impactFrame.handsMid.x;
      const hipX = hipMid.x;
      const shoulderX = shoulderMid.x;
      const rel = wristX - hipX;
      const dirConf = clamp01(Math.abs(rel) / 0.15);

      if (rel < -0.03) addIssue("左曲球", dirConf, "让杆面更靠外摆入，保持收杆");
      else if (rel > 0.03) addIssue("右曲球", dirConf, "减少外向内切入，击球后保持杆面");

      const skew = (shoulderMid.x - hipMid.x) / 0.2;
      if (Math.abs(skew) > 0.25) addIssue("斜飞球", clamp01(Math.abs(skew) / 0.8), "提高转体一致性，保持路径在同一平面");
    } else {
      // Side view: use elbow extension vs body tilt to infer push/slice tendencies.
      const ext = clubFaceAngle; // 0-180, larger means more open
      const bias = (ext - 120) / 60;
      const conf = clamp01(Math.abs(bias));
      if (bias > 0.2) addIssue("右曲球", conf, "减小杆面开放度，击球后收住");
      if (bias < -0.2) addIssue("左曲球", conf, "提高杆面稳定性，避免过早翻转");
      if (conf > 0.35) addIssue("斜飞球", clamp01(conf * 0.9), "维持下杆平面，避免外侧拉出");
    }

    // 4) Speed / efficiency issues
    if (clubHeadSpeed < 28) addIssue("杆头速度不足", clamp01((30 - clubHeadSpeed) / 30), "加大转体幅度，提升挥杆速度");
    if (strikeEfficiency < 62) addIssue("击球效率偏低", clamp01((65 - strikeEfficiency) / 65), "稳定触球点，减少节奏波动");

    // Keep Top10
    issues.sort((a, b) => b.confidence - a.confidence);
    const top = issues.slice(0, 10);

    // Trajectory visualization data from history
    const recent = wristTrack.slice(Math.max(0, wristTrack.length - 55));
    const path = recent.map((f) => {
      // For front view: x = handsMid.x, y = handsMid.y
      // For side view: x = handsMid.x, y = handsMid.y (more meaningful as 2D proxy)
      return {
        x: f.handsMid.x,
        y: f.handsMid.y,
        t: f.t,
      };
    });
    const center = recent.map((f) => ({
      x: f.hipMid.x,
      y: f.hipMid.y,
      t: f.t,
    }));

    const primary = top[0]?.label ?? null;
    return {
      issues: top.map((t) => ({ label: t.label, confidence: t.confidence, fix: t.fix })),
      metrics: {
        "杆头速度": clubHeadSpeed,
        "挥杆节奏比": rhythmRatio,
        "杆面角度": clubFaceAngle,
        "击球效率": strikeEfficiency,
      },
      trajectory: { path, center, impact: impactFrame, backStart, transition },
      explanationKey: primary,
      debug: {
        backswingMs,
        downswingMs,
        minImpactVelocity: best.v,
        impactT,
        primary,
        view,
      },
      // Note: rawLandmarks are used by overlay drawing
      rawLandmarks,
      ready: true,
    };
  }

  return { reset, analyze };
}

