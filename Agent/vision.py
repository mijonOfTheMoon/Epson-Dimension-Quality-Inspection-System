from dataclasses import dataclass, field
from typing import Any

import cv2
import numpy as np

PIXEL_TO_MM_RATIO = 0.05
GUARDBAND_PERCENT = 0.2
MIN_CONTOUR_AREA = 1000


@dataclass(frozen=True)
class DimensionSpec:
    id: str
    name: str
    nominal: float
    upper_limit: float
    lower_limit: float
    unit: str = "mm"

    @classmethod
    def from_dict(cls, raw: dict[str, Any]) -> "DimensionSpec":
        return cls(
            id=str(raw.get("id", raw.get("name", ""))),
            name=str(raw.get("name", "Dimension")),
            nominal=float(raw["nominal"]),
            upper_limit=float(raw["upperLimit"]),
            lower_limit=float(raw["lowerLimit"]),
            unit=str(raw.get("unit", "mm")),
        )


@dataclass(frozen=True)
class PartSpec:
    part_id: str
    part_code: str
    part_name: str
    vendor: str = "Internal"
    dimensions: tuple[DimensionSpec, ...] = field(default_factory=tuple)

    @classmethod
    def from_dict(cls, raw: dict[str, Any]) -> "PartSpec":
        dims_raw = raw.get("dimensions", []) or []
        return cls(
            part_id=str(raw.get("partId", raw.get("id", ""))),
            part_code=str(raw.get("partCode", "")),
            part_name=str(raw.get("partName", "")),
            vendor=str(raw.get("vendor", "Internal")),
            dimensions=tuple(DimensionSpec.from_dict(d) for d in dims_raw),
        )


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
class BoundingBox:
    x: float
    y: float
    width: float
    height: float

    def to_dict(self) -> dict[str, Any]:
        return {
            "x": self.x,
            "y": self.y,
            "width": self.width,
            "height": self.height,
        }


@dataclass(frozen=True)
class ObjectDetection:
    id: str
    label: str
    bbox: BoundingBox
    status: str
    confidenceScore: float
    measurements: list[Measurement]

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "label": self.label,
            "bbox": self.bbox.to_dict(),
            "status": self.status,
            "confidenceScore": self.confidenceScore,
            "measurements": [measurement.to_dict() for measurement in self.measurements],
        }


@dataclass(frozen=True)
class InspectionPayload:
    partName: str
    partCode: str
    partId: str
    status: str
    confidenceScore: float
    measurements: list[Measurement]
    detections: list[ObjectDetection]

    def to_dict(self) -> dict[str, Any]:
        return {
            "partName": self.partName,
            "partCode": self.partCode,
            "partId": self.partId,
            "status": self.status,
            "confidenceScore": self.confidenceScore,
            "measurements": [measurement.to_dict() for measurement in self.measurements],
            "detections": [detection.to_dict() for detection in self.detections],
        }


@dataclass
class VisionResult:
    frame: np.ndarray
    foreground_area: int
    inspection: InspectionPayload | None = None


def get_camera(camera_index: int = 0) -> cv2.VideoCapture:
    cap = cv2.VideoCapture(camera_index, cv2.CAP_DSHOW)
    if not cap.isOpened():
        cap = cv2.VideoCapture(camera_index)
    if not cap.isOpened():
        raise RuntimeError("Kamera tidak ditemukan")
    return cap


def to_gray_blurred(frame: np.ndarray) -> np.ndarray:
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    return cv2.GaussianBlur(gray, (5, 5), 0)


def calibrate_background(frames: list[np.ndarray]) -> np.ndarray:
    if not frames:
        raise ValueError("Need at least 1 frame for calibration")
    stack = np.stack([to_gray_blurred(f).astype(np.float32) for f in frames], axis=0)
    return np.mean(stack, axis=0).astype(np.uint8)


def compute_foreground_mask(frame: np.ndarray, background: np.ndarray, threshold: int = 25) -> np.ndarray:
    gray = to_gray_blurred(frame)
    diff = cv2.absdiff(gray, background)
    _, mask = cv2.threshold(diff, threshold, 255, cv2.THRESH_BINARY)
    kernel = np.ones((5, 5), np.uint8)
    return cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)


def _calc_subpixel_offset(val_left: float, val_center: float, val_right: float) -> float:
    denominator = 2.0 * (val_left - 2.0 * val_center + val_right)
    if denominator == 0:
        return 0.0
    return (val_left - val_right) / denominator


def _refine_edge_1d(image_gray: np.ndarray, rough_x: int, rough_y: int) -> float:
    h, w = image_gray.shape
    if rough_x <= 0 or rough_x >= w - 1:
        return float(rough_x)
    roi = image_gray[rough_y, rough_x - 1: rough_x + 2].astype(np.float32)
    return float(rough_x) + _calc_subpixel_offset(float(roi[0]), float(roi[1]), float(roi[2]))


def _status_for(value: float, spec: DimensionSpec) -> str:
    span = spec.upper_limit - spec.lower_limit
    guard = span * GUARDBAND_PERCENT * 0.5
    return "OK" if (spec.lower_limit + guard) <= value <= (spec.upper_limit - guard) else "NG"


def inspect_frame(frame: np.ndarray, mask: np.ndarray, part: PartSpec) -> VisionResult:
    fg_area = int(cv2.countNonZero(mask))
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours or cv2.contourArea(max(contours, key=cv2.contourArea)) <= MIN_CONTOUR_AREA:
        return VisionResult(frame=frame, foreground_area=fg_area, inspection=None)

    result_frame = frame.copy()
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    detections: list[ObjectDetection] = []

    ordered_contours = sorted(
        [contour for contour in contours if cv2.contourArea(contour) > MIN_CONTOUR_AREA],
        key=cv2.contourArea,
        reverse=True,
    )[:12]

    for index, contour in enumerate(ordered_contours, start=1):
        x, y, w_box, h_box = cv2.boundingRect(contour)
        moments = cv2.moments(contour)
        cx = int(moments["m10"] / moments["m00"]) if moments["m00"] else x + w_box // 2
        cy = int(moments["m01"] / moments["m00"]) if moments["m00"] else y + h_box // 2
        (circle_x, circle_y), radius_px = cv2.minEnclosingCircle(contour)

        mid_y = y + h_box // 2
        precise_left = _refine_edge_1d(gray, x, mid_y)
        precise_right = _refine_edge_1d(gray, x + w_box, mid_y)
        diameter_mm = round(float(radius_px * 2 * PIXEL_TO_MM_RATIO), 3)
        width_mm = round(float((precise_right - precise_left) * PIXEL_TO_MM_RATIO), 3)

        measured_by_name: dict[str, float] = {}
        for spec in part.dimensions:
            name = spec.name.lower()
            if "diam" in name:
                measured_by_name[spec.name] = diameter_mm
            elif "width" in name or "lebar" in name:
                measured_by_name[spec.name] = width_mm
            else:
                measured_by_name[spec.name] = diameter_mm if "h" not in name else width_mm

        measurements: list[Measurement] = []
        detection_ok = True
        for spec in part.dimensions:
            value = measured_by_name.get(spec.name, diameter_mm)
            status = _status_for(value, spec)
            if status == "NG":
                detection_ok = False
            measurements.append(Measurement(
                dimensionName=spec.name,
                measured=value,
                nominal=spec.nominal,
                upperLimit=spec.upper_limit,
                lowerLimit=spec.lower_limit,
                unit=spec.unit,
                status=status,
            ))

        if not measurements:
            nominal = round(diameter_mm, 3)
            measurements.append(Measurement(
                dimensionName="Diameter",
                measured=diameter_mm,
                nominal=nominal,
                upperLimit=nominal + 0.5,
                lowerLimit=nominal - 0.5,
                unit="mm",
                status="OK",
            ))

        status = "OK" if detection_ok else "NG"
        color = (0, 255, 0) if status == "OK" else (0, 0, 255)
        detection = ObjectDetection(
            id=f"obj-{index}",
            label=f"{part.part_code} #{index}",
            bbox=BoundingBox(
                x=round((x / frame.shape[1]) * 100, 2),
                y=round((y / frame.shape[0]) * 100, 2),
                width=round((w_box / frame.shape[1]) * 100, 2),
                height=round((h_box / frame.shape[0]) * 100, 2),
            ),
            status=status,
            confidenceScore=95.0 if status == "OK" else 88.0,
            measurements=measurements,
        )
        detections.append(detection)

        cv2.circle(result_frame, (cx, cy), 3, (0, 255, 255), -1)
        cv2.circle(result_frame, (int(circle_x), int(circle_y)), int(radius_px), color, 2)
        cv2.rectangle(result_frame, (x, y), (x + w_box, y + h_box), color, 2)
        cv2.putText(result_frame, detection.id, (x, max(20, y - 10)),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.55, color, 2)

    if not detections:
        return VisionResult(frame=frame, foreground_area=fg_area, inspection=None)

    measurements = [measurement for detection in detections for measurement in detection.measurements]
    status = "OK" if all(detection.status == "OK" for detection in detections) else "NG"
    confidence = round(sum(detection.confidenceScore for detection in detections) / len(detections), 2)

    cv2.putText(result_frame, f"STATUS: {status} | OBJECTS: {len(detections)}", (10, result_frame.shape[0] - 20),
                cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 255, 0) if status == "OK" else (0, 0, 255), 2)
    cv2.putText(result_frame, f"{part.part_name} ({part.part_code})", (10, 28),
                cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 0), 2)

    inspection = InspectionPayload(
        partName=part.part_name,
        partCode=part.part_code,
        partId=part.part_id,
        status=status,
        confidenceScore=confidence,
        measurements=measurements,
        detections=detections,
    )
    return VisionResult(frame=result_frame, foreground_area=fg_area, inspection=inspection)


def annotate_status(frame: np.ndarray, phase: str, part: PartSpec | None) -> np.ndarray:
    annotated = frame.copy()
    label = f"{phase.upper()}"
    if part is not None:
        label += f" | {part.part_name} ({part.part_code})"
    cv2.putText(annotated, label, (10, 28), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 255), 2)
    return annotated
