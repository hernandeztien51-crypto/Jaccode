test "push and pop" {
    s = Stack();
    s.push(1);
    s.push(2);
    assert s.peek() == 2 and s.size() == 2;
    assert s.pop() == 2 and s.pop() == 1;
    assert s.is_empty();
}
test "separate instances" {
    a = Stack();
    a.push(5);
    assert Stack().is_empty();
}
test "empty raises" { with testraises(IndexError) { Stack().pop(); } }
