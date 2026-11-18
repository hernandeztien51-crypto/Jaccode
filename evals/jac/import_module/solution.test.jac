import from geometry { Point }

test "distance" { assert distance(Point(x=0.0, y=0.0), Point(x=3.0, y=4.0)) == 5.0; }
test "closest" {
    near = Point(x=1.0, y=1.0);
    assert closest(Point(), [Point(x=5.0, y=5.0), near]) == near;
}
test "empty" { with testraises(ValueError) { closest(Point(), []); } }
