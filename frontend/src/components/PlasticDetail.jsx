import { Fragment } from 'react';
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

// Bảng chi tiết sử dụng nhựa theo ngày (file riêng).
// Số liệu, hàm tính tổng và hàm lưu nhận từ trang tường tổng hợp (PlasticReport).
export default function PlasticDetail({ py, pm, daysInMonth, dayKey, cell, dayProd, daySample, colSum, groupTotal, monthTotal, closed, saveDay, ITEMS, GROUPS }) {
  return (
    <>
      <div className="pl-detail-wrap">
        <table className="pl-detail">
          <thead>
            <tr>
              <th rowSpan={3}>Ngày xuất</th>
              <th colSpan={11}>BULK / PRODUCTION</th>
              <th colSpan={12}>SAMPLE</th>
            </tr>
            <tr>
              <th colSpan={6}>NGUYÊN LIỆU 1</th>
              <th colSpan={5}>NGUYÊN LIỆU 2</th>
              <th colSpan={6}>NGUYÊN LIỆU 1</th>
              <th colSpan={6}>NGUYÊN LIỆU 2</th>
            </tr>
            <tr>
              {ITEMS.NL1.production.map((it) => <th key={`p1-${it}`}>{it}</th>)}<th>TOTAL</th>
              {ITEMS.NL2.production.map((it) => <th key={`p2-${it}`}>{it}</th>)}<th>TOTAL</th>
              {ITEMS.NL1.sample.map((it) => <th key={`s1-${it}`}>{it}</th>)}<th>TOTAL</th>
              {ITEMS.NL2.sample.map((it) => <th key={`s2-${it}`}>{it}</th>)}<th>TOTAL</th>
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((d) => {
              const day = dayKey(d);
              return (
                <tr key={day}>
                  <td className="pl-sticky">{d}/{Number(pm)}/{py}</td>
                  {GROUPS.map((g) => (
                    <Fragment key={`p-${g}`}>
                      {ITEMS[g].production.map((it) => (
                        <td key={it}>
                          <NumCell value={cell(day, g, 'production', it)} disabled={closed}
                            onSave={(n) => saveDay(day, g, 'production', it, n)} />
                        </td>
                      ))}
                      <td className="pl-total">{fmt(dayProd(day, g))}</td>
                    </Fragment>
                  ))}
                  {GROUPS.map((g) => (
                    <Fragment key={`s-${g}`}>
                      {ITEMS[g].sample.map((it) => (
                        <td key={it}>
                          <NumCell value={cell(day, g, 'sample', it)} disabled={closed}
                            onSave={(n) => saveDay(day, g, 'sample', it, n)} />
                        </td>
                      ))}
                      <td className="pl-total">{fmt(daySample(day, g))}</td>
                    </Fragment>
                  ))}
                </tr>
              );
            })}
            <tr className="pl-total-row">
              <td>TOTAL</td>
              {GROUPS.map((g) => (
                <Fragment key={`tp-${g}`}>
                  {ITEMS[g].production.map((it) => <td key={it}>{fmt(colSum(g, 'production', it))}</td>)}
                  <td>{fmt(ITEMS[g].production.reduce((s, it) => s + colSum(g, 'production', it), 0))}</td>
                </Fragment>
              ))}
              {GROUPS.map((g) => (
                <Fragment key={`ts-${g}`}>
                  {ITEMS[g].sample.map((it) => <td key={it}>{fmt(colSum(g, 'sample', it))}</td>)}
                  <td>{fmt(ITEMS[g].sample.reduce((s, it) => s + colSum(g, 'sample', it), 0))}</td>
                </Fragment>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      <div className="pl-sumlines">
        <div>NGUYÊN LIỆU 1 (Sản Xuất + Sample): <b>{fmt(groupTotal('NL1'))} kg</b></div>
        <div>NGUYÊN LIỆU 2 (Sản Xuất + Sample): <b>{fmt(groupTotal('NL2'))} kg</b></div>
        <div>TOTAL (NL1 + NL2): <b>{fmt(monthTotal)} kg</b></div>
      </div>
    </>
  );
}
