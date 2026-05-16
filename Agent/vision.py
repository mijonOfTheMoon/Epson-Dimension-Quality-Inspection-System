from dataclasses import dataclass
from typing import Any

import cv2
import numpy as np

PIXEL_TO_MM_RATIO = 0.05
TARGET_DIMENSION_MM = 10.0
TOLERANCE_CAD_MM = 0.5
GUARDBAND_PERCENT = 0.2
ACTIVE_TOLERANCE = TOLERANCE_CAD_MM * (1.0 - GUARDBAND_PERCENT)
LOWER_LIMIT = TARGET_DIMENSION_MM - ACTIVE_TOLERANCE
UPPER_LIMIT = TARGET_DIMENSION_MM + ACTIVE_TOLERANCE
MIN_CONTOUR_AREA = 1000


@dataclass(frozen=True)
class Measurement:
    dimensionName: str
    measured: float
    nominal: float
    upperLimit: float
    lowerLimit: float
    unit: str
    status: str

    def to_dict(self) -> dict[str, Any]:
        return self.__dict__


@dataclass(frozen=True)
class InspectionPayload:
    partName: str
    partCode: str
    status: str
    confidenceScore: float
    measurements: list[Measurement]

    def to_dict(self) -> dict[str, Any]:
        return {
            "partName": self.partName,
            "partCode": self.partCode,
            "status": self.status,
            "confidenceScore": self.confidenceScore,
            "measurements": [measurement.to_dict() for measurement in self.measurements],
        }


@dataclass(frozen=True)
class VisionResult:
    edges: np.ndarray
    frame: np.ndarray
    inspection: InspectionPayload | None


def get_camera(camera_index: int = 0) -> cv2.VideoCapture:
    cap = cv2.VideoCapture(camera_index, cv2.CAP_DSHOW)
    if not cap.isOpened():
        cap = cv2.VideoCapture(camera_index)
    if not cap.isOpened():
        raise RuntimeError("Kamera tidak ditemukan")
    return cap


def calc_subpixel_offset(val_left: float, val_center: float, val_right: float) -> float:
    denominator = 2.0 * (val_left - 2.0 * val_center + val_right)
    if denominator == 0:
        return 0.0
    return (val_left - val_right) / denominator


def refine_edge_1d(image_gray: np.ndarray, rough_x: int, rough_y: int, axis: str = "horizontal") -> float:
    h, w = image_gray.shape
    if axis == "horizontal":
        if rough_x <= 0 or rough_x >= w - 1:
            return float(rough_x)
        roi = image_gray[rough_y, rough_x - 1: rough_x + 2].astype(np.float32)
        return float(rough_x) + calc_subpixel_offset(float(roi[0]), float(roi[1]), float(roi[2]))

    if rough_y <= 0 or rough_y >= h - 1:
        return float(rough_y)
    roi = image_gray[rough_y - 1: rough_y + 2, rough_x].astype(np.float32)
    return float(rough_y) + calc_subpixel_offset(float(roi[0]), float(roi[1]), float(roi[2]))


def status_for_value(value: float) -> str:
    return "OK" if LOWER_LIMIT <= value <= UPPER_LIMIT else "NG"


def process_inspection(frame: np.ndarray) -> VisionResult:
    result_frame = frame.copy()
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = cv2.Canny(blurred, 40, 120)
    contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    if not contours:
        return VisionResult(edges, result_frame, None)

    largest_contour = max(contours, key=cv2.contourArea)
    if cv2.contourArea(largest_contour) <= MIN_CONTOUR_AREA:
        return VisionResult(edges, result_frame, None)

    x, y, w_box, h_box = cv2.boundingRect(largest_contour)
    moments = cv2.moments(largest_contour)
    cx = int(moments["m10"] / moments["m00"]) if moments["m00"] else x + w_box // 2
    cy = int(moments["m01"] / moments["m00"]) if moments["m00"] else y + h_box // 2
    circle_center, radius_px = cv2.minEnclosingCircle(largest_contour)
    mid_y = y + h_box // 2
    precise_x_left = refine_edge_1d(gray, x, mid_y)
    precise_x_right = refine_edge_1d(gray, x + w_box, mid_y)

    diameter_mm = round(float(radius_px * 2 * PIXEL_TO_MM_RATIO), 3)
    width_mm = round(float((precise_x_right - precise_x_left) * PIXEL_TO_MM_RATIO), 3)
    diameter_status = status_for_value(diameter_mm)
    width_status = status_for_value(width_mm)
    status = "OK" if diameter_status == "OK" and width_status == "OK" else "NG"
    color = (0, 255, 0) if status == "OK" else (0, 0, 255)

    measurements = [
        Measurement("Diameter", diameter_mm, TARGET_DIMENSION_MM, UPPER_LIMIT, LOWER_LIMIT, "mm", diameter_status),
        Measurement("Width", width_mm, TARGET_DIMENSION_MM, UPPER_LIMIT, LOWER_LIMIT, "mm", width_status),
    ]

    cv2.circle(result_frame, (cx, cy), 3, (0, 255, 255), -1)
    cv2.circle(result_frame, (int(circle_center[0]), int(circle_center[1])), int(radius_px), color, 2)
    cv2.rectangle(result_frame, (x, y), (x + w_box, y + h_box), (255, 255, 0), 1)
    cv2.putText(result_frame, f"Dia: {diameter_mm:.3f} mm", (x, y - 42), cv2.FONT_HERSHEY_SIMPLEX, 0.65, color, 2)
    cv2.putText(result_frame, f"Width: {width_mm:.3f} mm", (x, y - 20), cv2.FONT_HERSHEY_SIMPLEX, 0.65, color, 2)
    cv2.putText(result_frame, f"STATUS: {status}", (10, result_frame.shape[0] - 20), cv2.FONT_HERSHEY_SIMPLEX, 0.8, color, 2)
    cv2.putText(result_frame, f"Target: {TARGET_DIMENSION_MM}mm | Tol: +/- {ACTIVE_TOLERANCE:.3f}mm", (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 255), 2)

    confidence = 95.0 if status == "OK" else 90.0
    inspection = InspectionPayload("Generic Circular Part", "GEN-001", status, confidence, measurements)
    return VisionResult(edges, result_frame, inspection)
