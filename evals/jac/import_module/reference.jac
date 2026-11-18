import math;
import from geometry { Point }

def distance(a: Point, b: Point) -> float {
    return math.hypot(a.x - b.x, a.y - b.y);
}

def closest(origin: Point, points: list[Point]) -> Point {
    if not points { raise ValueError("no points"); }
    return min(points, key=lambda (p: Point) { distance(origin, p); });
}
