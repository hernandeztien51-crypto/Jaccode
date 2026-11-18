test "counts words" {
    c = word_count("The cat, the hat. THE end!");
    assert c["the"] == 3 and c["cat"] == 1 and c["end"] == 1;
}
test "punctuation only" { assert word_count("... !!") == {}; }
