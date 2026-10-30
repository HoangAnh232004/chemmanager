import { useState, useEffect } from 'react';
import api from '../api';
import ConfirmModal from './ConfirmModal';
import PlasticDetail from './PlasticDetail';
import PlasticSummary from './PlasticSummary';
import PlasticMonthEnd from './PlasticMonthEnd';
import PlasticStock from './PlasticStock';
import PlasticWeekly from './PlasticWeekly';
import PlasticArchive from './PlasticArchive';
import './PlasticReport.css';

// Mã nhựa đúng cột trong file Excel mẫu của user.
// Lưu ý: sample NL1 dùng 'SB-100' (có gạch nối), khác 'SB100' bên sản xuất.
const ITEMS = {
  NL1: {
    production: ['SB100', '640EW', '655HIM-G', '655HIM-A', 'BF-670'],
    sample: ['640EW', 'BF-670', '655HIM-A', '655HIM-G', 'SB-100'],
  },
  NL2: {
    production: ['620L', 'RB-110', 'BF-670', 'BT-600'],
    sample: ['620L', 'RB-110', '640EW', 'BF-670', 'BT-600'],
  },
};
// Bảng tổng kết cuối tháng: 640C2P chỉ có ở bảng này/tuần, không có số liệu chi tiết.
const MONTH_END_ITEMS = {
  NL1: ['SB100', '640EW', '655HIM-G', '655HIM-A', 'BF-670', '640C2P'],
  NL2: ['620L', 'RB-110', 'BF-670', 'BT-600'],
};
const WEEKLY_ITEMS = {
  NL1: ['640EW', '655HIM-G', 'BF-670', '655HIM-A', '640C2P', 'SB-100'],
  NL2: ['620L', 'BF-670', 'BT-600', 'RB-110'],
};
const GROUPS = ['NL1', 'NL2'];

const TITLES = {
  detail: 'Báo cáo nhựa',
  summary: 'Bảng tổng hợp theo ngày',
  monthend: 'Tổng kết cuối tháng',
  stock: 'Tồn theo bộ phận',
  weekly: 'Số lượng kho nguyên liệu xuất trong tháng',
  archive: 'Lưu trữ báo cáo nhựa',
};

const fmtDay = (iso) => {
  const [y, m, d] = iso.split('-');
  return `${Number(d)}/${Number(m)}/${y}`;
};
// Mã sample tương ứng với mã tổng kết (chỉ SB100 khác tên: sample là SB-100)
const sampleItemOf = (item) => (item === 'SB100' ? 'SB-100' : item);

// Trang vỏ bọc cho từng ô báo cáo nhựa riêng: mỗi tab chỉ hiện đúng 1 phần,
// không gộp chung nữa. Số liệu, hàm tính tổng và hàm lưu giữ ở đây, các phần
// hiển thị nằm ở file riêng (PlasticDetail/Summary/MonthEnd/Stock/Weekly/Archive).
export default function PlasticPage({ signal, user, section }) {
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState(false);
  const [archived, setArchived] = useState([]);
  const [viewingArchive, setViewingArchive] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const isAdmin = user?.role === 'admin';

  const loadCurrent = async () => {
    try {
      const { data: d } = await api.get('/plastic/current');
      setData(d);
      setLoadError(false);
    } catch (err) {
      setLoadError(true);
    }
    try {
      const { data: p } = await api.get('/plastic/periods');
      setArchived(p || []);
    } catch (err) { /* kệ, chỉ mất danh sách lưu trữ */ }
    setViewingArchive(false);
  };

  useEffect(() => { loadCurrent(); }, [signal]);

  const loadPeriod = async (period) => {
    try {
      const { data: d } = await api.get(`/plastic/${period}`);
      setData(d);
      setViewingArchive(true);
    } catch (err) {
      alert('Không mở được tháng này');
    }
  };

  const period = data?.period || '';
  const closed = data?.status === 'closed';
  const [py, pm] = period ? period.split('-') : ['', ''];
  const daysInMonth = period ? new Date(Number(py), Number(pm), 0).getDate() : 0;
  const dayKey = (d) => `${period}-${String(d).padStart(2, '0')}`;

  // Map số liệu ngày: "YYYY-MM-DD|NL1|production|SB100" -> qty
  const dayMap = {};
  (data?.days || []).forEach((r) => {
    dayMap[`${String(r.day).slice(0, 10)}|${r.grp}|${r.kind}|${r.item}`] = Number(r.qty) || 0;
  });
  const cell = (day, grp, kind, item) => dayMap[`${day}|${grp}|${kind}|${item}`] || 0;
  const colSum = (grp, kind, item) => {
    let s = 0;
    for (let d = 1; d <= daysInMonth; d++) s += cell(dayKey(d), grp, kind, item);
    return s;
  };
  const dayProd = (day, grp) => ITEMS[grp].production.reduce((s, it) => s + cell(day, grp, 'production', it), 0);
  const daySample = (day, grp) => ITEMS[grp].sample.reduce((s, it) => s + cell(day, grp, 'sample', it), 0);
  const groupTotal = (grp) =>
    ITEMS[grp].production.reduce((s, it) => s + colSum(grp, 'production', it), 0) +
    ITEMS[grp].sample.reduce((s, it) => s + colSum(grp, 'sample', it), 0);
  const monthTotal = groupTotal('NL1') + groupTotal('NL2');

  // Tổng kết cuối tháng: NL/SAMPLE tự tính từ bảng chi tiết,
  // CÒN LẠI = STOCK OUT + TRẢ HÀNG - (NL + SAMPLE)
  const meMap = {};
  (data?.monthEnd || []).forEach((r) => { meMap[`${r.grp}|${r.item}`] = r; });
  const meRow = (grp, item) => {
    const nl = colSum(grp, 'production', item);
    const sample = colSum(grp, 'sample', sampleItemOf(item));
    const me = meMap[`${grp}|${item}`] || {};
    const stockOut = Number(me.stock_out) || 0;
    const ret = Number(me.return_qty) || 0;
    return { nl, sample, total: nl + sample, stockOut, ret, remain: stockOut + ret - (nl + sample) };
  };

  // Tồn theo bộ phận: SỬ DỤNG tự tính = tổng nhóm, CÒN LẠI = TỒN ĐẦU + NHẬP - SỬ DỤNG
  const stockMap = {};
  (data?.stock || []).forEach((r) => { stockMap[r.grp] = r; });
  const stockRow = (grp) => {
    const opening = Number(stockMap[grp]?.opening) || 0;
    const imp = Number(stockMap[grp]?.import_qty) || 0;
    const used = groupTotal(grp);
    return { opening, imp, used, remain: opening + imp - used };
  };

  // Xuất kho theo tuần
  const wkMap = {};
  (data?.weekly || []).forEach((r) => { wkMap[`${r.grp}|${r.item}|${r.week}`] = Number(r.qty) || 0; });
  const wkTotal = (grp, item) => [1, 2, 3, 4].reduce((s, w) => s + (wkMap[`${grp}|${item}|${w}`] || 0), 0);

  const saveDay = async (day, grp, kind, item, qty) => {
    try {
      await api.put('/plastic/day', { period, day, grp, kind, item, qty });
      loadCurrent();
    } catch (err) {
      alert(err.response?.data?.message || 'Lưu thất bại');
    }
  };
  const saveStock = async (grp, opening, importQty) => {
    try {
      await api.put('/plastic/stock', { period, grp, opening, import_qty: importQty });
      loadCurrent();
    } catch (err) {
      alert(err.response?.data?.message || 'Lưu thất bại');
    }
  };
  const saveWeekly = async (grp, item, week, qty) => {
    try {
      await api.put('/plastic/weekly', { period, week, grp, item, qty });
      loadCurrent();
    } catch (err) {
      alert(err.response?.data?.message || 'Lưu thất bại');
    }
  };
  const saveMonthEnd = async (grp, item, stockOut, returnQty) => {
    try {
      await api.put('/plastic/month-end', { period, grp, item, stock_out: stockOut, return_qty: returnQty });
      loadCurrent();
    } catch (err) {
      alert(err.response?.data?.message || 'Lưu thất bại');
    }
  };
  const closeMonth = async () => {
    try {
      const { data: r } = await api.post('/plastic/close', { period });
      alert(r.message);
      setConfirmClose(false);
      loadCurrent();
    } catch (err) {
      alert(err.response?.data?.message || 'Chốt tháng thất bại');
    }
  };
  const exportCSV = () => {
    if (!data) return;
    const head = ['Ngày xuất'];
    GROUPS.forEach((g) => {
      ITEMS[g].production.forEach((it) => head.push(`SX ${g} ${it}`));
      head.push(`SX ${g} TOTAL`);
    });
    GROUPS.forEach((g) => {
      ITEMS[g].sample.forEach((it) => head.push(`Sample ${g} ${it}`));
      head.push(`Sample ${g} TOTAL`);
    });
    const lines = [head.join(',')];
    for (let d = 1; d <= daysInMonth; d++) {
      const day = dayKey(d);
      const row = [fmtDay(day)];
      GROUPS.forEach((g) => {
        ITEMS[g].production.forEach((it) => row.push(cell(day, g, 'production', it) || ''));
        row.push(dayProd(day, g) || '');
      });
      GROUPS.forEach((g) => {
        ITEMS[g].sample.forEach((it) => row.push(cell(day, g, 'sample', it) || ''));
        row.push(daySample(day, g) || '');
      });
      lines.push(row.join(','));
    }
    const totalRow = ['TOTAL'];
    GROUPS.forEach((g) => {
      ITEMS[g].production.forEach((it) => totalRow.push(colSum(g, 'production', it) || ''));
      totalRow.push(ITEMS[g].production.reduce((s, it) => s + colSum(g, 'production', it), 0) || '');
    });
    GROUPS.forEach((g) => {
      ITEMS[g].sample.forEach((it) => totalRow.push(colSum(g, 'sample', it) || ''));
      totalRow.push(ITEMS[g].sample.reduce((s, it) => s + colSum(g, 'sample', it), 0) || '');
    });
    lines.push(totalRow.join(','));
    lines.push(`NGUYÊN LIỆU 1 (Sản Xuất + Sample),${groupTotal('NL1')}`);
    lines.push(`NGUYÊN LIỆU 2 (Sản Xuất + Sample),${groupTotal('NL2')}`);
    lines.push(`TOTAL (NL1 + NL2),${monthTotal}`);
    const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `bao-cao-nhua-${period}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  if (loadError) {
    return (
      <div className="tab-scroll">
        <h2>{TITLES[section] || 'Báo cáo nhựa'}</h2>
        <p>Chưa tải được dữ liệu. Kiểm tra backend đã có file <b>backend/routes/plastic.js</b> và đã gắn mount <b>/api/plastic</b> trong <b>server.js</b> rồi restart backend chưa.</p>
        <button onClick={loadCurrent}>Thử lại</button>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="tab-scroll">
        <h2>{TITLES[section] || 'Báo cáo nhựa'}</h2>
        <p>Đang tải...</p>
      </div>
    );
  }

  const detailProps = {
    py, pm, daysInMonth, dayKey, cell, dayProd, daySample, colSum,
    groupTotal, monthTotal, closed, saveDay, ITEMS, GROUPS,
  };

  return (
    <div className="tab-scroll">
      <h2>{TITLES[section] || 'Báo cáo nhựa'}</h2>
      <div className="pl-bar">
        <span className="pl-period">Kỳ: <b>{data.periodLabel}</b>{closed ? ' — Đã chốt' : ''}</span>
        {viewingArchive && <button onClick={loadCurrent}>{section === 'archive' ? '← Quay lại lưu trữ' : '← Quay lại tháng hiện tại'}</button>}
        <button onClick={exportCSV}>Xuất CSV</button>
        {isAdmin && !closed && section === 'detail' && (
          <button className="btn-danger" onClick={() => setConfirmClose(true)}>Chốt tháng</button>
        )}
      </div>

      {section === 'detail' && <PlasticDetail {...detailProps} />}
      {section === 'summary' && (
        <PlasticSummary
          py={py} pm={pm} daysInMonth={daysInMonth} dayKey={dayKey}
          dayProd={dayProd} daySample={daySample} colSum={colSum}
          groupTotal={groupTotal} ITEMS={ITEMS}
        />
      )}
      {section === 'monthend' && (
        <PlasticMonthEnd
          MONTH_END_ITEMS={MONTH_END_ITEMS} meRow={meRow}
          closed={closed} saveMonthEnd={saveMonthEnd}
        />
      )}
      {section === 'stock' && (
        <PlasticStock GROUPS={GROUPS} stockRow={stockRow} closed={closed} saveStock={saveStock} />
      )}
      {section === 'weekly' && (
        <PlasticWeekly
          GROUPS={GROUPS} WEEKLY_ITEMS={WEEKLY_ITEMS} wkMap={wkMap} wkTotal={wkTotal}
          closed={closed} saveWeekly={saveWeekly}
        />
      )}
      {section === 'archive' && !viewingArchive && (
        <PlasticArchive archived={archived} onView={loadPeriod} />
      )}
      {section === 'archive' && viewingArchive && (
        <>
          <p className="pl-locked">Tháng này đã chốt, chỉ xem không sửa được nữa. Toàn bộ các phần của tháng đều nằm ở đây.</p>
          <PlasticDetail {...detailProps} closed={true} />
          <PlasticSummary
            py={py} pm={pm} daysInMonth={daysInMonth} dayKey={dayKey}
            dayProd={dayProd} daySample={daySample} colSum={colSum}
            groupTotal={groupTotal} ITEMS={ITEMS}
          />
          <PlasticMonthEnd
            MONTH_END_ITEMS={MONTH_END_ITEMS} meRow={meRow}
            closed={true} saveMonthEnd={saveMonthEnd}
          />
          <PlasticStock GROUPS={GROUPS} stockRow={stockRow} closed={true} saveStock={saveStock} />
          <PlasticWeekly
            GROUPS={GROUPS} WEEKLY_ITEMS={WEEKLY_ITEMS} wkMap={wkMap} wkTotal={wkTotal}
            closed={true} saveWeekly={saveWeekly}
          />
        </>
      )}

      <ConfirmModal
        open={confirmClose}
        title="Chốt tháng này?"
        message={`Tháng ${data.periodLabel} sẽ chuyển vào Lưu trữ báo cáo sử dụng nhựa và không sửa được nữa. Tháng mới sẽ mở ra trống để nhập tiếp.`}
        confirmText="Chốt tháng"
        onConfirm={closeMonth}
        onCancel={() => setConfirmClose(false)}
      />
    </div>
  );
}
