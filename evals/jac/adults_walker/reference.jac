node Person {
    has name: str;
    has age: int;
}

walker FindAdults {
    has min_age: int = 18;

    can check with Root entry {
        for p in [-->][?:Person] {
            if p.age >= self.min_age {
                report p;
            }
        }
    }
}
