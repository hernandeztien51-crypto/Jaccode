test "balanced" { assert is_balanced("f(a[1]) { x }"); }
test "wrong order" { assert not is_balanced("(]"); }
test "unclosed" { assert not is_balanced("(("); }
