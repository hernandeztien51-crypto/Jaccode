node Task {
    has title: str;
    has done: bool = False;
}

def add_tasks(titles: list[str]) -> list[Task] {
    created: list[Task] = [];
    for t in titles {
        task = Task(title=t);
        root ++> task;
        created.append(task);
    }
    return created;
}

def open_tasks() -> list[str] {
    return [t.title for t in [root-->[?:Task]] if not t.done];
}
