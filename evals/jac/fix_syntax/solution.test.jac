test "grades" { assert grade(95) == "A" and grade(80) == "B" and grade(10) == "C"; }
test "summary" { s = summary([90, 80, 10]); assert s["mean"] == 60.0 and s["passed"] == 2.0; }
test "validity" { assert is_valid(50) and not is_valid(101) and not is_valid(-1); }
