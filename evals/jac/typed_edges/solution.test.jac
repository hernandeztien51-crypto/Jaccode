test "friends only" {
    ana = Person(name="Ana");
    bo = Person(name="Bo");
    cy = Person(name="Cy");
    dee = Person(name="Dee");
    befriend(ana, cy, 2020);
    befriend(ana, bo, 2019);
    ana ++> dee;
    assert friends_of(ana) == ["Bo", "Cy"];
    assert friends_of(bo) == [];
}
