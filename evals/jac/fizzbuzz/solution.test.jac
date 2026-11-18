test "first fifteen" {
    r = fizzbuzz(15);
    assert len(r) == 15;
    assert r[0] == "1" and r[2] == "Fizz" and r[4] == "Buzz" and r[14] == "FizzBuzz";
}
test "zero is empty" { assert fizzbuzz(0) == []; }
