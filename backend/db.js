const mysql = require('mysql2/promise');
require('dotenv').config();

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'chem_manager',
  ssl: process.env.DB_SSL === 'true' ? { minVersion: 'TLSv1.2' } : undefined,
  // Trả ngày/giờ dạng chuỗi 'YYYY-MM-DD' thay vì đối tượng Date (driver tự đổi sang giờ UTC
  // làm frontend cắt chuỗi bị lùi 1 ngày: nhập 27 hiện 26 ở cả Mua/nhập, Xuất kho và Hạn dùng trong Kho)
  dateStrings: true,
  waitForConnections: true,
  connectionLimit: 10,
});

// Thêm cột vào bảng nếu chưa có (bảng cũ vẫn dùng được khi thêm trường mới)
async function addColumnIfMissing(table, column, definition) {
  try {
    await pool.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  } catch (e) {
    if (e.errno !== 1060) throw e; // 1060 = cột đã có sẵn, bỏ qua
  }
}

async function initDb() {
  // Tạo database trước bằng kết nối tạm (vì pool chính đã gắn database)
  const tmp = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    ssl: process.env.DB_SSL === 'true' ? { minVersion: 'TLSv1.2' } : undefined,
  });
  await tmp.query(`CREATE DATABASE IF NOT EXISTS ${process.env.DB_NAME || 'chem_manager'}`);
  await tmp.end();


  // 1. Danh mục hóa chất
  await pool.query(`
    CREATE TABLE IF NOT EXISTS chemicals (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      type VARCHAR(50),
      grade VARCHAR(50),
      standard VARCHAR(100),
      hazard_group VARCHAR(50),
      storage_condition VARCHAR(100)
    )
  `);

  // Hóa chất: thêm tên Hàn, quy cách, tồn tối thiểu, số lượng đặt hàng
  // (đọc từ file tồn kho kiểu STOCK LIST; bảng cũ tự ALTER khi khởi động)
  await addColumnIfMissing('chemicals', 'korean_name', 'VARCHAR(255)');
  await addColumnIfMissing('chemicals', 'packaging', 'VARCHAR(100)');
  await addColumnIfMissing('chemicals', 'min_stock', 'DECIMAL(12,2) DEFAULT 0');
  await addColumnIfMissing('chemicals', 'order_qty', 'DECIMAL(12,2) DEFAULT 0');

  // Nhà cung cấp
  // Nhà cung cấp
await pool.query(`
  CREATE TABLE IF NOT EXISTS suppliers (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    chemical_name VARCHAR(100),
    contact VARCHAR(100),
    phone VARCHAR(100),
    price DECIMAL(12,2),
    price_unit VARCHAR(20),
    email VARCHAR(100)
  )
`);
await addColumnIfMissing('suppliers', 'chemical_name', 'VARCHAR(100)');
await addColumnIfMissing('suppliers', 'price', 'DECIMAL(12,2)');
await addColumnIfMissing('suppliers', 'price_unit', 'VARCHAR(20)');
// Nới cột phone để chứa được nhiều số điện thoại trong 1 ô
const [phoneCols] = await pool.query(
  `SELECT CHARACTER_MAXIMUM_LENGTH AS len FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'suppliers' AND COLUMN_NAME = 'phone'`
);
if (phoneCols.length && phoneCols[0].len < 100) {
  await pool.query('ALTER TABLE suppliers MODIFY phone VARCHAR(100)');
}


  // 2. Mua/nhập: mỗi lô hàng là 1 lot
  await pool.query(`
    CREATE TABLE IF NOT EXISTS lots (
      id INT AUTO_INCREMENT PRIMARY KEY,
      lot_code VARCHAR(50) UNIQUE NOT NULL,
      chemical_id INT NOT NULL,
      supplier_id INT,
      quantity DECIMAL(12,2) NOT NULL,
      unit VARCHAR(20) DEFAULT 'kg',
      purity VARCHAR(50),
      coa_file VARCHAR(255),
      msds_file VARCHAR(255),
      expiry_date DATE,
      received_date DATE,
      FOREIGN KEY (chemical_id) REFERENCES chemicals(id),
      FOREIGN KEY (supplier_id) REFERENCES suppliers(id)
    )
  `);

  // Nới mã lot để chứa mã tự sinh dạng KHO-<tên hóa chất> khi nhập file tồn kho
  const [lotCodeCols] = await pool.query(
    `SELECT CHARACTER_MAXIMUM_LENGTH AS len FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'lots' AND COLUMN_NAME = 'lot_code'`
  );
  if (lotCodeCols.length && lotCodeCols[0].len < 100) {
    await pool.query('ALTER TABLE lots MODIFY lot_code VARCHAR(100)');
  }

  // Đánh dấu nguồn gốc lot: 'manual' (nhập tay ở tab Mua/nhập) hay 'excel' (nhập từ file Excel).
  // Tab Mua/nhập chỉ hiện lot nhập tay; lot từ Excel vẫn hiện ở tab Kho, QC và Truy xuất.
  await addColumnIfMissing('lots', 'source', "VARCHAR(20) DEFAULT 'manual'");
  // Dữ liệu cũ: lot mã KHO- chỉ có thể đến từ file tồn kho nên đánh dấu là excel
  await pool.query(`UPDATE lots SET source = 'excel' WHERE lot_code LIKE 'KHO-%' AND (source IS NULL OR source = 'manual')`);

  // 3. QC/release
  await pool.query(`
    CREATE TABLE IF NOT EXISTS qc_tests (
      id INT AUTO_INCREMENT PRIMARY KEY,
      lot_id INT NOT NULL,
      status ENUM('quarantine','pass','fail') DEFAULT 'quarantine',
      result TEXT,
      tested_by VARCHAR(100),
      tested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (lot_id) REFERENCES lots(id) ON DELETE CASCADE
    )
  `);

  // 4. Kho
  await pool.query(`
    CREATE TABLE IF NOT EXISTS inventory (
      id INT AUTO_INCREMENT PRIMARY KEY,
      lot_id INT NOT NULL,
      location VARCHAR(100),
      quantity_available DECIMAL(12,2) NOT NULL,
      FOREIGN KEY (lot_id) REFERENCES lots(id) ON DELETE CASCADE
    )
  `);

  // 5. Bán hàng (giữ lại bảng để truy xuất còn đọc được lịch sử cũ)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sales (
      id INT AUTO_INCREMENT PRIMARY KEY,
      lot_id INT NOT NULL,
      customer VARCHAR(100),
      quantity DECIMAL(12,2) NOT NULL,
      packing_note TEXT,
      invoice_no VARCHAR(50),
      sale_date DATE,
      FOREIGN KEY (lot_id) REFERENCES lots(id)
    )
  `);

  // Lịch sử di chuyển của lot (phục vụ truy xuất)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS stock_movements (
      id INT AUTO_INCREMENT PRIMARY KEY,
      lot_id INT NOT NULL,
      action VARCHAR(50),
      quantity DECIMAL(12,2),
      note TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (lot_id) REFERENCES lots(id) ON DELETE CASCADE
    )
  `);
  // Ngày xuất riêng (DATE, không phụ thuộc múi giờ của TIMESTAMP): bảng cũ chưa có thì tự thêm,
  // dòng cũ để NULL thì danh sách vẫn hiện theo ngày từ created_at
  await addColumnIfMissing('stock_movements', 'export_date', 'DATE');

  // Tài khoản
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      username VARCHAR(50) UNIQUE NOT NULL,
      email VARCHAR(100),
      password_hash VARCHAR(255) NOT NULL,
      role ENUM('admin','user') DEFAULT 'user',
      status ENUM('pending','active') DEFAULT 'pending',
      email_verified TINYINT(1) DEFAULT 0,
      verification_code VARCHAR(10),
      verification_expires DATETIME,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  // Bảng users cũ (tạo trước khi có cột role/email) vẫn dùng được khi thêm trường mới
  await addColumnIfMissing('users', 'role', "ENUM('admin','user') DEFAULT 'user'");
  await addColumnIfMissing('users', 'email', 'VARCHAR(100)');
  await addColumnIfMissing('users', 'email_verified', 'TINYINT(1) DEFAULT 0');
  await addColumnIfMissing('users', 'verification_code', 'VARCHAR(10)');
  await addColumnIfMissing('users', 'verification_expires', 'DATETIME');

  // Nhật ký hoạt động (admin giám sát)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT,
      username VARCHAR(50),
      action VARCHAR(20),
      table_name VARCHAR(50),
      record_id INT,
      detail TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Kho theo tháng: mỗi tháng là 1 kỳ, hết tháng kỳ cũ đóng băng vào lưu trữ,
  // kỳ mới mở ra với tồn đầu kỳ = tồn cuối kỳ cũ, Nhập/Xuất về 0
  await pool.query(`
    CREATE TABLE IF NOT EXISTS monthly_periods (
      id INT AUTO_INCREMENT PRIMARY KEY,
      period VARCHAR(7) NOT NULL UNIQUE,
      status ENUM('open','closed') DEFAULT 'open',
      closed_at DATETIME,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS monthly_rows (
      id INT AUTO_INCREMENT PRIMARY KEY,
      period_id INT NOT NULL,
      chemical_id INT,
      chemical_name VARCHAR(100) NOT NULL,
      korean_name VARCHAR(255),
      supplier_name VARCHAR(100),
      packaging VARCHAR(100),
      min_stock DECIMAL(12,2) DEFAULT 0,
      order_qty DECIMAL(12,2) DEFAULT 0,
      opening_stock DECIMAL(12,2) DEFAULT 0,
      manual_in DECIMAL(12,2) DEFAULT 0,
      excel_in DECIMAL(12,2) DEFAULT 0,
      stock_out DECIMAL(12,2) DEFAULT 0,
      closing_stock DECIMAL(12,2),
      expiry_date DATE,
      FOREIGN KEY (period_id) REFERENCES monthly_periods(id),
      UNIQUE KEY uniq_period_chemical (period_id, chemical_name)
    )
  `);

  console.log('Database chem_manager đã sẵn sàng');
}

module.exports = { pool, initDb };
