import json
import os
from collections.abc import Iterable
from pathlib import Path
from typing import Any


class EventBuffer:
    def __init__(self, path: str) -> None:
        self.path = Path(path)

    def append(self, event: dict[str, Any]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True) if self.path.parent != Path(".") else None
        with self.path.open("a", encoding="utf-8") as file:
            file.write(json.dumps(event, separators=(",", ":")) + "\n")

    def read_all(self) -> list[dict[str, Any]]:
        if not self.path.exists():
            return []
        events: list[dict[str, Any]] = []
        with self.path.open("r", encoding="utf-8") as file:
            for line in file:
                line = line.strip()
                if line:
                    events.append(json.loads(line))
        return events

    def replace(self, events: Iterable[dict[str, Any]]) -> None:
        temp = self.path.with_suffix(self.path.suffix + ".tmp")
        with temp.open("w", encoding="utf-8") as file:
            for event in events:
                file.write(json.dumps(event, separators=(",", ":")) + "\n")
        os.replace(temp, self.path)

    def clear(self) -> None:
        if self.path.exists():
            self.path.unlink()
