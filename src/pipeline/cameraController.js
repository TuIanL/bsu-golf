export function createCameraController(els) {
  let stream = null;
  let recorder = null;
  let chunks = [];
  let recordState = "待机";

  const { video, recordStatus } = els;

  // 按照“极简拍摄流程”提供：开始后自动录制固定时长（首版用暂停/继续模拟）
  // 说明：没有外部存储与上传需求时，这里仅做演示/状态展示；可后续接入视频解释库。
  function setState(state) {
    recordState = state;
    if (recordStatus) recordStatus.textContent = `自动录制: ${recordState}`;
  }

  async function start() {
    if (stream) return stream;

    setState("准备中");
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error("当前浏览器不支持摄像头访问（getUserMedia 不可用）");
    }
    const constraints = {
      audio: false,
      video: {
        facingMode: "user",
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
    };

    stream = await navigator.mediaDevices.getUserMedia(constraints);
    if (video) {
      video.srcObject = stream;
      try {
        await video.play();
      } catch (err) {
        if (err.name !== "AbortError") throw err;
      }
    }

    // Auto-record for demo purposes (client-only).
    // We don't upload the recording; it's only used to satisfy "auto recording" flow & future explanation.
    if (typeof MediaRecorder !== "undefined") {
      try {
        chunks = [];
        recorder = new MediaRecorder(stream, { mimeType: "video/webm;codecs=vp9" });
      } catch {
        recorder = new MediaRecorder(stream);
      }
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunks.push(e.data);
      };
      recorder.start(250);
      setState("录制中（自动）");

      // stop after a fixed window; users can also hit stop which stops recorder
      setTimeout(() => {
        try {
          if (recorder && recorder.state !== "inactive") recorder.stop();
        } catch {
          // ignore
        }
      }, 9000);
    } else {
      setState("录制不可用（仅识别）");
    }
    return stream;
  }

  async function stop() {
    if (!stream) return;
    for (const track of stream.getTracks()) track.stop();
    stream = null;
    if (recorder && recorder.state !== "inactive") recorder.stop();
    recorder = null;
    chunks = [];
    setState("待机");
  }

  return {
    start,
    stop,
    setRecorderState: setState,
  };
}

