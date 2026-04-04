"""
swing_tracer.py — 挥杆平面轨迹计算模块

职责:
1. 从平滑后的 history（每帧含 MediaPipe landmarks）中提取手腕中心坐标
2. 用滑窗极值法检测上杆顶点 (Top of Backswing)
3. 为每一个追踪点打上阶段标签:
   - backswing      (上杆，蓝色)
   - downswing      (下杆，红色)
   - follow_through (送杆，绿色)
4. 输出结构化的 swingTrace 列表，供前端逐帧绘制贝塞尔曲线轨迹
"""

from typing import List, Dict, Optional

# MediaPipe Pose 关键点索引
# 15 = 左手腕，16 = 右手腕
_IDX_LEFT_WRIST = 15
_IDX_RIGHT_WRIST = 16

# 最低可见度阈值，低于该值的关节点被认为不可靠
_MIN_VISIBILITY = 0.3


def _extract_wrist_center(landmarks: list) -> Optional[Dict]:
    """
    从单帧 landmarks 列表中提取左右手腕的归一化中心坐标。
    如果两个手腕点的可见度都不足，返回 None。
    """
    if not landmarks or len(landmarks) <= _IDX_RIGHT_WRIST:
        return None

    lw = landmarks[_IDX_LEFT_WRIST]
    rw = landmarks[_IDX_RIGHT_WRIST]

    lv = lw.get("visibility", 1.0)
    rv = rw.get("visibility", 1.0)

    # 至少一个手腕可见才继续
    if lv < _MIN_VISIBILITY and rv < _MIN_VISIBILITY:
        return None

    # 加权平均：可见度高的手腕权重更大
    total_w = lv + rv
    if total_w == 0:
        return None

    cx = (lw["x"] * lv + rw["x"] * rv) / total_w
    cy = (lw["y"] * lv + rw["y"] * rv) / total_w

    return {"x": float(cx), "y": float(cy)}


def _detect_apex_index(points: List[Dict], window: int = 12) -> int:
    """
    在归一化坐标序列中检测上杆顶点。

    算法：
    - 图像坐标系中 y=0 在顶部，因此手部"最高点"= y 的局部最小值。
    - 用大小为 window 的滑动窗口找到 y 的极小值，
      同时要求前后有显著的方向反转（避免平台期或噪声误判）。
    - 如果找不到明显顶点，回退到序列的 1/3 处（上杆通常占挥杆前 1/3）。
    """
    ys = [p["y"] for p in points]
    n = len(ys)
    if n < window * 2 + 1:
        return max(0, n // 3)

    best_idx = -1
    best_y = float("inf")

    for i in range(window, n - window):
        local_min = min(ys[i - window: i + window + 1])
        if ys[i] > local_min + 1e-4:
            continue  # 不是局部最小值

        # 检测方向反转幅度
        pre_delta = ys[i] - ys[max(0, i - window)]
        post_delta = ys[min(n - 1, i + window)] - ys[i]

        if pre_delta < -0.02 and post_delta > 0.02:
            # 找到一个有效的方向反转，取 y 最小的那个
            if ys[i] < best_y:
                best_y = ys[i]
                best_idx = i

    if best_idx == -1:
        # 兜底：取整个序列 y 的全局最小点
        best_idx = ys.index(min(ys))

    return best_idx


def _detect_followthrough_index(points: List[Dict], apex_idx: int, window: int = 8) -> int:
    """
    在下杆之后检测送杆起始点。
    送杆 = 手部再次达到击球位置高度（y 值回到与上杆起始相近的水平）之后。
    简化实现：取下杆阶段结束后手部 y 值再次超过 apex_y * 1.4 的第一帧。
    """
    n = len(points)
    if apex_idx >= n - 1:
        return n - 1

    apex_y = points[apex_idx]["y"]
    threshold = min(0.85, apex_y * 1.6)  # 送杆时手部回到中腰附近

    for i in range(apex_idx + 1, n):
        if points[i]["y"] > threshold:
            return i

    return n - 1


def compute_swing_trace(history: list) -> List[Dict]:
    """
    主入口函数：接收平滑后的 history，返回 swingTrace 点列表。

    每个点:
    {
      "t":      float,   # 时间戳，单位 ms，对应视频播放时间
      "x":      float,   # 归一化 [0,1]，宽度方向
      "y":      float,   # 归一化 [0,1]，高度方向（0=顶部）
      "phase":  str      # "backswing" | "downswing" | "follow_through"
    }
    """
    if not history:
        return []

    # 1. 提取原始追踪点
    raw_points = []
    for frame in history:
        t_ms = frame.get("t", 0.0)
        lms = frame.get("landmarks", [])
        center = _extract_wrist_center(lms)
        if center is not None:
            raw_points.append({"t": t_ms, "x": center["x"], "y": center["y"]})

    if len(raw_points) < 6:
        return []

    # 2. 检测顶点和送杆起始索引
    apex_idx = _detect_apex_index(raw_points, window=12)
    followthrough_idx = _detect_followthrough_index(raw_points, apex_idx, window=8)

    # 3. 为每个点标注阶段
    result = []
    for i, p in enumerate(raw_points):
        if i <= apex_idx:
            phase = "backswing"
        elif i <= followthrough_idx:
            phase = "downswing"
        else:
            phase = "follow_through"

        result.append({
            "t": p["t"],
            "x": p["x"],
            "y": p["y"],
            "phase": phase,
        })

    return result
