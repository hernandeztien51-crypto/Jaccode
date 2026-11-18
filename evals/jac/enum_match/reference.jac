import math;

enum Shape { CIRCLE, SQUARE, TRIANGLE }

def area(shape: Shape, size: float) -> float {
    result: float = 0.0;
    match shape {
        case Shape.CIRCLE:
            result = math.pi * size ** 2;
        case Shape.SQUARE:
            result = size ** 2;
        case Shape.TRIANGLE:
            result = math.sqrt(3) / 4 * size ** 2;
    }
    return result;
}
