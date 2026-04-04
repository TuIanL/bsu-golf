/**
 * router.js — 纯原生 Hash 路由器
 * 
 * 路由表:
 *   #/           → Landing
 *   #/camera     → Camera
 *   #/upload     → Upload & Task Queue
 *   #/report/:id → Report
 */

const PAGES = ["pageLanding", "pageCamera", "pageUpload", "pageReport"];

let _onRouteChangeCb = null;
let _currentRoute = null;

/** 解析 hash 为 { page, params } */
function parseHash(hash) {
  const h = (hash || "#/").replace(/^#\/?/, "");

  if (!h || h === "") return { page: "pageLanding", params: {} };
  if (h === "camera") return { page: "pageCamera", params: {} };
  if (h === "upload") return { page: "pageUpload", params: {} };

  // #/report/:id
  const reportMatch = h.match(/^report\/(.+)$/);
  if (reportMatch) return { page: "pageReport", params: { id: reportMatch[1] } };

  return { page: "pageLanding", params: {} };
}

/** 切换页面可见性 */
function _showPage(pageId) {
  for (const id of PAGES) {
    const el = document.getElementById(id);
    if (el) el.style.display = id === pageId ? "" : "none";
  }
}

/** 处理路由变化 */
function _handleRoute() {
  const route = parseHash(location.hash);
  _currentRoute = route;
  _showPage(route.page);
  _onRouteChangeCb?.(route);
}

/** 导航至指定 hash */
export function navigate(hash) {
  location.hash = hash;
}

/** 获取当前路由 */
export function currentRoute() {
  return _currentRoute || parseHash(location.hash);
}

/** 注册路由变化回调 */
export function onRouteChange(cb) {
  _onRouteChangeCb = cb;
}

/** 初始化路由器 */
export function initRouter() {
  window.addEventListener("hashchange", _handleRoute);
  // 首次加载
  _handleRoute();
}
