def mean(xs: list[float]) -> float {
    if not xs { raise ValueError("empty"); }
    return sum(xs) / len(xs);
}

def variance(xs: list[float]) -> float {
    m = mean(xs);
    return sum([(x - m) ** 2 for x in xs]) / len(xs);
}

def normalize(xs: list[float]) -> list[float] {
    lo = min(xs);
    hi = max(xs);
    if hi == lo { return [0.0 for _ in xs]; }
    return [(x - lo) / (hi - lo) for x in xs];
}
