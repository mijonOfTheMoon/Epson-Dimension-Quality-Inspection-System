use std::collections::HashMap;
use std::sync::Mutex;

use bytes::Bytes;
use tokio::sync::broadcast;

const CHANNEL_CAPACITY: usize = 8;

pub struct VideoHub {
    stations: Mutex<HashMap<String, broadcast::Sender<Bytes>>>,
}

impl VideoHub {
    pub fn new() -> Self {
        Self {
            stations: Mutex::new(HashMap::new()),
        }
    }

    pub fn sender(&self, station_id: &str) -> broadcast::Sender<Bytes> {
        let mut stations = self.stations.lock().expect("video hub poisoned");
        stations
            .entry(station_id.to_string())
            .or_insert_with(|| broadcast::channel(CHANNEL_CAPACITY).0)
            .clone()
    }

    pub fn subscribe(&self, station_id: &str) -> broadcast::Receiver<Bytes> {
        self.sender(station_id).subscribe()
    }
}

impl Default for VideoHub {
    fn default() -> Self {
        Self::new()
    }
}
