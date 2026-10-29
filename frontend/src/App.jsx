import { useState, Fragment } from 'react';
import './App.css';
import './theme.css';
import Chemicals from './components/Chemicals';
import Suppliers from './components/Suppliers';
import Lots from './components/Lots';
import Inventory from './components/Inventory';
import Archive from './components/Archive';
import Export from './components/Export';
import Home from './components/Home';
import Auth from './components/Auth';
import AdminApprovals from './components/AdminApprovals';
import ActivityLog from './components/ActivityLog';
import ImportExcel from './components/ImportExcel';
import Notifications from './components/Notifications';
import AccountSettings from './components/AccountSettings';
import { maskEmail } from './utils';
import './components/loading.css';
import { useEffect } from 'react';
import socket from './socket';


export default function App() {
  const [tab, setTab] = useState(() => {
    // Tab cũ 'trace' đã đổi thành 'export': nếu trình duyệt còn nhớ tab cũ thì về trang chủ cho khỏi trắng trang
    const valid = ['home', 'chemicals', 'suppliers', 'lots', 'inventory', 'archive', 'export', 'import', 'approvals', 'audit'];
    // Phân biệt F5 với đóng tab rồi mở lại: sessionStorage còn khi F5, mất khi đóng tab mở tab mới
    const isReload = sessionStorage.getItem('tabAlive') === '1';
    sessionStorage.setItem('tabAlive', '1');
    if (!isReload) return 'home'; // Đóng tab rồi mở lại: luôn về trang chủ
    const saved = localStorage.getItem('activeTab');
    return valid.includes(saved) ? saved : 'home'; // F5: giữ nguyên tab đang xem
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
  // Hóa chất cần nhảy tới ở tab Kho khi bấm "Xem ở tab Kho" trong bảng nổi thông báo
  const [khoHighlight, setKhoHighlight] = useState(null);
  const goKho = (name) => { setKhoHighlight(name); setTab('inventory'); };
  const [menuOpen, setMenuOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

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
    // Reset cả trạng thái giao diện, không thì đăng nhập lại sẽ thấy menu tự mở
    // sẵn và nút đăng xuất vẫn kẹt ở "Đang đăng xuất..."
    setAccountOpen(false);
    setLoggingOut(false);
    setUser(null);
  };

  // Đăng xuất vốn xử lý ngay lập tức nên giữ hiệu ứng load nửa giây cho dễ thấy
  // rồi mới về trang đăng nhập (menu vẫn mở trong lúc load để thấy nút đang xoay)
  const handleLogout = () => {
    if (loggingOut) return;
    setLoggingOut(true);
    setTimeout(() => { logout(); }, 600);
  };

  const tabs = [
    ['home', 'Trang chủ'],
    ['chemicals', 'Hóa chất'],
    ['suppliers', 'Nhà cung cấp'],
    ['lots', 'Mua/nhập'],
    ['inventory', 'Kho'],
    ['archive', 'Lưu trữ'],
    ['export', 'Xuất kho'],
  ];
  if (user.role === 'admin') tabs.push(['import', 'Nhập Excel']);
  if (user.role === 'admin') tabs.push(['approvals', 'Duyệt tài khoản']);
  if (user.role === 'admin') tabs.push(['audit', 'Lịch sử hoạt động']);

  // Menu dọc phân nhóm y như các ô ở trang chủ
  const sidebarGroups = [
    { title: null, keys: ['home'] },
    { title: 'Vận hành kho hằng ngày', keys: ['lots', 'export', 'inventory'] },
    { title: 'Danh mục & nhập liệu', keys: ['chemicals', 'suppliers', 'import'] },
    { title: 'Theo dõi & quản trị', keys: ['archive', 'audit', 'approvals'] },
  ];


  return (
    <div className="container">
      <div className="header">
        <div className="header-left">
          <button className="menu-btn" onClick={() => setMenuOpen(true)} title="Mở menu">☰</button>
          <img className="sidebar-logo" src="/logo.png" alt="KhoManager" />
          <h1>KhoManager</h1>
          {tab !== 'home' && (
            <button className="home-btn" onClick={() => { setTab('home'); setMenuOpen(false); }} title="Về trang chủ">
              ⌂ <span className="home-btn-label">Trang chủ</span>
            </button>
          )}
        </div>
        <div className="header-right">
          <Notifications user={user} signal={signal} goKho={goKho} />
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
                  <div className="account-menu-row"><span>Gmail</span><b>{maskEmail(user.email)}</b></div>
                )}
                <button className="account-settings" onClick={() => { setAccountOpen(false); setSettingsOpen(true); }}>Cài đặt tài khoản</button>
                <button className="account-logout" onClick={handleLogout} disabled={loggingOut}>{loggingOut ? (<><span className="auth-spinner" /> Đang đăng xuất...</>) : 'Đăng xuất'}</button>
              </div>
            </>
          )}
        </div>
        </div>
      </div>
      {menuOpen && <div className="sidebar-backdrop" onClick={() => setMenuOpen(false)} />}
      <div className={`sidebar${menuOpen ? ' open' : ''}`}>
        <div className="sidebar-head">
          <div className="sidebar-brand">
            <img className="sidebar-logo" src="/logo.png" alt="KhoManager" />
            <span>
              <span className="sidebar-brand-name">KhoManager</span>
              <span className="sidebar-brand-sub">Hệ thống kho</span>
            </span>
          </div>
          <button className="sidebar-close" onClick={() => setMenuOpen(false)}>✕</button>
        </div>
        {sidebarGroups.map((group) => (
          <Fragment key={group.title || 'chung'}>
            {group.title && <div className="sidebar-group">{group.title}</div>}
            {group.keys.map((key) => {
              const found = tabs.find(([k]) => k === key);
              if (!found) return null;
              return (
                <button
                  key={key}
                  className={tab === key ? 'sidebar-item active' : 'sidebar-item'}
                  onClick={() => { setTab(key); setMenuOpen(false); }}
                >
                  {found[1]}
                </button>
              );
            })}
          </Fragment>
        ))}
      </div>
      <div className="card">
        {tab === 'home' && <Home signal={signal} user={user} goTab={setTab} />}
        {tab === 'chemicals' && <Chemicals signal={signal} user={user} />}
        {tab === 'suppliers' && <Suppliers signal={signal} user={user} />}
        {tab === 'lots' && <Lots signal={signal} />}
        {tab === 'inventory' && <Inventory signal={signal} user={user} highlightChemical={khoHighlight} onHighlightDone={() => setKhoHighlight(null)} />}
        {tab === 'archive' && <Archive signal={signal} />}
        {tab === 'export' && <Export signal={signal} />}
        {tab === 'import' && <ImportExcel />}
        {tab === 'approvals' && <AdminApprovals signal={signal} user={user} />}
        {tab === 'audit' && <ActivityLog signal={signal} />}


      </div>
      {settingsOpen && <AccountSettings user={user} onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
