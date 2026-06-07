export const MAX_AVATAR_FILE_BYTES = 5 * 1024 * 1024;

const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Gagal membaca file gambar.'));
    };
    img.src = url;
  });
}

export async function fileToAvatarBlob(
  file: File,
  size = 256,
  quality = 0.85,
): Promise<Blob> {
  if (!ACCEPTED_TYPES.includes(file.type)) {
    throw new Error('File harus berupa gambar.');
  }
  if (file.size > MAX_AVATAR_FILE_BYTES) {
    throw new Error('Ukuran gambar maksimal 5 MB.');
  }

  const img = await loadImage(file);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Browser tidak mendukung pemrosesan gambar.');
  }

  const edge = Math.min(img.naturalWidth, img.naturalHeight);
  const sx = (img.naturalWidth - edge) / 2;
  const sy = (img.naturalHeight - edge) / 2;
  ctx.drawImage(img, sx, sy, edge, edge, 0, 0, size, size);

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, 'image/jpeg', quality);
  });
  if (!blob) {
    throw new Error('Browser tidak mendukung pemrosesan gambar.');
  }

  return blob;
}
