import { createPoseEstimator } from "./poseEstimator.js";
import { createSwingAnalyzer } from "./swingAnalyzer.js";
import { createScoringEngine } from "../scoring/scoringEngine.js";

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
      const base = analyzer.analyze({
        rawLandmarks: raw,
        analysisLandmarks,
        history: historyInfo.history,
        view: config.view,
        handedness: config.handedness,
        clubType: config.clubType,
      });
      if (!base.ready) {
        onFrame?.({
          ...base,
          score: null,
          deductions: [],
        });
        return;
      }

      const scored = scoring.scoreFromIssues(base.issues);
      onFrame?.({
        ...base,
        ...scored,
      });
    },
    onLatency: (ms) => onLatency?.(ms),
  });

  const analyzer = createSwingAnalyzer();
  const scoring = createScoringEngine();

  let running = false;
  let isVideoMode = false;

  async function start(_stream) {
    if (running) return;
    running = true;
    onRecorderState?.("录制中");
    analyzer.reset();
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
