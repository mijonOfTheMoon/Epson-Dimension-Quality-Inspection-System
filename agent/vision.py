from dataclasses import dataclass, field
from typing import Any
import json
import math
import os

import cv2
import numpy as np

ARUCO_SIZE_MM = 20.00
PIXEL_TO_MM_RATIO = 0.05
MIN_CONTOUR_AREA = 1500

CANNY_LOW = 40
CANNY_HIGH = 120
TRACK_CONFIRM_FRAMES = 4
TRACK_MAX_DISTANCE_PX = 120.0
TRACK_FORGET_FRAMES = 6
CAPTURE_TRIGGER_X_RATIO = 0.5
CAPTURE_RETIRE_MARGIN_PX = 40.0
TRIGGER_MIN_TRAVEL_RATIO = 0.2

ARUCO_DICT = cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_50)
ARUCO_PARAMS = cv2.aruco.DetectorParameters()
ARUCO_PARAMS.cornerRefinementMethod = cv2.aruco.CORNER_REFINE_SUBPIX
ARUCO_PARAMS.adaptiveThreshWinSizeMin = 3
ARUCO_PARAMS.adaptiveThreshWinSizeMax = 23
ARUCO_PARAMS.adaptiveThreshWinSizeStep = 10
ARUCO_PARAMS.minMarkerPerimeterRate = 0.03
ARUCO_PARAMS.maxMarkerPerimeterRate = 4.0
ARUCO_DETECTOR = cv2.aruco.ArucoDetector(ARUCO_DICT, ARUCO_PARAMS)

CALIBRATION_STATE_PATH = os.environ.get("CALIBRATION_STATE_PATH") or os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "calibration_state.json"
)


def _load_persisted_ratio() -> float:
    try:
        with open(CALIBRATION_STATE_PATH, "r", encoding="utf-8") as handle:
            data = json.load(handle)
        ratio = float(data["pixelToMmRatio"])
    except (OSError, ValueError, TypeError, KeyError, json.JSONDecodeError):
        return PIXEL_TO_MM_RATIO
    return ratio if ratio > 0 else PIXEL_TO_MM_RATIO


def save_persisted_ratio() -> bool:
    try:
        with open(CALIBRATION_STATE_PATH, "w", encoding="utf-8") as handle:
            json.dump({"pixelToMmRatio": current_ratio}, handle)
    except OSError:
        return False
    return True


current_ratio = _load_persisted_ratio()


class _CentroidTracker:
    def __init__(self) -> None:
        self._tracks: list[dict[str, float]] = []

    def reset(self) -> None:
        self._tracks = []

    def update(self, centroids: list[tuple[float, float]], frame_width: int) -> list[tuple[bool, bool]]:
        line = CAPTURE_TRIGGER_X_RATIO * float(frame_width)
        matched = [False] * len(self._tracks)
        results: list[tuple[bool, bool]] = []
        new_tracks: list[dict[str, float]] = []
        for cx, cy in centroids:
            best = -1
            best_distance = TRACK_MAX_DISTANCE_PX
            for index, track in enumerate(self._tracks):
                if matched[index]:
                    continue
                predicted_x = track["cx"] + track["vx"]
                distance = math.hypot(cx - predicted_x, cy - track["cy"])
                if distance < best_distance:
                    best_distance = distance
                    best = index
            if best >= 0:
                track = self._tracks[best]
                matched[best] = True
                new_cx = 0.5 * cx + 0.5 * track["cx"]
                new_cy = 0.5 * cy + 0.5 * track["cy"]
                track["vx"] = 0.5 * (new_cx - track["cx"]) + 0.5 * track["vx"]
                track["cx"] = new_cx
                track["cy"] = new_cy
                track["hits"] = min(track["hits"] + 1, TRACK_CONFIRM_FRAMES + 3)
                track["missed"] = 0
                signed_travel = new_cx - track["entry_x"]
                dy = new_cy - track["entry_y"]
                crossed_line = (track["entry_x"] - line) * (new_cx - line) < 0.0
                confirmed = track["hits"] >= TRACK_CONFIRM_FRAMES
                fired = (
                    confirmed
                    and track["captured"] < 1.0
                    and crossed_line
                    and abs(signed_travel) >= TRIGGER_MIN_TRAVEL_RATIO * float(frame_width)
                    and abs(signed_travel) >= abs(dy)
                )
                if fired:
                    track["captured"] = 1.0
                results.append((confirmed, fired))
            else:
                new_tracks.append(
                    {
                        "cx": float(cx),
                        "cy": float(cy),
                        "vx": 0.0,
                        "entry_x": float(cx),
                        "entry_y": float(cy),
                        "entry_side": 1.0 if (float(cx) - line) >= 0.0 else -1.0,
                        "hits": 1.0,
                        "missed": 0.0,
                        "captured": 0.0,
                    }
                )
                results.append((False, False))
        for index, track in enumerate(self._tracks):
            if not matched[index]:
                track["missed"] += 1
        self._tracks = [
            track
            for track in self._tracks
            if track["missed"] <= TRACK_FORGET_FRAMES
            and not (track["captured"] >= 1.0 and (track["cx"] - line) * (-track["entry_side"]) > CAPTURE_RETIRE_MARGIN_PX)
        ]
        self._tracks.extend(new_tracks)
        return results


_TRACKER = _CentroidTracker()


def reset_tracker() -> None:
    _TRACKER.reset()


def calibrate_aruco_ratio(frame: np.ndarray) -> bool:
    global current_ratio
    if frame.ndim == 3:
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    else:
        gray = frame
    corners, ids, _ = ARUCO_DETECTOR.detectMarkers(gray)
    if ids is not None and len(corners) > 0:
        marker_corners = corners[0][0]
        dist_px = np.linalg.norm(marker_corners[0] - marker_corners[1])
        if dist_px > 0:
            current_ratio = ARUCO_SIZE_MM / float(dist_px)
            return True
    flipped_gray = cv2.flip(gray, 1)
    corners, ids, _ = ARUCO_DETECTOR.detectMarkers(flipped_gray)
    if ids is not None and len(corners) > 0:
        marker_corners = corners[0][0]
        dist_px = np.linalg.norm(marker_corners[0] - marker_corners[1])
        if dist_px > 0:
            current_ratio = ARUCO_SIZE_MM / float(dist_px)
            return True
    return False


def annotate_calibration(
    frame: np.ndarray,
    part: "PartSpec | None",
    captured: int,
    total: int,
    aruco_detected: bool,
) -> np.ndarray:
    annotated = frame.copy()
    font = cv2.FONT_HERSHEY_SIMPLEX
    cv2.putText(annotated, f"KALIBRASI {captured}/{total}", (10, 28), font, 0.6, (0, 255, 255), 2)
    status = "TERDETEKSI" if aruco_detected else "MARKER TIDAK TERLIHAT"
    color = (0, 200, 0) if aruco_detected else (0, 0, 255)
    cv2.putText(annotated, f"ArUco: {status}", (10, 54), font, 0.55, color, 2)
    scale_suffix = "" if aruco_detected else " (terakhir)"
    cv2.putText(annotated, f"Skala: {current_ratio:.4f} mm/px{scale_suffix}", (10, 80), font, 0.55, (255, 255, 0), 2)
    if part is not None:
        cv2.putText(annotated, f"{part.part_name} ({part.part_code})", (10, 106), font, 0.5, (200, 200, 200), 2)
    return annotated


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


def _orientation_label(view: str) -> str:
    return "Menyamping dari Kamera" if view == "side" else "Menghadap Kamera"


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
    vendor: str
    status: str
    confidenceScore: float
    measurements: list[Measurement]
    detections: list[ObjectDetection]

    def to_dict(self) -> dict[str, Any]:
        return {
            "partName": self.partName,
            "partCode": self.partCode,
            "partId": self.partId,
            "vendor": self.vendor,
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
    triggered: list[ObjectDetection] = field(default_factory=list)
    overlay: list[dict[str, Any]] = field(default_factory=list)


def render_overlay(frame: np.ndarray, items: list[dict[str, Any]]) -> np.ndarray:
    out = frame.copy()
    font = cv2.FONT_HERSHEY_SIMPLEX
    for item in items:
        color = (0, 255, 0) if item["ok"] else (0, 0, 255)
        cv2.drawContours(out, [item["box"]], 0, color, 2)
        cx, cy = item["center"]
        cv2.circle(out, (cx, cy), 4, (0, 0, 255), -1)
        cv2.putText(out, item["label"], (cx - 40, max(16, cy - 14)), font, 0.5, color, 2)
    return out


def get_camera(camera_index: int = 0, fps: int = 0, width: int = 0, height: int = 0) -> cv2.VideoCapture:
    cap = cv2.VideoCapture(camera_index, cv2.CAP_DSHOW)
    if not cap.isOpened():
        cap = cv2.VideoCapture(camera_index)
    if not cap.isOpened():
        raise RuntimeError("Kamera tidak ditemukan")
    if width > 0 and height > 0:
        cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*"MJPG"))
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, float(width))
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, float(height))
    if fps > 0:
        cap.set(cv2.CAP_PROP_FPS, float(fps))
    cap.set(cv2.CAP_PROP_AUTOFOCUS, 0)
    cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
    return cap


def compute_object_mask(frame: np.ndarray) -> np.ndarray:
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = cv2.Canny(blurred, CANNY_LOW, CANNY_HIGH)
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    edges = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, kernel, iterations=2)
    contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    mask = np.zeros(gray.shape, dtype=np.uint8)
    for contour in contours:
        if cv2.contourArea(contour) > MIN_CONTOUR_AREA:
            cv2.drawContours(mask, [contour], -1, 255, -1)
    return mask


def _status_for(value: float, spec: DimensionSpec) -> str:
    return "OK" if spec.lower_limit <= value <= spec.upper_limit else "NG"


def _confidence_for_measurements(measurements: list["Measurement"]) -> float:
    if not measurements:
        return 0.0
    scores: list[float] = []
    for measurement in measurements:
        if measurement.status == "UNREADABLE":
            scores.append(0.0)
            continue
        half_span = max((measurement.upperLimit - measurement.lowerLimit) / 2.0, 1e-6)
        deviation = abs(measurement.measured - measurement.nominal) / half_span
        scores.append(max(0.0, 1.0 - deviation))
    return round((sum(scores) / len(scores)) * 100.0, 2)


def _hole_diameter_mm(mask: np.ndarray, contour: np.ndarray, ratio: float) -> float | None:
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
    return round(float(radius_px * 2 * ratio), 3)


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

    ratio = current_ratio

    fg_area = int(cv2.countNonZero(mask))

    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    area_candidates = [c for c in contours if cv2.contourArea(c) > MIN_CONTOUR_AREA]
    ordered_contours = sorted(area_candidates, key=cv2.contourArea, reverse=True)[:12]

    candidate_centroids: list[tuple[float, float]] = []
    for contour in ordered_contours:
        moments = cv2.moments(contour)
        x, y, w_box, h_box = cv2.boundingRect(contour)
        cx = moments["m10"] / moments["m00"] if moments["m00"] else x + w_box / 2.0
        cy = moments["m01"] / moments["m00"] if moments["m00"] else y + h_box / 2.0
        candidate_centroids.append((cx, cy))

    results = _TRACKER.update(candidate_centroids, frame.shape[1])
    confirmed_pairs = [
        (contour, fired) for contour, (confirmed, fired) in zip(ordered_contours, results) if confirmed
    ]

    if not confirmed_pairs:
        return VisionResult(frame=frame, foreground_area=fg_area, inspection=None)

    ordered_contours = [contour for contour, _ in confirmed_pairs]
    fired_flags = [fired for _, fired in confirmed_pairs]

    detections: list[ObjectDetection] = []
    triggered: list[ObjectDetection] = []
    overlay: list[dict[str, Any]] = []
    active_view = inspection_view if inspection_view in {"top", "side"} else "top"
    active_specs = [spec for spec in part.dimensions if spec.view == active_view]

    used_ids: set[str] = set()

    for index, (contour, fired_flag) in enumerate(zip(ordered_contours, fired_flags), start=1):
        x, y, w_box, h_box = cv2.boundingRect(contour)
        moments = cv2.moments(contour)
        cx = int(moments["m10"] / moments["m00"]) if moments["m00"] else x + w_box // 2
        cy = int(moments["m01"] / moments["m00"]) if moments["m00"] else y + h_box // 2
        (_, _), radius_px = cv2.minEnclosingCircle(contour)

        rect = cv2.minAreaRect(contour)
        (_, _), (rect_w, rect_h), _ = rect
        long_side_px = max(float(rect_w), float(rect_h))
        short_side_px = min(float(rect_w), float(rect_h))
        box_points = cv2.boxPoints(rect).astype(np.intp)

        diameter_mm = round(float(radius_px * 2 * ratio), 3)
        width_mm = round(short_side_px * ratio, 3)
        length_mm = round(long_side_px * ratio, 3)
        hole_mm = _hole_diameter_mm(mask, contour, ratio)

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
                dimensionName=f"Dimensi {_orientation_label(active_view)}",
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
        cell_x = max(0, min(9, int((cx / max(frame.shape[1], 1)) * 10)))
        cell_y = max(0, min(9, int((cy / max(frame.shape[0], 1)) * 10)))
        detection_id = f"obj-{cell_x}-{cell_y}"
        dedupe = 1
        while detection_id in used_ids:
            dedupe += 1
            detection_id = f"obj-{cell_x}-{cell_y}-{dedupe}"
        used_ids.add(detection_id)
        detection = ObjectDetection(
            id=detection_id,
            label=f"{part.part_code} #{index}",
            bbox=BoundingBox(
                x=round((x / frame.shape[1]) * 100, 2),
                y=round((y / frame.shape[0]) * 100, 2),
                width=round((w_box / frame.shape[1]) * 100, 2),
                height=round((h_box / frame.shape[0]) * 100, 2),
            ),
            status=status,
            confidenceScore=_confidence_for_measurements(measurements),
            measurements=measurements,
        )
        detections.append(detection)
        if fired_flag:
            triggered.append(detection)
        overlay.append({
            "box": box_points,
            "center": (cx, cy),
            "ok": status == "OK",
            "label": detection.label,
        })

    if not detections:
        return VisionResult(frame=frame, foreground_area=fg_area, inspection=None)

    measurements = [measurement for detection in detections for measurement in detection.measurements]
    status = "OK" if all(detection.status == "OK" for detection in detections) else "NG"
    confidence = round(sum(detection.confidenceScore for detection in detections) / len(detections), 2)

    inspection = InspectionPayload(
        partName=part.part_name,
        partCode=part.part_code,
        partId=part.part_id,
        vendor=part.vendor,
        status=status,
        confidenceScore=confidence,
        measurements=measurements,
        detections=detections,
    )
    return VisionResult(frame=frame, foreground_area=fg_area, inspection=inspection, triggered=triggered, overlay=overlay)


def payload_from_detections(part: PartSpec, detections: list[ObjectDetection]) -> InspectionPayload:
    measurements = [measurement for detection in detections for measurement in detection.measurements]
    status = "OK" if all(detection.status == "OK" for detection in detections) else "NG"
    confidence = (
        round(sum(detection.confidenceScore for detection in detections) / len(detections), 2)
        if detections
        else 0.0
    )
    return InspectionPayload(
        partName=part.part_name,
        partCode=part.part_code,
        partId=part.part_id,
        vendor=part.vendor,
        status=status,
        confidenceScore=confidence,
        measurements=measurements,
        detections=detections,
    )