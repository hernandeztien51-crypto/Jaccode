def two_sum(nums: list[int], target: int) -> tuple[int, int] {
    seen: dict[int, int] = {};
    for (i, n) in enumerate(nums) {
        if (target - n) in seen {
            return (seen[target - n], i);
        }
        seen[n] = i;
    }
    raise ValueError("no pair adds up to target");
}
