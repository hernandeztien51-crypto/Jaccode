test "merges" { assert merge_sorted([1, 4, 9], [2, 3, 10, 11]) == [1, 2, 3, 4, 9, 10, 11]; }
test "one empty" { assert merge_sorted([], [5]) == [5]; }
