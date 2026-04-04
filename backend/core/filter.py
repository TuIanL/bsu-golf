import numpy as np
from scipy.signal import savgol_filter
from typing import List, Dict

def smooth_dense_sequence(sequence: List[Dict], window_size: int = 11, polyorder: int = 2) -> List[Dict]:
    """
    使用 Savitzky-Golay 滤波器对所有的稠密追踪视频帧（30fps 或 60fps 时间序列）进行时序平滑降噪。
    由于是对所有视频帧进行密集滤波，不会出现由于阶段跳跃引起的扭曲插值问题。
    """
    seq_len = len(sequence)
    if seq_len < window_size:
        window_size = seq_len if seq_len % 2 == 1 else seq_len - 1
        if window_size < 3:
            return sequence

    if seq_len == 0:
        return sequence

    # 确定骨骼点数量（通常 MediaPipe Pose 为 33 点）
    num_landmarks = len(sequence[0].get('landmarks', []))
    if num_landmarks == 0:
        return sequence

    # 构建矩阵: [seq_len, num_landmarks, 3]
    coords_t = []
    for frame in sequence:
        lms = frame.get('landmarks', [])
        # 防止个别帧由于识别丢失导致的长度不对齐
        if len(lms) < num_landmarks:
            arr = [[0.0, 0.0, 0.0]] * num_landmarks
            for i, p in enumerate(lms):
                arr[i] = [p.get('x',0), p.get('y',0), p.get('z',0)]
        else:
            arr = [[p.get('x',0), p.get('y',0), p.get('z',0)] for p in lms[:num_landmarks]]
        coords_t.append(arr)
        
    coords_np = np.array(coords_t) # shape: (seq_len, num_landmarks, 3)
    
    # 分别对每个点的 x, y, z 进行单维度序列滤波
    smoothed_coords = np.zeros_like(coords_np)
    for i in range(num_landmarks):
        for dim in range(3): # x, y, z
            dim_seq = coords_np[:, i, dim]
            smoothed_coords[:, i, dim] = savgol_filter(dim_seq, window_size, polyorder)
            
    # 回写至字典序列
    smoothed_sequence = []
    for t_idx, frame in enumerate(sequence):
        # 复制原有的所有字段（包括 clubhead, t 等）
        new_frame = frame.copy()
        
        old_lms = frame.get('landmarks', [])
        new_lms = []
        for i in range(num_landmarks):
            vis = 1.0
            if i < len(old_lms):
                vis = old_lms[i].get('visibility', 1.0)
            
            new_lms.append({
                'x': float(smoothed_coords[t_idx, i, 0]),
                'y': float(smoothed_coords[t_idx, i, 1]),
                'z': float(smoothed_coords[t_idx, i, 2]),
                'visibility': vis
            })
        new_frame['landmarks'] = new_lms
        smoothed_sequence.append(new_frame)

    return smoothed_sequence
