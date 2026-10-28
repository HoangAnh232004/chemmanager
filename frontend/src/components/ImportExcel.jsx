import { useState } from 'react';
import api from '../api';
import './ImportExcel.css';

const SECTIONS = [
  {
    key: 'suppliers',
    title: 'File nhà cung cấp',
   
    endpoint: '/import/suppliers',

  },
  {
    key: 'inventory',
    title: 'File kho',
    
    endpoint: '/import/inventory',
   
  },
];

function ImportSection({ section }) {
  const [file, setFile] = useState(null);
  const [message, setMessage] = useState('');
  const [msgType, setMsgType] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    if (!file) return;
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await api.post(section.endpoint, formData);
      setMessage(res.data.message);
      setMsgType('success');
      setFile(null);
      e.target.reset();
    } catch (err) {
      setMessage(err.response?.data?.message || 'Nhập file thất bại');
      setMsgType('error');
    }
  };

  return (
    <div className="import-card">
      <h3>{section.title}</h3>
      <p className="import-desc">{section.desc}</p>
      <p className="import-note">{section.note}</p>
      <form onSubmit={submit} className="import-form">
        <label className="import-dropzone">
          <input
            type="file"
            accept=".xlsx,.xls"
            className="import-file-input"
            onChange={(e) => setFile(e.target.files[0])}
            required
          />
          <span className="import-dropzone-icon">↑</span>
          {file
            ? <span className="import-filename">Đã chọn: {file.name}</span>
            : (
              <>
                <span className="import-dropzone-title">Chọn file Excel</span>
                <span className="import-dropzone-hint">Bấm để chọn file .xlsx hoặc .xls từ máy tính</span>
              </>
            )}
        </label>
        <button type="submit" className="btn-submit">Nhập lên web</button>
      </form>
      {message && <p className={`import-message ${msgType}`}>{message}</p>}
    </div>
  );
}

export default function ImportExcel() {
  return (
    <div className="import-page">
      <div>
        <h2 className="import-title">Nhập dữ liệu từ Excel</h2>
        <p className="import-subtitle">Chọn file Excel cho từng ô, hệ thống tự đọc và ghi đúng chỗ.</p>
      </div>
      <div className="import-grid">
        {SECTIONS.map((s) => <ImportSection key={s.key} section={s} />)}
      </div>
    </div>
  );
}
