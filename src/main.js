import { createUIBindings } from "./ui/uiBindings.js";
import { createCameraController } from "./pipeline/cameraController.js";
import { createPosePipeline } from "./pipeline/posePipeline.js";
import { createVideoUploadController } from "./pipeline/videoUploadController.js";
import { createExplanationStore } from "./content/explanationStore.js";
import { createVisualization } from "./visualization/visualization.js";
import { uploadVideoToBackend } from "./apiClient.js";

async function main() {
  const els = {
    clubSelect: document.getElementById("clubSelect"),
    viewSelect: document.getElementById("viewSelect"),
    handednessSelect: document.getElementById("handednessSelect"),
    startBtn: document.getElementById("startBtn"),
    stopBtn: document.getElementById("stopBtn"),
    video: document.getElementById("video"),
    overlay: document.getElementById("overlay"),
    cameraStatus: document.getElementById("cameraStatus"),
    latencyStatus: document.getElementById("latencyStatus"),
    recordStatus: document.getElementById("recordStatus"),
    scoreValue: document.getElementById("scoreValue"),
    deductionList: document.getElementById("deductionList"),
    issueList: document.getElementById("issueList"),
    metricsGrid: document.getElementById("metricsGrid"),
    trajectoryCanvas: document.getElementById("trajectoryCanvas"),
    explanation: document.getElementById("explanation"),
  };

  const ui = createUIBindings(els);
  const camera = createCameraController(els);
  const videoUpload = createVideoUploadController(els);
  const explanationStore = createExplanationStore();
  const viz = createVisualization(els);

  let latencySamples = [];
  let currentMode = "camera"; // "camera" | "upload"
  let analysisHistory = []; // Store frames for seeking: { t: ms, payload }

  function percentile(sorted, p) {
    if (sorted.length === 0) return null;
    const idx = (sorted.length - 1) * p;
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    if (lo === hi) return sorted[lo];
    const w = idx - lo;
    return sorted[lo] * (1 - w) + sorted[hi] * w;
  }

  const pipeline = await createPosePipeline({
    overlayCanvas: els.overlay,
    videoEl: els.video,
    onFrame: (payload) => {
      // 在上传分析期间记录历史
      if (currentMode === "upload") {
        analysisHistory.push({
          t: els.video.currentTime,
          payload: payload,
        });
      }
      viz.renderAll(payload, explanationStore, currentMode === "upload");
      ui.renderResult(payload);
    },
    onLatency: (ms) => {
      if (ms == null || !Number.isFinite(ms) || ms <= 0) return;
      latencySamples.push(ms);
      if (latencySamples.length > 160) latencySamples.shift();
      if (latencySamples.length < 20) {
        ui.setLatency(ms);
        return;
      }
      const sorted = [...latencySamples].sort((a, b) => a - b);
      const p50 = percentile(sorted, 0.5);
      const p95 = percentile(sorted, 0.95);
      const avg = latencySamples.reduce((s, v) => s + v, 0) / latencySamples.length;
      ui.setLatency({ p50, p95, avg });
    },
    onRecorderState: (state) => ui.setRecorderState(state),
  });

  // ── 进度条 Seek 手动查看看回放 ─────────────────────────
  ui.onSeek((pct) => {
    if (currentMode !== "upload") return;
    const duration = videoUpload.getDuration();
    if (!duration) return;
    const targetTime = pct * duration;
    videoUpload.seek(targetTime);

    // 找到 analysisHistory 中最接近 targetTime 的那一帧重绘
    if (analysisHistory.length === 0) return;
    
    let closestFrame = analysisHistory[0];
    let minDiff = Math.abs(closestFrame.t - targetTime);

    for (let i = 1; i < analysisHistory.length; i++) {
      const diff = Math.abs(analysisHistory[i].t - targetTime);
      if (diff < minDiff) {
        minDiff = diff;
        closestFrame = analysisHistory[i];
      }
    }

    if (closestFrame && closestFrame.payload) {
      viz.renderAll(closestFrame.payload, explanationStore, true);
      ui.renderResult(closestFrame.payload);
    }
  });

  // ── 摄像头模式 ────────────────────────────────────────
  ui.onStart(async (config) => {
    latencySamples = [];
    ui.setCameraStatus("启动中...");
    pipeline.setVideoMode(false);
    const stream = await camera.start();
    ui.setCameraStatus("摄像头已启动");
    pipeline.setConfig(config);
    await pipeline.start(stream);
  });

  ui.onStop(async () => {
    await pipeline.stop();
    await camera.stop();
    ui.setCameraStatus("摄像头已停止");
    latencySamples = [];
  });

  // ── 模式切换 ──────────────────────────────────────────
  ui.onModeSwitch(async (mode) => {
    // 如果正在运行任一模式先停止
    if (currentMode === "camera") {
      try {
        await pipeline.stop();
        await camera.stop();
        ui.setCameraStatus("摄像头未启动");
      } catch (_) { /* 未运行时忽略 */ }
    } else {
      videoUpload.stop();
      ui.hideProgress();
      ui.setCameraStatus("等待上传视频");
    }

    currentMode = mode;
    latencySamples = [];

    if (mode === "upload") {
      els.video.classList.add("noMirror");
      ui.setCameraStatus("请上传视频文件");
    } else {
      els.video.classList.remove("noMirror");
      ui.setCameraStatus("摄像头未启动");
    }
  });

  // ── 视频上传与分析 ─────────────────────────────────────
  ui.onFileSelect(async (file) => {
    try {
      // 停止上次分析（如有）
      await pipeline.stop();
      videoUpload.stop();
      ui.hideProgress();
      analysisHistory = []; // 清空历史

      ui.setCameraStatus(`正在加载: ${file.name}`);
      ui.setAnalysisStatus("加载中...");

      await videoUpload.load(file);

      const config = {
        clubType: els.clubSelect.value,
        view: els.viewSelect.value,
        handedness: els.handednessSelect.value,
      };

      ui.setCameraStatus(`正在上传并分析: ${file.name}`);
      ui.setAnalysisStatus("请求后端分析...");

      // Request Python backend to perform the heavy lifting
      let backendData = null;
      try {
        const result = await uploadVideoToBackend(file, config);
        backendData = result.python_pipeline_results;
        ui.setAnalysisStatus("后端分析完成，构建视图中...");
      } catch (err) {
        console.error("Backend Error:", err);
        ui.setCameraStatus(`后端服务连接失败: ${err.message}`);
        ui.setAnalysisStatus("错误");
        return;
      }

      // Build analysis history array for seeking/scrubbing
      if (backendData && backendData.fullHistory) {
        analysisHistory = backendData.fullHistory.map((frame) => ({
          t: frame.t / 1000, // backend t is in ms, video.currentTime is in seconds
          payload: {
            ...backendData,
            rawLandmarks: frame.landmarks,
            analysisLandmarks: frame.landmarks, // backend has already smoothed it
          },
        }));
      }

      // When the video plays or is scrubbed, update the UI and drawn overlays
      videoUpload.onProgress((cur, dur) => {
        ui.setProgress(cur, dur);

        if (analysisHistory.length > 0) {
          let closestFrame = analysisHistory[0];
          let minDiff = Math.abs(closestFrame.t - cur);
          for (let i = 1; i < analysisHistory.length; i++) {
            const diff = Math.abs(analysisHistory[i].t - cur);
            if (diff < minDiff) {
              minDiff = diff;
              closestFrame = analysisHistory[i];
            }
          }
          if (closestFrame && closestFrame.payload) {
            viz.renderAll(closestFrame.payload, explanationStore, true);
            ui.renderResult(closestFrame.payload);
          }
        }
      });

      videoUpload.onEnded(async () => {
        ui.setAnalysisStatus("分析完成 ✓");
        ui.setCameraStatus("视频播放完成，可拖动进度条查看回放");
      });

      ui.setCameraStatus(`分析完成，正在回放: ${file.name}`);
      await videoUpload.play();
    } catch (err) {
      console.error(err);
      ui.setCameraStatus(`错误: ${err?.message || String(err)}`);
    }
  });
}

main().catch((err) => {
  console.error(err);
  const el = document.getElementById("cameraStatus");
  if (el) el.textContent = `启动失败: ${err?.message || String(err)}`;
});

