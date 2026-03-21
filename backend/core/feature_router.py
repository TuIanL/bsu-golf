from typing import Dict
from .datatypes import KeyFrameData, EngineContext, SwingPhase, FlattenedFeatures
from .geometry import calculate_distance, calculate_global_angle, calculate_angle_3pt, estimate_pseudo_3d_rotation

def extract_flattened_features(frame: KeyFrameData, context: EngineContext) -> FlattenedFeatures:
    """
    基于 Switch-case 的特征路由映射器
    根据当前帧的 SwingPhase，有针对性地提取该阶段特有的 CaddieSet 特征和 SPI 旋转极值
    返回的字典会拼接到总特征库中送给下游的 PCA / NAM 模型
    """
    flat_features: FlattenedFeatures = {}
    joints = frame.smoothedJoints
    
    # 基础空安全检查
    if not joints:
        return flat_features

    phase = frame.phase

    if phase == SwingPhase.ADDRESS:
        # 1. 站位比 (Stance Ratio) = 双脚距离 / 肩宽
        stance_width = calculate_distance(joints["left_ankle"], joints["right_ankle"])
        shoulder_width = calculate_distance(joints["left_shoulder"], joints["right_shoulder"])
        
        # 将最大肩宽存入上下文，供后续伪 3D 旋转参考
        context.max_shoulder_width_address = max(context.max_shoulder_width_address, shoulder_width)
        
        # 骨盆最大宽度基准
        hip_width = calculate_distance(joints["left_hip"], joints["right_hip"])
        context.max_hip_width_address = max(context.max_hip_width_address, hip_width)
        
        flat_features["ADDRESS_STANCE_RATIO"] = stance_width / context.max_shoulder_width_address if context.max_shoulder_width_address > 0 else 0
        
        # 2. 准备阶段的肩部倾角 (一般右肩低于左肩)
        flat_features["ADDRESS_SHOULDER_ANGLE"] = calculate_global_angle(joints["left_shoulder"], joints["right_shoulder"])

    elif phase == SwingPhase.TOP:
        # 1. 上杆顶点的左臂伸直程度 (Left Arm Angle)
        flat_features["TOP_LEFT_ARM_ANGLE"] = calculate_angle_3pt(
            joints["left_shoulder"], 
            joints["left_elbow"], 
            joints["left_wrist"]
        )
        
        # 2. 肩部极限扭转角度 (利用伪 3D Cosine 估算)
        flat_features["TOP_SHOULDER_ROTATION_THETA"] = estimate_pseudo_3d_rotation(
            joints["left_shoulder"], 
            joints["right_shoulder"], 
            context.max_shoulder_width_address
        )

    elif phase == SwingPhase.IMPACT:
        # 1. 击球时髋部开放角度 (Hip Rotation at Impact)
        current_hip_rotation = estimate_pseudo_3d_rotation(
            joints["left_hip"], 
            joints["right_hip"], 
            context.max_hip_width_address
        )
        flat_features["IMPACT_HIP_ROTATION_THETA"] = current_hip_rotation
        
        # 2. SPI 核心：击球瞬时骨盆角速度 (Impact Velocity)
        if context.prev_timestamp is not None and context.prev_hip_rotation_theta is not None:
            dt = (frame.timestamp - context.prev_timestamp) / 1000.0 # 转换为秒
            if dt > 0:
                angular_velocity = (current_hip_rotation - context.prev_hip_rotation_theta) / dt
                flat_features["SPI_IMPACT_VELOCITY"] = angular_velocity

    # 在所有阶段的末尾，更新当前帧到全局字典，为下一帧差分做准备
    if "left_hip" in joints and "right_hip" in joints:
        context.prev_hip_rotation_theta = estimate_pseudo_3d_rotation(
            joints["left_hip"], joints["right_hip"], context.max_hip_width_address
        )
    context.prev_timestamp = frame.timestamp

    return flat_features
