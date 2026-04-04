/**
 * videoUploadController.js
 * 控制本地视频文件的加载、播放与分析生命周期。
 */
export function createVideoUploadController(els) {
  const { video } = els;
  let objectUrl = null;
  let onEndedCb = null;
  let progressRafId = null;
  let onProgressCb = null;

  /** 加载文件，设置 video.src，准备播放 */
  async function load(file) {
    // 释放上次的 object URL
    _release();

    objectUrl = URL.createObjectURL(file);
    video.srcObject = null; // 断开摄像头流
    video.src = objectUrl;
    video.loop = false;
    video.muted = true;

    // 等待元数据加载（获取 duration）
    await new Promise((resolve, reject) => {
      video.onloadedmetadata = resolve;
      video.onerror = () => reject(new Error("视频文件加载失败，请检查格式是否支持。"));
    });

    video.onended = () => {
      _stopProgress();
      onEndedCb?.();
    };
  }

  /** 开始播放（同时启动进度轮询） */
  async function play() {
    try {
      await video.play();
    } catch (err) {
      if (err.name !== "AbortError") throw err;
    }
    _startProgress();
  }

  /** 暂停 */
  function pause() {
    video.pause();
    _stopProgress();
  }

  /** 停止并释放资源 */
  function stop() {
    video.pause();
    video.src = "";
    _stopProgress();
    _release();
  }

  function getDuration() {
    return isFinite(video.duration) ? video.duration : 0;
  }

  function getCurrentTime() {
    return video.currentTime || 0;
  }

  function seek(time) {
    if (isFinite(time)) {
      video.currentTime = Math.max(0, Math.min(time, getDuration()));
      onProgressCb?.(getCurrentTime(), getDuration());
    }
  }

  function onEnded(cb) {
    onEndedCb = cb;
  }

  function onProgress(cb) {
    onProgressCb = cb;
  }

  // ─── 内部工具 ────────────────────────────────────────────
  function _release() {
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
      objectUrl = null;
    }
  }

  function _startProgress() {
    _stopProgress();
    const tick = () => {
      onProgressCb?.(getCurrentTime(), getDuration());
      progressRafId = requestAnimationFrame(tick);
    };
    progressRafId = requestAnimationFrame(tick);
  }

  function _stopProgress() {
    if (progressRafId != null) {
      cancelAnimationFrame(progressRafId);
      progressRafId = null;
    }
  }

  return { load, play, pause, stop, getDuration, getCurrentTime, seek, onEnded, onProgress };
}
