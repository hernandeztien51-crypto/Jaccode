test "odd" { assert median([3.0, 1.0, 2.0]) == 2.0; }
test "even" { assert median([4.0, 1.0, 3.0, 2.0]) == 2.5; }
test "empty" { with testraises(ValueError) { median([]); } }
