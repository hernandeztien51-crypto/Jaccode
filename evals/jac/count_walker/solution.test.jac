test "counts a chain and a branch" {
    a = City(name="A");
    b = City(name="B");
    c = City(name="C");
    root ++> a;
    a ++> b;
    a ++> c;
    w = root spawn CountCities();
    assert w.count >= 3;
}
