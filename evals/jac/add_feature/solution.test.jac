test "remove and count" {
    t = TodoList();
    t.add("a");
    t.add("b");
    t.add("c");
    t.complete("a");
    assert t.pending_count() == 2;
    assert t.remove("b") and not t.remove("zzz");
    assert t.pending_count() == 1 and len(t.items) == 2;
}
