import math

def clamp01(x: float) -> float:
    return max(0.0, min(1.0, x))

def clamp(x: float, a: float, b: float) -> float:
    return max(a, min(b, x))

def dist(a: dict, b: dict) -> float:
    dx = a.get('x', 0) - b.get('x', 0)
    dy = a.get('y', 0) - b.get('y', 0)
    return math.sqrt(dx * dx + dy * dy)

def angle_between(a: dict, b: dict, c: dict) -> float:
    # angle at b for points a-b-c
    ab_x = a.get('x', 0) - b.get('x', 0)
    ab_y = a.get('y', 0) - b.get('y', 0)
    cb_x = c.get('x', 0) - b.get('x', 0)
    cb_y = c.get('y', 0) - b.get('y', 0)
    
    dot = ab_x * cb_x + ab_y * cb_y
    na = math.sqrt(ab_x * ab_x + ab_y * ab_y)
    nb = math.sqrt(cb_x * cb_x + cb_y * cb_y)
    if na < 1e-6 or nb < 1e-6:
        return 0.0
    
    cos_val = dot / (na * nb)
    rad = math.acos(clamp(cos_val, -1.0, 1.0))
    return (rad * 180.0) / math.pi

def mirror_landmarks_x(landmarks: list) -> list:
    if not landmarks:
        return landmarks
    return [{ **p, 'x': 1.0 - p.get('x', 0) } for p in landmarks]

def get_lm(landmarks: list, idx: int) -> dict:
    if not landmarks or idx >= len(landmarks) or landmarks[idx] is None:
        return None
    return landmarks[idx]

def get_mid(landmarks: list, idx_a: int, idx_b: int) -> dict:
    a = get_lm(landmarks, idx_a)
    b = get_lm(landmarks, idx_b)
    if not a or not b:
        return None
    return {
        'x': (a.get('x', 0) + b.get('x', 0)) / 2,
        'y': (a.get('y', 0) + b.get('y', 0)) / 2,
        'z': (a.get('z', 0) + b.get('z', 0)) / 2
    }

def analyze_swing(raw_landmarks: list, analysis_landmarks: list, history: list, view: str, handedness: str, club_type: str) -> dict:
    if not history or len(history) < 12:
        return {
            "issues": [],
            "metrics": {},
            "trajectory": { "path": [], "center": [] },
            "explanationKey": None,
            "debug": { "view": view },
            "rawLandmarks": raw_landmarks,
            "ready": False
        }

    mirrored = mirror_landmarks_x(analysis_landmarks) if handedness == "left" else analysis_landmarks

    idx_lw, idx_rw = 15, 16
    idx_le, idx_re = 13, 14
    idx_ls, idx_rs = 11, 12
    idx_lh, idx_rh = 23, 24

    # Extract wrist/shoulder/hip tracks from history
    wrist_track = []
    for f in history:
        lms = f.get('landmarks', [])
        L = get_lm(lms, idx_lw) or {'x': 0, 'y': 0, 'z': 0, 'visibility': 0}
        R = get_lm(lms, idx_rw) or {'x': 0, 'y': 0, 'z': 0, 'visibility': 0}
        should_mid = get_mid(lms, idx_ls, idx_rs) or {'x': 0, 'y': 0, 'z': 0}
        hip_mid = get_mid(lms, idx_lh, idx_rh) or {'x': 0, 'y': 0, 'z': 0}
        hand_vis = max(L.get('visibility', 0), R.get('visibility', 0))
        
        wrist_track.append({
            't': f.get('t', 0),
            'L': L,
            'R': R,
            'handsMid': {
                'x': (L.get('x', 0) + R.get('x', 0)) / 2,
                'y': (L.get('y', 0) + R.get('y', 0)) / 2,
                'z': (L.get('z', 0) + R.get('z', 0)) / 2
            },
            'shouldMid': should_mid,
            'hipMid': hip_mid,
            'handVis': hand_vis
        })

    # Impact detection
    history_recent = wrist_track[max(0, len(wrist_track) - 40):]

    best = {'i': -1, 'v': 0.0}
    for i in range(1, len(history_recent)):
        a = history_recent[i - 1]
        b = history_recent[i]
        dt = max(1, b['t'] - a['t'])
        v_l = dist(a['L'], b['L']) / (dt / 1000.0)
        v_r = dist(a['R'], b['R']) / (dt / 1000.0)
        v = max(v_l, v_r) * max(0.2, (a['handVis'] + b['handVis']) / 2.0)
        if v > best['v']:
            best = {'i': i, 'v': v}
            
    impact_index = best['i']
    min_impact_velocity = 0.65
    
    if impact_index >= 0 and best['v'] > min_impact_velocity:
        impact_frame = history_recent[impact_index]
    else:
        impact_frame = history_recent[-1]

    # Back-swing start
    threshold_y = 0.08
    back_start = wrist_track[0]
    for i in range(len(wrist_track)):
        f = wrist_track[i]
        hand_y = min(f['L']['y'], f['R']['y'])
        shoulder_y = f['shouldMid']['y']
        if hand_y < shoulder_y - threshold_y:
            back_start = f
            break

    # Transition
    transition = back_start
    start_idx = max(1, wrist_track.index(back_start) if back_start in wrist_track else 1)
    for i in range(start_idx, len(wrist_track)):
        prev = wrist_track[i - 1]
        cur = wrist_track[i]
        hand_y_prev = min(prev['L']['y'], prev['R']['y'])
        hand_y_cur = min(cur['L']['y'], cur['R']['y'])
        dy = hand_y_cur - hand_y_prev
        was_up = hand_y_prev < prev['shouldMid']['y'] - threshold_y / 2.0
        if was_up and dy > 0.003:
            transition = cur
            break

    impact_t = impact_frame['t']
    back_start_t = back_start['t']
    transition_t = transition['t']

    backswing_ms = clamp(transition_t - back_start_t, 50, 2500)
    downswing_ms = clamp(impact_t - transition_t, 50, 2500)
    rhythm_ratio = downswing_ms / max(80, backswing_ms)

    speed_est = best['v']
    club_head_speed = speed_est * (60 if view == "side" else 55)

    impact_landmarks = mirrored
    shoulder_mid = get_mid(impact_landmarks, idx_ls, idx_rs) or impact_frame['shouldMid']
    hip_mid = get_mid(impact_landmarks, idx_lh, idx_rh) or impact_frame['hipMid']
    Lw = get_lm(impact_landmarks, idx_lw) or impact_frame['L']
    Rw = get_lm(impact_landmarks, idx_rw) or impact_frame['R']

    right_shoulder = get_lm(impact_landmarks, idx_rs) or shoulder_mid
    right_elbow = get_lm(impact_landmarks, idx_re) or impact_frame['R']
    right_wrist = get_lm(impact_landmarks, idx_rw) or impact_frame['R']
    club_face_angle = angle_between(right_shoulder, right_elbow, right_wrist)

    hand_mid = impact_frame['handsMid']
    spine_tilt = abs(shoulder_mid['y'] - hip_mid['y'])
    hands_hip_dist = dist({'x': hand_mid['x'], 'y': hand_mid['y']}, hip_mid)
    hands_shoulder_dist = dist({'x': hand_mid['x'], 'y': hand_mid['y']}, shoulder_mid)

    strike_efficiency = 100 - abs(hands_shoulder_dist - hands_hip_dist) * 180 - abs(spine_tilt - 0.12) * 450
    strike_efficiency = clamp(strike_efficiency, 0, 100)

    issues = []
    def add_issue(label, conf, fix):
        issues.append({
            "label": label,
            "confidence": clamp01(conf),
            "fix": fix
        })

    fast_back = backswing_ms < 280
    slow_back = backswing_ms > 900
    if fast_back: add_issue("上杆过快", (280 - backswing_ms) / 250, "放慢上杆，让转体更顺")
    if slow_back: add_issue("上杆过慢", (backswing_ms - 900) / 800, "加快手臂提升速度")
    if rhythm_ratio < 0.72: add_issue("下杆启动过早", (0.72 - rhythm_ratio) / 0.72, "先完成转体再下杆")
    if rhythm_ratio > 1.55: add_issue("下杆过慢", (rhythm_ratio - 1.55) / 1.55, "加快重心进入")

    hand_y = min(Lw['y'], Rw['y'])
    shoulder_y = shoulder_mid['y']
    topping_conf = (shoulder_y - hand_y - 0.05) / 0.08
    if topping_conf > 0.15: add_issue("打顶", topping_conf, "下杆加深，击球瞬间降低手部高度")

    hip_y = hip_mid['y']
    thick_conf = (hand_y - hip_y + 0.02) / 0.10
    if thick_conf > 0.15: add_issue("打厚", thick_conf, "保持手臂长度，击球点更靠前")

    if view == "front":
        wrist_x = impact_frame['handsMid']['x']
        hip_x = hip_mid['x']
        shoulder_x = shoulder_mid['x']
        rel = wrist_x - hip_x
        dir_conf = abs(rel) / 0.15

        if rel < -0.03: add_issue("左曲球", dir_conf, "让杆面更靠外摆入，保持收杆")
        elif rel > 0.03: add_issue("右曲球", dir_conf, "减少外向内切入，击球后保持杆面")

        skew = (shoulder_mid['x'] - hip_mid['x']) / 0.2
        if abs(skew) > 0.25: add_issue("斜飞球", abs(skew) / 0.8, "提高转体一致性，保持路径在同一平面")
    else:
        ext = club_face_angle
        bias = (ext - 120) / 60
        conf = abs(bias)
        if bias > 0.2: add_issue("右曲球", conf, "减小杆面开放度，击球后收住")
        if bias < -0.2: add_issue("左曲球", conf, "提高杆面稳定性，避免过早翻转")
        if conf > 0.35: add_issue("斜飞球", conf * 0.9, "维持下杆平面，避免外侧拉出")

    if club_head_speed < 28: add_issue("杆头速度不足", (30 - club_head_speed) / 30, "加大转体幅度，提升挥杆速度")
    if strike_efficiency < 62: add_issue("击球效率偏低", (65 - strike_efficiency) / 65, "稳定触球点，减少节奏波动")

    issues.sort(key=lambda x: x['confidence'], reverse=True)
    top = issues[:10]

    recent = wrist_track[max(0, len(wrist_track) - 55):]
    path = [{'x': f['handsMid']['x'], 'y': f['handsMid']['y'], 't': f['t']} for f in recent]
    center = [{'x': f['hipMid']['x'], 'y': f['hipMid']['y'], 't': f['t']} for f in recent]

    primary = top[0]['label'] if top else None

    return {
        "issues": top,
        "metrics": {
            "杆头速度": club_head_speed,
            "挥杆节奏比": rhythm_ratio,
            "杆面角度": club_face_angle,
            "击球效率": strike_efficiency
        },
        "trajectory": {
            "path": path,
            "center": center,
            "impact": impact_frame,
            "backStart": back_start,
            "transition": transition
        },
        "explanationKey": primary,
        "debug": {
            "backswingMs": backswing_ms,
            "downswingMs": downswing_ms,
            "minImpactVelocity": best['v'],
            "impactT": impact_t,
            "primary": primary,
            "view": view
        },
        "rawLandmarks": raw_landmarks,
        "fullHistory": history,
        "ready": True
    }
