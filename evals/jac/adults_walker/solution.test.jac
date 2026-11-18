test "default threshold" {
    root ++> Person(name="Zed_adult_test", age=30);
    root ++> Person(name="Kid_adult_test", age=15);
    result = root spawn FindAdults();
    names = [p.name for p in result.reports];
    assert "Zed_adult_test" in names and "Kid_adult_test" not in names;
}
test "custom threshold" {
    root ++> Person(name="Teen_custom_test", age=16);
    result = root spawn FindAdults(min_age=16);
    assert "Teen_custom_test" in [p.name for p in result.reports];
}
