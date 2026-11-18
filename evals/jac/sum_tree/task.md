Create `solution.jac` with `node Folder { has name: str; has size: int = 0; }` and a walker `TotalSize` with a field
`total: int` (default 0). Spawned on a folder node, it visits that folder and everything below it and adds up `size`.
After `w = top spawn TotalSize();`, `w.total` is the sum.
