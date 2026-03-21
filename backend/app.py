from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
import time
import uuid

# 导入我们事先写好的核心基础算法库
from core.datatypes import SwingPhase, KeyFrameData, BBox, Point2D, EngineContext
from core.feature_router import extract_flattened_features
from core.pose_estimator import process_video
from core.phase_detector import detect_phases
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

        # 4. PhaseDetector: 从平滑稠密序列中提取 8 个关键帧
        keyframes = detect_phases(history)
        if len(keyframes) != 8:
            return {
                "status": "error",
                "message": f"未能成功提取出8个动作阶段 (提取了 {len(keyframes)} 个)"
            }

        # 5. 特征路由: 循环 8 张图提取 40 维空间特征
        context = EngineContext()
        extracted_features = {}
        for frame in keyframes:
            flat_feats = extract_flattened_features(frame, context)
            extracted_features.update(flat_feats)
        
        # 6. NAM 引擎预留 (模拟根据 40 维特征推导的 Explanations 和 Score)
        # 这里模拟下 NAM 模型产出的结果，实际开发中调用 `spiscorer` 和 `namexplainer`
        nam_explanations = []
        if "ADDRESS_STANCE_RATIO" in extracted_features:
            nam_explanations.append({
                "featureKey": "ADDRESS_STANCE_RATIO",
                "diagnosticText": f"检测到您的站位比为 {extracted_features['ADDRESS_STANCE_RATIO']:.2f}，表现良好。"
            })
        if "SPI_IMPACT_VELOCITY" in extracted_features:
             nam_explanations.append({
                 "featureKey": "SPI_IMPACT_VELOCITY",
                 "diagnosticText": f"击球瞬时骨盆闭合角速度估算值为 {extracted_features['SPI_IMPACT_VELOCITY']:.1f} 度/秒。"
             })
        
        # 将 40 维英文特征名映射为中文，供指标面板使用
        feature_zh_map = {
            "ADDRESS_STANCE_RATIO": "准备姿势-站位比例",
            "ADDRESS_SHOULDER_ANGLE": "准备姿势-肩部倾角",
            "TOP_LEFT_ARM_ANGLE": "上杆顶点-左臂角度",
            "TOP_SHOULDER_ROTATION_THETA": "上杆顶点-肩部旋转",
            "IMPACT_HIP_ROTATION_THETA": "击球瞬间-髋部旋转",
            "SPI_IMPACT_VELOCITY": "击球瞬间-骨盆角速度(度/秒)"
        }
        metrics_zh = {}
        for k, v in extracted_features.items():
            metrics_zh[feature_zh_map.get(k, k)] = v

        # 为了防止浏览器缓存仍旧读取原版的 `issues` 字段以及图文渲染的 `explanationKey`
        # 利用由 NAM 产生的 nam_explanations 反向填充这些旧结构
        issues_bridge = []
        primary_explanation_key = "GOOD_POSTURE" # 默认值
        if len(nam_explanations) > 0:
            primary_explanation_key = nam_explanations[0].get("featureKey", "GOOD_POSTURE")
            for n in nam_explanations:
                issues_bridge.append({
                    "label": n.get("diagnosticText", ""),
                    "confidence": 1.0
                })
        
        # 组装返回给前端渲染的统一体
        final_result = {
            "extracted_features": extracted_features,
            "nam_explanations": nam_explanations,
            "issues": issues_bridge, # 为了兼容未清除缓存的旧版前端
            "score": 85, # mock NAM Score
            "fullHistory": history,
            "metrics": metrics_zh, # 使用中文 Key 的指标面板
            "explanationKey": primary_explanation_key # 指定在「图文+视频解释」弹出的解释文案 ID
        }

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
