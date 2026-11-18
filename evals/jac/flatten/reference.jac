def flatten(nested: list[list[int]]) -> list[int] {
    return [x for inner in nested for x in inner];
}
