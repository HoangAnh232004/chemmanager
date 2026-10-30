import { useState, useEffect } from 'react';
import api from '../api';
import Pagination from './Pagination';

// So sánh không phân biệt dấu và hoa thường: gõ "hoa chat" vẫn khớp "Hóa chất"
const normalize = (s) => (s || '').toString().toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/g, 'd');

export default function Qc({ signal }) {
  const [list, setList] = useState([]);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');

  const load = async () => {
    try {
      const res = await api.get('/qc');
      setList(res.data);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    load();
  }, [signal]);

  // Công tắc hiển thị tab QC: false = không hiện lot nào, dù nhập tay hay nhập từ file Excel.
  // Muốn hiện lại thì đổi thành true (khi đó chỉ hiện lot nhập tay: ẩn lot source = 'excel'
  // và lot mã KHO- của file tồn kho; lot cũ chưa có source thì coi như nhập tay).
  const SHOW_QC = false;
  const manualList = list.filter((item) => item.source !== 'excel' && !String(item.lot_code || '').startsWith('KHO-'));
  // Tìm kiếm theo mã lot (gõ là lọc ngay, không phân biệt dấu)
  const keyword = normalize(search);
  const filtered = SHOW_QC ? manualList.filter((item) => normalize(item.lot_code).includes(keyword)) : [];

  // Phân trang: mỗi trang 10 dòng
  const pageSize = 10;
  // Xếp từ cũ đến mới để món mới thêm luôn nằm cuối danh sách, STT tăng dần
  const sorted = [...filtered].sort((a, b) => a.id - b.id);
  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageItems = sorted.slice((safePage - 1) * pageSize, safePage * pageSize);

  const update = async (id, status) => {
    await api.put(`/qc/${id}`, { status, result: status === 'pass' ? 'Đạt' : 'Không đạt', tested_by: 'QC' });
    load();
  };

  return (
    <>
      <div className="tab-scroll">
      <h2>Phiếu QC</h2>
      <input placeholder="Tìm theo mã lot..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} className="search-box" />
      <table>
        <thead><tr><th>STT</th><th>Mã lot</th><th>Trạng thái</th><th>Kết quả</th><th>Người kiểm</th><th></th></tr></thead>
        <tbody>
          {pageItems.map((q, idx) => (
            <tr key={q.id}>
              <td>{(safePage - 1) * pageSize + idx + 1}</td><td>{q.lot_code}</td><td>{q.status}</td><td>{q.result}</td><td>{q.tested_by}</td>
              <td>
                <button onClick={() => update(q.id, 'pass')}>Đạt</button>{' '}
                <button onClick={() => update(q.id, 'fail')}>Không đạt</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
      <div className="pagination-bar">
        <Pagination page={safePage} totalPages={totalPages} onChange={setPage} />
      </div>
    </>
  );
}
