from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
import time
import uuid

# 导入我们事先写好的核心基础算法库
from core.datatypes import SwingPhase, KeyFrameData, BBox, Point2D, EngineContext
from core.feature_router import extract_flattened_features
from core.pose_estimator import process_video
from core.phase_detector import detect_phases
from core.swing_tracer import compute_swing_trace
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
        feature_zh_map = {
            "ADDRESS_STANCE_RATIO": "站位比例",
            "ADDRESS_SHOULDER_ANGLE": "准备姿势-肩部倾角",
            "TOP_LEFT_ARM_ANGLE": "上杆顶点-左臂角度",
            "TOP_SHOULDER_ROTATION_THETA": "上杆顶点-肩部旋转",
            "IMPACT_HIP_ROTATION_THETA": "击球瞬间-髋部旋转",
            "SPI_IMPACT_VELOCITY": "击球瞬间-骨盆角速度",
        }

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

        # ── 评分与扣分项（真实 deductions）────────────────────────────
        # 这里用可解释的启发式阈值把现有 extracted_features 映射为扣分项。
        # 前端会读取 payload.deductions 并展示每一项的扣分值。

        def _angle_diff(a, b, period=360.0):
            """最短角差（绝对值）"""
            diff = (a - b + period / 2.0) % period - period / 2.0
            return abs(diff)

        def _calc_penalty(*, val, ideal, tol, scale, period=None, max_penalty=15):
            if val is None or not isinstance(val, (int, float)):
                return 0
            diff = _angle_diff(val, ideal, period=period) if period else abs(val - ideal)
            excess = max(0.0, diff - tol)
            raw = excess * scale
            pen = int(round(min(raw, max_penalty)))
            return max(0, pen)

        # 依据当前命名体系，给出“理想值 + 容忍度 + 惩罚强度”
        rules = {
            # ideal 与 tol 尽量使用你截图里表现良好的量级做初始标定
            "ADDRESS_STANCE_RATIO": dict(ideal=2.80, tol=0.30, scale=20.0, max_penalty=15),
            "ADDRESS_SHOULDER_ANGLE": dict(ideal=17.0, tol=8.0, scale=1.0, period=360.0, max_penalty=15),
            "TOP_LEFT_ARM_ANGLE": dict(ideal=95.0, tol=10.0, scale=0.6, max_penalty=12),
            "TOP_SHOULDER_ROTATION_THETA": dict(ideal=180.0, tol=15.0, scale=0.25, max_penalty=12),
            "IMPACT_HIP_ROTATION_THETA": dict(ideal=180.0, tol=15.0, scale=0.25, max_penalty=12),
            # 角速度理应越接近“稳定命中”越好；先按 0 做标定
            "SPI_IMPACT_VELOCITY": dict(ideal=0.0, tol=0.2, scale=50.0, max_penalty=18),
        }

        deductions = []
        total_deduction = 0
        # 顺序尽量和界面展示逻辑一致
        for feature_key in [
            "ADDRESS_STANCE_RATIO",
            "ADDRESS_SHOULDER_ANGLE",
            "TOP_LEFT_ARM_ANGLE",
            "TOP_SHOULDER_ROTATION_THETA",
            "IMPACT_HIP_ROTATION_THETA",
            "SPI_IMPACT_VELOCITY",
        ]:
            if feature_key not in extracted_features:
                continue
            val = extracted_features.get(feature_key)
            rule = rules.get(feature_key)
            if not rule:
                continue
            pen = _calc_penalty(
                val=val,
                ideal=rule["ideal"],
                tol=rule["tol"],
                scale=rule["scale"],
                period=rule.get("period"),
                max_penalty=rule.get("max_penalty", 15),
            )
            if pen > 0:
                title = feature_zh_map.get(feature_key, feature_key)
                deductions.append({"title": title, "value": pen})
                total_deduction += pen

        score = max(0, min(100, int(round(100 - total_deduction))))

        # deductions 同时也是“问题识别”的来源：只在偏离阈值时输出 nam_explanations
        nam_explanations = []
        issues_bridge = []
        primary_explanation_key = "GOOD_POSTURE"  # 默认值（用于说明区兜底）

        diagnostics_for = {
            "ADDRESS_STANCE_RATIO": lambda val: f"检测到您的站位比例为 {val:.2f}，偏离理想范围（2.80 +/- 0.30），建议调整站位重心以提升稳定性。",
            "ADDRESS_SHOULDER_ANGLE": lambda val: f"检测到准备姿势肩部倾角为 {val:.1f} 度，偏离理想范围（17 +/- 8 度），建议在准备阶段调整肩胯倾角。",
            "TOP_LEFT_ARM_ANGLE": lambda val: f"检测到上杆顶点左臂角度为 {val:.1f} 度，偏离理想范围（95 +/- 10 度），建议在顶点保持手臂角度更接近理想节奏。",
            "TOP_SHOULDER_ROTATION_THETA": lambda val: f"检测到上杆顶点肩部旋转为 {val:.1f} 度，偏离理想范围（180 +/- 15 度），建议在顶点控制肩部旋转时序。",
            "IMPACT_HIP_ROTATION_THETA": lambda val: f"检测到击球瞬间髋部旋转为 {val:.1f} 度，偏离理想范围（180 +/- 15 度），建议在击球前保持髋部旋转到位。",
            "SPI_IMPACT_VELOCITY": lambda val: f"检测到击球瞬间骨盆角速度为 {val:.1f} 度/秒，偏离理想范围（接近 0.0 +/- 0.2 度/秒），建议优化击球瞬间的稳定性与力量传递。",
        }

        title_to_feature_key = {zh: k for k, zh in feature_zh_map.items()}

        # deductions 已经只包含 pen>0 的项，因此这些 diagnostic 文本不会再出现“表现良好却算问题”。
        for d in deductions:
            zh_title = d.get("title")
            feature_key = title_to_feature_key.get(zh_title)
            if not feature_key:
                continue
            val = extracted_features.get(feature_key)
            if val is None:
                continue

            fn = diagnostics_for.get(feature_key)
            diagnostic_text = fn(val) if fn else f"检测到该指标偏离理想范围，当前值为 {val}。"

            nam_explanations.append(
                {
                    "featureKey": feature_key,
                    "featureKeyEn": feature_key,
                    "diagnosticText": diagnostic_text,
                }
            )
            issues_bridge.append({"label": diagnostic_text, "confidence": 1.0})

            if primary_explanation_key == "GOOD_POSTURE":
                primary_explanation_key = zh_title

        # 组装返回给前端渲染的统一体
        final_result = {
            "extracted_features": extracted_features,
            "nam_explanations": nam_explanations,
            "deductions": deductions,
            "issues": issues_bridge, # 为了兼容未清除缓存的旧版前端
            "score": score,
            "fullHistory": history,
            "metrics": metrics_zh, # 使用中文 Key 的指标面板
            "explanationKey": primary_explanation_key, # 指定在「图文+视频解释」弹出的解释文案 ID
            "swingTrace": compute_swing_trace(history),  # 挥杆平面轨迹追踪数据
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
