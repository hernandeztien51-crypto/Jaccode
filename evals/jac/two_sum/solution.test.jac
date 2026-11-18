test "finds pair" { assert two_sum([2, 7, 11, 15], 9) == (0, 1); }
test "later pair" { assert two_sum([3, 2, 4], 6) == (1, 2); }
test "no pair raises" {
    with testraises(ValueError) { two_sum([1, 2], 10); }
}
