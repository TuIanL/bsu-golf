function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function loadScript(src) {
  // Avoid double-loading
  if (document.querySelector(`script[src="${src}"]`)) return;
  await new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.crossOrigin = "anonymous";
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Failed to load script: ${src}`));
    document.head.appendChild(s);
  });
}

export async function createPoseEstimator({ videoEl, onResults, onLatency }) {
  // MediaPipe legacy Pose solution (browser friendly).
  const POSE_JS = "https://cdn.jsdelivr.net/npm/@mediapipe/pose/pose.js";

  await loadScript(POSE_JS);
  const PoseCtor = window.Pose;
  if (!PoseCtor) throw new Error("Pose ctor not found on window");

  let pose = new PoseCtor({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`,
  });

  pose.setOptions({
    modelComplexity: 1,
    smoothLandmarks: true,
    minDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5,
    selfieMode: false,
  });

  let running = false;
  let rafId = null;
  let lastSendAt = 0;
  const minSendIntervalMs = 60; // ~16fps to keep latency reasonable
  let sendToken = 0;
  let lastSendAtToken = new Map();

  // Simple EMA smoothing fallback
  let smoothed = null;
  const alpha = 0.65;

  // Video upload mode: use video.currentTime instead of performance.now()
  let videoMode = false;
  // Allow a grace period after stop for late MediaPipe results
  let gracePeriodEnd = 0;

  // MediaPipe calls this in response to pose.send
  pose.onResults((results) => {
    // In video mode, allow results to arrive during grace period after stop
    if (!running && !(videoMode && performance.now() < gracePeriodEnd)) return;

    const token = sendToken;
    const sentAt = lastSendAtToken.get(token);
    if (sentAt != null) {
      onLatency?.(performance.now() - sentAt);
    }

    const raw = results?.poseLandmarks || null;
    if (!raw || raw.length === 0) return;

    const landmarks = raw.map((p) => ({
      x: p.x,
      y: p.y,
      z: p.z,
      visibility: p.visibility ?? 1,
    }));

    if (!smoothed) {
      smoothed = landmarks;
    } else {
      smoothed = smoothed.map((prev, i) => ({
        x: prev.x * alpha + landmarks[i].x * (1 - alpha),
        y: prev.y * alpha + landmarks[i].y * (1 - alpha),
        z: prev.z * alpha + landmarks[i].z * (1 - alpha),
        visibility: prev.visibility * alpha + (landmarks[i].visibility ?? 1) * (1 - alpha),
      }));
    }

    // Use video.currentTime in upload mode for accurate time-based analysis
    const frameTime = videoMode
      ? videoEl.currentTime * 1000 // video timeline in ms
      : performance.now();        // wall-clock in ms

    history.push({ t: frameTime, landmarks: smoothed });

    if (videoMode) {
      // In video mode, keep ALL frames (video is finite length)
      // Only trim if we have too many frames (>600) to avoid memory issues
      if (history.length > 600) history.shift();
    } else {
      // In camera mode, keep last ~4.5 seconds of wall-clock history
      const now = performance.now();
      while (history.length > 0 && now - history[0].t > 4500) history.shift();
    }

    onResults?.(smoothed, smoothed, { history: history.slice() });
  });

  let history = [];

  function setViewHint(_view) {
    // Placeholder: can tune options based on view in future.
  }

  function setVideoMode(isVideo) {
    videoMode = isVideo;
  }

  async function start() {
    if (running) return;
    running = true;
    history = [];
    smoothed = null;
    gracePeriodEnd = 0;

    // Wait for enough video frames.
    for (let i = 0; i < 30; i++) {
      if (videoEl && videoEl.readyState >= 2) break;
      await sleep(100);
    }
    // rAF loop: drive pose.send; pose.onResults will fire asynchronously.
    const loop = async () => {
      if (!running) return;
      const now = performance.now();
      const canSend = videoEl && videoEl.readyState >= 2;
      if (canSend && now - lastSendAt >= minSendIntervalMs) {
        lastSendAt = now;
        sendToken += 1;
        lastSendAtToken.set(sendToken, now);
        pose.send({ image: videoEl });
      }
      rafId = requestAnimationFrame(loop);
    };
    loop();
  }

  function stop() {
    running = false;
    // Allow 800ms grace period for late arriving MediaPipe results
    gracePeriodEnd = performance.now() + 800;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
  }

  return { start, stop, setViewHint, setVideoMode };
}
