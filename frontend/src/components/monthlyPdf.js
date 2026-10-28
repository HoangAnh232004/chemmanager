import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

const hasHangul = (s) => /[\uAC00-\uD7A3]/.test(s || '');
const fmtDate = (d) => {
  if (!d) return '—';
  const s = d.slice(0, 10);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : s;
};

// Xuất PDF kho tháng: font nhúng sẵn nên đủ dấu tiếng Việt + chữ Hàn.
// rows đã có sẵn status/statusClass (tính ở component gọi), hàm này chỉ vẽ bảng.
export async function exportMonthlyPDF({ title, subtitle, rows, filename }) {
  // Font chỉ tải khi bấm xuất (dynamic import), không làm nặng lúc mở web
  const { BEVIETNAMPRO_FONT, BEVIETNAMPRO_BOLD_FONT, NOTOSANSKR_FONT } = await import('../fonts/fonts.js');
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  doc.addFileToVFS('BeVietnamPro-VN.ttf', BEVIETNAMPRO_FONT);
  doc.addFont('BeVietnamPro-VN.ttf', 'BeVietnamPro', 'normal');
  doc.addFileToVFS('BeVietnamPro-Bold-VN.ttf', BEVIETNAMPRO_BOLD_FONT);
  doc.addFont('BeVietnamPro-Bold-VN.ttf', 'BeVietnamPro', 'bold');
  doc.addFileToVFS('NotoSansKR-Hangul.ttf', NOTOSANSKR_FONT);
  doc.addFont('NotoSansKR-Hangul.ttf', 'NotoSansKR', 'normal');
  doc.setFont('BeVietnamPro');
  doc.setFontSize(16);
  doc.text(title, 14, 14);
  doc.setFontSize(11);
  doc.text(subtitle, 14, 22);
  autoTable(doc, {
    startY: 28,
    head: [['STT', 'Tên hóa chất', 'Tên Hàn', 'NCC', 'Hạn dùng', 'Quy cách', 'Tồn đầu kỳ', 'Tối thiểu', 'Tối đa', 'Nhập', 'Xuất', 'Tồn', 'Trạng thái']],
    body: rows.map((r, idx) => [
      idx + 1, r.chemical_name, r.korean_name || '—', r.supplier_name || '—', fmtDate(r.expiry),
      r.packaging || '—', r.opening_stock, r.min_stock ? r.min_stock : '—', r.order_qty ? r.order_qty : '—',
      r.stock_in, r.stock_out, r.closing, r.status,
    ]),
    styles: { font: 'BeVietnamPro', fontSize: 9, cellPadding: 3 },
    headStyles: { font: 'BeVietnamPro', fillColor: [13, 148, 136], textColor: [255, 255, 255] },
    columnStyles: {
      0: { halign: 'center', cellWidth: 11 },
      6: { halign: 'right' },
      7: { halign: 'right' },
      8: { halign: 'right' },
      9: { halign: 'right' },
      10: { halign: 'right' },
      11: { halign: 'right' },
    },
    didParseCell: (data) => {
      // Ô nào có chữ Hàn thì dùng font Hàn (font Hàn cũng đủ chữ Việt nên ô lẫn cả hai vẫn hiện đủ)
      const text = (data.cell.text || []).join(' ');
      if (hasHangul(text)) data.cell.styles.font = 'NotoSansKR';
    },
    margin: { left: 10, right: 10 },
  });
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont('BeVietnamPro');
    doc.setFontSize(9);
    doc.text(`Trang ${i} / ${pages}`, doc.internal.pageSize.getWidth() - 14, doc.internal.pageSize.getHeight() - 10, { align: 'right' });
  }
  doc.save(filename);
}
