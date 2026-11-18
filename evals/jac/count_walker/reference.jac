node City {
    has name: str;
}

walker CountCities {
    has count: int = 0;

    can start with Root entry {
        visit [-->];
    }

    can tally with City entry {
        self.count += 1;
        visit [-->];
    }
}
