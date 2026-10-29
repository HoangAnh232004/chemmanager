// Hàm dùng chung cho frontend.

// Che Gmail: chỉ hiện 2 chữ đầu và 2 chữ cuối của phần tên trước @,
// còn lại là *, phần @domain giữ nguyên để vẫn nhận ra là Gmail nào.
// Vd: nguyennhan26052019@gmail.com → ng************19@gmail.com
export function maskEmail(email) {
  if (!email || !email.includes('@')) return email || '—';
  const at = email.indexOf('@');
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (local.length <= 4) return `${local.slice(0, 1)}***@${domain}`;
  return `${local.slice(0, 2)}${'*'.repeat(local.length - 4)}${local.slice(-2)}@${domain}`;
}
