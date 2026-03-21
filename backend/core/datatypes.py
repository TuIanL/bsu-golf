from enum import Enum
from dataclasses import dataclass, field
from typing import List, Dict, Optional, Tuple

class SwingPhase(str, Enum):
    ADDRESS = "Address"                 # 准备
    TAKEAWAY = "Takeaway"               # 上杆起始
    BACKSWING = "Backswing"             # 上杆
    TOP = "Top"                         # 顶点
    DOWNSWING = "Downswing"             # 下杆
    IMPACT = "Impact"                   # 击球
    FOLLOW_THROUGH = "Follow-through"   # 送杆
    FINISH = "Finish"                   # 收杆

@dataclass
class BBox:
    x: float
    y: float
    w: float
    h: float
    confidence: float = 1.0

@dataclass
class Point2D:
    x: float
    y: float
    prob: float = 1.0

@dataclass
class KeyFrameData:
    phase: SwingPhase
    timestamp: float                    # 视频中的相对时间戳 (ms)
    rCnnBBox: BBox                      # Faster R-CNN 识别到的人物框
    rawJoints: Dict[str, Point2D]       # 17个原始关键点字典 (Key: joint_name)
    scaledJoints: Dict[str, Point2D]    # 等比缩放后的归一化关键点 (x/w, y/w)
    smoothedJoints: Dict[str, Point2D] = field(default_factory=dict) # 经 S-G 滤波降噪后的坐标

@dataclass
class EngineContext:
    """保存挥杆过程中的静态或历史上下文参量，用于跨阶段衍生特征计算"""
    max_shoulder_width_address: float = 0.0
    max_hip_width_address: float = 0.0
    prev_hip_rotation_theta: Optional[float] = None
    prev_shoulder_rotation_theta: Optional[float] = None
    prev_timestamp: Optional[float] = None

# 扁平化的 40 维特征字典别名
FlattenedFeatures = Dict[str, float]
