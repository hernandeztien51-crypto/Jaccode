test "mean and variance" {
    assert mean([1.0, 2.0, 3.0]) == 2.0;
    assert abs(variance([1.0, 2.0, 3.0]) - 0.6667) < 0.001;
}
test "normalize" { assert normalize([2.0, 4.0, 6.0]) == [0.0, 0.5, 1.0]; }
test "empty mean" { with testraises(ValueError) { mean([]); } }
