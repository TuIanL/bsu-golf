export function createUIBindings(els) {
  const { clubSelect, viewSelect, handednessSelect, startBtn, stopBtn } = els;
  const issueTitleMap = {
    ADDRESS_STANCE_RATIO: "站位比例",
    ADDRESS_SHOULDER_ANGLE: "准备姿势-肩部倾角",
    TOP_LEFT_ARM_ANGLE: "上杆顶点-左臂角度",
    TOP_SHOULDER_ROTATION_THETA: "上杆顶点-肩部旋转",
    IMPACT_HIP_ROTATION_THETA: "击球瞬间-髋部旋转",
    SPI_IMPACT_VELOCITY: "击球瞬间-骨盆角速度",
  };

  let onStartCb = null;
  let onStopCb = null;
  let onModeSwitchCb = null;
  let onFileSelectCb = null;
  let metricsRadarChart = null;

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

  // ── 模式 Tab (legacy — 新路由架构已移除 tab 按钮) ──
  const tabCamera = document.getElementById("tabCamera");
  const tabUpload = document.getElementById("tabUpload");
  const tabDashboard = document.getElementById("tabDashboard");
  const uploadPanel = document.getElementById("uploadPanel");
  const dashboardApp = document.getElementById("dashboardApp");
  const recordStatus = els.recordStatus;

  function _setMode(mode) {
    const isCamera = mode === "camera";
    const isDashboard = mode === "dashboard";
    const isUpload = mode === "upload";

    tabCamera?.classList?.toggle("active", isCamera);
    tabUpload?.classList?.toggle("active", isUpload);
    tabDashboard?.classList?.toggle("active", isDashboard);

    if (uploadPanel) uploadPanel.style.display = isUpload ? "block" : "none";
    if (dashboardApp) dashboardApp.style.display = isDashboard ? "block" : "none";

    if (recordStatus) recordStatus.style.display = isCamera ? "" : "none";
    if (startBtn) startBtn.style.display = isCamera ? "" : "none";
    if (stopBtn) stopBtn.style.display = isCamera ? "" : "none";
    onModeSwitchCb?.(mode);
  }

  tabCamera?.addEventListener("click", () => _setMode("camera"));
  tabUpload?.addEventListener("click", () => _setMode("upload"));
  tabDashboard?.addEventListener("click", () => _setMode("dashboard"));

  // 初始隐藏上传面板
  if (uploadPanel) uploadPanel.style.display = "none";

  // ── 文件选择（点击 + 拖拽）── ──────────────
  const dropZone = document.getElementById("dropZone");
  const videoFileInput = document.getElementById("videoFileInput");
  const uploadBtn = document.getElementById("uploadBtn");

  uploadBtn?.addEventListener("click", () => {
    videoFileInput?.click?.();
  });

  videoFileInput?.addEventListener("change", () => {
    const file = videoFileInput.files?.[0];
    if (file) onFileSelectCb?.(file);
    // Reset so same file can be re-selected
    videoFileInput.value = "";
  });

  // dropZone 可能在“上传小按钮模式”下被移除，因此需要做存在性判断
  if (dropZone) {
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
  }

  // ── 进度条 ──────────────────────────────
  const progressRow = document.getElementById("progressRow");
  const playPauseBtn = document.getElementById("playPauseBtn");
  const progressBarWrap = document.querySelector(".progressBarWrap");
  const progressBarFill = document.getElementById("progressBarFill");
  const progressTimeText = document.getElementById("progressTimeText");
  const analysisStatusText = document.getElementById("analysisStatusText");

  let onSeekCb = null;
  let onPlayPauseCb = null;
  let isDraggingProgress = false;

  playPauseBtn?.addEventListener("click", () => {
    onPlayPauseCb?.();
  });

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

  function setPlaybackState(isPlaying, isEnded = false) {
    if (!playPauseBtn) return;
    if (isEnded) {
      playPauseBtn.textContent = "🔄";
    } else {
      playPauseBtn.textContent = isPlaying ? "▍▍" : "▶";
      playPauseBtn.style.background = isPlaying ? "rgba(126, 184, 247, 0.2)" : "#7eb8f7";
      playPauseBtn.style.color = isPlaying ? "#7eb8f7" : "#0b0f14";
    }
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
        const val = Math.abs(d.value);
        if (val >= 12) li.classList.add("severity-high");
        else if (val >= 6) li.classList.add("severity-mid");
        else li.classList.add("severity-low");

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

    // explanations (from NAM Engine instead of local heuristic issues)
    els.issueList.innerHTML = "";
    const list = Array.isArray(payload.nam_explanations) ? payload.nam_explanations : [];
    // Make sure we update the correct <h3> next to #issueList
    // (avoid relying on document-wide selector that can fail due to DOM timing/caching).
    const issuesCard = els.issueList?.closest?.(".issuesCard");
    const issuesHeader = issuesCard?.querySelector?.("h3");
    if (issuesHeader) {
      issuesHeader.textContent = `问题识别（${list.length}/10）`;
    }
    if (list.length === 0) {
      const li = document.createElement("li");
      li.innerHTML =
        '<div class="issuesTitle">暂无问题识别</div><div class="issuesDesc">当前未检测到明显异常项。</div>';
      els.issueList.appendChild(li);
    } else {
      for (const item of list) {
        const li = document.createElement("li");
        const title = document.createElement("div");
        title.className = "issuesTitle";
        const key = item.featureKey || "";
        title.textContent = issueTitleMap[key] || key || "诊断说明";
        const desc = document.createElement("div");
        desc.className = "issuesDesc";
        desc.textContent = item.diagnosticText || "";
        li.appendChild(title);
        li.appendChild(desc);
        els.issueList.appendChild(li);
      }
    }

        // metrics -> gradient radar (with value labels)
    els.metricsGrid.innerHTML = "";
    const echarts = window.echarts || globalThis.echarts;
    if (metrics && typeof metrics === "object" && echarts) {
      const entriesRaw = Object.entries(metrics);
      const entries = entriesRaw.filter(([_, v]) => typeof v === "number" && Number.isFinite(v));
      if (entries.length > 0) {
        // Re-init chart instance on every render (simpler & safer than resize handling).
        try {
          if (metricsRadarChart) metricsRadarChart.dispose();
        } catch (_) {
          /* ignore */
        }
        metricsRadarChart = echarts.init(els.metricsGrid);
        // Ensure container has a usable size (Safari sometimes reports 0 height).
        if (!els.metricsGrid.style.height) els.metricsGrid.style.height = "240px";
        if (!els.metricsGrid.style.width) els.metricsGrid.style.width = "100%";

        // Make each axis share a common max so the polygon radius is proportional
        // to the real numeric value (distance from center ~= value / commonMax).
        const rawValues = entries.map(([_, v]) => v);
        const valuesAbs = rawValues.map((v) => Math.abs(v));
        const commonMax = Math.max(1, ...valuesAbs);

        const keys = entries.map(([k]) => k);
        // Build a stable name -> value map to avoid relying on `indicatorIndex`
        // (Safari/ECharts may pass it inconsistently).
        const normalizeKey = (s) =>
          String(s)
            .trim()
            .replace(/\s+/g, "")
            .replace(/-/g, "")
            .toLowerCase();
        const valueByName = Object.fromEntries(
          entries.map(([k, v]) => [normalizeKey(k), v])
        );

        const indicator = keys.map((name) => ({ name, max: commonMax }));

        const formatAxisName = (name) => {
          // Keep it single-line to avoid Safari/ECharts label rendering quirks.
          const parts = String(name).split("-");
          if (parts.length <= 1) return String(name);
          return parts[0] + " " + parts.slice(1).join("-");
        };

        const values = valuesAbs; // keep radius valid for radar
        const unitForName = (name) => {
          const s = String(name);
          if (s.includes("角速度")) return "度/秒";
          if (s.includes("站位比例")) return "";
          if (s.includes("倾角") || s.includes("角度") || s.includes("旋转")) return "度";
          return "";
        };
        const grad =
          echarts.graphic && echarts.graphic.LinearGradient
            ? new echarts.graphic.LinearGradient(0, 0, 1, 1, [
                { offset: 0, color: "rgba(56, 189, 248, 0.95)" },
                { offset: 0.55, color: "rgba(167, 139, 250, 0.75)" },
                { offset: 1, color: "rgba(34, 197, 94, 0.65)" },
              ])
            : "rgba(56, 189, 248, 0.9)";

        metricsRadarChart.setOption(
          {
            backgroundColor: "transparent",
            tooltip: { show: false },
            radar: {
              radius: "70%",
              center: ["50%", "50%"],
              indicator,
              axisName: {
                show: true,
                color: "rgba(210, 230, 255, 0.9)",
                fontSize: 12,
                formatter: (name) => {
                  const axisNameText = formatAxisName(String(name));
                  const real = valueByName[normalizeKey(name)];
                  if (typeof real !== "number" || !Number.isFinite(real)) return axisNameText;

                  const abs = Math.abs(real);
                  const text =
                    abs >= 100 ? String(Math.round(real)) : abs >= 10 ? real.toFixed(1) : real.toFixed(2);
                  const unit = unitForName(name);
                  return axisNameText + " " + text + (unit ? " " + unit : "");
                },
              },
              // axisLabel controls the radius ring tick labels; we hide them to prevent亂數/噪声。
              axisLabel: { show: false },
              splitLine: {
                lineStyle: {
                  color: "rgba(120, 160, 200, 0.25)",
                },
              },
              axisLine: {
                lineStyle: { color: "rgba(120, 160, 200, 0.35)" },
              },
            },
            series: [
              {
                type: "radar",
                name: "指标",
                data: [{ value: values, name: "指标" }],
                lineStyle: {
                  width: 2,
                  color: grad,
                },
                itemStyle: {
                  color: grad,
                },
                symbol: "none",
                areaStyle: {
                  color: grad,
                  opacity: 0.35,
                },
                label: { show: false },
              },
            ],
          },
          { notMerge: true, lazyUpdate: true }
        );
        metricsRadarChart.resize?.();
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
      onStartCb = async (config) => {
        setStartEnabled(false);
        try {
          await cb(config);
        } catch (e) {
          setStartEnabled(true);
          throw e;
        }
      };
    },
    onStop(cb) {
      onStopCb = async () => {
        try {
          await cb();
        } finally {
          setStartEnabled(true);
        }
      };
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
    onPlayPause(cb) {
      onPlayPauseCb = cb;
    },
    setCameraStatus,
    setLatency,
    setRecorderState,
    renderResult,
    setStartEnabled,
    setProgress,
    setPlaybackState,
    setAnalysisStatus,
    hideProgress,
  };
}
