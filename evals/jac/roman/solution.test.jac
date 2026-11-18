test "converts" {
    assert to_roman(1994) == "MCMXCIV";
    assert to_roman(4) == "IV";
    assert to_roman(3999) == "MMMCMXCIX";
}
test "range" { with testraises(ValueError) { to_roman(0); } }
