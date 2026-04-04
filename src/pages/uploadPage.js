/**
 * uploadPage.js — Page 3: 视频上传与任务管理
 *
 * 职责:
 * 1. 拖拽/点击批量上传
 * 2. 文件入队后立即向后端发起分析
 * 3. 渲染任务列表 (进度/完成/错误)
 */

import { addTask, updateTask, getAllTasks } from "../taskStore.js";
import { uploadVideoToBackend } from "../apiClient.js";
import { navigate } from "../router.js";

let _initialized = false;

export function initUploadPage() {
  if (_initialized) return;
  _initialized = true;

  const dropZone = document.getElementById("uploadDropZone");
  const fileInput = document.getElementById("batchFileInput");
  const taskListEl = document.getElementById("taskList");

  if (!dropZone || !fileInput || !taskListEl) {
    console.error("[UploadPage] 缺少 DOM 元素");
    return;
  }

  // ── 拖拽上传 ─────────────────────────────
  dropZone.addEventListener("click", () => fileInput.click());

  dropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropZone.classList.add("dragover");
  });
  dropZone.addEventListener("dragleave", () => dropZone.classList.remove("dragover"));
  dropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropZone.classList.remove("dragover");
    const files = Array.from(e.dataTransfer?.files || []).filter(f => f.type.startsWith("video/"));
    if (files.length) _enqueueFiles(files);
  });

  fileInput.addEventListener("change", () => {
    const files = Array.from(fileInput.files || []);
    if (files.length) _enqueueFiles(files);
    fileInput.value = "";
  });

  // ── 状态变化重渲染 ─────────────────────────
  window.addEventListener("task_store_change", () => renderTaskList(taskListEl));

  // 首次渲染
  renderTaskList(taskListEl);
}

/** 批量入队 */
function _enqueueFiles(files) {
  for (const file of files) {
    const task = addTask(file);
    _startAnalysis(task);
  }
}

/** 单个任务：上传 + 分析 */
async function _startAnalysis(task) {
  updateTask(task.id, { status: "uploading", progress: 10 });

  // 模拟平滑进度（真实进度取决于后端返回时间）
  let fakeProgress = 10;
  const progressTimer = setInterval(() => {
    fakeProgress = Math.min(fakeProgress + Math.random() * 8, 90);
    updateTask(task.id, { progress: Math.round(fakeProgress) });
  }, 600);

  try {
    const config = {
      view: "front",
      handedness: "right",
      clubType: "wood",
    };

    const result = await uploadVideoToBackend(task.file, config);
    clearInterval(progressTimer);

    updateTask(task.id, {
      status: "completed",
      progress: 100,
      result: result.python_pipeline_results,
    });
  } catch (err) {
    clearInterval(progressTimer);
    updateTask(task.id, {
      status: "error",
      progress: 0,
      error: err.message || String(err),
    });
  }
}

/** 渲染任务列表 */
function renderTaskList(container) {
  const tasks = getAllTasks();
  container.innerHTML = "";

  if (tasks.length === 0) {
    container.innerHTML = `<div class="taskEmpty">暂无分析任务，请上传视频文件开始分析</div>`;
    return;
  }

  for (const task of tasks) {
    const item = document.createElement("div");
    item.className = "taskItem";

    const left = document.createElement("div");
    left.className = "taskInfo";

    const name = document.createElement("div");
    name.className = "taskName";
    name.textContent = task.fileName;

    const size = document.createElement("div");
    size.className = "taskSize";
    size.textContent = _formatSize(task.fileSize);

    left.appendChild(name);
    left.appendChild(size);

    const right = document.createElement("div");
    right.className = "taskAction";

    if (task.status === "uploading" || task.status === "queued") {
      const bar = document.createElement("div");
      bar.className = "taskProgressWrap";
      const fill = document.createElement("div");
      fill.className = "taskProgressFill";
      fill.style.width = `${task.progress}%`;
      bar.appendChild(fill);

      const label = document.createElement("span");
      label.className = "taskProgressLabel";
      label.textContent = `分析中 ${task.progress}%`;

      right.appendChild(bar);
      right.appendChild(label);
    } else if (task.status === "completed") {
      const btn = document.createElement("button");
      btn.className = "taskReportBtn";
      btn.textContent = "📊 查看分析报告";
      btn.addEventListener("click", () => navigate(`#/report/${task.id}`));
      
      const score = document.createElement("span");
      score.className = "taskScore";
      score.textContent = `${task.result?.score ?? "--"} 分`;

      right.appendChild(score);
      right.appendChild(btn);
    } else if (task.status === "error") {
      const errSpan = document.createElement("span");
      errSpan.className = "taskError";
      errSpan.textContent = `❌ ${task.error || "分析失败"}`;
      right.appendChild(errSpan);
    }

    item.appendChild(left);
    item.appendChild(right);
    container.appendChild(item);
  }
}

function _formatSize(bytes) {
  if (!bytes) return "";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}
