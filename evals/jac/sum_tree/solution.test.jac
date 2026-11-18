test "sums a tree" {
    top = Folder(name="top", size=1);
    a = Folder(name="a", size=10);
    b = Folder(name="b", size=100);
    c = Folder(name="c", size=1000);
    top ++> a;
    top ++> b;
    b ++> c;
    w = top spawn TotalSize();
    assert w.total == 1111;
}
