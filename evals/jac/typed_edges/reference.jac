node Person {
    has name: str;
}

edge Friend {
    has since: int;
}

def befriend(a: Person, b: Person, since: int) {
    a +>:Friend(since=since):+> b;
}

def friends_of(p: Person) -> list[str] {
    return sorted([f.name for f in [p ->:Friend:->]]);
}
