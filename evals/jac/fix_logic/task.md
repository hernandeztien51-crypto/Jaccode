`median` in `solution.jac` returns wrong answers for lists with an even number of items, and crashes on an empty list
instead of raising `ValueError`. Fix both problems.
