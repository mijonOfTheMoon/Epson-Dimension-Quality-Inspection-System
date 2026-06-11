from __future__ import annotations

import asyncio
import logging
import threading
from collections import deque
from fractions import Fraction
from typing import Any, Callable

import cv2
import numpy as np
import requests

from config import AgentConfig

VideoReadyHandler = Callable[[str, str], None]
logger = logging.getLogger(__name__)

PUBLICATION_DISCONNECTED_ERROR = "webrtc_connection_lost"
DEFAULT_FRAME_QUEUE = 1
MAX_FRAME_QUEUE = 5


class BoundedFrameBuffer:

    def __init__(self, capacity: int = DEFAULT_FRAME_QUEUE) -> None:
        self._capacity = max(1, min(int(capacity), MAX_FRAME_QUEUE))
        self._frames: deque[cv2.Mat] = deque(maxlen=self._capacity)
        self._lock = threading.Lock()

    def push(self, frame: cv2.Mat) -> None:
        """Append a frame, dropping the oldest one if the buffer is full."""
        with self._lock:
            self._frames.append(frame)

    def pop(self) -> cv2.Mat | None:
        """Return the most recently pushed frame, or ``None`` if empty."""
        with self._lock:
            if not self._frames:
                return None
            return self._frames[-1]

    def clear(self) -> None:
        with self._lock:
            self._frames.clear()

try:
    from aiortc import RTCPeerConnection, RTCSessionDescription, VideoStreamTrack
    from av import VideoFrame
except ImportError:
    RTCPeerConnection = None
    RTCSessionDescription = None
    VideoStreamTrack = object
    VideoFrame = None


class LatestFrameTrack(VideoStreamTrack):
    def __init__(self, fps: int, capacity: int = DEFAULT_FRAME_QUEUE) -> None:
        super().__init__()
        self._interval = 1.0 / max(fps, 1)
        self._buffer = BoundedFrameBuffer(capacity)
        self._pts = 0
        self._closed = False

    def update(self, frame: cv2.Mat) -> None:
        if self._closed:
            return
        self._buffer.push(frame.copy())

    def stop_buffering(self) -> None:
        self._closed = True
        self._buffer.clear()

    async def recv(self) -> Any:
        await asyncio.sleep(self._interval)
        frame = self._buffer.pop()
        if frame is None:
            frame = np.zeros((480, 640, 3), dtype=np.uint8)
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        video_frame = VideoFrame.from_ndarray(rgb, format="rgb24")
        self._pts += 3000
        video_frame.pts = self._pts
        video_frame.time_base = Fraction(1, 90000)
        return video_frame


class WebRTCPublisher:
    def __init__(self, config: AgentConfig, fps: int) -> None:
        self.config = config
        self.fps = fps
        self._loop: asyncio.AbstractEventLoop | None = None
        self._thread: threading.Thread | None = None
        self._pc: Any = None
        self._track: LatestFrameTrack | None = None
        self._lock = threading.Lock()
        self._publication_error: str | None = None

    def start(self, track_name: str | None, on_ready: VideoReadyHandler) -> None:
        if not track_name or not self.config.cloudflare_realtime_enabled:
            return
        if RTCPeerConnection is None or RTCSessionDescription is None or VideoFrame is None:
            logger.warning("aiortc/av are not installed; live video publishing disabled")
            return
        if not self.config.cloudflare_realtime_app_id or not self.config.cloudflare_realtime_app_secret:
            logger.warning("Cloudflare Realtime credentials are missing; live video publishing disabled")
            return
        loop = self._ensure_loop()
        future = asyncio.run_coroutine_threadsafe(self._start_async(track_name, on_ready), loop)
        future.add_done_callback(self._log_future_error)

    def stop(self) -> None:
        loop = self._loop
        if loop is None:
            return
        future = asyncio.run_coroutine_threadsafe(self._stop_async(), loop)
        future.add_done_callback(self._log_future_error)

    def submit_frame(self, frame: cv2.Mat, meta: str | None = None) -> None:
        with self._lock:
            track = self._track
        if track is not None:
            track.update(frame)

    def _ensure_loop(self) -> asyncio.AbstractEventLoop:
        if self._loop is not None:
            return self._loop
        loop = asyncio.new_event_loop()
        self._loop = loop
        self._thread = threading.Thread(target=loop.run_forever, name="webrtc-publisher", daemon=True)
        self._thread.start()
        return loop

    async def _start_async(self, track_name: str, on_ready: VideoReadyHandler) -> None:
        await self._stop_async()
        pc = RTCPeerConnection()
        track = LatestFrameTrack(self.fps)
        sender = pc.addTrack(track)

        @pc.on("connectionstatechange")
        def on_connection_state_change_teardown() -> None:
            if pc.connectionState in ("failed", "disconnected", "closed"):
                if pc.connectionState != "closed":
                    logger.warning(
                        "Cloudflare Realtime connection %s for track %s; tearing down",
                        pc.connectionState,
                        track_name,
                    )
                asyncio.ensure_future(self._handle_disconnect(pc))

        offer = await pc.createOffer()
        await pc.setLocalDescription(offer)
        await self._wait_for_ice(pc)
        transceiver = next((item for item in pc.getTransceivers() if item.sender is sender), None)
        mid = transceiver.mid if transceiver is not None else "0"

        local_description = {
            "sdp": pc.localDescription.sdp,
            "type": pc.localDescription.type,
        }
        session_id, session_answer = await asyncio.to_thread(self._create_session, local_description)
        await pc.setRemoteDescription(
            RTCSessionDescription(sdp=session_answer["sdp"], type=session_answer["type"])
        )
        await asyncio.to_thread(
            self._publish_track,
            session_id,
            track_name,
            mid,
            local_description,
        )
        with self._lock:
            self._pc = pc
            self._track = track
            self._publication_error = None
        on_ready(session_id, track_name)
        logger.info("Cloudflare Realtime track published for %s", track_name)
        if await self._wait_for_connection(pc):
            logger.info("Cloudflare Realtime session connected for track %s", track_name)
        else:
            logger.warning(
                "Cloudflare Realtime session did not report connected before timeout "
                "(state=%s, ice=%s)",
                pc.connectionState,
                pc.iceConnectionState,
            )

    async def _stop_async(self) -> None:
        with self._lock:
            pc = self._pc
            track = self._track
            self._pc = None
            self._track = None
        if track is not None:
            track.stop_buffering()
            track.stop()
        if pc is not None:
            await self._release_senders(pc)
            await pc.close()

    async def _handle_disconnect(self, pc: Any) -> None:
        """Tear down a publication that lost its WebRTC connection (Req 9.7)."""
        with self._lock:
            if self._pc is not pc:
                return
            track = self._track
            self._pc = None
            self._track = None
            self._publication_error = PUBLICATION_DISCONNECTED_ERROR
        if track is not None:
            track.stop_buffering()
            track.stop()
        await self._release_senders(pc)
        try:
            await pc.close()
        except Exception as exc:
            logger.error("Error closing WebRTC connection after disconnect: %s", exc)

    @staticmethod
    async def _release_senders(pc: Any) -> None:
        """Explicitly stop and detach every local track on the connection."""
        try:
            senders = pc.getSenders()
        except Exception:
            return
        for sender in senders:
            sender_track = getattr(sender, "track", None)
            if sender_track is not None:
                stop = getattr(sender_track, "stop", None)
                if callable(stop):
                    try:
                        stop()
                    except Exception:
                        pass
            replace = getattr(sender, "replaceTrack", None)
            if callable(replace):
                try:
                    await replace(None)
                except Exception:
                    pass

    @property
    def publication_error(self) -> str | None:
        """Return the defined error indication if publishing was interrupted."""
        with self._lock:
            return self._publication_error

    async def _wait_for_ice(self, pc: Any) -> None:
        if pc.iceGatheringState == "complete":
            return
        done = asyncio.Event()

        @pc.on("icegatheringstatechange")
        def on_ice_gathering_state_change() -> None:
            if pc.iceGatheringState == "complete":
                done.set()

        try:
            await asyncio.wait_for(done.wait(), timeout=3)
        except asyncio.TimeoutError:
            pass

    async def _wait_for_connection(self, pc: Any) -> bool:
        if pc.connectionState == "connected":
            return True
        done = asyncio.Event()

        @pc.on("connectionstatechange")
        def on_connection_state_change() -> None:
            if pc.connectionState == "connected":
                done.set()

        try:
            await asyncio.wait_for(done.wait(), timeout=15)
            return True
        except asyncio.TimeoutError:
            return pc.connectionState == "connected"

    def _create_session(self, session_description: dict[str, str]) -> tuple[str, dict[str, str]]:
        url = (
            f"{self.config.cloudflare_realtime_api_base_url}/apps/"
            f"{self.config.cloudflare_realtime_app_id}/sessions/new"
        )
        response = requests.post(
            url,
            headers={"Authorization": f"Bearer {self.config.cloudflare_realtime_app_secret}"},
            json={"sessionDescription": session_description},
            timeout=10,
        )
        self._raise_for_status(response, "create session")
        payload = response.json()
        if payload.get("errorCode"):
            raise RuntimeError(payload.get("errorDescription") or payload["errorCode"])
        answer = payload.get("sessionDescription")
        if not answer:
            raise RuntimeError("Cloudflare Realtime did not return a sessionDescription answer")
        return str(payload["sessionId"]), {"sdp": str(answer["sdp"]), "type": str(answer["type"])}

    def _publish_track(
        self,
        session_id: str,
        track_name: str,
        mid: str,
        session_description: dict[str, str],
    ) -> None:
        url = (
            f"{self.config.cloudflare_realtime_api_base_url}/apps/"
            f"{self.config.cloudflare_realtime_app_id}/sessions/{session_id}/tracks/new"
        )
        body = {
            "sessionDescription": session_description,
            "tracks": [{"location": "local", "mid": mid, "trackName": track_name, "kind": "video"}],
        }
        response = requests.post(
            url,
            headers={"Authorization": f"Bearer {self.config.cloudflare_realtime_app_secret}"},
            json=body,
            timeout=10,
        )
        self._raise_for_status(response, "publish track")
        payload = response.json()
        if payload.get("errorCode"):
            raise RuntimeError(payload.get("errorDescription") or payload["errorCode"])

    @staticmethod
    def _raise_for_status(response: requests.Response, action: str) -> None:
        try:
            response.raise_for_status()
        except requests.HTTPError as exc:
            body = response.text[:500]
            raise RuntimeError(
                f"Cloudflare Realtime {action} failed: HTTP {response.status_code} {body}"
            ) from exc

    @staticmethod
    def _log_future_error(future: "asyncio.Future[Any]") -> None:
        try:
            future.result()
        except Exception as exc:
            logger.error("Cloudflare Realtime publisher error: %s", exc)
