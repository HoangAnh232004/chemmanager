import './PlasticReport.css';

const fmt = (n) => (Number(n) || 0).toLocaleString('vi-VN', { maximumFractionDigits: 2 });

// Bảng tổng hợp sử dụng nhựa theo ngày (file riêng).
// Số liệu và hàm tính tổng nhận từ trang tường tổng hợp (PlasticReport).
export default function PlasticSummary({ py, pm, daysInMonth, dayKey, dayProd, daySample, colSum, groupTotal, ITEMS }) {
  return (
    <section className="pl-section">
      <h3>Bảng tổng hợp theo ngày</h3>
      <table>
        <thead><tr><th>Ngày xuất</th><th>Nguyên liệu 1</th><th>Nguyên liệu 2</th><th>Sample NL1</th><th>Sample NL2</th></tr></thead>
        <tbody>
          {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((d) => {
            const day = dayKey(d);
            return (
              <tr key={day}>
                <td>{d}/{Number(pm)}/{py}</td>
                <td>{fmt(dayProd(day, 'NL1'))}</td>
                <td>{fmt(dayProd(day, 'NL2'))}</td>
                <td>{fmt(daySample(day, 'NL1'))}</td>
                <td>{fmt(daySample(day, 'NL2'))}</td>
              </tr>
            );
          })}
          <tr className="pl-total-row">
            <td>Total</td>
            <td>{fmt(ITEMS.NL1.production.reduce((s, it) => s + colSum('NL1', 'production', it), 0))}</td>
            <td>{fmt(ITEMS.NL2.production.reduce((s, it) => s + colSum('NL2', 'production', it), 0))}</td>
            <td>{fmt(ITEMS.NL1.sample.reduce((s, it) => s + colSum('NL1', 'sample', it), 0))}</td>
            <td>{fmt(ITEMS.NL2.sample.reduce((s, it) => s + colSum('NL2', 'sample', it), 0))}</td>
          </tr>
        </tbody>
      </table>
      <div className="pl-sumlines">
        <div>TOTAL Nguyên Liệu 1: <b>{fmt(groupTotal('NL1'))} kg</b></div>
        <div>TOTAL Nguyên Liệu 2: <b>{fmt(groupTotal('NL2'))} kg</b></div>
      </div>
    </section>
  );
}
