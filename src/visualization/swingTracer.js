import { getContainRect } from "./visualization.js";

const PHASE_COLORS = {
  backswing: "rgba(56, 189, 248, 0.9)",
  downswing: "rgba(239, 68, 68, 0.9)",
  follow_through: "rgba(52, 211, 153, 0.9)",
};

const PHASE_GLOW = {
  backswing: "rgba(56, 189, 248, 0.4)",
  downswing: "rgba(239, 68, 68, 0.4)",
  follow_through: "rgba(52, 211, 153, 0.4)",
};

/**
 * 内部平滑曲线绘制
 */
function _drawSmoothPath(ctx, pts) {
  if (pts.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  if (pts.length === 2) {
    ctx.lineTo(pts[1].x, pts[1].y);
  } else {
    for (let i = 1; i < pts.length - 1; i++) {
        const midX = (pts[i].x + pts[i + 1].x) / 2;
        const midY = (pts[i].y + pts[i + 1].y) / 2;
        ctx.quadraticCurveTo(pts[i].x, pts[i].y, midX, midY);
    }
    const last = pts[pts.length - 1];
    ctx.lineTo(last.x, last.y);
  }
  ctx.stroke();
}

export function createSwingTracer(canvas, video, swingData) {
  // 1. 鲁棒的数据归一化
  let points = [];
  let vSlot = [];

  if (Array.isArray(swingData)) {
    points = swingData;
  } else if (swingData && typeof swingData === 'object') {
    points = swingData.points || [];
    vSlot = swingData.vSlot || [];
  }

  console.log("[SwingTracer] Bootstrapped with letterbox support.");

  let _visible = true;

  /**
   * 主循环绘制函数
   */
  function draw(currentTimeMs) {
    if (!_visible) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    if (!W || !H) return;

    // 🏆 计算视频实际渲染区域 (处理黑边)
    const rect = getContainRect(W, H, video);
    
    ctx.save();
    
    // --- 🌍 物理屏障：开启裁剪，防止任何绘制溢出到黑边 ---
    ctx.beginPath();
    ctx.rect(rect.x, rect.y, rect.w, rect.h);
    ctx.clip();

    // A. 绘制 V-Slot (背景层)
    if (vSlot && vSlot.length >= 3) {
      const pts = vSlot.map(p => ({ 
        x: rect.x + p.x * rect.w, 
        y: rect.y + p.y * rect.h 
      }));
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      ctx.lineTo(pts[1].x, pts[1].y);
      ctx.lineTo(pts[2].x, pts[2].y);
      ctx.closePath();
      ctx.fillStyle = "rgba(46, 204, 113, 0.22)";
      ctx.fill();
      
      ctx.setLineDash([8, 4]);
      ctx.strokeStyle = "rgba(46, 204, 113, 0.5)";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
    }

    // B. 筛选当前可见点
    const visiblePoints = points.filter(p => p.t <= currentTimeMs);
    if (visiblePoints.length >= 2) {
        // C. 轨迹分段
        const segments = [];
        let curSeg = [visiblePoints[0]];
        for (let i = 1; i < visiblePoints.length; i++) {
            const p = visiblePoints[i];
            if (p.phase === curSeg[0].phase) {
                curSeg.push(p);
            } else {
                segments.push(curSeg);
                curSeg = [curSeg[curSeg.length - 1], p];
            }
        }
        segments.push(curSeg);

        // D. 执行绘制
        ctx.lineCap = "round";
        ctx.lineJoin = "round";

        for (const seg of segments) {
            const phase = seg[0].phase;
            const color = PHASE_COLORS[phase] || "white";
            const glow = PHASE_GLOW[phase] || "white";
            const pts = seg.map(p => ({ 
                x: rect.x + p.x * rect.w, 
                y: rect.y + p.y * rect.h 
            }));

            // 1. 底层发光
            ctx.strokeStyle = glow;
            ctx.lineWidth = Math.max(6, rect.w / 100);
            _drawSmoothPath(ctx, pts);

            // 2. 核心线
            ctx.strokeStyle = color;
            ctx.lineWidth = Math.max(3, rect.w / 200);
            _drawSmoothPath(ctx, pts);
        }

        // E. 绘制最新位置指示器
        const lastP = visiblePoints[visiblePoints.length - 1];
        const lp = { 
            x: rect.x + lastP.x * rect.w, 
            y: rect.y + lastP.y * rect.h 
        };
        const pColor = PHASE_COLORS[lastP.phase] || "white";
        const r = Math.max(6, rect.w / 120);

        ctx.beginPath();
        const g = ctx.createRadialGradient(lp.x, lp.y, 0, lp.x, lp.y, r * 2.5);
        g.addColorStop(0, pColor.replace("0.9", "0.6"));
        g.addColorStop(1, "transparent");
        ctx.fillStyle = g;
        ctx.arc(lp.x, lp.y, r * 2.5, 0, Math.PI * 2);
        ctx.fill();

        ctx.beginPath();
        ctx.fillStyle = pColor;
        ctx.arc(lp.x, lp.y, r, 0, Math.PI * 2);
        ctx.fill();
    }

    ctx.restore(); // 恢复裁剪区域外
  }

  function clear() {
    const ctx = canvas.getContext("2d");
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  return { draw, clear, setVisible: (v) => { _visible = v; } };
}
