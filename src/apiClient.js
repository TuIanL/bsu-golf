/**
 * apiClient.js
 * 负责与后端的 Python FastAPI 算法服务器进行通讯
 */

const API_BASE_URL = "http://localhost:8000/api";

export async function uploadVideoToBackend(file, config = {}) {
  const formData = new FormData();
  formData.append("video", file, file.name);
  if (config.view) formData.append("view", config.view);
  if (config.handedness) formData.append("handedness", config.handedness);
  if (config.clubType) formData.append("clubType", config.clubType);

  try {
    console.log(`[API Client] 开始上传视频并请求底层特征提取引擎: ${file.name} ...`);
    const startTime = performance.now();
    
    const response = await fetch(`${API_BASE_URL}/analyze-video`, {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`网络错误: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const durationMs = (performance.now() - startTime).toFixed(0);
    
    console.log(`[API Client] ✅ 分析请求完成 (耗时 ${durationMs}ms)! Python 后端返回架构解构数据:`, data);
    return data;
  } catch (error) {
    console.error("[API Client] ❌ 连接 Python 后端失败 (请检查 uvicorn 服务是否在 8000 端口启动):", error);
    throw error;
  }
}
