test "sentence palindrome" { assert is_palindrome("A man, a plan, a canal: Panama"); }
test "not palindrome" { assert not is_palindrome("jac lang"); }
test "empty is palindrome" { assert is_palindrome(""); }
