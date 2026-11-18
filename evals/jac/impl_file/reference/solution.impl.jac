impl Shape.area() -> float {
    return 0.0;
}

impl Circle.area() -> float {
    return math.pi * self.radius * self.radius;
}

impl Rect.area() -> float {
    return self.width * self.height;
}

impl total_area(shapes: list[Shape]) -> float {
    return sum([s.area() for s in shapes]);
}
