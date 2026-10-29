import { useState, useEffect } from 'react';
import api from '../api';
import Pagination from './Pagination';

const actionLabel = { add: 'Thêm', edit: 'Sửa', delete: 'Xóa' };

// So sánh không phân biệt dấu và hoa thường (giống các tab khác)
const normalize = (s) => (s || '').toString().toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/g, 'd');

export default function ActivityLog({ signal }) {
  const [list, setList] = useState([]);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');

  const load = () => {
    api.get('/audit').then((res) => setList(res.data)).catch(() => {});
  };

  useEffect(() => {
    load();
  }, [signal]);

  // Tìm theo tài khoản (người làm): gõ là lọc ngay, không phân biệt dấu/hoa thường,
  // lọc trước rồi mới phân trang, gõ tìm là về trang 1
  const q = normalize(search);
  const filtered = q ? list.filter((l) => normalize(l.username).includes(q)) : list;

  // Phân trang: mỗi trang 10 dòng
  const pageSize = 10;
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageItems = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  return (
    <>
      <div className="tab-scroll">
      <h2>Lịch sử hoạt động</h2>
      {list.length === 0 && <p>Chưa có hoạt động nào.</p>}
      <input placeholder="Tìm tài khoản..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} className="search-box" />
      <table>
        <thead><tr><th>Thời gian</th><th>Người làm</th><th>Hành động</th><th>Chi tiết</th></tr></thead>
        <tbody>
          {pageItems.map((l, idx) => (
            <tr key={l.id}>
              <td>{new Date(l.created_at).toLocaleString('vi-VN')}</td>
              <td>{l.username}</td>
              <td>{actionLabel[l.action] || l.action}</td>
              <td>{l.detail}</td>
            </tr>
          ))}
          {pageItems.length === 0 && list.length > 0 && <tr><td colSpan={4}>Không tìm thấy</td></tr>}
        </tbody>
      </table>
      </div>
      <div className="pagination-bar">
        <Pagination page={safePage} totalPages={totalPages} onChange={setPage} />
      </div>
    </>
  );
}
