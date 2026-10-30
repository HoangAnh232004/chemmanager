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

// Số lượng kho nguyên liệu xuất trong tháng theo tuần (file riêng, 1 ô riêng trên trang chủ).
export default function PlasticWeekly({ GROUPS, WEEKLY_ITEMS, wkMap, wkTotal, closed, saveWeekly }) {
  return (
    <section className="pl-section">
      <h3>Số lượng kho nguyên liệu xuất trong tháng (theo tuần)</h3>
      <table>
        <thead><tr><th>Nhóm</th><th>Item</th><th>Tuần 1</th><th>Tuần 2</th><th>Tuần 3</th><th>Tuần 4</th><th>TOTAL</th></tr></thead>
        <tbody>
          {GROUPS.map((g) => WEEKLY_ITEMS[g].map((it) => (
            <tr key={`${g}-${it}`}>
              <td>{g === 'NL1' ? 'Nguyên liệu 1' : 'Nguyên liệu 2'}</td>
              <td>{it}</td>
              {[1, 2, 3, 4].map((w) => (
                <td key={w}>
                  <NumCell value={wkMap[`${g}|${it}|${w}`] || 0} disabled={closed}
                    onSave={(n) => saveWeekly(g, it, w, n)} />
                </td>
              ))}
              <td className="pl-total">{fmt(wkTotal(g, it))}</td>
            </tr>
          )))}
        </tbody>
      </table>
    </section>
  );
}
