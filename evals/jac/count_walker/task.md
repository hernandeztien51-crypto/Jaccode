Create `solution.jac` with `node City { has name: str; }` and a walker `CountCities` with a field `count: int` (default 0)
that starts at `root`, visits every `City` reachable from it, and counts them. After `w = root spawn CountCities();`,
`w.count` holds the number of cities.
