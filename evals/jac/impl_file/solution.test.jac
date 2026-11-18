test "areas" {
    assert Rect(name="r", width=2.0, height=3.0).area() == 6.0;
    assert abs(Circle(name="c", radius=1.0).area() - 3.14159) < 0.001;
    assert Shape(name="s").area() == 0.0;
}
test "total" { assert total_area([Rect(name="a", width=1.0, height=1.0), Rect(name="b", width=2.0, height=2.0)]) == 5.0; }
