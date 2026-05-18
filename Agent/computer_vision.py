from datetime import UTC, datetime
from time import monotonic
from uuid import uuid4

import cv2

from config import AgentConfig, load_config
from transport import create_publisher
from vision import get_camera, process_inspection


def now_iso() -> str:
    return datetime.now(Asia/Jakarta).isoformat().replace("+00:00", "Z")


def build_inspection_event(config: AgentConfig, inspection: dict) -> dict:
    return {
        "eventId": str(uuid4()),
        "eventType": "inspection.created",
        "stationId": config.station_id,
        "cameraId": config.camera_id,
        "timestamp": now_iso(),
        "batchNo": datetime.now().strftime("B%Y%m%d"),
        "vendor": "Internal",
        "operatorId": "agent",
        "operatorName": "Vision Agent",
        "shift": "A",
        "line": config.station_id,
        "modelVersion": config.model_version,
        **inspection,
    }


def build_station_status(config: AgentConfig, fps: float, queue_size: int = 0) -> dict:
    return {
        "eventId": str(uuid4()),
        "eventType": "station.status",
        "stationId": config.station_id,
        "cameraId": config.camera_id,
        "timestamp": now_iso(),
        "state": "online",
        "fps": round(fps, 2),
        "queueSize": queue_size,
        "modelVersion": config.model_version,
    }


def main() -> None:
    config = load_config()
    publisher = create_publisher(config)
    cap = get_camera(config.camera_index)
    last_publish = 0.0
    last_status = 0.0
    last_frame = monotonic()
    fps = 0.0

    try:
        while True:
            ret, frame = cap.read()
            if not ret:
                break

            current = monotonic()
            elapsed = current - last_frame
            last_frame = current
            if elapsed > 0:
                fps = (fps * 0.9) + ((1.0 / elapsed) * 0.1)

            result = process_inspection(frame)

            if result.inspection and current - last_publish >= 1.0:
                publisher.publish(build_inspection_event(config, result.inspection.to_dict()))
                last_publish = current

            if current - last_status >= 5.0:
                publisher.publish(build_station_status(config, fps))
                last_status = current

            cv2.imshow("Kamera Inspeksi Aktual", result.frame)
            cv2.imshow("Deteksi Tepi Biner", result.edges)

            if cv2.waitKey(1) & 0xFF == ord("q"):
                break
    finally:
        publisher.close()
        cap.release()
        cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
