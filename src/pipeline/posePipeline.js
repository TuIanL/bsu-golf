import { createPoseEstimator } from "./poseEstimator.js";

export async function createPosePipeline({
  overlayCanvas,
  videoEl,
  onFrame,
  onLatency,
  onRecorderState,
}) {
  let config = {
    clubType: "wood",
    view: "front",
    handedness: "right",
  };

  const estimator = await createPoseEstimator({
    videoEl,
    onResults: (raw, analysisLandmarks, historyInfo) => {
      // 在彻底移除前端启发式分析后，我们将不再直接计算 score / issues 等，
      // 仅回传原始与平滑后的 landmarks 供实时渲染 (如摄像头模式下)。
      onFrame?.({
        rawLandmarks: raw,
        analysisLandmarks: analysisLandmarks,
        history: historyInfo.history,
        score: null,
        deductions: [],
        issues: [],
        metrics: {},
        ready: true,
      });
    },
    onLatency: (ms) => onLatency?.(ms),
  });

  let running = false;
  let isVideoMode = false;

  async function start(_stream) {
    if (running) return;
    running = true;
    onRecorderState?.("录制中");
    estimator.setVideoMode(isVideoMode);
    estimator.start();
  }

  async function stop() {
    if (!running) return;
    running = false;
    onRecorderState?.("停止");
    estimator.stop();
  }

  function setConfig(next) {
    config = { ...config, ...next };
    estimator.setViewHint(config.view);
  }

  function setVideoMode(mode) {
    isVideoMode = mode;
  }

  return {
    start,
    stop,
    setConfig,
    setVideoMode,
  };
}
