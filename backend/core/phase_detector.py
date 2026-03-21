from typing import List, Dict, Optional
from .datatypes import KeyFrameData, SwingPhase, BBox, Point2D
import math

def calculate_distance(p1, p2):
    return math.hypot(p1.get('x', 0) - p2.get('x', 0), p1.get('y', 0) - p2.get('y', 0))

def extract_landmarks(frame: Dict) -> Dict[str, Point2D]:
    """Convert MediaPipe index-based landmarks to named Point2D dictionary"""
    lms = frame.get('landmarks', [])
    if not lms or len(lms) < 33:
        return {}
    
    # MediaPipe Pose Topology Mapping
    mapping = {
        0: 'nose', 7: 'left_ear', 8: 'right_ear',
        11: 'left_shoulder', 12: 'right_shoulder',
        13: 'left_elbow', 14: 'right_elbow',
        15: 'left_wrist', 16: 'right_wrist',
        23: 'left_hip', 24: 'right_hip',
        25: 'left_knee', 26: 'right_knee',
        27: 'left_ankle', 28: 'right_ankle'
    }
    
    result = {}
    for idx, name in mapping.items():
        if idx < len(lms):
            pt = lms[idx]
            result[name] = Point2D(x=pt.get('x', 0), y=pt.get('y', 0), prob=pt.get('visibility', 1.0))
    return result

def detect_phases(history: List[Dict]) -> List[KeyFrameData]:
    """
    Analyzes the dense smoothed history array to identify the 8 critical SwingPhases.
    Returns exactly 8 KeyFrameData objects.
    """
    if not history or len(history) < 10:
        return []

    # Helper to get wrist Y (average of left/right) and velocity
    def get_wrist_y(frame):
        lms = frame.get('landmarks', [])
        if len(lms) > 16:
            return (lms[15].get('y', 0) + lms[16].get('y', 0)) / 2.0
        return 0.0

    # 1. FIND TOP (Highest point of hands -> Minimum Y coordinate)
    top_idx = 0
    min_y = float('inf')
    for i, frame in enumerate(history):
        wy = get_wrist_y(frame)
        if wy < min_y:
            min_y = wy
            top_idx = i

    # 2. FIND IMPACT (Max velocity after TOP)
    # Calculate velocities
    velocities = [0.0] * len(history)
    for i in range(1, len(history)):
        dt = max(1.0, history[i]['t'] - history[i-1]['t'])
        dx = history[i]['landmarks'][15].get('x', 0) - history[i-1]['landmarks'][15].get('x', 0)
        dy = history[i]['landmarks'][15].get('y', 0) - history[i-1]['landmarks'][15].get('y', 0)
        velocities[i] = math.hypot(dx, dy) / dt

    impact_idx = top_idx
    max_vel = 0.0
    for i in range(top_idx, len(history) - 1):
        if velocities[i] > max_vel:
            max_vel = velocities[i]
            impact_idx = i

    # 3. FIND ADDRESS (Stable position before TOP where hands are low)
    # Search backwards from TOP
    address_idx = 0
    # For simplicity, taking the first frame or a stabilizing frame.
    # We will pick frame 0 as pseudo address if it's trimmed, or the frame where velocity is lowest in the first 20%
    address_idx = 0

    # 4. TAKEAWAY (Midpoint or specific wrist height between ADDRESS and TOP)
    takeaway_idx = address_idx + (top_idx - address_idx) // 3
    
    # 5. BACKSWING (Midpoint between TAKEAWAY and TOP)
    backswing_idx = takeaway_idx + (top_idx - takeaway_idx) // 2
    
    # 6. DOWNSWING (Midpoint between TOP and IMPACT)
    downswing_idx = top_idx + (impact_idx - top_idx) // 2

    # 7. FOLLOW_THROUGH (Shortly after IMPACT)
    follow_idx = impact_idx + min(15, (len(history) - 1 - impact_idx) // 3)

    # 8. FINISH (End of swing)
    finish_idx = len(history) - 1

    indices = {
        SwingPhase.ADDRESS: address_idx,
        SwingPhase.TAKEAWAY: takeaway_idx,
        SwingPhase.BACKSWING: backswing_idx,
        SwingPhase.TOP: top_idx,
        SwingPhase.DOWNSWING: downswing_idx,
        SwingPhase.IMPACT: impact_idx,
        SwingPhase.FOLLOW_THROUGH: follow_idx,
        SwingPhase.FINISH: finish_idx
    }

    # Build the 8 KeyFrameData
    key_frames = []
    # Ensure order matches the enum sequence
    for phase_enum in SwingPhase:
        idx = indices.get(phase_enum, 0)
        frame = history[idx]
        joints_dict = extract_landmarks(frame)
        
        kf = KeyFrameData(
            phase=phase_enum,
            timestamp=frame.get('t', 0.0),
            rCnnBBox=BBox(0, 0, 0, 0), # Dummy BBox since we use MediaPipe
            rawJoints=joints_dict,
            scaledJoints=joints_dict, # Skip raw scaling for now, use normalized
            smoothedJoints=joints_dict # Dense S-G already applied
        )
        key_frames.append(kf)

    return key_frames
