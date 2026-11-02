// Tường ngày: lưới đủ ngày của 1 tháng, nhập/xuất ngày nào rơi vào ô ngày đó.
// Bấm 1 ngày để hiện bảng nổi của ngày đó; bấm lại ngày đang chọn để đóng.
export default function DayWall({ month, entries, selectedDay, onSelectDay, showTitle = true }) {
  const [y, m] = (month || '').split('-').map(Number);
  if (!y || !m) return null;
  const daysInMonth = new Date(y, m, 0).getDate();
  const firstWeekday = new Date(y, m - 1, 1).getDay(); // 0 = Chủ nhật
  const offset = (firstWeekday + 6) % 7; // tuần bắt đầu từ Thứ 2
  const cells = [];
  for (let i = 0; i < offset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  const pad = (n) => String(n).padStart(2, '0');
  const weekdays = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];

  return (
    <div>
      {showTitle && <h3 style={{ margin: '16px 0 8px' }}>Tháng {m}/{y}</h3>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6 }}>
        {weekdays.map((w) => (
          <div key={w} style={{ textAlign: 'center', fontSize: 12, color: '#64748b', fontWeight: 600 }}>{w}</div>
        ))}
        {cells.map((d, i) => {
          if (d === null) return <div key={`blank-${i}`} />;
          const date = `${y}-${pad(m)}-${pad(d)}`;
          const list = entries[date] || [];
          const selected = selectedDay === date;
          return (
            <div
              key={date}
              onClick={() => onSelectDay(selected ? '' : date)}
              style={{
                border: selected ? '2px solid #14b8a6' : '1px solid #e2e8f0',
                background: selected ? '#ccfbf1' : '#fff',
                borderRadius: 10, padding: '6px 8px', minHeight: 64, cursor: 'pointer',
              }}
            >
              <div style={{ fontWeight: 700, color: list.length ? '#0f172a' : '#94a3b8' }}>{d}</div>
              {list.slice(0, 3).map((e, j) => (
                <div key={j} style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.label}: {e.qty} kg</div>
              ))}
              {list.length > 3 && <div style={{ fontSize: 12, color: '#64748b' }}>+{list.length - 3} nữa</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
