/**
 * main.js — 路由驱动的应用入口
 *
 * 按路由初始化各页面模块，替代旧的 tab 切换逻辑。
 */

import { initRouter, onRouteChange, navigate } from "./router.js";
import { initTaskStore } from "./taskStore.js";
import { initUploadPage } from "./pages/uploadPage.js";
import { mountReport } from "./pages/reportPage.js";
import { createCameraController } from "./pipeline/cameraController.js";
import { createPosePipeline } from "./pipeline/posePipeline.js";
import { createExplanationStore } from "./content/explanationStore.js";
import { createVisualization } from "./visualization/visualization.js";

async function main() {
  // ── 初始化全局状态 ──────────────────────────
  initTaskStore();
  initUploadPage();

  // ── Landing 按钮绑定 ────────────────────────
  document.getElementById("btnGoCamera")?.addEventListener("click", () => navigate("#/camera"));
  document.getElementById("btnGoUpload")?.addEventListener("click", () => navigate("#/upload"));
  document.getElementById("uploadBackBtn")?.addEventListener("click", () => navigate("#/"));
  document.getElementById("cameraBackBtn")?.addEventListener("click", () => navigate("#/"));

  // ── 摄像头模式相关 DOM ──────────────────────
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

  const camera = createCameraController(els);
  const explanationStore = createExplanationStore();
  const viz = createVisualization(els);

  // Cache-bust uiBindings
  const v = new URL(import.meta.url).searchParams.get("v") || "0";
  const { createUIBindings } = await import(`./ui/uiBindings.js?v=${v}`);
  const ui = createUIBindings(els);

  let latencySamples = [];

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
      viz.renderAll(payload, explanationStore, false);
      ui.renderResult(payload);
    },
    onLatency: (ms) => {
      if (ms == null || !Number.isFinite(ms) || ms <= 0) return;
      latencySamples.push(ms);
      if (latencySamples.length > 160) latencySamples.shift();
      if (latencySamples.length < 20) { ui.setLatency(ms); return; }
      const sorted = [...latencySamples].sort((a, b) => a - b);
      const p50 = percentile(sorted, 0.5);
      const p95 = percentile(sorted, 0.95);
      const avg = latencySamples.reduce((s, v) => s + v, 0) / latencySamples.length;
      ui.setLatency({ p50, p95, avg });
    },
    onRecorderState: (state) => ui.setRecorderState(state),
  });

  // ── 摄像头启停 ──────────────────────────────
  let cameraRunning = false;

  ui.onStart(async (config) => {
    latencySamples = [];
    ui.setCameraStatus("启动中...");
    pipeline.setVideoMode(false);
    const stream = await camera.start();
    ui.setCameraStatus("摄像头已启动");
    pipeline.setConfig(config);
    await pipeline.start(stream);
    cameraRunning = true;
  });

  ui.onStop(async () => {
    await pipeline.stop();
    await camera.stop();
    ui.setCameraStatus("摄像头已停止");
    latencySamples = [];
    cameraRunning = false;
  });

  // ── 路由变化处理 ──────────────────────────
  onRouteChange(async (route) => {
    // 离开摄像头页面时自动停止
    if (route.page !== "pageCamera" && cameraRunning) {
      try {
        await pipeline.stop();
        await camera.stop();
        cameraRunning = false;
      } catch {}
    }

    // 进入报告页时挂载数据
    if (route.page === "pageReport" && route.params.id) {
      mountReport(route.params.id);
    }
  });

  // ── 启动路由 ────────────────────────────────
  initRouter();
}

main().catch((err) => {
  console.error(err);
  const el = document.getElementById("cameraStatus");
  if (el) el.textContent = `启动失败: ${err?.message || String(err)}`;
});
