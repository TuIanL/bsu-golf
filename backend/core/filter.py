import numpy as np
from scipy.signal import savgol_filter
from typing import List
from .datatypes import KeyFrameData, Point2D

def smooth_joints_sequence(sequence: List[KeyFrameData], window_size: int = 5, polyorder: int = 2) -> List[KeyFrameData]:
    """
    使用 Savitzky-Golay 滤波器对人体 17 个关键点序列进行时序平滑降噪。
    S-G 滤波器的优势在于能够有效剔除高频 Jitter 单帧抖动，但极大地保留原始数据的峰值特征（防止过度平滑丢失击球瞬时极值）。
    
    参数:
    sequence: 按时间戳排序的缓冲帧序列 (通常包含相邻的几个不同阶段或高帧率切片)
    window_size: 必须为奇数，表示平滑窗口大小。若是总共只有 8 帧极简输入，建议 window_size 取 3。
    polyorder: 拟合多项式的阶数。
    """
    seq_len = len(sequence)
    if seq_len < window_size:
        # 如果序列太短，退化为不平滑或者减小 window_size
        window_size = seq_len if seq_len % 2 == 1 else seq_len - 1
        if window_size < 3:
            # 放弃平滑，直接复制
            for frame in sequence:
                frame.smoothedJoints = {k: Point2D(v.x, v.y, v.prob) for k, v in frame.scaledJoints.items()}
            return sequence

    # 提取所有的 Joint 键 (如 'left_shoulder', 'right_hip' 等)
    if seq_len == 0:
        return sequence
    joint_keys = list(sequence[0].scaledJoints.keys())
    
    # 将序列解构为针对每个 Joint 的 numpy arrays，便于列级滤波
    # [N, 2] 对于每一个 joint_key
    filtered_data = {}
    for key in joint_keys:
        coords = np.array([[frame.scaledJoints[key].x, frame.scaledJoints[key].y] for frame in sequence])
        x_filtered = savgol_filter(coords[:, 0], window_size, polyorder)
        y_filtered = savgol_filter(coords[:, 1], window_size, polyorder)
        filtered_data[key] = (x_filtered, y_filtered)

    # 将滤波结果写回 sequence
    for i, frame in enumerate(sequence):
        frame.smoothedJoints = {}
        for key in joint_keys:
            orig_prob = frame.scaledJoints[key].prob
            frame.smoothedJoints[key] = Point2D(
                x=float(filtered_data[key][0][i]),
                y=float(filtered_data[key][1][i]),
                prob=orig_prob  # 信任度保持原始设定的可信度
            )
            
    return sequence
