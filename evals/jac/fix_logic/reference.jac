def median(values: list[float]) -> float {
    if not values { raise ValueError("median of empty list"); }
    ordered = sorted(values);
    mid = len(ordered) // 2;
    if len(ordered) % 2 == 0 {
        return (ordered[mid - 1] + ordered[mid]) / 2;
    }
    return ordered[mid];
}
