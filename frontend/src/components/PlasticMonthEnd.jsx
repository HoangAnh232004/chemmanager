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

// Tổng kết cuối tháng nguyên liệu 1 và nguyên liệu 2 (file riêng).
// NL/SAMPLE tự tính từ bảng chi tiết, CÒN LẠI = STOCK OUT + TRẢ HÀNG - (NL + SAMPLE).
// Hàm tính và hàm lưu nhận từ trang tường tổng hợp (PlasticReport).
export default function PlasticMonthEnd({ MONTH_END_ITEMS, meRow, closed, saveMonthEnd }) {
  const GROUPS = ['NL1', 'NL2'];
  return (
    <>
      {GROUPS.map((g) => {
        const items = MONTH_END_ITEMS[g];
        const tot = items.reduce((acc, it) => {
          const r = meRow(g, it);
          return { nl: acc.nl + r.nl, sample: acc.sample + r.sample, total: acc.total + r.total, stockOut: acc.stockOut + r.stockOut, ret: acc.ret + r.ret, remain: acc.remain + r.remain };
        }, { nl: 0, sample: 0, total: 0, stockOut: 0, ret: 0, remain: 0 });
        return (
          <section className="pl-section" key={`me-${g}`}>
            <h3>Tổng kết cuối tháng — Nguyên liệu {g === 'NL1' ? '1' : '2'}</h3>
            <table>
              <thead><tr><th>ITEM</th><th>STOCK OUT</th><th>TRẢ HÀNG</th><th>NL</th><th>SAMPLE</th><th>NL+SAMPLE</th><th>LƯỢNG CÒN LẠI</th></tr></thead>
              <tbody>
                {items.map((it) => {
                  const r = meRow(g, it);
                  return (
                    <tr key={it}>
                      <td>{it}</td>
                      <td><NumCell value={r.stockOut} disabled={closed} onSave={(n) => saveMonthEnd(g, it, n, r.ret)} /></td>
                      <td><NumCell value={r.ret} disabled={closed} onSave={(n) => saveMonthEnd(g, it, r.stockOut, n)} /></td>
                      <td>{fmt(r.nl)}</td>
                      <td>{fmt(r.sample)}</td>
                      <td>{fmt(r.total)}</td>
                      <td>{fmt(r.remain)}</td>
                    </tr>
                  );
                })}
                <tr className="pl-total-row">
                  <td>TOTAL</td>
                  <td>{fmt(tot.stockOut)}</td>
                  <td>{fmt(tot.ret)}</td>
                  <td>{fmt(tot.nl)}</td>
                  <td>{fmt(tot.sample)}</td>
                  <td>{fmt(tot.total)}</td>
                  <td>{fmt(tot.remain)}</td>
                </tr>
              </tbody>
            </table>
          </section>
        );
      })}
    </>
  );
}
