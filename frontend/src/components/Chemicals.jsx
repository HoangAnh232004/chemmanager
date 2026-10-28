import { useState, useEffect } from 'react';
import api from '../api';
import Pagination from './Pagination';
import ConfirmModal from './ConfirmModal';


// So sánh không phân biệt dấu và hoa thường: gõ "hoa chat" vẫn khớp "Hóa chất"
const normalize = (s) => (s || '').toString().toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/g, 'd');

export default function Chemicals({ signal, user }) {
  const [list, setList] = useState([]);
  const [form, setForm] = useState({ name: '', type: '', grade: '', standard: '', hazard_group: '', storage_condition: '' });
  const [message, setMessage] = useState('');
  const [page, setPage] = useState(1);
  const [confirm, setConfirm] = useState(null);
  const [search, setSearch] = useState('');
  const [editingId, setEditingId] = useState(null);

  const load = async () => {
    try {
      const res = await api.get('/chemicals');
      setList(res.data);
      return res.data;
    } catch (err) {
      console.error(err);
      return [];
    }
  };

  useEffect(() => {
    load();
  }, [signal]);

  // Tìm kiếm theo tên (gõ là lọc ngay, không phân biệt dấu)
  const q = normalize(search);
  const filtered = list.filter((c) => normalize(c.name).includes(q));

  // Phân trang: mỗi trang 10 dòng
  const pageSize = 10;
  // Xếp từ cũ đến mới để món mới thêm luôn nằm cuối danh sách, STT tăng dần
  const sorted = [...filtered].sort((a, b) => a.id - b.id);
  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageItems = sorted.slice((safePage - 1) * pageSize, safePage * pageSize);

  const submit = async (e) => {
    e.preventDefault();
    try {
      if (editingId) {
        await api.put(`/chemicals/${editingId}`, form);
        setMessage('Đã sửa hóa chất');
        setEditingId(null);
        setForm({ name: '', type: '', grade: '', standard: '', hazard_group: '', storage_condition: '' });
        load();
      } else {
        await api.post('/chemicals', form);
        setForm({ name: '', type: '', grade: '', standard: '', hazard_group: '', storage_condition: '' });
        setMessage('Đã thêm hóa chất');
        const data = await load();
        setPage(Math.max(1, Math.ceil(data.length / pageSize))); // nhảy tới trang cuối để thấy món mới
      }
    } catch (err) {
      setMessage(err.response?.data?.message || (editingId ? 'Sửa thất bại' : 'Thêm thất bại'));
    }
  };

  // Bấm Sửa ở 1 dòng: đưa dữ liệu dòng đó lên form để sửa, bấm Lưu là xong
  const startEdit = (c) => {
    setEditingId(c.id);
    setForm({ name: c.name ?? '', type: c.type ?? '', grade: c.grade ?? '', standard: c.standard ?? '', hazard_group: c.hazard_group ?? '', storage_condition: c.storage_condition ?? '' });
    setMessage('');
  };

  const cancelEdit = () => {
    setEditingId(null);
    setForm({ name: '', type: '', grade: '', standard: '', hazard_group: '', storage_condition: '' });
  };

  const deleteAll = async () => {
    try {
      await api.delete('/import/chemicals');
      setPage(1);
      load();
    } catch (err) {
      setMessage(err.response?.data?.message || 'Xóa thất bại');
    }
  };

  const deleteOne = async (id) => {
    await api.delete(`/chemicals/${id}`);
    load();
  };

  return (
    <>
      <div className="tab-scroll">
      <h2>{editingId ? 'Sửa hóa chất' : 'Thêm hóa chất'}</h2>
      {user?.role === 'admin' && (
        <button onClick={() => setConfirm({ title: 'Xóa TẤT CẢ hóa chất?', message: 'Hành động này không khôi phục được.', confirmText: 'Xóa tất cả', action: deleteAll })} className="btn-danger mb-16">
          Xóa tất cả
        </button>
      )}
      <form onSubmit={submit} className="form-row">
        <input placeholder="Tên" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        <input placeholder="Loại (acid/base/solvent...)" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} />
        <input placeholder="Grade" value={form.grade} onChange={(e) => setForm({ ...form, grade: e.target.value })} />
        <input placeholder="Tiêu chuẩn" value={form.standard} onChange={(e) => setForm({ ...form, standard: e.target.value })} />
        <input placeholder="Nhóm nguy hiểm" value={form.hazard_group} onChange={(e) => setForm({ ...form, hazard_group: e.target.value })} />
        <input placeholder="Điều kiện lưu trữ" value={form.storage_condition} onChange={(e) => setForm({ ...form, storage_condition: e.target.value })} />
        <button type="submit">{editingId ? 'Lưu' : 'Thêm'}</button>
        {editingId && <button type="button" className="btn-secondary" onClick={cancelEdit}>Hủy</button>}
      </form>
      {message && <p>{message}</p>}
      <input placeholder="Tìm theo tên hóa chất..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} className="search-box" />
      <table>
        <thead><tr><th>STT</th><th>Tên</th><th>Loại</th><th>Grade</th><th>Tiêu chuẩn</th><th>Nhóm nguy hiểm</th><th></th></tr></thead>
        <tbody>
          {pageItems.map((c, idx) => (
            <tr key={c.id}>
              <td>{(safePage - 1) * pageSize + idx + 1}</td><td>{c.name}</td><td>{c.type}</td><td>{c.grade}</td><td>{c.standard}</td><td>{c.hazard_group}</td>
              <td><button onClick={() => startEdit(c)}>Sửa</button>{' '}<button onClick={() => setConfirm({ title: 'Xóa hóa chất này?', message: 'Hành động này không khôi phục được.', confirmText: 'Xóa', action: () => deleteOne(c.id) })}>Xóa</button></td>
            </tr>
          ))}
        </tbody>
      </table>

      <ConfirmModal
        open={!!confirm}
        title={confirm?.title}
        message={confirm?.message}
        confirmText={confirm?.confirmText}
        onConfirm={() => { confirm.action(); setConfirm(null); }}
        onCancel={() => setConfirm(null)}
      />
      </div>
      <div className="pagination-bar">
        <Pagination page={safePage} totalPages={totalPages} onChange={setPage} />
      </div>
    </>
  );
}
