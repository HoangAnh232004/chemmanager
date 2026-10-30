import './PlasticReport.css';

const fmt = (n) => (Number(n) || 0).toLocaleString('vi-VN', { maximumFractionDigits: 2 });
const fmtDateShort = (v) => {
  if (!v) return '—';
  if (v instanceof Date) return `${v.getDate()}/${v.getMonth() + 1}/${v.getFullYear()}`;
  const s = String(v).slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s.split('-').reverse().join('/');
  return s;
};

// Lưu trữ báo cáo sử dụng nhựa (file riêng, 1 ô riêng trên trang chủ).
// Bấm Xem thì trang vỏ bọc sẽ hiện bảng chi tiết của tháng đã chốt (chỉ xem).
export default function PlasticArchive({ archived, onView }) {
  return (
    <section className="pl-section">
      <h3>Lưu trữ báo cáo sử dụng nhựa</h3>
      {archived.length === 0 ? (
        <p>Chưa có tháng nào được chốt.</p>
      ) : (
        <table>
          <thead><tr><th>Kỳ</th><th>Tổng sử dụng</th><th>Ngày chốt</th><th></th></tr></thead>
          <tbody>
            {archived.map((a) => (
              <tr key={a.period}>
                <td>{`Tháng ${Number(a.period.split('-')[1])}/${a.period.split('-')[0]}`}</td>
                <td>{fmt(a.total)} kg</td>
                <td>{fmtDateShort(a.closed_at)}</td>
                <td><button onClick={() => onView(a.period)}>Xem</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
