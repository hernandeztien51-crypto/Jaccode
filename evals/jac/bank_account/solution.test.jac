test "deposit and withdraw" {
    acct = BankAccount(owner="Ana");
    acct.deposit(50.0);
    acct.withdraw(20.0);
    assert acct.balance == 30.0;
}
test "overdraft raises" {
    acct = BankAccount(owner="Bo", balance=10.0);
    with testraises(ValueError) { acct.withdraw(11.0); }
    assert acct.balance == 10.0;
}
test "failed transfer changes nothing" {
    a = BankAccount(owner="A", balance=5.0);
    b = BankAccount(owner="B");
    with testraises(ValueError) { transfer(a, b, 6.0); }
    assert a.balance == 5.0 and b.balance == 0.0;
}
