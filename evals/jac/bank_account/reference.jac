obj BankAccount {
    has owner: str;
    has balance: float = 0.0;

    def deposit(amount: float) {
        if amount <= 0 { raise ValueError("amount must be positive"); }
        self.balance += amount;
    }

    def withdraw(amount: float) {
        if amount <= 0 { raise ValueError("amount must be positive"); }
        if amount > self.balance { raise ValueError("insufficient funds"); }
        self.balance -= amount;
    }
}

def transfer(src: BankAccount, dst: BankAccount, amount: float) {
    src.withdraw(amount);
    dst.deposit(amount);
}
