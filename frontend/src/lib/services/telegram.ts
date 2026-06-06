import { api } from './api';

const TELEGRAM_BOT_TOKEN =
  import.meta.env.VITE_TELEGRAM_BOT_TOKEN || '8749458055:AAEWmBVETyDg8QxdjRNjwnG2G37mPiaqD4w';
const TELEGRAM_CHAT_ID =
  import.meta.env.VITE_TELEGRAM_CHAT_ID || '-5201350124';

interface MeasurementLike {
  dimensionName: string;
  measured: number;
  nominal: number;
  lowerLimit: number;
  upperLimit: number;
  unit: string;
  status: string;
}

interface InspectionLike {
  id: string;
  partName: string;
  partCode: string;
  status: string;
  stationId: string;
  operatorName: string;
  timestamp: string;
  confidenceScore: number;
  measurements: MeasurementLike[];
  frameUrl?: string | null;
}

async function telegramSendMessage(text: string): Promise<boolean> {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text,
      parse_mode: 'HTML',
    }),
  });
  return res.ok;
}

async function telegramSendPhoto(caption: string, imageBlob: Blob): Promise<boolean> {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`;
  const formData = new FormData();
  formData.append('chat_id', TELEGRAM_CHAT_ID);
  formData.append('photo', imageBlob, 'frame.jpg');
  formData.append('caption', caption);
  formData.append('parse_mode', 'HTML');

  const res = await fetch(url, { method: 'POST', body: formData });
  return res.ok;
}

async function fetchFrameBlob(detail: InspectionLike): Promise<Blob | null> {
  if (!detail.frameUrl) return null;
  try {
    const { frameUrl } = await api.refreshFrameUrl(detail.id);
    const res = await fetch(frameUrl);
    if (res.ok) return await res.blob();
  } catch (err) {
    console.warn('Gagal mengambil gambar frame, kirim teks saja:', err);
  }
  return null;
}

function buildInspectionCaption(detail: InspectionLike): string {
  const statusEmoji = detail.status === 'OK' ? '✅' : '🚨';
  const formattedDate = new Date(detail.timestamp).toLocaleString('id-ID');

  const measurementsText = detail.measurements
    .map(
      (m) =>
        `<b>${m.dimensionName}</b>: ${m.measured} ${m.unit} (Nominal: ${m.nominal}, Toleransi: ${m.lowerLimit} ~ ${m.upperLimit})`,
    )
    .join('\n');

  return (
    `${statusEmoji} <b>LAPORAN INSPEKSI ${detail.status}</b> ${statusEmoji}\n\n` +
    `<b>Detail Part:</b>\n` +
    `• <b>Nama Part:</b> ${detail.partName}\n` +
    `• <b>Kode Part:</b> ${detail.partCode}\n` +
    `• <b>Status:</b> ${detail.status}\n` +
    `• <b>Stasiun:</b> ${detail.stationId}\n` +
    `• <b>Operator:</b> ${detail.operatorName}\n` +
    `• <b>Waktu:</b> ${formattedDate}\n` +
    `• <b>Confidence:</b> ${detail.confidenceScore}%\n\n` +
    `<b>Hasil Pengukuran:</b>\n${measurementsText || 'Tidak ada data pengukuran.'}`
  );
}

export async function sendInspectionToTelegram(detail: InspectionLike): Promise<boolean> {
  const caption = buildInspectionCaption(detail);
  const imageBlob = await fetchFrameBlob(detail);

  if (imageBlob) {
    try {
      if (await telegramSendPhoto(caption, imageBlob)) return true;
    } catch (err) {
      console.warn('sendPhoto gagal, fallback ke sendMessage:', err);
    }
  }

  return telegramSendMessage(caption);
}

export async function sendNgSummaryToTelegram(): Promise<boolean> {
  const [dashboard, parts] = await Promise.all([
    api.getDashboardSummary(),
    api.getParts(),
  ]);

  const vendorByPartCode = new Map(parts.map((p) => [p.partCode, p.vendor]));

  const partLines = dashboard.partRisk
    .filter((p) => p.ng > 0)
    .sort((a, b) => b.ngRate - a.ngRate)
    .map((p) => {
      const vendor = vendorByPartCode.get(p.partCode) ?? '-';
      return `• <b>${p.partName}</b> (${p.partCode}) — Vendor: <b>${vendor}</b>\n  Total scan: ${p.total}, NG: <b>${p.ng}</b> (${p.ngRate.toFixed(1)}%)`;
    });

  const dimLines = dashboard.failingDimensions
    .filter((d) => d.ngCount > 0)
    .sort((a, b) => b.ngCount - a.ngCount)
    .map((d) => {
      const vendor = vendorByPartCode.get(d.partCode) ?? '-';
      return `• <b>${d.partName}</b> (Vendor: ${vendor})\n  Dimensi: <b>${d.dimensionName}</b> — NG: <b>${d.ngCount}</b> dari ${d.totalCount} scan (${d.ngRate.toFixed(1)}%)`;
    });

  const now = new Date().toLocaleString('id-ID');

  const text =
    `🚨 <b>REKAP KECACATAN INSPEKSI</b> 🚨\n` +
    `📅 ${now}\n\n` +
    `<b>Ringkasan:</b>\n` +
    `• Total Inspeksi: <b>${dashboard.total}</b>\n` +
    `• OK: <b>${dashboard.ok}</b>\n` +
    `• NG: <b>${dashboard.ng}</b>\n` +
    `• NG Rate: <b>${dashboard.ngRate.toFixed(1)}%</b>\n\n` +
    `━━━━━━━━━━━━━━━━━━━\n` +
    `<b>Part Berisiko Tinggi:</b>\n${partLines.length > 0 ? partLines.join('\n\n') : 'Tidak ada data.'}\n\n` +
    `━━━━━━━━━━━━━━━━━━━\n` +
    `<b>Detail Kecacatan per Dimensi:</b>\n${dimLines.length > 0 ? dimLines.join('\n\n') : 'Tidak ada data.'}\n\n` +
    `<i>— Dikirim otomatis oleh Sistem Inspeksi Dimensi Epson</i>`;

  return telegramSendMessage(text);
}
