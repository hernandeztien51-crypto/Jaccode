Create `solution.jac` with `node Person { has name: str; has age: int; }` and a walker `FindAdults` with a field
`min_age: int` (default 18). Started at `root`, it checks the `Person` nodes directly connected to root and reports
each person whose age is at least `min_age`, so `result.reports` is a list of those `Person` nodes.
