def is_balanced(s: str) -> bool {
    pairs: dict[str, str] = {")": "(", "]": "[", "}": "{"};
    stack: list[str] = [];
    for c in s {
        if c in "([{" {
            stack.append(c);
        } elif c in pairs {
            if not stack or stack.pop() != pairs[c] {
                return False;
            }
        }
    }
    return len(stack) == 0;
}
