import math
from typing import Tuple
from .datatypes import Point2D

def calculate_distance(p1: Point2D, p2: Point2D) -> float:
    """计算两点间的欧式距离"""
    return math.hypot(p1.x - p2.x, p1.y - p2.y)

def calculate_angle_3pt(a: Point2D, b: Point2D, c: Point2D) -> float:
    """
    计算由三个点构成的夹角 (以 b 为顶点)
    返回角度 (0 - 180度)
    """
    ang_a = math.degrees(math.atan2(a.y - b.y, a.x - b.x))
    ang_c = math.degrees(math.atan2(c.y - b.y, c.x - b.x))
    angle = abs(ang_a - ang_c)
    if angle > 180:
        angle = 360 - angle
    return angle

def calculate_global_angle(p1: Point2D, p2: Point2D) -> float:
    """计算两点连线与水平面绝对夹角 (-180 ~ 180)"""
    return math.degrees(math.atan2(p2.y - p1.y, p2.x - p1.x))

def estimate_pseudo_3d_rotation(left_pt: Point2D, right_pt: Point2D, max_width: float, is_front_view: bool = True) -> float:
    """
    伪 3D 旋转角估算 (Pseudo-3D Cosine Estimator)
    利用正面最大宽度 W_max 和当前观测投影宽度 W_obs，配合反余弦函数反推绝对旋转角 Theta。
    并引入符号方向判断：当双肩/双髋坐标发生交叉时，判定旋转超过 90 度。
    """
    if max_width <= 0:
        return 0.0

    current_width = calculate_distance(left_pt, right_pt)
    
    # 比例防御，防止数学溢出
    ratio = current_width / max_width
    ratio = max(0.0, min(1.0, ratio)) # 假定躯干不能反折，比例在 [0, 1]
    
    rotation_deg = math.degrees(math.acos(ratio))
    
    # 检测交叉 (大于 90 度)
    if is_front_view:
        # MediaPipe 输出的是生物学左右：
        # 正面视角下，生物学左肩 (left_pt) 原本在画面右侧 (X 更大)
        # 生物学右肩 (right_pt) 原本在画面左侧 (X 更小)
        # 如果 left_pt.x < right_pt.x，说明发生了背对镜头的交叉，旋转已超过 90 度
        if left_pt.x < right_pt.x:
            rotation_deg = 180.0 - rotation_deg

    return rotation_deg
