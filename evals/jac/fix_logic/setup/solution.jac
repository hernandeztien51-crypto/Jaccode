def median(values: list[float]) -> float {
    ordered = sorted(values);
    mid = len(ordered) // 2;
    return ordered[mid];
}
