test "flattens" { assert flatten([[1, 2], [], [3]]) == [1, 2, 3]; }
test "empty" { assert flatten([]) == []; }
