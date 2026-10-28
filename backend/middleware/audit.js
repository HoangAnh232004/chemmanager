const { pool } = require('../db');

// Tên hiển thị tiếng Việt cho từng bảng
const labels = {
  chemicals: 'hóa chất',
  suppliers: 'nhà cung cấp',
  lots: 'lot',
  qc: 'phiếu QC',
  inventory: 'tồn kho',
  users: 'tài khoản',
};

const verbs = { POST: 'Thêm', PUT: 'Sửa', DELETE: 'Xóa' };

// Bảng nào được tra tên từ DB (để không bao giờ ghi #id hay mã loằng ngoằng)
const nameTables = {
  chemicals: { table: 'chemicals', col: 'name' },
  suppliers: { table: 'suppliers', col: 'name' },
  users: { table: 'users', col: 'username' },
};

// Tra tên hóa chất + tên NCC theo id (dùng cho lot)
async function lotNames(chemicalId, supplierId) {
  let chemicalName = '';
  let supplierName = '';
  if (chemicalId) {
    try {
      const [[r]] = await pool.query('SELECT name FROM chemicals WHERE id=?', [chemicalId]);
      if (r) chemicalName = r.name;
    } catch {}
  }
  if (supplierId) {
    try {
      const [[r]] = await pool.query('SELECT name FROM suppliers WHERE id=?', [supplierId]);
      if (r) supplierName = r.name;
    } catch {}
  }
  return { chemicalName, supplierName };
}

// Chi tiết của lot ghi bằng tên hóa chất + tên NCC, không dùng mã lot hay #id.
// Không tra được tên thì ghi trơn (ví dụ "Thêm lot"), tuyệt đối không ghi "#".
function lotDetail(verb, chemicalName, supplierName) {
  let name = chemicalName || '';
  if (supplierName) name = name ? `${name} (NCC: ${supplierName})` : `NCC: ${supplierName}`;
  return name ? `${verb} lot ${name}` : `${verb} lot`;
}

// Tự ghi log mọi thao tác thêm/sửa/xóa, chi tiết ghi bằng tên cụ thể
// (ví dụ: "Thêm lot SHIMADA (NCC: YOUNGJIN)", "Xóa hóa chất Axit Sunfuric")
// thay vì id (#572), mã loằng ngoằng hay JSON.
async function auditLogger(req, res, next) {
  if (!['POST', 'PUT', 'DELETE'].includes(req.method)) return next();
  const tableName = req.baseUrl.replace('/api/', '');
  const method = req.method;

  // Với DELETE: lấy tên trước khi xóa vì xóa xong là không còn tên để ghi.
  // Chú ý: lúc middleware chạy, Express chưa khớp route nên req.params.id còn
  // trống — phải lấy id từ đường dẫn còn lại sau mount (ví dụ '/324' -> '324').
  if (method === 'DELETE') {
    const id = req.url.split('?')[0].split('/').filter(Boolean)[0];
    if (id) {
      try {
        if (tableName === 'lots') {
          const [[row]] = await pool.query(
            'SELECT c.name AS chemical_name, s.name AS supplier_name FROM lots l LEFT JOIN chemicals c ON c.id = l.chemical_id LEFT JOIN suppliers s ON s.id = l.supplier_id WHERE l.id=?',
            [id]
          );
          if (row) req._auditDetail = lotDetail('Xóa', row.chemical_name, row.supplier_name);
        } else if (tableName === 'qc') {
          const [[row]] = await pool.query(
            'SELECT c.name AS chemical_name FROM qc_tests q JOIN lots l ON l.id = q.lot_id JOIN chemicals c ON c.id = l.chemical_id WHERE q.id=?',
            [id]
          );
          if (row) req._auditDetail = `Xóa phiếu QC ${row.chemical_name}`;
        } else if (tableName === 'inventory') {
          const [[row]] = await pool.query(
            'SELECT c.name AS chemical_name FROM inventory i JOIN lots l ON l.id = i.lot_id JOIN chemicals c ON c.id = l.chemical_id WHERE i.id=?',
            [id]
          );
          if (row) req._auditDetail = `Xóa tồn kho ${row.chemical_name}`;
        } else if (nameTables[tableName]) {
          const t = nameTables[tableName];
          const [[row]] = await pool.query(`SELECT ${t.col} AS name FROM ${t.table} WHERE id=?`, [id]);
          if (row) req._auditDetail = `Xóa ${labels[tableName]} ${row.name}`;
        }
        // import (xóa tất cả) không cần tra tên, xử lý ở finish
      } catch {}
    }
  }

  res.on('finish', async () => {
    if (res.statusCode >= 400) return;
    const action = method === 'POST' ? 'add' : method === 'PUT' ? 'edit' : 'delete';
    const verb = verbs[method] || method;
    const label = labels[tableName] || tableName;
    let detail = req._auditDetail || '';

    if (!detail) {
      if (tableName === 'import') {
        // Nhập/xóa file Excel: lấy loại từ đường dẫn (chemicals/suppliers/inventory)
        const sub = req.url.split('?')[0].split('/').filter(Boolean)[0];
        const subLabel = sub === 'chemicals' ? 'hóa chất' : sub === 'suppliers' ? 'nhà cung cấp' : sub === 'inventory' ? 'kho' : '';
        if (method === 'DELETE') detail = subLabel ? `Xóa tất cả ${subLabel}` : 'Xóa tất cả';
        else detail = subLabel ? `Nhập file Excel ${subLabel}` : 'Nhập file Excel';
      } else if (tableName === 'lots') {
        // Xuất kho (POST /lots/export): ghi "Xuất kho <tên hóa chất> <số lượng> kg"
        const sub = req.url.split('?')[0].split('/').filter(Boolean)[0];
        if (sub === 'export' && method === 'POST') {
          const { chemicalName } = await lotNames(req.body?.chemical_id, null);
          const qty = Number(req.body?.quantity);
          const note = req.body?.note ? String(req.body.note).trim() : '';
          const parts = ['Xuất kho'];
          if (chemicalName) parts.push(chemicalName);
          if (qty) parts.push(`${qty} kg`);
          detail = parts.join(' ');
          if (note) detail += ` (${note})`;
          // Xuất ghi ngày khác hôm nay thì ghi rõ ngày xuất để đối chiếu với danh sách xuất kho
          // (frontend giờ luôn gửi ngày nên phải so với hôm nay theo giờ máy chủ, không thì dòng nào cũng kèm ngày)
          const ed = req.body?.export_date;
          if (ed && /^\d{4}-\d{2}-\d{2}$/.test(String(ed))) {
            const now = new Date();
            const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
            if (String(ed) !== todayStr) {
              const [y, m, d] = String(ed).split('-');
              detail += ` - ngày xuất ${d}/${m}/${y}`;
            }
          }
        } else if (sub === 'exports' && (method === 'PUT' || method === 'DELETE')) {
          // Sửa/xóa lần xuất: body gửi kèm tên hóa chất + số lượng của dòng (danh sách gộp theo ngày + hóa chất + ghi chú)
          const eName = req.body?.chemical || '';
          const eQty = Number(req.body?.quantity);
          const eVerb = method === 'PUT' ? 'Sửa' : 'Xóa';
          detail = `${eVerb} xuất kho${eName ? ` ${eName}` : ''}${eQty ? ` ${eQty} kg` : ''}`;
        } else {
          // Thêm/sửa lot: tra tên hóa chất + NCC từ chemical_id/supplier_id trong body,
          // nếu body không có thì tra từ lot trong DB (trường hợp sửa)
          let chemicalId = req.body?.chemical_id;
          let supplierId = req.body?.supplier_id;
          if ((!chemicalId || !supplierId) && req.params.id) {
            try {
              const [[lot]] = await pool.query('SELECT chemical_id, supplier_id FROM lots WHERE id=?', [req.params.id]);
              if (lot) {
                chemicalId = chemicalId || lot.chemical_id;
                supplierId = supplierId || lot.supplier_id;
              }
            } catch {}
          }
          const { chemicalName, supplierName } = await lotNames(chemicalId, supplierId);
          detail = lotDetail(verb, chemicalName, supplierName);
        }
      } else if (tableName === 'qc' && method === 'PUT') {
        // Duyệt QC: tra tên hóa chất của lot từ phiếu QC, kết quả theo status
        let chemicalName = '';
        try {
          const [[row]] = await pool.query(
            'SELECT c.name AS chemical_name FROM qc_tests q JOIN lots l ON l.id = q.lot_id JOIN chemicals c ON c.id = l.chemical_id WHERE q.id=?',
            [req.params.id]
          );
          if (row) chemicalName = row.chemical_name;
        } catch {}
        const st = req.body?.status;
        const result = st === 'pass' ? 'đạt' : st === 'fail' ? 'không đạt' : '';
        if (chemicalName) detail = result ? `QC ${result} ${chemicalName}` : `Sửa phiếu QC ${chemicalName}`;
        else detail = result ? `QC ${result}` : 'Sửa phiếu QC';
      } else {
        // Hóa chất / NCC / tài khoản: lấy tên từ body, nếu không có thì tra từ DB theo id
        let name = req.body?.name || req.body?.username || '';
        if (!name && req.params.id && nameTables[tableName]) {
          try {
            const t = nameTables[tableName];
            const [[row]] = await pool.query(`SELECT ${t.col} AS name FROM ${t.table} WHERE id=?`, [req.params.id]);
            if (row) name = row.name;
          } catch {}
        }
        detail = name ? `${verb} ${label} ${name}` : `${verb} ${label}`;
      }
    }

    try {
      await pool.query(
        'INSERT INTO audit_logs (user_id, username, action, table_name, record_id, detail) VALUES (?, ?, ?, ?, ?, ?)',
        [req.user?.id || null, req.user?.username || 'hệ thống', action, tableName, req.params.id || null, detail]
      );
    } catch (e) {
      console.error('Ghi log thất bại', e.message);
    }
    const io = req.app.get('io');
    if (io) io.emit('data_changed', { table: tableName });
  });
  next();
}

module.exports = { auditLogger };
