test "areas" {
    assert abs(area(Shape.CIRCLE, 1.0) - 3.14159) < 0.001;
    assert area(Shape.SQUARE, 3.0) == 9.0;
    assert abs(area(Shape.TRIANGLE, 2.0) - 1.73205) < 0.001;
}
