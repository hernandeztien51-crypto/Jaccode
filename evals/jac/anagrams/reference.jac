def group_anagrams(words: list[str]) -> list[list[str]] {
    groups: dict[str, list[str]] = {};
    for w in words {
        key = "".join(sorted(w));
        if key not in groups {
            groups[key] = [];
        }
        groups[key].append(w);
    }
    return list(groups.values());
}
