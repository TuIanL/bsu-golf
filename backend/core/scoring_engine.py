WEIGHTS = {
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
}

def clamp(x: float, a: float, b: float) -> float:
    return max(a, min(b, x))

def score_from_issues(issues: list) -> dict:
    top = issues[:10] if isinstance(issues, list) else []
    deduction_total = 0
    deductions = []

    for it in top:
        label = it.get("label", "")
        w = WEIGHTS.get(label, 7)
        conf = it.get("confidence", 0)
        
        # more confident => more deduction
        val = w * (0.35 + 0.65 * clamp(conf, 0, 1))
        rounded = round(val)
        
        if rounded <= 0:
            continue
            
        deduction_total += rounded
        deductions.append({
            "title": label,
            "value": rounded,
            "confidence": conf,
            "fix": it.get("fix", "")
        })

    score = clamp(100 - deduction_total, 0, 100)
    return {
        "score": score,
        "deductions": deductions
    }
