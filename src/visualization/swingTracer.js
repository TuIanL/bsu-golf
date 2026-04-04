/**
 * swingTracer.js — 挥杆平面轨迹动态渲染模块
 *
 * 职责：
 * 1. 接收后端返回的 swingTrace 坐标序列（已包含 phase 标签）
 * 2. 根据视频当前播放时间（ms），在 canvas 上绘制动态生长的贝塞尔曲线轨迹
 * 3. 用颜色区分三个挥杆阶段：
 *    - backswing      = 蓝色
 *    - downswing      = 红色
 *    - follow_through = 绿色
 * 4. 在最新点绘制发光圆点（指示当前位置）
 */

const PHASE_COLORS = {
  backswing: "rgba(56, 189, 248, 0.9)",       // 天蓝色
  downswing: "rgba(239, 68, 68, 0.9)",        // 红色
  follow_through: "rgba(52, 211, 153, 0.9)",  // 翠绿色
};

const PHASE_GLOW = {
  backswing: "rgba(56, 189, 248, 0.4)",
  downswing: "rgba(239, 68, 68, 0.4)",
  follow_through: "rgba(52, 211, 153, 0.4)",
};

/**
 * 将 tracePoint 的归一化坐标 [0,1] 映射到 canvas 像素坐标。
 * 使用与 visualization.js 相同的 "object-fit: fill" 逻辑（直接拉伸映射）。
 *
 * @param {number} nx  归一化 x [0,1]
 * @param {number} ny  归一化 y [0,1]
 * @param {number} W   canvas 实际宽度（px，包含 DPR）
 * @param {number} H   canvas 实际高度（px，包含 DPR）
 * @returns {{ x: number, y: number }}
 */
function _toCanvas(nx, ny, W, H) {
  return { x: nx * W, y: ny * H };
}

/**
 * 使用二次贝塞尔曲线平滑连接一组点，绘制在 ctx 上。
 * 每两个相邻点之间以其中点作为控制点，实现 Catmull-Rom 风格的平滑效果。
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {{ x: number, y: number }[]} pts  canvas 像素坐标数组
 */
function _drawSmoothPath(ctx, pts) {
  if (pts.length < 2) {
    if (pts.length === 1) {
      ctx.beginPath();
      ctx.arc(pts[0].x, pts[0].y, 2, 0, Math.PI * 2);
      ctx.fill();
    }
    return;
  }

  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);

  if (pts.length === 2) {
    ctx.lineTo(pts[1].x, pts[1].y);
    ctx.stroke();
    return;
  }

  // 二次贝塞尔曲线：以相邻中点作为端点，当前点作为控制点
  for (let i = 1; i < pts.length - 1; i++) {
    const midX = (pts[i].x + pts[i + 1].x) / 2;
    const midY = (pts[i].y + pts[i + 1].y) / 2;
    ctx.quadraticCurveTo(pts[i].x, pts[i].y, midX, midY);
  }

  // 最后一段直接连到最终点
  const last = pts[pts.length - 1];
  ctx.lineTo(last.x, last.y);
  ctx.stroke();
}

/**
 * 工厂函数：创建一个与特定 canvas + video + tracePoints 绑定的渲染器。
 *
 * @param {HTMLCanvasElement} canvas
 * @param {HTMLVideoElement}  video
 * @param {Array}             tracePoints  后端返回的 swingTrace 数组
 * @returns {{ draw: (currentTimeMs: number) => void, clear: () => void }}
 */
export function createSwingTracer(canvas, video, tracePoints) {
  if (!tracePoints || tracePoints.length === 0) {
    return {
      draw: () => {},
      clear: () => {},
      setVisible: () => {},
    };
  }

  // 预建按 phase 分组索引Cache，避免每帧重复分组
  let _visible = true;

  function setVisible(v) {
    _visible = v;
  }

  /**
   * 在 canvas 上绘制当前时间对应的轨迹。
   * 注意：此函数不负责 clearRect，调用方（reportPage）应在渲染骨骼点后再调用此函数，
   * 骨骼 overlay 已在 visualization.js 中 clearRect 后重绘，轨迹叠加在上层。
   *
   * @param {number} currentTimeMs  视频当前时间（毫秒）
   */
  function draw(currentTimeMs) {
    if (!_visible) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    if (!W || !H) return;

    // 筛选出当前时间之前的所有轨迹点
    const visiblePoints = tracePoints.filter((p) => p.t <= currentTimeMs);
    if (visiblePoints.length < 2) return;

    // 按阶段分段，连续同 phase 的点组成一段
    const segments = [];
    let curPhase = visiblePoints[0].phase;
    let curSeg = [visiblePoints[0]];

    for (let i = 1; i < visiblePoints.length; i++) {
      const p = visiblePoints[i];
      if (p.phase === curPhase) {
        curSeg.push(p);
      } else {
        // 跨段时，将当前段的最后一个点复制到下一段开头，保证视觉连续
        segments.push({ phase: curPhase, pts: curSeg });
        curSeg = [curSeg[curSeg.length - 1], p];
        curPhase = p.phase;
      }
    }
    segments.push({ phase: curPhase, pts: curSeg });

    // 逐段绘制
    ctx.save();
    ctx.lineWidth = Math.max(2.5, W / 280);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    for (const seg of segments) {
      const color = PHASE_COLORS[seg.phase] || "rgba(255,255,255,0.8)";
      const glowColor = PHASE_GLOW[seg.phase] || "rgba(255,255,255,0.3)";

      const canvasPts = seg.pts.map((p) => _toCanvas(p.x, p.y, W, H));

      // 绘制发光外层（粗一些，半透明）
      ctx.strokeStyle = glowColor;
      ctx.lineWidth = Math.max(5, W / 140);
      _drawSmoothPath(ctx, canvasPts);

      // 绘制核心线（细一些，不透明）
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(2.5, W / 280);
      _drawSmoothPath(ctx, canvasPts);
    }

    // 绘制最新位置的发光指示点
    const latest = visiblePoints[visiblePoints.length - 1];
    const lp = _toCanvas(latest.x, latest.y, W, H);
    const phaseColor = PHASE_COLORS[latest.phase] || "rgba(255,255,255,0.9)";
    const r = Math.max(5, W / 100);

    // 外发光
    const grd = ctx.createRadialGradient(lp.x, lp.y, 0, lp.x, lp.y, r * 2.5);
    grd.addColorStop(0, phaseColor.replace("0.9", "0.6"));
    grd.addColorStop(1, phaseColor.replace("0.9", "0.0"));
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.arc(lp.x, lp.y, r * 2.5, 0, Math.PI * 2);
    ctx.fill();

    // 实心点
    ctx.fillStyle = phaseColor;
    ctx.beginPath();
    ctx.arc(lp.x, lp.y, r, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  function clear() {
    const ctx = canvas.getContext("2d");
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  return { draw, clear, setVisible };
}
