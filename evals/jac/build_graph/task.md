Create `solution.jac` with `node Task { has title: str; has done: bool = False; }` and a function
`add_tasks(titles: list[str]) -> list[Task]` that connects one new `Task` per title to `root` and returns them in order.
Also add `def open_tasks() -> list[str]` returning the titles of tasks connected to root that are not done.
