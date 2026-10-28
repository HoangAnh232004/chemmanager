import { useState, useEffect } from 'react';
import api from '../api';
import Pagination from './Pagination';
import ConfirmModal from './ConfirmModal';

export default function AdminApprovals({ signal, user }) {
  const [list, setList] = useState([]);
  const [page, setPage] = useState(1);
  const [users, setUsers] = useState([]);
  const [page2, setPage2] = useState(1);
  const [roleEdits, setRoleEdits] = useState({});
  const [msg, setMsg] = useState('');
  const [confirm, setConfirm] = useState(null);

  const load = async () => {
    try {
      const res = await api.get('/auth/pending');
      setList(res.data);
    } catch (err) {
      console.error(err);
    }
  };

  const loadUsers = async () => {
    try {
      const res = await api.get('/auth/users');
      setUsers(res.data);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    load();
    loadUsers();
  }, [signal]);

  // Phân trang: mỗi trang 10 dòng
  const pageSize = 10;
  const totalPages = Math.max(1, Math.ceil(list.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageItems = list.slice((safePage - 1) * pageSize, safePage * pageSize);

  const totalPages2 = Math.max(1, Math.ceil(users.length / pageSize));
  const safePage2 = Math.min(page2, totalPages2);
  const pageItems2 = users.slice((safePage2 - 1) * pageSize, safePage2 * pageSize);

  const changeRole = async (id, currentRole) => {
    const role = roleEdits[id] ?? currentRole;
    try {
      await api.put(`/auth/role/${id}`, { role });
      setRoleEdits((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      setMsg('Đã đổi vai trò (có hiệu lực sau khi tài khoản đó đăng nhập lại)');
      loadUsers();
    } catch (err) {
      setMsg(err.response?.data?.message || 'Đổi vai trò thất bại');
    }
  };

  const deleteUser = async (id) => {
    try {
      await api.delete(`/auth/users/${id}`);
      setMsg('Đã xóa tài khoản');
      loadUsers();
      load();
    } catch (err) {
      setMsg(err.response?.data?.message || 'Xóa tài khoản thất bại');
    }
  };

  return (
    <div>
      <h2>Tài khoản chờ duyệt</h2>
      {list.length === 0 && <p>Không có tài khoản nào chờ duyệt.</p>}
      <table>
        <thead><tr><th>STT</th><th>Tên đăng nhập</th><th>Ngày đăng ký</th><th></th></tr></thead>
        <tbody>
          {pageItems.map((u, idx) => (
            <tr key={u.id}>
              <td>{(safePage - 1) * pageSize + idx + 1}</td><td>{u.username}</td><td>{u.created_at?.slice(0, 10)}</td>
              <td>
                <button onClick={async () => { await api.put(`/auth/approve/${u.id}`); load(); }}>Duyệt</button>{' '}
                <button onClick={async () => { await api.delete(`/auth/reject/${u.id}`); load(); }}>Từ chối</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <Pagination page={safePage} totalPages={totalPages} onChange={setPage} />

      <h2 style={{ marginTop: 32 }}>Tất cả tài khoản</h2>
      {msg && <p>{msg}</p>}
      {users.length === 0 && <p>Chưa có tài khoản nào.</p>}
      <table>
        <thead><tr><th>STT</th><th>Tên đăng nhập</th><th>Vai trò</th><th>Trạng thái</th><th>Ngày đăng ký</th><th></th></tr></thead>
        <tbody>
          {pageItems2.map((u, idx) => {
            const isSelf = user && u.id === user.id;
            return (
              <tr key={u.id}>
                <td>{(safePage2 - 1) * pageSize + idx + 1}</td><td>{u.username}{isSelf ? ' (bạn)' : ''}</td>
                <td>
                  <select
                    value={roleEdits[u.id] ?? u.role}
                    onChange={(e) => setRoleEdits({ ...roleEdits, [u.id]: e.target.value })}
                    disabled={isSelf}
                  >
                    <option value="admin">admin</option>
                    <option value="user">user</option>
                  </select>
                </td>
                <td>{u.status === 'active' ? 'Đã kích hoạt' : 'Chờ duyệt'}</td>
                <td>{u.created_at?.slice(0, 10)}</td>
                <td>
                  {!isSelf && (
                    <>
                      <button onClick={() => changeRole(u.id, u.role)}>Lưu</button>{' '}
                      <button onClick={() => setConfirm({ title: 'Xóa tài khoản này?', message: 'Hành động này không khôi phục được.', confirmText: 'Xóa', action: () => deleteUser(u.id) })}>Xóa</button>
                    </>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <Pagination page={safePage2} totalPages={totalPages2} onChange={setPage2} />
      <ConfirmModal
        open={!!confirm}
        title={confirm?.title}
        message={confirm?.message}
        confirmText={confirm?.confirmText}
        onConfirm={() => { confirm.action(); setConfirm(null); }}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}
