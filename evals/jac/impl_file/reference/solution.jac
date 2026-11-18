import math;

obj Shape {
    has name: str;
    def area() -> float;
}

obj Circle(Shape) {
    has radius: float;
    override def area() -> float;
}

obj Rect(Shape) {
    has width: float;
    has height: float;
    override def area() -> float;
}

def total_area(shapes: list[Shape]) -> float;
