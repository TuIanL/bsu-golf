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


import numpy as np

def _detect_setup_params(history: list) -> Dict:
    """
    识别准备阶段 (Setup/Address)。
    在视频前 15% 帧中寻找手部/杆头坐标方差最小的区间。
    """
    n = len(history)
    if n < 20:
        return None
        
    search_limit = int(n * 0.2)
    min_var = float('inf')
    best_idx = 0
    
    # 抽取手腕和球杆头序列
    hand_pts = []
    club_pts = []
    for frame in history[:search_limit]:
        lms = frame.get("landmarks", [])
        if len(lms) > _IDX_RIGHT_WRIST:
            lw, rw = lms[_IDX_LEFT_WRIST], lms[_IDX_RIGHT_WRIST]
            hand_pts.append([(lw['x'] + rw['x'])/2, (lw['y'] + rw['y'])/2])
        else:
            hand_pts.append([0.5, 0.8])
            
        c = frame.get("clubhead")
        if c:
            club_pts.append([c['x'], c['y']])
        else:
            club_pts.append(hand_pts[-1]) # 兜底使用手部

    hand_pts = np.array(hand_pts)
    
    # 滑窗寻找最稳帧
    win = 5
    for i in range(len(hand_pts) - win):
        var = np.var(hand_pts[i:i+win], axis=0).sum()
        if var < min_var:
            min_var = var
            best_idx = i + win // 2

    setup_frame = history[best_idx]
    lms = setup_frame["landmarks"]
    
    # A点：球位（即 Setup 时的球杆头位置）
    club_init = setup_frame.get("clubhead") or {"x": hand_pts[best_idx][0], "y": hand_pts[best_idx][1] + 0.15}
    # B点：手位
    hand_init = {"x": hand_pts[best_idx][0], "y": hand_pts[best_idx][1]}
    # C点：肩位（优先后肩，索引 12 为右肩）
    shoulder = lms[12] if len(lms) > 12 else (lms[11] if len(lms) > 11 else {"x": 0.5, "y": 0.3})
    
    return {
        "idx": best_idx,
        "p_init_club": club_init,
        "p_init_hand": hand_init,
        "p_shoulder": shoulder
    }

def _calculate_v_slot(setup: Dict) -> List[Dict]:
    """
    计算 V-Slot 多边形顶点。
    下边界：A -> B 延长线
    上边界：A -> C 延长线
    """
    A = setup["p_init_club"]
    B = setup["p_init_hand"]
    C = setup["p_shoulder"]
    
    # 构造射线多边形
    def extend(p1, p2, target_y=0.0):
        dx = p2["x"] - p1["x"]
        dy = p2["y"] - p1["y"]
        if abs(dy) < 1e-4: 
            return {"x": max(0.0, min(1.0, p2["x"])), "y": target_y}
        t = (target_y - p1["y"]) / dy
        # 截断到 [0, 1] 范围内
        new_x = max(0.0, min(1.0, p1["x"] + dx * t))
        return {"x": new_x, "y": target_y}

    top_left = extend(A, C, 0.0)
    top_right = extend(A, B, 0.0)
    
    # 返回多边形顶点序列
    return [
        {"x": A["x"], "y": A["y"]},
        {"x": top_left["x"], "y": top_left["y"]},
        {"x": top_right["x"], "y": top_right["y"]}
    ]

def _detect_swing_phases_v2(points: List[Dict], club_pts: List[Optional[Dict]], setup: Dict, fps: float) -> Dict[str, int]:
    """
    状态锁重构：基于物理时间窗口 (0.18s) 的下坠校验与单向状态机。
    """
    import numpy as np
    n = len(points)
    p_init = setup["p_init_club"]
    
    # 动态计算物理观察窗 (约 0.18s)
    N = max(3, int(0.18 * fps))
    V_THRESHOLD = 0.005 # 归一化垂直速度阈值
    
    try:
        from scipy.signal import argrelextrema
        ys = np.array([p["y"] for p in points])
        xs = np.array([p["x"] for p in points])
        
        # 1. 寻找顶点 (Apex) - 引入状态锁与滑动窗口
        search_start = max(5, int(n * 0.1))
        search_end = int(n * 0.75) # 顶点通常在前半段
        
        search_area = ys[search_start:search_end]
        local_mins = argrelextrema(search_area, np.less, order=N)[0]
        
        apex_idx = n // 3 # 默认比例
        found_apex = False
        
        # 遍历所有局部最高点候选
        for cand in local_mins:
            idx = search_start + cand
            if idx + N >= n: continue
            
            # --- 滑动窗口下坠校验 (Velocity Latch) ---
            # 计算接下来 N 帧的平均下行速度
            future_ys = ys[idx : idx + N]
            avg_v_y = (future_ys[-1] - future_ys[0]) / N
            
            # --- X轴反转校验 ---
            # 简化逻辑：上杆水平位移方向与下杆应相反
            dx_pre = xs[max(0, idx-5)] - xs[idx]
            dx_post = xs[min(n-1, idx+5)] - xs[idx]
            is_x_reversing = (dx_pre * dx_post < 0) or (abs(dx_post) > 0.01)

            if avg_v_y > V_THRESHOLD and is_x_reversing:
                apex_idx = idx
                found_apex = True
                break # 锁定第一个符合物理特征的顶点（防止被收杆干扰）

        if not found_apex:
            # 兜底寻找区间最小值
            apex_idx = search_start + np.argmin(search_area)

        # 2. 寻找击球点 (Impact) - Apex 之后
        # 寻找距离 p_init 最近的点，且伴随速度极值
        impact_idx = n - 1
        found_impact = False
        search_impact_start = apex_idx + 2
        search_impact_end = min(n, int(n * 0.95))
        
        if search_impact_start < n:
            dists = []
            for i in range(search_impact_start, search_impact_end):
                p = club_pts[i] or points[i]
                d = np.sqrt((p['x']-p_init['x'])**2 + (p['y']-p_init['y'])**2)
                dists.append(d)
            
            if dists:
                local_impact_idx = np.argmin(dists)
                if dists[local_impact_idx] < 0.18:
                    impact_idx = search_impact_start + local_impact_idx
                    found_impact = True

        # 3. 如果识别出的比例非常离谱（例如上杆占了 90%），执行 TPI 3:1 经验回退
        # 高尔夫物理常识：上杆时长通常是下杆时长的 3 倍左右
        if apex_idx > n * 0.8:
            print(f"[SwingEngine] Detection outlier (Apex at {apex_idx}/{n}), using TPI 3:1 fallback.")
            apex_idx = int(n * 0.6) # 粗略分配
            impact_idx = int(n * 0.8)

        return {"apex_idx": int(apex_idx), "impact_idx": int(impact_idx)}

    except Exception as e:
        print(f"[SwingEngine] Phase Detection error: {e}")
        return {"apex_idx": n // 3, "impact_idx": (2 * n) // 3}

def compute_swing_trace(history: list, fps: float = 30.0) -> Dict:
    """
    主入口：FPS 解耦的轨迹分析。
    """
    if not history:
        return {"points": [], "vSlot": []}

    try:
        # 1. 识别准备参数
        setup = _detect_setup_params(history)
        v_slot_geom = []
        if setup:
            v_slot_geom = _calculate_v_slot(setup)
        else:
            setup = {"p_init_club": {"x": 0.5, "y": 0.85}, "p_init_hand": {"x": 0.5, "y": 0.75}}

        # 2. 提取数据
        raw_points, club_pts = [], []
        for frame in history:
            lms = frame.get("landmarks", [])
            center = _extract_wrist_center(lms)
            if center:
                raw_points.append({"t": frame["t"], "x": center["x"], "y": center["y"]})
                club_pts.append(frame.get("clubhead"))
                
        if len(raw_points) < 15:
            return {"points": [], "vSlot": []}

        # 3. 识别阶段 (带 FPS)
        phases = _detect_swing_phases_v2(raw_points, club_pts, setup, fps)
        
        # 4. 组装 (单向状态分拨)
        points = []
        for i, p in enumerate(raw_points):
            if i <= phases["apex_idx"]:
                phase = "backswing"
            elif i <= phases["impact_idx"]:
                phase = "downswing"
            else:
                phase = "follow_through"
            points.append({**p, "phase": phase})

        return {"points": points, "vSlot": v_slot_geom}

    except Exception as e:
        print(f"[SwingEngine] Full trace error: {e}")
        return {"points": [], "vSlot": []}
