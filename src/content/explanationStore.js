const EXPLANATIONS = {
  "上杆过快": {
    title: "上杆过快",
    short: "准备阶段太急，导致转体与挥臂时序错位，下杆只能“抢着打”。",
    cause: ["上杆启动太快（节奏比失衡）", "转体到位不足，手臂先进入下杆"],
    fix: ["把“起杆-转体-手臂上举”拆开，给转体留出时间", "在顶点停留 0.2-0.3 秒后再开始下杆"],
  },
  "下杆启动过早": {
    title: "下杆启动过早",
    short: "下杆太早开始，身体重心还没进入，就先用手臂带杆。",
    cause: ["转体尚未完成", "重心转移时机提前"],
    fix: ["先转体（肩胯同向），再让手臂“跟随下落”", "练习“转体先行”的分解挥杆"],
  },
  "下杆过慢": {
    title: "下杆过慢",
    short: "下杆节奏拉长，击球点容易变高或变薄，整体效率下降。",
    cause: ["重心进入滞后", "挥杆速度在下杆末段才爆发"],
    fix: ["下杆中段保持加速感，减少停顿", "用拍手节奏练“1-2-3”进入击球"],
  },
  "打顶": {
    title: "打顶（Topping）",
    short: "击球瞬间手部高度偏高，杆头没有“穿过”击球点。",
    cause: ["下杆手部高度保持过高", "击球前杆头下落不足"],
    fix: ["进攻角度保持：让手臂在下杆阶段更靠前下落", "练习“杆头先到位再击球”的节奏"],
  },
  "打厚": {
    title: "打厚（Fat）",
    short: "杆头触球点偏后或身体压得过早，导致球前地面被先“打到”。",
    cause: ["重心过早压向前腿", "击球点落后于理想位置"],
    fix: ["保持手臂长度到击球后（不提前“收”）", "在小幅度练习中找到“先球后草”的感觉"],
  },
  "左曲球": {
    title: "左曲球",
    short: "挥杆路径或杆面时机偏向“从外向内”不足，球向左偏离。",
    cause: ["击球瞬间杆面/路径关系失衡", "杆头轨迹方向偏左"],
    fix: ["减少过度内收，保持下杆平面稳定", "收杆后保持杆面朝向目标方向"],
  },
  "右曲球": {
    title: "右曲球",
    short: "挥杆路径或杆面时机偏向“内向外”，球向右偏离。",
    cause: ["杆面过早开放/闭合时机不对", "下杆轨迹向右偏移"],
    fix: ["加强“先转体后带杆”，减少手臂左右摆动", "击球后保持身体重心在左腿（右手视角可调整）"],
  },
  "斜飞球": {
    title: "斜飞球（方向不直）",
    short: "转体与重心转移不同步，导致击球方向与挥杆平面不一致。",
    cause: ["肩胯相对角度与路径偏差", "重心转移不在同一平面上"],
    fix: ["减少左右甩动，让肩胯以更一致的节奏旋转", "在慢速挥杆中对齐“起杆-击球”方向"],
  },
  "杆头速度不足": {
    title: "杆头速度不足",
    short: "力量更多停留在“手臂”，核心转动参与不足。",
    cause: ["转体幅度不足", "下杆中段加速不足"],
    fix: ["加大髋部带动，避免手先动", "练习“核心旋转带手”的分解动作"],
  },
  "击球效率偏低": {
    title: "击球效率偏低",
    short: "触球点不稳定（厚薄/高度），导致能量没有有效传递给球。",
    cause: ["击球瞬间节奏波动", "杆头穿过击球点的时机偏差"],
    fix: ["专注“同一个击球点”，先用慢挥杆建立稳定触球", "记录每次最常出现的问题并针对性矫正"],
  },
};

export function createExplanationStore() {
  function get(issueLabel) {
    return EXPLANATIONS[issueLabel] || null;
  }

  function render(container, issueLabel, options = {}) {
    const data = get(issueLabel);
    container.innerHTML = "";

    if (!issueLabel || !data) {
      const p = document.createElement("div");
      p.className = "explainBlock";
      p.innerHTML = `<div class="explainTitle">等待诊断</div><div class="explainText">完成一次挥杆后，会自动识别问题并给出扣分项和矫正建议。</div>`;
      container.appendChild(p);
      return;
    }

    const block = document.createElement("div");
    block.className = "explainBlock";

    const causeHtml = (data.cause || [])
      .map((c) => `<li>${escapeHtml(c)}</li>`)
      .join("");
    const fixHtml = (data.fix || []).map((c) => `<li>${escapeHtml(c)}</li>`).join("");

    block.innerHTML = `
      <div class="explainTitle">${escapeHtml(data.title)}</div>
      <div class="explainText">${escapeHtml(data.short)}</div>
      <div style="margin-top:10px">
        <div class="explainTitle" style="font-size:12px;opacity:0.95;margin-bottom:6px">可能原因</div>
        <ul style="margin:0;padding-left:18px;font-size:13px;line-height:1.5;opacity:0.96">${causeHtml}</ul>
      </div>
      <div style="margin-top:10px">
        <div class="explainTitle" style="font-size:12px;opacity:0.95;margin-bottom:6px">矫正建议</div>
        <ul style="margin:0;padding-left:18px;font-size:13px;line-height:1.5;opacity:0.96">${fixHtml}</ul>
      </div>
    `;
    container.appendChild(block);
  }

  function escapeHtml(s) {
    return String(s)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  return { get, render };
}

