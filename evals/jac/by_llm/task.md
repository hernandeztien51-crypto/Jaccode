Create `solution.jac` with an LLM-backed function `def shorten(text: str) -> str by llm();` and a normal function
`total_words(texts: list[str]) -> int` that shortens each text with `shorten` and returns the total number of words in
the results. For now use a mock model so it runs offline: import `MockLLM` from `jaclang.byllm.lib` and define
`glob llm = MockLLM(outputs=["one two", "three"]);`.
