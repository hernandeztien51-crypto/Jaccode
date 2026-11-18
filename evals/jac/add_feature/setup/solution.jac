obj Item {
    has title: str;
    has done: bool = False;
}

obj TodoList {
    has items: list[Item] = [];

    def add(title: str) -> Item {
        item = Item(title=title);
        self.items.append(item);
        return item;
    }

    def complete(title: str) {
        for item in self.items {
            if item.title == title {
                item.done = True;
                return;
            }
        }
    }
}
