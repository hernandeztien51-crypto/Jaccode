def word_count(text: str) -> dict[str, int] {
    counts: dict[str, int] = {};
    for raw in text.split() {
        word = raw.strip(".,!?;:").lower();
        if word {
            counts[word] = counts.get(word, 0) + 1;
        }
    }
    return counts;
}
