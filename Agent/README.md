# DimInspect Agent

Agent menjalankan pipeline OpenCV untuk inspeksi dimensi dan mengirim event ke backend.

## Run local

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
python computer_vision.py
```

## Environment

```text
STATION_ID=station-1
CAMERA_ID=camera-1
CAMERA_INDEX=0
MODEL_VERSION=vision-v1
MQTT_ENABLED=true
MQTT_HOST=broker.hivemq.com
MQTT_PORT=1883
MQTT_TOPIC_PREFIX=diminspect
MQTT_QOS=1
```

Agent membaca konfigurasi dari `.env` di folder `Agent`.

## Output event

- `inspection.created` untuk hasil inspeksi.
- `station.status` untuk status agent berkala.

## Validation

```bash
python -m py_compile computer_vision.py config.py transport.py vision.py
```
