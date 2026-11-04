// Tạo hash chống trùng giao dịch ngân hàng
export async function generateDedupeHash(
  bankCode: string,
  accountMask: string,
  amount: number,
  type: string,
  occurredAt: string,
  description: string
): Promise<string> {
  // Làm tròn thời gian đến mức 5 phút để tránh lệch mili-giây giữa các nguồn
  const dateObj = new Date(occurredAt);
  const roundedMinutes = Math.floor(dateObj.getMinutes() / 5) * 5;
  const timeKey = `${dateObj.getFullYear()}-${dateObj.getMonth() + 1}-${dateObj.getDate()} ${dateObj.getHours()}:${roundedMinutes}`;

  const rawKey = `${bankCode.toUpperCase()}_${accountMask}_${amount}_${type}_${timeKey}_${description.slice(0, 30).trim().toUpperCase()}`;

  // Sử dụng Web Crypto API (chuẩn tương thích Cloudflare Workers)
  const encoder = new TextEncoder();
  const data = encoder.encode(rawKey);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}
