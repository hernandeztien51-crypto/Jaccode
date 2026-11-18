def is_palindrome(s: str) -> bool {
    cleaned = [c.lower() for c in s if c.isalnum()];
    return cleaned == list(reversed(cleaned));
}
