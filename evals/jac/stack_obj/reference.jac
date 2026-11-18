obj Stack {
    has items: list[int] = [];

    def push(x: int) {
        self.items.append(x);
    }

    def pop() -> int {
        if not self.items { raise IndexError("pop from empty stack"); }
        return self.items.pop();
    }

    def peek() -> int {
        if not self.items { raise IndexError("peek at empty stack"); }
        return self.items[-1];
    }

    def size() -> int {
        return len(self.items);
    }

    def is_empty() -> bool {
        return len(self.items) == 0;
    }
}
