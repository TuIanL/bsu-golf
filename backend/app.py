from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
import time
import uuid

# 导入我们事先写好的核心基础算法库
from core.datatypes import SwingPhase, KeyFrameData, BBox, Point2D, EngineContext
from core.feature_router import extract_flattened_features
from core.pose_estimator import process_video
from core.swing_analyzer import analyze_swing
from core.scoring_engine import score_from_issues
import os
import tempfile
from fastapi import Form

app = FastAPI(title="Golf Posture AI - Mock Backend")

# 放开跨域限制，允许前端 http://localhost:8765 访问
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 开发阶段全放开
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.post("/api/analyze-video")
async def analyze_video(
    video: UploadFile = File(...),
    view: str = Form("front"),
    handedness: str = Form("right"),
    clubType: str = Form("wood")
):
    """
    接收前端视频流，通过 MediaPipe 进行骨骼点提取，然后根据核心算法进行评分。
    """
    start_time = time.time()
    
    file_bytes = await video.read()
    file_size_mb = len(file_bytes) / (1024 * 1024)

    # 1. 保存视频至临时文件
    temp_video_path = ""
    with tempfile.NamedTemporaryFile(delete=False, suffix=".mp4") as temp_file:
        temp_file.write(file_bytes)
        temp_video_path = temp_file.name

    try:
        # 2. 从视频提取动作历史
        history = process_video(temp_video_path)
        
        # 3. 如果没能提取到历史或历史过短，直接返回默认
        if not history or len(history) < 12:
            return {
                "status": "error",
                "message": "未能从视频中提取到足够的有效动作帧"
            }

        # 4. 取最后一帧或代表性帧作 raw_landmarks/analysis_landmarks
        final_frame_landmarks = history[-1]['landmarks']
        
        # 5. 分析挥杆
        base_result = analyze_swing(
            raw_landmarks=final_frame_landmarks,
            analysis_landmarks=final_frame_landmarks,
            history=history,
            view=view,
            handedness=handedness,
            club_type=clubType
        )
        
        if not base_result.get("ready"):
            return {
                "status": "success",
                "python_pipeline_results": base_result
            }

        # 6. 打分
        scored_result = score_from_issues(base_result.get("issues", []))
        
        # 合并结果
        final_result = {**base_result, **scored_result}

        # 7. (可选) 继续保留原有的 feature_router / mock_nam_explanations 流程
        # 为了兼容前面的 Mock UI, 原代码在此处有一些 extracted_features 和 nam_explanations

        process_time_ms = int((time.time() - start_time) * 1000)

        # 8. 返回给前端
        return {
            "status": "success",
            "job_id": str(uuid.uuid4()),
            "file_info": {
                "filename": video.filename,
                "size_mb": round(file_size_mb, 2)
            },
            "python_pipeline_results": final_result
        }

    finally:
        # 清理临时视频文件
        if os.path.exists(temp_video_path):
            os.remove(temp_video_path)

if __name__ == "__main__":
    import uvicorn
    # 为了方便测试，使用 app.py 直接支持 python app.py 启动
    uvicorn.run("app:app", host="0.0.0.0", port=8000, reload=True)
