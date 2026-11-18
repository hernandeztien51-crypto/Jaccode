test "small values" { assert [fib(i) for i in range(7)] == [0, 1, 1, 2, 3, 5, 8]; }
test "large value" { assert fib(90) == 2880067194370816120; }
test "negative raises" { with testraises(ValueError) { fib(-1); } }
