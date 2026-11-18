Create `solution.jac` with `obj BankAccount` with fields `owner: str` and `balance: float` (default 0.0), and methods
`deposit(amount: float)` and `withdraw(amount: float)`. Both raise `ValueError` for amounts <= 0, and `withdraw` raises
`ValueError` if it would make the balance negative. Also add `def transfer(src: BankAccount, dst: BankAccount, amount: float)`
as a top-level function that moves money and leaves both accounts unchanged if it fails.
