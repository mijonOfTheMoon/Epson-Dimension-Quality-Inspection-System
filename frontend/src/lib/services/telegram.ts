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
  const formattedDate = new Date(detail.timestamp).toLocaleString('id-ID');

  const measurementsText = detail.measurements
    .map(
      (m) =>
        `<b>${m.dimensionName}</b>: ${m.measured} ${m.unit} (Nominal: ${m.nominal}, Toleransi: ${m.lowerLimit} ~ ${m.upperLimit})`,
    )
    .join('\n');

  return (
    `<b>LAPORAN INSPEKSI ${detail.status}</b>\n\n` +
    `<b>Detail Part:</b>\n` +
    `• <b>Nama Part:</b> ${detail.partName}\n` +
    `• <b>Kode Part:</b> ${detail.partCode}\n` +
    `• <b>Status:</b> ${detail.status}\n` +
    `• <b>Station:</b> ${detail.stationId}\n` +
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

  const problemParts = dashboard.problemParts.filter((p) => p.ng > 0);

  const fmtNum = (v: number) => String(Math.round(v * 1000) / 1000);

  const partBlocks = problemParts.map((p) => {
    const vendor = p.vendor ?? vendorByPartCode.get(p.partCode) ?? '-';

    const dimLines = p.dimensions
      .filter((d) => d.ngCount > 0)
      .sort((a, b) => b.ngCount - a.ngCount)
      .map((d) => {
        let dev = '';
        if (d.avgMeasured > d.upperLimit) {
          dev = ` · oversize +${fmtNum(d.avgMeasured - d.upperLimit)}${d.unit}`;
        } else if (d.avgMeasured < d.lowerLimit) {
          dev = ` · undersize -${fmtNum(d.lowerLimit - d.avgMeasured)}${d.unit}`;
        }
        return `   └ ${d.dimensionName}: ${d.ngCount}× NG · rata-rata ${fmtNum(d.avgMeasured)}${d.unit}${dev}`;
      });

    return (
      `<b>${p.partName}</b> · ${p.partCode}\n` +
      `   Vendor ${vendor} · NG ${p.ng}/${p.total} (${p.ngRate.toFixed(1)}%)` +
      (dimLines.length > 0 ? `\n${dimLines.join('\n')}` : '')
    );
  });

  const now = new Date().toLocaleString('id-ID');

  const body =
    problemParts.length > 0
      ? partBlocks.join('\n\n')
      : '✅ Tidak ada part NG pada periode ini.';

  const text =
    `<b>Rekap Kecacatan Inspeksi</b>\n` +
    `${now}\n\n` +
    `${dashboard.total} scan · ${dashboard.ok} OK · <b>${dashboard.ng} NG</b> (${dashboard.ngRate.toFixed(1)}%)\n\n` +
    `━━━━━━━━━━━━━━━\n` +
    `<b>Part Bermasalah</b>\n${body}\n\n` +
    `<i>Otomatis dari Sistem Inspeksi Dimensi Epson</i>`;

  return telegramSendMessage(text);
}
