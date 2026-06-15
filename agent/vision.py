from collections import deque
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
SMOOTH_WINDOW = 7
STATUS_HYSTERESIS_FRAMES = 3


def _int_env(name: str, default: int) -> int:
    try:
        value = int(os.environ.get(name, ""))
    except (TypeError, ValueError):
        return default
    return value if value > 0 else default


TRACK_CONFIRM_FRAMES = _int_env("TRACK_CONFIRM_FRAMES", 6)
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


def set_calibrated_ratio(value: float) -> None:
    global current_ratio
    if value and value > 0:
        current_ratio = float(value)


class _CentroidTracker:
    def __init__(self) -> None:
        self._tracks: list[dict[str, float]] = []
        self._next_id = 1

    def reset(self) -> None:
        self._tracks = []
        self._next_id = 1

    def alive_ids(self) -> set[int]:
        return {int(track["id"]) for track in self._tracks}

    def update(self, centroids: list[tuple[float, float]], frame_width: int) -> list[tuple[int, bool, bool]]:
        line = CAPTURE_TRIGGER_X_RATIO * float(frame_width)
        matched = [False] * len(self._tracks)
        results: list[tuple[int, bool, bool]] = []
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
                results.append((int(track["id"]), confirmed, fired))
            else:
                track_id = self._next_id
                self._next_id += 1
                new_tracks.append(
                    {
                        "id": float(track_id),
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
                results.append((track_id, False, False))
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


class _MeasurementStabilizer:
    def __init__(self) -> None:
        self._store: dict[int, dict[str, Any]] = {}

    def reset(self) -> None:
        self._store = {}

    def prune(self, alive_ids: set[int]) -> None:
        self._store = {key: value for key, value in self._store.items() if key in alive_ids}

    def smooth(self, track_id: int, samples: dict[str, float | None]) -> dict[str, float | None]:
        entry = self._store.setdefault(track_id, {})
        windows = entry.setdefault("windows", {})
        last = entry.setdefault("last", {})
        out: dict[str, float | None] = {}
        for key, value in samples.items():
            if value is None:
                out[key] = last.get(key)
                continue
            window = windows.get(key)
            if window is None:
                window = deque(maxlen=SMOOTH_WINDOW)
                windows[key] = window
            window.append(float(value))
            smoothed = float(np.median(window))
            last[key] = smoothed
            out[key] = smoothed
        return out

    def classify(self, track_id: int, raw_ok: bool) -> bool:
        entry = self._store.setdefault(track_id, {})
        stable = entry.get("status_stable")
        if stable is None:
            entry["status_stable"] = raw_ok
            entry["status_pending"] = raw_ok
            entry["status_count"] = 0
            return raw_ok
        if raw_ok == stable:
            entry["status_pending"] = raw_ok
            entry["status_count"] = 0
            return stable
        if entry.get("status_pending") == raw_ok:
            entry["status_count"] = entry.get("status_count", 0) + 1
        else:
            entry["status_pending"] = raw_ok
            entry["status_count"] = 1
        if entry["status_count"] >= STATUS_HYSTERESIS_FRAMES:
            entry["status_stable"] = raw_ok
            entry["status_count"] = 0
            return raw_ok
        return stable


_TRACKER = _CentroidTracker()
_STABILIZER = _MeasurementStabilizer()


def reset_tracker() -> None:
    _TRACKER.reset()
    _STABILIZER.reset()


def measure_aruco_ratio(frame: np.ndarray) -> float | None:
    if frame.ndim == 3:
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    else:
        gray = frame
    for candidate in (gray, cv2.flip(gray, 1)):
        corners, ids, _ = ARUCO_DETECTOR.detectMarkers(candidate)
        if ids is not None and len(corners) > 0:
            marker_corners = corners[0][0]
            sides = [
                float(np.linalg.norm(marker_corners[i] - marker_corners[(i + 1) % 4]))
                for i in range(4)
            ]
            valid = [side for side in sides if side > 0]
            if valid:
                avg_side = sum(valid) / len(valid)
                if avg_side > 0:
                    return ARUCO_SIZE_MM / avg_side
    return None


def annotate_calibration(
    frame: np.ndarray,
    part: "PartSpec | None",
    captured: int,
    total: int,
    aruco_detected: bool,
) -> np.ndarray:
    annotated = frame.copy()
    h, w = annotated.shape[:2]
    scale = max(0.8, w / 900.0)
    font = cv2.FONT_HERSHEY_SIMPLEX
    line_gap = int(46 * scale)
    panel_h = line_gap * (4 if part is not None else 3) + int(24 * scale)
    overlay = annotated.copy()
    cv2.rectangle(overlay, (0, 0), (w, panel_h), (0, 0, 0), -1)
    cv2.addWeighted(overlay, 0.55, annotated, 0.45, 0.0, annotated)

    def put(text: str, line: int, font_scale: float, color: tuple[int, int, int]) -> None:
        y = line_gap * (line + 1)
        cv2.putText(annotated, text, (int(18 * scale), y), font, font_scale, (0, 0, 0), int(6 * scale), cv2.LINE_AA)
        cv2.putText(annotated, text, (int(18 * scale), y), font, font_scale, color, max(2, int(2 * scale)), cv2.LINE_AA)

    put(f"KALIBRASI {captured}/{total}", 0, 1.15 * scale, (0, 255, 255))
    status = "TERDETEKSI" if aruco_detected else "MARKER TIDAK TERLIHAT"
    status_color = (0, 220, 0) if aruco_detected else (0, 80, 255)
    put(f"ArUco: {status}", 1, 0.9 * scale, status_color)
    scale_suffix = "" if aruco_detected else " (terakhir)"
    put(f"Skala: {current_ratio:.4f} mm/px{scale_suffix}", 2, 0.9 * scale, (255, 255, 0))
    if part is not None:
        put(f"{part.part_name} ({part.part_code})", 3, 0.8 * scale, (220, 220, 220))
    return annotated


def _normalize_kind(raw: dict[str, Any]) -> str:
    explicit = str(raw.get("kind", "")).strip().lower()
    if explicit == "outer_diameter":
        return "diameter"
    if explicit == "hole_diameter":
        return "inner_diameter"
    if explicit in {"width", "length", "diameter", "inner_diameter"}:
        return explicit

    name = str(raw.get("name", "")).strip().lower()
    if "inner" in name or "inside" in name or "hole" in name or "lubang" in name:
        return "inner_diameter"
    if "outer" in name or "outside" in name:
        return "diameter"
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
    polygon: list[list[float]] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "label": self.label,
            "bbox": self.bbox.to_dict(),
            "status": self.status,
            "confidenceScore": self.confidenceScore,
            "measurements": [measurement.to_dict() for measurement in self.measurements],
            "polygon": self.polygon,
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
    inspection: InspectionPayload | None = None
    triggered: list[ObjectDetection] = field(default_factory=list)
    overlay: list[dict[str, Any]] = field(default_factory=list)


def render_overlay(frame: np.ndarray, items: list[dict[str, Any]]) -> np.ndarray:
    out = frame.copy()
    font = cv2.FONT_HERSHEY_SIMPLEX
    for item in items:
        color = (0, 255, 0) if item["ok"] else (0, 0, 255)
        cv2.drawContours(out, [item["outline"]], -1, color, 2)
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


def _hole_diameter_px(gray: np.ndarray, contour: np.ndarray) -> float | None:
    x, y, w_box, h_box = cv2.boundingRect(contour)
    if w_box <= 0 or h_box <= 0:
        return None

    local_contour = contour.copy()
    local_contour[:, :, 0] -= x
    local_contour[:, :, 1] -= y
    body = np.zeros((h_box, w_box), dtype=np.uint8)
    cv2.drawContours(body, [local_contour], -1, 255, -1)
    eroded = cv2.erode(body, np.ones((5, 5), np.uint8), iterations=1)

    roi = gray[y:y + h_box, x:x + w_box]
    samples = roi[eroded > 0]
    if samples.size == 0:
        return None
    mean_intensity = float(samples.mean())
    std_intensity = float(samples.std())
    threshold = max(25.0, 2.0 * std_intensity)

    deviation = cv2.absdiff(roi, np.full_like(roi, int(round(mean_intensity))))
    hole_bin = ((deviation.astype(np.float32) > threshold) & (eroded > 0)).astype(np.uint8) * 255
    hole_bin = cv2.morphologyEx(hole_bin, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))

    hole_contours, _ = cv2.findContours(hole_bin, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    readable = [hole for hole in hole_contours if cv2.contourArea(hole) > MIN_CONTOUR_AREA * 0.05]
    if not readable:
        return None

    largest = max(readable, key=cv2.contourArea)
    (_, _), radius_px = cv2.minEnclosingCircle(largest)
    return float(radius_px * 2)


def _refine_dimensions(
    gray: np.ndarray,
    raw_box: np.ndarray,
    rect_w: float,
    rect_h: float,
) -> tuple[float, float]:
    if rect_w <= 0 or rect_h <= 0:
        return rect_w, rect_h
    h_img, w_img = gray.shape[:2]
    pts = raw_box.astype(np.float32)
    pts[:, 0] = np.clip(pts[:, 0], 0.0, float(w_img - 1))
    pts[:, 1] = np.clip(pts[:, 1], 0.0, float(h_img - 1))
    corners = pts.reshape(-1, 1, 2).copy()
    try:
        cv2.cornerSubPix(
            gray,
            corners,
            (5, 5),
            (-1, -1),
            (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 20, 0.01),
        )
    except cv2.error:
        return rect_w, rect_h
    refined = corners.reshape(-1, 2)
    side_a = (
        float(np.linalg.norm(refined[0] - refined[1]))
        + float(np.linalg.norm(refined[2] - refined[3]))
    ) / 2.0
    side_b = (
        float(np.linalg.norm(refined[1] - refined[2]))
        + float(np.linalg.norm(refined[3] - refined[0]))
    ) / 2.0
    if side_a <= 0 or side_b <= 0:
        return rect_w, rect_h
    aligned = abs(side_a - rect_w) + abs(side_b - rect_h)
    swapped = abs(side_a - rect_h) + abs(side_b - rect_w)
    if aligned <= swapped:
        return side_a, side_b
    return side_b, side_a


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
    if spec.kind == "diameter":
        return diameter_mm
    if spec.kind == "inner_diameter":
        return hole_diameter_mm
    return width_mm


def inspect_frame(frame: np.ndarray, mask: np.ndarray, part: PartSpec, inspection_view: str = "top") -> VisionResult:

    ratio = current_ratio
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY) if frame.ndim == 3 else frame

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
    _STABILIZER.prune(_TRACKER.alive_ids())
    confirmed_pairs = [
        (contour, track_id, fired)
        for contour, (track_id, confirmed, fired) in zip(ordered_contours, results)
        if confirmed
    ]

    if not confirmed_pairs:
        return VisionResult(inspection=None)

    detections: list[ObjectDetection] = []
    triggered: list[ObjectDetection] = []
    overlay: list[dict[str, Any]] = []
    active_view = inspection_view if inspection_view in {"top", "side"} else "top"
    active_specs = [spec for spec in part.dimensions if spec.view == active_view]
    needs_hole = any(spec.kind == "inner_diameter" for spec in active_specs)

    for index, (contour, track_id, fired_flag) in enumerate(confirmed_pairs, start=1):
        (raw_cx, raw_cy), radius_px = cv2.minEnclosingCircle(contour)
        rect = cv2.minAreaRect(contour)
        (rect_cx, rect_cy), (rect_w, rect_h), rect_angle = rect
        raw_box = cv2.boxPoints(rect)
        w_ref, h_ref = _refine_dimensions(gray, raw_box, float(rect_w), float(rect_h))
        hole_px = _hole_diameter_px(gray, contour) if needs_hole else None

        contour_pts = contour.reshape(-1, 2)
        max_outline_points = 80
        if len(contour_pts) > max_outline_points:
            idx = np.linspace(0, len(contour_pts) - 1, max_outline_points).astype(np.intp)
            contour_pts = contour_pts[idx]
        outline = contour_pts.reshape(-1, 1, 2).astype(np.int32)
        frame_w = float(frame.shape[1])
        frame_h = float(frame.shape[0])
        polygon = [
            [round(float(px) / frame_w * 100.0, 2), round(float(py) / frame_h * 100.0, 2)]
            for px, py in contour_pts
        ]

        smoothed = _STABILIZER.smooth(track_id, {
            "cx": float(rect_cx),
            "cy": float(rect_cy),
            "w": w_ref,
            "h": h_ref,
            "angle": float(rect_angle),
            "radius": float(radius_px),
            "hole": hole_px,
        })

        s_cx = smoothed["cx"] if smoothed["cx"] is not None else float(raw_cx)
        s_cy = smoothed["cy"] if smoothed["cy"] is not None else float(raw_cy)
        s_w = smoothed["w"] if smoothed["w"] is not None else float(rect_w)
        s_h = smoothed["h"] if smoothed["h"] is not None else float(rect_h)
        s_angle = smoothed["angle"] if smoothed["angle"] is not None else float(rect_angle)
        s_radius = smoothed["radius"] if smoothed["radius"] is not None else float(radius_px)
        s_hole = smoothed["hole"]

        box_points = cv2.boxPoints(((s_cx, s_cy), (s_w, s_h), s_angle)).astype(np.intp)
        x, y, w_box, h_box = cv2.boundingRect(box_points)
        x = max(0, x)
        y = max(0, y)
        cx = int(round(s_cx))
        cy = int(round(s_cy))

        long_side_px = max(s_w, s_h)
        short_side_px = min(s_w, s_h)
        diameter_mm = round(s_radius * 2 * ratio, 3)
        width_mm = round(short_side_px * ratio, 3)
        length_mm = round(long_side_px * ratio, 3)
        hole_mm = round(s_hole * ratio, 3) if s_hole is not None else None

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

        stable_ok = _STABILIZER.classify(track_id, detection_ok)
        status = "OK" if stable_ok else "NG"
        detection = ObjectDetection(
            id=f"obj-{track_id}",
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
            polygon=polygon,
        )
        detections.append(detection)
        if fired_flag:
            triggered.append(detection)
        overlay.append({
            "outline": outline,
            "center": (cx, cy),
            "ok": status == "OK",
            "label": detection.label,
        })

    if not detections:
        return VisionResult(inspection=None)

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
    return VisionResult(inspection=inspection, triggered=triggered, overlay=overlay)


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
