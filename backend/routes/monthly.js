const express = require('express');
const monthly = require('../monthly');
const { requireAdmin } = require('../middleware/auth');
const router = express.Router();

// Kỳ kho đang mở (kèm toàn bộ dòng tháng hiện tại)
router.get('/current', async (req, res) => {
  try {
    res.json(await monthly.getCurrentView());
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: 'Không tải được kho tháng' });
  }
});

// Danh sách các kỳ (mở + đã chốt) để chọn ở tab Lưu trữ
router.get('/periods', async (req, res) => {
  try {
    res.json(await monthly.getPeriods());
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: 'Không tải được danh sách kỳ' });
  }
});

// Xem 1 kỳ (tháng đã chốt thì số liệu đóng băng; kỳ đang mở thì tính live như /current)
// Đặt sau '/current' và '/periods' để Express không khớp nhầm chúng thành :period
router.get('/:period', async (req, res) => {
  try {
    if (!/^\d{4}-\d{2}$/.test(req.params.period)) return res.status(400).json({ message: 'Kỳ không hợp lệ' });
    const view = await monthly.getArchivedView(req.params.period);
    if (!view) return res.status(404).json({ message: 'Không tìm thấy kỳ này' });
    res.json(view);
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: 'Không tải được kỳ' });
  }
});

// Chốt tháng (chỉ admin): đóng kỳ đang mở, mở kỳ tháng tiếp theo
// (tồn đầu kỳ mới = tồn cuối kỳ vừa đóng, Nhập/Xuất về 0)
router.post('/close', requireAdmin, async (req, res) => {
  try {
    const opened = await monthly.closeCurrentAndOpenNext();
    req.app.get('io')?.emit('data_changed', { table: 'monthly' });
    res.json({ message: `Đã chốt tháng, kỳ mới: ${monthly.labelOf(opened.period)}`, period: opened.period, periodLabel: monthly.labelOf(opened.period) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: 'Chốt tháng thất bại' });
  }
});

module.exports = router;
