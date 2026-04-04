/**
 * reportPage.js — Page 4: 视频分析报告
 *
 * 职责:
 * 1. 读取 URL 中的 videoId，从 taskStore 获取分析数据
 * 2. 复用现有 uiBindings.renderResult() 渲染
 * 3. 提供"返回上传页"按钮
 * 4. 提供"进入赛博大屏"按钮
 */

import { getTask } from "../taskStore.js";
import { navigate } from "../router.js";
import { createVisualization } from "../visualization/visualization.js";
import { createSwingTracer } from "../visualization/swingTracer.js";

let _metricsRadarChart = null;
let _viz = null;
let _swingTracer = null;
let _videoRafId = null;
let _currentObjectUrl = null;

/**
 * 当路由进入 #/report/:id 时调用
 */
export function mountReport(videoId) {
  // ── 清理旧状态 ────────────────────────────
  if (_videoRafId) cancelAnimationFrame(_videoRafId);
  if (_currentObjectUrl) {
    URL.revokeObjectURL(_currentObjectUrl);
    _currentObjectUrl = null;
  }
  _swingTracer = null;

  const task = getTask(videoId);
  const container = document.getElementById("reportContent");
  const titleEl = document.getElementById("reportTitle");
  const backBtn = document.getElementById("reportBackBtn");
  const dashboardBtn = document.getElementById("reportDashboardBtn");

  // 视频/Canvas 元素
  const video = document.getElementById("reportVideo");
  const overlay = document.getElementById("reportOverlay");
  const playBtn = document.getElementById("reportPlayBtn");
  const seekBar = document.getElementById("reportSeekBar");
  const timeDisplay = document.getElementById("reportTimeDisplay");

  if (!container || !video || !overlay) return;

  // ── 返回 ─────────────────────────────
  backBtn?.addEventListener("click", () => {
    video.pause();
    navigate("#/upload");
  });

  // ── 赛博大屏 ────────────────────────────
  dashboardBtn?.addEventListener("click", () => {
    if (!task?.result) return;
    window.__DASHBOARD_DATA__ = task.result;
    window.dispatchEvent(new CustomEvent("golf_dashboard_data", { detail: task.result }));
    const dashboardApp = document.getElementById("dashboardApp");
    if (dashboardApp) dashboardApp.style.display = "block";
  });

  if (!task || !task.result) {
    console.warn(`[ReportPage] Task data missing for ID: ${videoId}. Current tasks count: ${window.__GOLF_TASKS__?.length || 0}`);
    const isStoreEmpty = (window.__GOLF_TASKS__?.length || 0) === 0;
    
    container.innerHTML = `
      <div style="text-align:center; padding:100px 20px; color:#94a3b8; max-width:600px; margin:0 auto;">
        <div style="font-size: 64px; margin-bottom: 20px;">🔍</div>
        <h2 style="color: #fff; margin-bottom: 12px;">${isStoreEmpty ? "会话已重置" : "未找到分析数据"}</h2>
        <p style="line-height: 1.6; margin-bottom: 30px;">
          ${isStoreEmpty 
            ? "检测到页面曾被刷新，由于数据仅保存在内存中，刷新会导致当前分析记录丢失。" 
            : "该分析任务可能已被删除或 ID 不正确。"}
        </p>
        <button id="errorBackBtn" class="backBtn" style="padding: 12px 24px; background: var(--accent); color: #000; border: none; border-radius: 8px; cursor: pointer; font-weight: bold;">
          ← 返回上传页重新分析
        </button>
      </div>
    `;
    
    document.getElementById("errorBackBtn")?.addEventListener("click", () => navigate("#/upload"));
    if (titleEl) titleEl.textContent = isStoreEmpty ? "会话重置" : "报告未找到";
    return;
  }

  if (titleEl) titleEl.textContent = task.fileName;

  // ── 视频加载与播放逻辑 ─────────────────────
  const data = task.result;
  const history = data.fullHistory || [];

  if (task.file) {
    _currentObjectUrl = URL.createObjectURL(task.file);
    video.src = _currentObjectUrl;
    video.load();
  }

  _viz = createVisualization({ overlay, video });

  // ── 挥杆轨迹切换按钮 ───────────────────────
  const traceToggleBtn = document.getElementById("traceToggleBtn");
  let _traceVisible = true;

  traceToggleBtn?.addEventListener("click", () => {
    _traceVisible = !_traceVisible;
    traceToggleBtn.classList.toggle("active", _traceVisible);
    if (_swingTracer) _swingTracer.setVisible(_traceVisible);
  });

  // ── 视频加载后初始化轨迹渲染器 ──────────────
  const tracePoints = data.swingTrace || [];
  video.onloadedmetadata = () => {
    _swingTracer = createSwingTracer(overlay, video, tracePoints);
    _updateUI();
  };

  // ── 播放按钮 ─────────────────────────────────
  playBtn.onclick = () => {
    if (video.paused) {
      video.play().catch(err => {
        if (err.name !== "AbortError") console.warn("[Report Video] Play error:", err);
      });
    } else {
      video.pause();
    }
  };

  video.onplay = () => { playBtn.textContent = "⏸"; _startSync(); };
  video.onpause = () => { playBtn.textContent = "▶"; _stopSync(); };
  video.onended = () => { playBtn.textContent = "🔄"; _stopSync(); };

  // 进度条
  seekBar.oninput = () => {
    const time = (seekBar.value / 100) * video.duration;
    if (isFinite(time)) video.currentTime = time;
  };

  function _startSync() {
    if (_videoRafId) cancelAnimationFrame(_videoRafId);
    const renderFrame = () => {
      _videoRafId = requestAnimationFrame(renderFrame);
      _updateUI();
    };
    _videoRafId = requestAnimationFrame(renderFrame);
  }

  function _stopSync() {
    if (_videoRafId) {
      cancelAnimationFrame(_videoRafId);
      _videoRafId = null;
    }
    _updateUI(); // 最后一帧
  }

  function _updateUI() {
    const cur = video.currentTime;
    const dur = video.duration || 1;
    
    // 更新进度条
    seekBar.value = (cur / dur) * 100;
    
    // 更新时间文本
    const format = (s) => (isFinite(s) ? `${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}` : "0:00");
    timeDisplay.textContent = `${format(cur)} / ${format(dur)}`;

    // 渲染骨骼点
    if (history.length > 0) {
      const idx = Math.min(history.length - 1, Math.floor((cur / dur) * history.length));
      const payload = history[idx];
      if (payload) {
        _viz.renderAll(payload, null, true); // true = upload mode (no mirror)
      }
    }

    // 渲染挥杆轨迹（叠加在骨骼点之上）
    if (_swingTracer) {
      _swingTracer.draw(cur * 1000); // 秒转毫秒
    }
  }

  // 初始渲染一帧 — 在 onloadedmetadata 中处理（见上方）
  // video.onloadedmetadata = () => _updateUI();  // 已移至轨迹初始化块

  // ── 渲染评分 ──────────────────────────────
  const scoreEl = document.getElementById("reportScore");
  if (scoreEl) scoreEl.textContent = data.score ?? "--";

  // ── 扣分项 ──────────────────────────────
  const deductionList = document.getElementById("reportDeductionList");
  if (deductionList) {
    deductionList.innerHTML = "";
    if (Array.isArray(data.deductions) && data.deductions.length > 0) {
      for (const d of data.deductions) {
        const li = document.createElement("li");
        const val = Math.abs(d.value);
        if (val >= 12) li.classList.add("severity-high");
        else if (val >= 6) li.classList.add("severity-mid");
        else li.classList.add("severity-low");

        li.innerHTML = `<div>${d.title}</div><div>${d.value >= 0 ? `-${d.value}` : d.value}</div>`;
        deductionList.appendChild(li);
      }
    } else {
      deductionList.innerHTML = `<li><div>暂无扣分项</div><div>0</div></li>`;
    }
  }

  // ── 雷达图 ──────────────────────────────
  const radarEl = document.getElementById("reportRadar");
  const echarts = window.echarts;
  if (radarEl && echarts && data.metrics) {
    try { if (_metricsRadarChart) _metricsRadarChart.dispose(); } catch {}
    _metricsRadarChart = echarts.init(radarEl);
    radarEl.style.height = "320px";
    radarEl.style.width = "100%";

    const entries = Object.entries(data.metrics).filter(([_, v]) => typeof v === "number" && Number.isFinite(v));
    const valuesAbs = entries.map(([_, v]) => Math.abs(v));
    const commonMax = Math.max(1, ...valuesAbs);
    const indicator = entries.map(([k]) => ({ name: k, max: commonMax }));

    _metricsRadarChart.setOption({
      backgroundColor: "transparent",
      tooltip: { show: false },
      radar: { radius: "70%", center: ["50%", "50%"], indicator,
        axisName: { color: "rgba(210,230,255,0.9)", fontSize: 11 },
        axisLabel: { show: false },
        splitLine: { lineStyle: { color: "rgba(120,160,200,0.25)" } },
        axisLine: { lineStyle: { color: "rgba(120,160,200,0.35)" } },
      },
      series: [{
        type: "radar", data: [{ value: valuesAbs }],
        lineStyle: { width: 2, color: "rgba(56,189,248,0.9)" },
        itemStyle: { color: "rgba(56,189,248,0.9)" },
        symbol: "none",
        areaStyle: { color: "rgba(56,189,248,0.3)" },
      }],
    }, { notMerge: true });
    _metricsRadarChart.resize?.();
  }

  // ── 问题识别 ──────────────────────────────
  const issueList = document.getElementById("reportIssueList");
  if (issueList) {
    issueList.innerHTML = "";
    const explanations = data.nam_explanations || [];
    if (explanations.length === 0) {
      issueList.innerHTML = `<li><div class="issuesTitle">暂无问题识别</div><div class="issuesDesc">当前未检测到明显异常项。</div></li>`;
    } else {
      const issueTitleMap = {
        ADDRESS_STANCE_RATIO: "准备姿势-站位比例",
        ADDRESS_SHOULDER_ANGLE: "准备姿势-肩部倾角",
        TOP_LEFT_ARM_ANGLE: "上杆顶点-左臂角度",
        TOP_SHOULDER_ROTATION_THETA: "上杆顶点-肩部旋转",
        IMPACT_HIP_ROTATION_THETA: "击球瞬间-髋部旋转",
        SPI_IMPACT_VELOCITY: "击球瞬间-骨盆角速度(度/秒)",
      };

      for (const item of explanations) {
        const li = document.createElement("li");
        const displayTitle = issueTitleMap[item.featureKey] || item.featureKey || "诊断";
        li.innerHTML = `<div class="issuesTitle">${displayTitle}</div><div class="issuesDesc">${item.diagnosticText || ""}</div>`;
        issueList.appendChild(li);
      }
    }
  }
}
