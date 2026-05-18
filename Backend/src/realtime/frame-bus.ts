export type FrameListener = (stationId: string, frame: Buffer) => void;

export class FrameBus {
  private readonly latest = new Map<string, Buffer>();
  private readonly listeners = new Set<FrameListener>();

  publish(stationId: string, frame: Buffer) {
    this.latest.set(stationId, frame);
    for (const listener of this.listeners) listener(stationId, frame);
  }

  subscribe(listener: FrameListener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  snapshot(): Array<[string, Buffer]> {
    return [...this.latest.entries()];
  }

  forget(stationId: string) {
    this.latest.delete(stationId);
  }
}

export function encodeFramePacket(stationId: string, frame: Buffer): Buffer {
  const idBytes = Buffer.from(stationId, 'utf8');
  if (idBytes.length > 0xffff) throw new Error('stationId too long');
  const header = Buffer.allocUnsafe(2);
  header.writeUInt16BE(idBytes.length, 0);
  return Buffer.concat([header, idBytes, frame]);
}
