const WEIGHTS = {
  "上杆过快": 10,
  "上杆过慢": 6,
  "下杆启动过早": 9,
  "下杆过慢": 10,
  "打厚": 12,
  "打顶": 14,
  "左曲球": 10,
  "右曲球": 10,
  "斜飞球": 9,
  "杆头速度不足": 6,
  "击球效率偏低": 8,
};

function clamp(x, a, b) {
  return Math.max(a, Math.min(b, x));
}

export function createScoringEngine() {
  function scoreFromIssues(issues) {
    const top = Array.isArray(issues) ? issues.slice(0, 10) : [];
    let deductionTotal = 0;
    const deductions = [];

    for (const it of top) {
      const w = WEIGHTS[it.label] ?? 7;
      const conf = typeof it.confidence === "number" ? it.confidence : 0;
      const val = w * (0.35 + 0.65 * clamp(conf, 0, 1)); // more confident => more扣分
      const rounded = Math.round(val);
      if (rounded <= 0) continue;
      deductionTotal += rounded;
      deductions.push({
        title: it.label,
        value: rounded,
        confidence: conf,
        fix: it.fix,
      });
    }

    const score = clamp(100 - deductionTotal, 0, 100);
    return { score, deductions };
  }

  return { scoreFromIssues };
}

