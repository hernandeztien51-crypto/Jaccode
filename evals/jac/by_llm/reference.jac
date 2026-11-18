import from jaclang.byllm.lib { MockLLM }

glob llm = MockLLM(outputs=["one two", "three"]);

def shorten(text: str) -> str by llm();

def total_words(texts: list[str]) -> int {
    return sum([len(shorten(t).split()) for t in texts]);
}
