export default function Pagination({ page, totalPages, onChange }) {
  if (totalPages <= 1) return null;

  // Chỉ hiện tối đa 5 số trang quanh trang hiện tại
  const start = Math.max(1, Math.min(page - 2, totalPages - 4));
  const end = Math.min(totalPages, start + 4);
  const pages = [];
  for (let i = start; i <= end; i++) pages.push(i);

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 16 }}>
      <button disabled={page === 1} onClick={() => onChange(1)}>Đầu</button>
      <button disabled={page === 1} onClick={() => onChange(page - 1)}>Trước</button>
      {pages.map((p) => (
        <button
          key={p}
          onClick={() => onChange(p)}
          style={p === page ? { background: '#2563eb', color: '#fff' } : {}}
        >
          {p}
        </button>
      ))}
      <button disabled={page === totalPages} onClick={() => onChange(page + 1)}>Sau</button>
      <button disabled={page === totalPages} onClick={() => onChange(totalPages)}>Cuối</button>
      <span>Trang {page}/{totalPages}</span>
    </div>
  );
}
