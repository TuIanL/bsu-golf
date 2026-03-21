import cv2
import mediapipe as mp
from mediapipe.tasks import python
from mediapipe.tasks.python import vision
import os

def process_video(video_path: str) -> list:
    """
    Reads a video file, runs MediaPipe Pose Landmarker frame-by-frame,
    applies EMA smoothing (alpha=0.65) to landmarks, and returns
    a history array compatible with swing_analyzer.py.
    """
    # Create robust path to the model file
    current_dir = os.path.dirname(os.path.abspath(__file__))
    model_path = os.path.join(current_dir, '..', 'pose_landmarker.task')

    if not os.path.exists(model_path):
        print(f"Model file not found at: {model_path}")
        return []

    # Initialize Pose Landmarker
    base_options = python.BaseOptions(model_asset_path=model_path)
    options = vision.PoseLandmarkerOptions(
        base_options=base_options,
        output_segmentation_masks=False
    )
    detector = vision.PoseLandmarker.create_from_options(options)

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        print(f"Failed to open video: {video_path}")
        return []

    fps = cap.get(cv2.CAP_PROP_FPS)
    if fps <= 0:
        fps = 30.0
    
    alpha = 0.65
    smoothed = None
    history = []

    frame_idx = 0
    while True:
        ret, frame = cap.read()
        if not ret:
            break

        # Convert the BGR image to RGB
        image_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        
        # Wrap image in mp.Image
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=image_rgb)
        
        # Run detection
        results = detector.detect(mp_image)
        
        # Calculate time in milliseconds
        frame_time_ms = (frame_idx / fps) * 1000.0

        if results.pose_landmarks and len(results.pose_landmarks) > 0:
            raw_landmarks = results.pose_landmarks[0] # Get first person landmarks
            landmarks = [
                {
                    'x': p.x,
                    'y': p.y,
                    'z': p.z,
                    'visibility': getattr(p, 'visibility', 1.0)
                } for p in raw_landmarks
            ]

            if smoothed is None:
                smoothed = landmarks
            else:
                smoothed = [
                    {
                        'x': prev['x'] * alpha + curr['x'] * (1 - alpha),
                        'y': prev['y'] * alpha + curr['y'] * (1 - alpha),
                        'z': prev['z'] * alpha + curr['z'] * (1 - alpha),
                        'visibility': prev['visibility'] * alpha + curr.get('visibility', 1.0) * (1 - alpha)
                    }
                    for prev, curr in zip(smoothed, landmarks)
                ]
            
            # Keep limit to 600 frames to avoid memory issues (same as JS)
            history.append({
                't': frame_time_ms,
                'landmarks': list(smoothed)  # copy just in case
            })
            if len(history) > 600:
                history.pop(0)

        frame_idx += 1

    cap.release()
    detector.close() # Close detector to release resources

    return history
