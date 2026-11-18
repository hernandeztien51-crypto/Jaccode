Create `solution.jac` with `node Person { has name: str; }` and `edge Friend { has since: int; }`. Add
`befriend(a: Person, b: Person, since: int)` that connects `a` to `b` with a `Friend` edge, and
`friends_of(p: Person) -> list[str]` returning the names of the people `p` is connected to by `Friend` edges, sorted.
Other edge types must be ignored.
