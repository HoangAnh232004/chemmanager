import './PlasticReport.css';

const fmt = (n) => (Number(n) || 0).toLocaleString('vi-VN', { maximumFractionDigits: 2 });

// Ô số nhập kiểu bảng tính: không controlled để gõ không giật, blur mới lưu
function NumCell({ value, disabled, onSave }) {
  return (
    <input
      type="number"
      step="any"
      className="pl-num"
      defaultValue={value || ''}
      key={String(value)}
      disabled={disabled}
      onBlur={(e) => {
        const raw = e.target.value;
        const n = raw === '' ? 0 : Number(raw);
        if (!Number.isNaN(n) && n !== (value || 0)) onSave(n);
      }}
      onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
    />
  );
}

// Tồn theo bộ phận (file riêng, 1 ô riêng trên trang chủ).
// TỒN ĐẦU + NHẬP nhập tay, SỬ DỤNG tự tính = tổng nhóm, CÒN LẠI = TỒN ĐẦU + NHẬP - SỬ DỤNG.
export default function PlasticStock({ GROUPS, stockRow, closed, saveStock }) {
  return (
    <section className="pl-section">
      <h3>Tồn theo bộ phận</h3>
      <table>
        <thead><tr><th>Bộ phận</th><th>Tồn đầu</th><th>Nhập</th><th>Sử dụng trong tháng</th><th>Còn lại</th></tr></thead>
        <tbody>
          {GROUPS.map((g) => {
            const s = stockRow(g);
            return (
              <tr key={g}>
                <td>{g === 'NL1' ? 'NL1 + Sample' : 'NL2 + Sample'}</td>
                <td><NumCell value={s.opening} disabled={closed} onSave={(n) => saveStock(g, n, s.imp)} /></td>
                <td><NumCell value={s.imp} disabled={closed} onSave={(n) => saveStock(g, s.opening, n)} /></td>
                <td>{fmt(s.used)}</td>
                <td>{fmt(s.remain)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
