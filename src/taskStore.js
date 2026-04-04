/**
 * taskStore.js — 全局任务队列状态管理器
 *
 * 任务状态流:  queued → uploading → completed / error
 * 持久化:      仅内存（由用户要求：刷新页面即清空数据）
 * 通知:        CustomEvent "task_store_change"
 */

let _tasks = [];

function _notify() {
  window.dispatchEvent(new CustomEvent("task_store_change"));
}

/** 生成唯一 ID */
function _uid() {
  return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
}

// ── 公共 API ──────────────────────────────────

export function addTask(file) {
  const task = {
    id: _uid(),
    fileName: file.name,
    fileSize: file.size,
    status: "queued",     // queued | uploading | completed | error
    progress: 0,          // 0–100
    result: null,         // 后端返回的分析数据
    error: null,
    createdAt: Date.now(),
    file,                 // 保留 File 引用用于上传
  };
  _tasks.push(task);
  _notify();
  return task;
}

export function updateTask(id, patch) {
  const t = _tasks.find(t => t.id === id);
  if (!t) return;
  Object.assign(t, patch);
  _notify();
}

export function getTask(id) {
  return _tasks.find(t => t.id === id) || null;
}

export function getAllTasks() {
  return [..._tasks];
}

export function removeTask(id) {
  _tasks = _tasks.filter(t => t.id !== id);
  _notify();
}

export function clearAllTasks() {
  _tasks = [];
  _notify();
}

/** 初始化 */
export function initTaskStore() {
  console.log("[TaskStore] Initializing in-memory store...");
  _tasks = [];
  window.__GOLF_TASKS__ = _tasks; // Debug hook
}
