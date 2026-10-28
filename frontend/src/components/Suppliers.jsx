import { useState, useEffect, useRef } from 'react';
import api from '../api';
import Pagination from './Pagination';
import ConfirmModal from './ConfirmModal';

// So sánh không phân biệt dấu và hoa thường: gõ "hoa chat" vẫn khớp "Hóa chất"
const normalize = (s) => (s || '').toString().toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/g, 'd');

export default function Suppliers({ signal, user }) {
  const [list, setList] = useState([]);
  const [form, setForm] = useState({ chemical_name: '', name: '', contact: '', phone: '', price: '', email: '' });
  const [message, setMessage] = useState('');
  const [page, setPage] = useState(1);
  const [confirm, setConfirm] = useState(null);
  const [search, setSearch] = useState('');
  const [editingId, setEditingId] = useState(null);
  const formTopRef = useRef(null);

  const load = async () => {
    try {
      const res = await api.get('/suppliers');
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

  // Tìm kiếm theo tên nhà cung cấp hoặc tên hóa chất (gõ là lọc ngay, không phân biệt dấu)
  const q = normalize(search);
  const filtered = list.filter((s) => normalize(s.name).includes(q) || normalize(s.chemical_name).includes(q));

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
        const res = await api.put(`/suppliers/${editingId}`, form);
        setMessage(res.data?.message || 'Đã sửa nhà cung cấp');
        setEditingId(null);
        setForm({ chemical_name: '', name: '', contact: '', phone: '', price: '', email: '' });
        load();
      } else {
        await api.post('/suppliers', form);
        setForm({ chemical_name: '', name: '', contact: '', phone: '', price: '', email: '' });
        setMessage('Đã thêm nhà cung cấp');
        const data = await load();
        setPage(Math.max(1, Math.ceil(data.length / pageSize))); // nhảy tới trang cuối để thấy món mới
      }
    } catch (err) {
      setMessage(err.response?.data?.message || (editingId ? 'Sửa thất bại' : 'Thêm thất bại'));
    }
  };

  // Bấm Sửa ở 1 dòng: đưa dữ liệu dòng đó lên form để sửa, bấm Lưu là xong,
  // đồng thời tự cuộn lên đầu trang để thấy form (form nằm trên cùng, bảng có thể đang ở trang xa)
  const startEdit = (s) => {
    setEditingId(s.id);
    setForm({ chemical_name: s.chemical_name ?? '', name: s.name ?? '', contact: s.contact ?? '', phone: s.phone ?? '', price: s.price ?? '', email: s.email ?? '' });
    setMessage('');
    formTopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setForm({ chemical_name: '', name: '', contact: '', phone: '', price: '', email: '' });
  };

  const deleteAll = async () => {
    try {
      await api.delete('/import/suppliers');
      setPage(1);
      load();
    } catch (err) {
      setMessage(err.response?.data?.message || 'Xóa thất bại');
    }
  };

  const deleteOne = async (id) => {
    await api.delete(`/suppliers/${id}`);
    load();
  };

  return (
    <>
      <div className="tab-scroll">
      <h2 ref={formTopRef}>{editingId ? 'Sửa nhà cung cấp' : 'Thêm nhà cung cấp'}</h2>
      {user?.role === 'admin' && (
        <button onClick={() => setConfirm({ title: 'Xóa TẤT CẢ nhà cung cấp?', message: 'Hành động này không khôi phục được.', confirmText: 'Xóa tất cả', action: deleteAll })} className="btn-danger mb-16">
          Xóa tất cả
        </button>
      )}
      <form onSubmit={submit} className="form-row">
        <input placeholder="Tên hóa chất" value={form.chemical_name} onChange={(e) => setForm({ ...form, chemical_name: e.target.value })} />
        <input placeholder="Nhà cung cấp" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        <input placeholder="Tên người liên hệ" value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} />
        <input placeholder="Số liên hệ" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        <input placeholder="Giá" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
        <input placeholder="Mail" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        <button type="submit">{editingId ? 'Lưu' : 'Thêm'}</button>
        {editingId && <button type="button" className="btn-secondary" onClick={cancelEdit}>Hủy</button>}
      </form>
      {message && <p>{message}</p>}
      <input placeholder="Tìm theo tên nhà cung cấp hoặc tên hóa chất..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} className="search-box" />
      <table>
        <thead><tr><th>STT</th><th>Tên hóa chất</th><th>Nhà cung cấp</th><th>Tên người liên hệ</th><th>Số liên hệ</th><th>Giá</th><th>Mail</th><th></th></tr></thead>
        <tbody>
          {pageItems.map((s, idx) => (
            <tr key={s.id}>
              <td>{(safePage - 1) * pageSize + idx + 1}</td><td>{s.chemical_name}</td><td>{s.name}</td><td>{s.contact}</td><td>{s.phone}</td><td>{s.price}{s.price_unit ? ` ${s.price_unit}` : ''}</td><td>{s.email}</td>
              <td><button onClick={() => startEdit(s)}>Sửa</button>{' '}<button onClick={() => setConfirm({ title: 'Xóa nhà cung cấp này?', message: 'Hành động này không khôi phục được.', confirmText: 'Xóa', action: () => deleteOne(s.id) })}>Xóa</button></td>
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
