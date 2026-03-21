export function createUIBindings(els) {
  const { clubSelect, viewSelect, handednessSelect, startBtn, stopBtn } = els;

  let onStartCb = null;
  let onStopCb = null;
  let onModeSwitchCb = null;
  let onFileSelectCb = null;

  function getConfig() {
    return {
      clubType: clubSelect.value, // wood | iron | wedge
      view: viewSelect.value, // front | side
      handedness: handednessSelect.value, // right | left
    };
  }

  startBtn.addEventListener("click", () => {
    if (onStartCb) onStartCb(getConfig());
  });

  stopBtn.addEventListener("click", () => {
    if (onStopCb) onStopCb();
  });

  // ── 模式 Tab ──────────────────────────────
  const tabCamera = document.getElementById("tabCamera");
  const tabUpload = document.getElementById("tabUpload");
  const uploadPanel = document.getElementById("uploadPanel");
  const recordStatus = els.recordStatus;

  function _setMode(mode) {
    const isCamera = mode === "camera";
    tabCamera.classList.toggle("active", isCamera);
    tabUpload.classList.toggle("active", !isCamera);
    uploadPanel.style.display = isCamera ? "none" : "block";
    // 摄像头模式才显示"自动录制"
    if (recordStatus) recordStatus.style.display = isCamera ? "" : "none";
    // 摄像头模式显示开始/停止；视频模式隐藏（上传后自动开始）
    startBtn.style.display = isCamera ? "" : "none";
    stopBtn.style.display = isCamera ? "" : "none";
    onModeSwitchCb?.(mode);
  }

  tabCamera.addEventListener("click", () => _setMode("camera"));
  tabUpload.addEventListener("click", () => _setMode("upload"));

  // 初始隐藏上传面板
  uploadPanel.style.display = "none";

  // ── 文件选择（点击 + 拖拽）── ──────────────
  const dropZone = document.getElementById("dropZone");
  const videoFileInput = document.getElementById("videoFileInput");

  videoFileInput.addEventListener("change", () => {
    const file = videoFileInput.files?.[0];
    if (file) onFileSelectCb?.(file);
    // Reset so same file can be re-selected
    videoFileInput.value = "";
  });

  dropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropZone.classList.add("dragover");
  });
  dropZone.addEventListener("dragleave", () => dropZone.classList.remove("dragover"));
  dropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropZone.classList.remove("dragover");
    const file = e.dataTransfer?.files?.[0];
    if (file) onFileSelectCb?.(file);
  });

  // ── 进度条 ──────────────────────────────
  const progressRow = document.getElementById("progressRow");
  const progressBarWrap = document.querySelector(".progressBarWrap");
  const progressBarFill = document.getElementById("progressBarFill");
  const progressTimeText = document.getElementById("progressTimeText");
  const analysisStatusText = document.getElementById("analysisStatusText");

  let onSeekCb = null;
  let isDraggingProgress = false;

  function updateProgressFromEvent(e) {
    if (!progressBarWrap) return;
    const rect = progressBarWrap.getBoundingClientRect();
    let x = e.clientX - rect.left;
    x = Math.max(0, Math.min(x, rect.width));
    const pct = x / rect.width;
    onSeekCb?.(pct);
  }

  progressBarWrap?.addEventListener("pointerdown", (e) => {
    isDraggingProgress = true;
    progressBarWrap.setPointerCapture(e.pointerId);
    updateProgressFromEvent(e);
  });

  progressBarWrap?.addEventListener("pointermove", (e) => {
    if (!isDraggingProgress) return;
    updateProgressFromEvent(e);
  });

  progressBarWrap?.addEventListener("pointerup", (e) => {
    isDraggingProgress = false;
    progressBarWrap.releasePointerCapture(e.pointerId);
  });

  progressBarWrap?.addEventListener("pointercancel", () => {
    isDraggingProgress = false;
  });

  function setProgress(current, duration) {
    if (!progressRow) return;
    progressRow.style.display = "flex";
    const pct = duration > 0 ? Math.min(100, (current / duration) * 100) : 0;
    // skip animation if dragging to feel snappy
    progressBarFill.style.transition = isDraggingProgress ? "none" : "width 0.1s linear";
    progressBarFill.style.width = `${pct}%`;
    progressTimeText.textContent = `${_fmt(current)} / ${_fmt(duration)}`;
  }

  function setAnalysisStatus(text) {
    if (analysisStatusText) analysisStatusText.textContent = text;
  }

  function hideProgress() {
    if (progressRow) progressRow.style.display = "none";
  }

  function _fmt(sec) {
    if (!isFinite(sec)) return "0:00";
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  // ── 原有逻辑 ──────────────────────────────
  function renderResult(payload) {
    const { score, deductions, issues, metrics } = payload;
    const isReady = score != null;
    els.scoreValue.textContent = isReady ? String(score) : "--";
    if (!isReady) return;

    // deductions
    els.deductionList.innerHTML = "";
    if (Array.isArray(deductions) && deductions.length > 0) {
      for (const d of deductions) {
        const li = document.createElement("li");
        const left = document.createElement("div");
        left.textContent = d.title;
        const right = document.createElement("div");
        right.textContent = d.value >= 0 ? `-${d.value}` : String(d.value);
        li.appendChild(left);
        li.appendChild(right);
        els.deductionList.appendChild(li);
      }
    } else {
      const li = document.createElement("li");
      li.innerHTML = "<div>暂无扣分项</div><div>0</div>";
      els.deductionList.appendChild(li);
    }

    // issues
    els.issueList.innerHTML = "";
    const list = Array.isArray(issues) ? issues.slice(0, 10) : [];
    if (list.length === 0) {
      const li = document.createElement("li");
      li.innerHTML =
        '<div class="issuesTitle">等待挥杆...</div><div class="issuesDesc">录制并识别挥杆后显示。</div>';
      els.issueList.appendChild(li);
    } else {
      for (const item of list) {
        const li = document.createElement("li");
        const title = document.createElement("div");
        title.className = "issuesTitle";
        title.textContent = item.label;
        const desc = document.createElement("div");
        desc.className = "issuesDesc";
        desc.textContent =
          item.confidence != null ? `置信度: ${(item.confidence * 100).toFixed(1)}%` : "";
        li.appendChild(title);
        li.appendChild(desc);
        els.issueList.appendChild(li);
      }
    }

    // metrics
    els.metricsGrid.innerHTML = "";
    if (metrics && typeof metrics === "object") {
      const entries = Object.entries(metrics);
      for (const [k, v] of entries) {
        const card = document.createElement("div");
        card.className = "metricCard";
        const label = document.createElement("div");
        label.className = "metricLabel";
        label.textContent = k;
        const val = document.createElement("div");
        val.className = "metricValue";
        val.textContent = formatMetric(v);
        card.appendChild(label);
        card.appendChild(val);
        els.metricsGrid.appendChild(card);
      }
    }
  }

  function formatMetric(v) {
    if (v == null || Number.isNaN(v)) return "--";
    if (typeof v === "number") {
      const abs = Math.abs(v);
      if (abs >= 100) return v.toFixed(0);
      if (abs >= 10) return v.toFixed(1);
      return v.toFixed(2);
    }
    return String(v);
  }

  function setCameraStatus(text) {
    els.cameraStatus.textContent = text;
  }

  function setLatency(ms) {
    if (ms == null) {
      els.latencyStatus.textContent = "延迟: -";
      return;
    }
    if (typeof ms === "number") {
      const v = `${Math.round(ms)}ms`;
      els.latencyStatus.textContent = `延迟: ${v}`;
      return;
    }
    // stats object
    const p50 = ms.p50 != null ? `${Math.round(ms.p50)}ms` : "-";
    const p95 = ms.p95 != null ? `${Math.round(ms.p95)}ms` : "-";
    const avg = ms.avg != null ? `${Math.round(ms.avg)}ms` : "-";
    els.latencyStatus.textContent = `延迟: P50 ${p50} / P95 ${p95} / 平均 ${avg}`;
  }

  function setRecorderState(state) {
    if (els.recordStatus) els.recordStatus.textContent = `自动录制: ${state}`;
  }

  function setStartEnabled(startEnabled) {
    startBtn.disabled = !startEnabled;
    stopBtn.disabled = startEnabled;
  }

  startBtn.disabled = false;
  stopBtn.disabled = true;

  return {
    onStart(cb) {
      onStartCb = cb;
      setStartEnabled(false);
    },
    onStop(cb) {
      onStopCb = cb;
      setStartEnabled(true);
    },
    onModeSwitch(cb) {
      onModeSwitchCb = cb;
    },
    onFileSelect(cb) {
      onFileSelectCb = cb;
    },
    onSeek(cb) {
      onSeekCb = cb;
    },
    setCameraStatus,
    setLatency,
    setRecorderState,
    renderResult,
    setStartEnabled,
    setProgress,
    setAnalysisStatus,
    hideProgress,
  };
}
