const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { initDb } = require('./db');
const { verifyToken } = require('./middleware/auth');
const { auditLogger } = require('./middleware/audit');
const chemicalsRouter = require('./routes/chemicals');
const suppliersRouter = require('./routes/suppliers');
const lotsRouter = require('./routes/lots');
const qcRouter = require('./routes/qc');
const inventoryRouter = require('./routes/inventory');
const authRouter = require('./routes/auth');
const auditRouter = require('./routes/audit');
const importRouter = require('./routes/import');
const monthlyRouter = require('./routes/monthly');
const plasticRouter = require('./routes/plastic');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true } });
app.set('io', io);

io.on('connection', (socket) => {
  console.log('Client kết nối:', socket.id);
});

app.use(cors());
app.use(express.json());

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.use('/api/chemicals', verifyToken, auditLogger, chemicalsRouter);
app.use('/api/suppliers', verifyToken, auditLogger, suppliersRouter);
app.use('/api/lots', verifyToken, auditLogger, lotsRouter);
app.use('/api/qc', verifyToken, auditLogger, qcRouter);
app.use('/api/inventory', verifyToken, auditLogger, inventoryRouter);
app.use('/api/auth', authRouter);
app.use('/api/audit', auditRouter);
app.use('/api/import', auditLogger, importRouter);
app.use('/api/monthly', verifyToken, auditLogger, monthlyRouter);
app.use('/api/plastic', verifyToken, auditLogger, plasticRouter);

initDb().then(() => {
  server.listen(process.env.PORT || 5000, () => console.log('Server chạy ở port ' + (process.env.PORT || 5000)));

});
