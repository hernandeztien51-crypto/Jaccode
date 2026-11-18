import from statistics { mean };

def grade(score: int) -> str {
    if score >= 90 && score <= 100 {
        return "A"
    } elif score >= 75 {
        return "B";
    }
    return "C";
}

def summary(scores: list[int]) -> dict[str, float] {
    result = {"mean": mean(scores), "passed": float(len([s for s in scores if grade(s) != "C"]))};
    return result;
}

def is_valid(score: int) -> bool {
    if score < 0 || score > 100 { return false; }
    return true;
}
