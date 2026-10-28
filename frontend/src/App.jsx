import { useState, Fragment } from 'react';
import './App.css';
import './theme.css';
import Chemicals from './components/Chemicals';
import Suppliers from './components/Suppliers';
import Lots from './components/Lots';
import Qc from './components/Qc';
import Inventory from './components/Inventory';
import Archive from './components/Archive';
import Export from './components/Export';
import Home from './components/Home';
import Auth from './components/Auth';
import AdminApprovals from './components/AdminApprovals';
import ActivityLog from './components/ActivityLog';
import ImportExcel from './components/ImportExcel';
import { useEffect } from 'react';
import socket from './socket';


export default function App() {
  const [tab, setTab] = useState(() => {
    // Tab cũ 'trace' đã đổi thành 'export': nếu trình duyệt còn nhớ tab cũ thì về trang chủ cho khỏi trắng trang
    const saved = localStorage.getItem('activeTab');
    const valid = ['home', 'chemicals', 'suppliers', 'lots', 'qc', 'inventory', 'archive', 'export', 'import', 'approvals', 'audit'];
    return valid.includes(saved) ? saved : 'home';
  });

useEffect(() => {
  localStorage.setItem('activeTab', tab);
}, [tab]);

  const [user, setUser] = useState(() => {
    // Đọc tài khoản đã lưu: localStorage (có ghi nhớ) trước, sessionStorage (không ghi nhớ) sau
    for (const store of [localStorage, sessionStorage]) {
      try {
        const saved = store.getItem('user');
        if (saved) return JSON.parse(saved);
      } catch { /* thử kho còn lại */ }
    }
    return null;
  });
  const [signal, setSignal] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);

useEffect(() => {
  const handler = () => setSignal((s) => s + 1);
  socket.on('data_changed', handler);
  return () => socket.off('data_changed', handler);
}, []);

// Nếu tab đang mở là tab chỉ dành cho admin mà tài khoản hiện tại không phải admin
// (ví dụ đăng nhập tài khoản khác trên cùng trình duyệt) thì quay về trang chủ
useEffect(() => {
  const adminTabs = ['import', 'approvals', 'audit'];
  if (user && user.role !== 'admin' && adminTabs.includes(tab)) setTab('home');
}, [tab, user]);

  if (!user) {
    return (
      <div className="container">
        <Auth onLogin={setUser} />
      </div>
    );
  }

  const logout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    localStorage.removeItem('activeTab');
    sessionStorage.removeItem('token');
    sessionStorage.removeItem('user');
    setTab('home');
    setUser(null);
  };

  const tabs = [
    ['home', 'Trang chủ'],
    ['chemicals', 'Hóa chất'],
    ['suppliers', 'Nhà cung cấp'],
    ['lots', 'Mua/nhập'],
    ['qc', 'QC/release'],
    ['inventory', 'Kho'],
    ['archive', 'Lưu trữ'],
    ['export', 'Xuất kho'],
  ];
  if (user.role === 'admin') tabs.push(['import', 'Nhập Excel']);
  if (user.role === 'admin') tabs.push(['approvals', 'Duyệt tài khoản']);
  if (user.role === 'admin') tabs.push(['audit', 'Lịch sử hoạt động']);


  return (
    <div className="container">
      <div className="header">
        <div className="header-left">
          <button className="menu-btn" onClick={() => setMenuOpen(true)} title="Mở menu">☰</button>
          <h1>Quản lý hóa chất</h1>
          {tab !== 'home' && (
            <button className="home-btn" onClick={() => { setTab('home'); setMenuOpen(false); }} title="Về trang chủ">
              ⌂ <span className="home-btn-label">Trang chủ</span>
            </button>
          )}
        </div>
        <div className="account-wrap">
          <button className="account-btn" onClick={() => setAccountOpen((v) => !v)} title="Tài khoản">
            <span className="account-avatar">{user.username?.[0]?.toUpperCase()}</span>
            <span className="account-text">
              <span className="account-name">{user.username}</span>
              <span className="account-role">{user.role === 'admin' ? 'Quản trị viên' : 'Người dùng'}</span>
            </span>
            <span className="account-caret">▾</span>
          </button>
          {accountOpen && (
            <>
              <div className="account-backdrop" onClick={() => setAccountOpen(false)} />
              <div className="account-menu">
                <div className="account-menu-head">
                  <span className="account-avatar">{user.username?.[0]?.toUpperCase()}</span>
                  <div>
                    <div className="account-menu-name">{user.username}</div>
                    <div className="account-menu-role">{user.role === 'admin' ? 'Quản trị viên' : 'Người dùng'}</div>
                  </div>
                </div>
                <div className="account-menu-row"><span>Tên đăng nhập</span><b>{user.username}</b></div>
                <div className="account-menu-row"><span>Vai trò</span><b>{user.role === 'admin' ? 'Quản trị viên' : 'Người dùng'}</b></div>
                {user.email && (
                  <div className="account-menu-row"><span>Gmail</span><b>{user.email}</b></div>
                )}
                <button className="account-logout" onClick={() => { setAccountOpen(false); logout(); }}>Đăng xuất</button>
              </div>
            </>
          )}
        </div>
      </div>
      {menuOpen && <div className="sidebar-backdrop" onClick={() => setMenuOpen(false)} />}
      <div className={`sidebar${menuOpen ? ' open' : ''}`}>
        <div className="sidebar-head">
          <div className="sidebar-brand">
            <span className="sidebar-logo">Q</span>
            <span>
              <span className="sidebar-brand-name">Quản lý hóa chất</span>
              <span className="sidebar-brand-sub">Hệ thống kho</span>
            </span>
          </div>
          <button className="sidebar-close" onClick={() => setMenuOpen(false)}>✕</button>
        </div>
        {tabs.map(([key, label]) => (
          <Fragment key={key}>
            {key === 'import' && <div className="sidebar-group">Quản trị</div>}
            <button
              className={tab === key ? 'sidebar-item active' : 'sidebar-item'}
              onClick={() => { setTab(key); setMenuOpen(false); }}
            >
              {label}
            </button>
          </Fragment>
        ))}
      </div>
      {/* Thanh ngang chuyển tab nhanh (dùng song song với menu dọc, cùng danh sách tab) */}
      <div className="topbar">
        {tabs.map(([key, label]) => (
          <Fragment key={key}>
            {key === 'import' && <span className="topbar-divider" title="Quản trị" />}
            <button
              className={tab === key ? 'topbar-item active' : 'topbar-item'}
              onClick={() => { setTab(key); setMenuOpen(false); }}
            >
              {label}
            </button>
          </Fragment>
        ))}
      </div>
      <div className="card">
        {tab === 'home' && <Home signal={signal} user={user} goTab={setTab} />}
        {tab === 'chemicals' && <Chemicals signal={signal} user={user} />}
        {tab === 'suppliers' && <Suppliers signal={signal} user={user} />}
        {tab === 'lots' && <Lots signal={signal} />}
        {tab === 'qc' && <Qc signal={signal} />}
        {tab === 'inventory' && <Inventory signal={signal} user={user} />}
        {tab === 'archive' && <Archive signal={signal} />}
        {tab === 'export' && <Export signal={signal} />}
        {tab === 'import' && <ImportExcel />}
        {tab === 'approvals' && <AdminApprovals signal={signal} user={user} />}
        {tab === 'audit' && <ActivityLog signal={signal} />}


      </div>
    </div>
  );
}
