from dataclasses import dataclass, field
from typing import Any

import cv2
import numpy as np

PIXEL_TO_MM_RATIO = 0.05
GUARDBAND_PERCENT = 0.2
MIN_CONTOUR_AREA = 1000


def _normalize_kind(raw: dict[str, Any]) -> str:
    explicit = str(raw.get("kind", "")).strip().lower()
    if explicit in {"width", "length", "diameter", "outer_diameter", "inner_diameter", "hole_diameter"}:
        return explicit

    name = str(raw.get("name", "")).strip().lower()
    if "inner" in name or "inside" in name:
        return "inner_diameter"
    if "hole" in name or "lubang" in name:
        return "hole_diameter"
    if "outer" in name or "outside" in name:
        return "outer_diameter"
    if "diam" in name:
        return "diameter"
    if "length" in name or "panjang" in name:
        return "length"
    return "width"


@dataclass(frozen=True)
class DimensionSpec:
    id: str
    name: str
    kind: str
    view: str
    nominal: float
    upper_limit: float
    lower_limit: float
    unit: str = "mm"

    @classmethod
    def from_dict(cls, raw: dict[str, Any]) -> "DimensionSpec":
        return cls(
            id=str(raw.get("id", raw.get("name", ""))),
            name=str(raw.get("name", "Dimension")),
            kind=_normalize_kind(raw),
            view=str(raw.get("view", "top")),
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


def _hole_diameter_mm(mask: np.ndarray, contour: np.ndarray) -> float | None:
    x, y, w_box, h_box = cv2.boundingRect(contour)
    if w_box <= 0 or h_box <= 0:
        return None

    crop_mask = mask[y:y + h_box, x:x + w_box]
    local_contour = contour.copy()
    local_contour[:, :, 0] -= x
    local_contour[:, :, 1] -= y

    filled = np.zeros((h_box, w_box), dtype=np.uint8)
    cv2.drawContours(filled, [local_contour], -1, 255, -1)
    holes = cv2.bitwise_and(filled, cv2.bitwise_not(crop_mask))
    kernel = np.ones((3, 3), np.uint8)
    holes = cv2.morphologyEx(holes, cv2.MORPH_OPEN, kernel)

    hole_contours, _ = cv2.findContours(holes, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    readable = [hole for hole in hole_contours if cv2.contourArea(hole) > MIN_CONTOUR_AREA * 0.05]
    if not readable:
        return None

    largest = max(readable, key=cv2.contourArea)
    (_, _), radius_px = cv2.minEnclosingCircle(largest)
    return round(float(radius_px * 2 * PIXEL_TO_MM_RATIO), 3)


def _measure_dimension(
    spec: DimensionSpec,
    *,
    width_mm: float,
    length_mm: float,
    diameter_mm: float,
    hole_diameter_mm: float | None,
) -> float | None:
    if spec.kind == "width":
        return width_mm
    if spec.kind == "length":
        return length_mm
    if spec.kind in {"diameter", "outer_diameter"}:
        return diameter_mm
    if spec.kind in {"inner_diameter", "hole_diameter"}:
        return hole_diameter_mm
    return width_mm


def inspect_frame(frame: np.ndarray, mask: np.ndarray, part: PartSpec, inspection_view: str = "top") -> VisionResult:
    fg_area = int(cv2.countNonZero(mask))
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours or cv2.contourArea(max(contours, key=cv2.contourArea)) <= MIN_CONTOUR_AREA:
        return VisionResult(frame=frame, foreground_area=fg_area, inspection=None)

    result_frame = frame.copy()
    detections: list[ObjectDetection] = []
    active_view = inspection_view if inspection_view in {"top", "side"} else "top"
    active_specs = [spec for spec in part.dimensions if spec.view == active_view]

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

        (_, _), (rect_w, rect_h), _ = cv2.minAreaRect(contour)
        short_side_px = max(0.0, min(float(rect_w), float(rect_h)))
        long_side_px = max(0.0, max(float(rect_w), float(rect_h)))
        diameter_mm = round(float(radius_px * 2 * PIXEL_TO_MM_RATIO), 3)
        width_mm = round(short_side_px * PIXEL_TO_MM_RATIO, 3)
        length_mm = round(long_side_px * PIXEL_TO_MM_RATIO, 3)
        hole_mm = _hole_diameter_mm(mask, contour)

        measurements: list[Measurement] = []
        detection_ok = True
        for spec in active_specs:
            value = _measure_dimension(
                spec,
                width_mm=width_mm,
                length_mm=length_mm,
                diameter_mm=diameter_mm,
                hole_diameter_mm=hole_mm,
            )
            if value is None:
                detection_ok = False
                measurements.append(Measurement(
                    dimensionName=spec.name,
                    measured=0.0,
                    nominal=spec.nominal,
                    upperLimit=spec.upper_limit,
                    lowerLimit=spec.lower_limit,
                    unit=spec.unit,
                    status="UNREADABLE",
                ))
                continue

            status = _status_for(value, spec)
            if status != "OK":
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

        if not measurements and part.dimensions:
            detection_ok = False
            measurements.append(Measurement(
                dimensionName=f"Dimensi {active_view}",
                measured=0.0,
                nominal=0.0,
                upperLimit=0.0,
                lowerLimit=0.0,
                unit="mm",
                status="UNREADABLE",
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
