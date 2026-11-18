test "groups" {
    assert group_anagrams(["eat", "tea", "tan", "ate", "nat", "bat"]) == [["eat", "tea", "ate"], ["tan", "nat"], ["bat"]];
}
test "empty" { assert group_anagrams([]) == []; }
