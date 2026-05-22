use bytes::{BufMut, Bytes, BytesMut};
use dashmap::DashMap;
use tokio::sync::broadcast;

pub struct FrameBus {
    latest: DashMap<String, Bytes>,
    latest_raw: DashMap<String, Bytes>,
    headers: DashMap<String, Bytes>,
    tx: broadcast::Sender<(String, Bytes)>,
}

impl FrameBus {
    pub fn new() -> Self {
        let (tx, _) = broadcast::channel(1024);
        Self {
            latest: DashMap::new(),
            latest_raw: DashMap::new(),
            headers: DashMap::new(),
            tx,
        }
    }

    pub fn publish(&self, station_id: &str, frame: Bytes) -> anyhow::Result<()> {
        self.latest_raw.insert(station_id.to_string(), frame.clone());
        let packet = self.encode_packet(station_id, frame)?;
        self.latest.insert(station_id.to_string(), packet.clone());
        let _ = self.tx.send((station_id.to_string(), packet));
        Ok(())
    }

    pub fn subscribe(&self) -> broadcast::Receiver<(String, Bytes)> {
        self.tx.subscribe()
    }

    pub fn latest(&self, station_id: &str) -> Option<Bytes> {
        self.latest.get(station_id).map(|entry| entry.value().clone())
    }

    pub fn latest_raw(&self, station_id: &str) -> Option<Bytes> {
        self.latest_raw.get(station_id).map(|entry| entry.value().clone())
    }

    pub fn forget(&self, station_id: &str) {
        self.latest.remove(station_id);
        self.latest_raw.remove(station_id);
        self.headers.remove(station_id);
    }

    fn encode_packet(&self, station_id: &str, frame: Bytes) -> anyhow::Result<Bytes> {
        let header = self.header(station_id)?;
        let mut out = BytesMut::with_capacity(header.len() + frame.len());
        out.put_slice(header.as_ref());
        out.put_slice(frame.as_ref());
        Ok(out.freeze())
    }

    fn header(&self, station_id: &str) -> anyhow::Result<Bytes> {
        if let Some(header) = self.headers.get(station_id) {
            return Ok(header.value().clone());
        }

        let id_bytes = station_id.as_bytes();
        if id_bytes.len() > u16::MAX as usize {
            anyhow::bail!("stationId too long");
        }
        let mut header = BytesMut::with_capacity(2 + id_bytes.len());
        header.put_u16(id_bytes.len() as u16);
        header.put_slice(id_bytes);
        let bytes = header.freeze();
        self.headers.insert(station_id.to_string(), bytes.clone());
        Ok(bytes)
    }
}

impl Default for FrameBus {
    fn default() -> Self {
        Self::new()
    }
}
