`geometry.jac` defines `obj Point`. Create `solution.jac` that imports `Point` from it and defines
`distance(a: Point, b: Point) -> float` (Euclidean) and `closest(origin: Point, points: list[Point]) -> Point`, which
returns the point nearest to `origin` and raises `ValueError` for an empty list.
