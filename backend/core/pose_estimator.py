import cv2
import mediapipe as mp
from mediapipe.tasks import python
from mediapipe.tasks.python import vision
import os
from .filter import smooth_dense_sequence
import numpy as np

def _detect_clubhead(frame, wrist_lms, img_w, img_h):
    """
    利用 OpenCV 霍夫变换在手部周围寻找杆身直线，并推算杆头位置。
    """
    try:
        # 1. 计算手部中心 (用于 ROI 裁剪)
        lw, rw = wrist_lms[0], wrist_lms[1]
        cx = int((lw['x'] + rw['x']) / 2 * img_w)
        cy = int((lw['y'] + rw['y']) / 2 * img_h)

        # 2. 定义动态 ROI (向下/外侧扩展)
        roi_size = 180
        x1 = max(0, cx - roi_size)
        y1 = max(0, cy - 20) # 手部上方保留一点，下方多保留
        x2 = min(img_w, cx + roi_size)
        y2 = min(img_h, cy + roi_size * 2)

        if x2 <= x1 or y2 <= y1:
            return None

        roi = frame[y1:y2, x1:x2]
        gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
        
        # 3. 边缘检测与二值化
        blurred = cv2.GaussianBlur(gray, (5, 5), 0)
        edges = cv2.Canny(blurred, 50, 150)

        # 4. 霍夫直线变换 (寻找杆身)
        lines = cv2.HoughLinesP(edges, 1, np.pi/180, threshold=40, minLineLength=50, maxLineGap=15)

        if lines is not None:
            best_line = None
            max_dist = -1
            
            for line in lines:
                x1_l, y1_l, x2_l, y2_l = line[0]
                # 计算两个端点到手腕中心的距离
                dist1 = np.sqrt((x1_l + x1 - cx)**2 + (y1_l + y1 - cy)**2)
                dist2 = np.sqrt((x2_l + x1 - cx)**2 + (y2_l + y1 - cy)**2)
                
                curr_max = max(dist1, dist2)
                if curr_max > max_dist:
                    max_dist = curr_max
                    # 记录距离较远的那个点作为疑似杆头
                    if dist1 > dist2:
                        best_line = (x1_l + x1, y1_l + y1)
                    else:
                        best_line = (x2_l + x1, y2_l + y1)
            
            if best_line:
                return {'x': float(best_line[0] / img_w), 'y': float(best_line[1] / img_h)}
    except Exception as e:
        print(f"[Clubhead] Detection err: {e}")
    return None

def _apply_ema(current_val, prev_val, alpha=0.65):
    """简单指数移动平均"""
    if prev_val is None:
        return current_val
    return alpha * current_val + (1 - alpha) * prev_val

def process_video(video_path: str) -> dict:
    """
    Reads a video file, runs MediaPipe Pose Landmarker,
    returns a dict: {"fps": float, "history": list}
    """
    # Create robust path to the model file
    current_dir = os.path.dirname(os.path.abspath(__file__))
    model_path = os.path.join(current_dir, '..', 'pose_landmarker.task')

    if not os.path.exists(model_path):
        print(f"Model file not found at: {model_path}")
        return {"fps": 0.0, "history": []}

    # Initialize Pose Landmarker
    base_options = python.BaseOptions(model_asset_path=model_path)
    options = vision.PoseLandmarkerOptions(
        base_options=base_options,
        output_segmentation_masks=False
    )
    detector = vision.PoseLandmarker.create_from_options(options)

    TARGET_W = 360
    TARGET_H = 640

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        print(f"Failed to open video: {video_path}")
        return {"fps": 0.0, "history": []}

    fps = cap.get(cv2.CAP_PROP_FPS)
    if fps <= 0:
        fps = 30.0
    
    history = []
    frame_idx = 0
    prev_lms_vals = None # 用于 EMA 平滑

    while True:
        ret, frame = cap.read()
        if not ret:
            break

        frame_resized = cv2.resize(frame, (TARGET_W, TARGET_H), interpolation=cv2.INTER_LINEAR)
        image_rgb = cv2.cvtColor(frame_resized, cv2.COLOR_BGR2RGB)
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=image_rgb)
        
        # Run Pose detection
        results = detector.detect(mp_image)
        frame_time_ms = (frame_idx / fps) * 1000.0

        if results.pose_landmarks and len(results.pose_landmarks) > 0:
            raw_landmarks = results.pose_landmarks[0]
            
            # --- EMA 预平滑处理 ---
            current_lms_vals = []
            for p in raw_landmarks:
                current_lms_vals.extend([p.x, p.y, p.z])
            current_lms_vals = np.array(current_lms_vals)

            if prev_lms_vals is None:
                prev_lms_vals = current_lms_vals
            
            # alpha=0.6 滤波
            smoothed_vals = 0.6 * current_lms_vals + 0.4 * prev_lms_vals
            prev_lms_vals = smoothed_vals
            
            landmarks = []
            for i in range(len(raw_landmarks)):
                landmarks.append({
                    'x': float(smoothed_vals[i*3]),
                    'y': float(smoothed_vals[i*3 + 1]),
                    'z': float(smoothed_vals[i*3 + 2]),
                    'visibility': getattr(raw_landmarks[i], 'visibility', 1.0)
                })

            # 融合球杆头追踪 (OpenCV)
            wrists = [landmarks[15], landmarks[16]]
            clubhead = _detect_clubhead(frame_resized, wrists, TARGET_W, TARGET_H)

            history.append({
                't': frame_time_ms,
                'landmarks': landmarks,
                'clubhead': clubhead
            })
            if len(history) > 600:
                history.pop(0)

        frame_idx += 1

    cap.release()
    detector.close()

    # Apply Savitzky-Golay filtering (preserve history, now even smoother with EMA)
    smoothed_history = smooth_dense_sequence(history, window_size=11, polyorder=2)

    return {"history": smoothed_history, "fps": fps}
