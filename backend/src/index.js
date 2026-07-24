require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');

const { initDB } = require('./db/migrations');
const { seedDB } = require('./db/seeds');
const { initAMI } = require('./services/amiClient');
const { initDialerEngine } = require('./services/dialerEngine');
const { initHopperService } = require('./services/hopperService');
const { initSocketService } = require('./services/socketService');
const rateLimiter = require('./middleware/rateLimiter');

const authRoutes        = require('./routes/auth');
const appointmentRoutes = require('./routes/appointments');
const agentRoutes = require('./routes/agents');
const campaignRoutes = require('./routes/campaigns');
const leadRoutes = require('./routes/leads');
const callRoutes = require('./routes/calls');
const cidRoutes = require('./routes/cid');
const reportRoutes = require('./routes/reports');
const adminRoutes = require('./routes/admin');
const sipRoutes = require('./routes/sip');

const app = express();
const server = http.createServer(app);

const allowedOrigins = [
  process.env.ADMIN_URL || 'http://localhost:3000',
  process.env.AGENT_URL || 'http://localhost:3001'
];

const io = socketIo(server, {
  cors: { origin: allowedOrigins, methods: ['GET', 'POST'], credentials: true }
});

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

app.use('/api', rateLimiter);
// Fail-closed guard: trainee tokens reach ONLY the trainee API, auth and their
// own SIP config. Must stay ABOVE every route mount below — many of those are
// authenticate-only and would otherwise serve unmasked lead data to a trainee.
app.use('/api', require('./middleware/auth').traineeFirewall);
app.use('/api/auth', authRoutes);
app.use('/api/agents', agentRoutes);
app.use('/api/campaigns', campaignRoutes);
app.use('/api/leads', leadRoutes);
app.use('/api/calls', callRoutes);
app.use('/api/cid', cidRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/sip', sipRoutes);
app.use('/api/appointments', appointmentRoutes);
app.use('/api/callbacks',   require('./routes/callbacks'));
app.use('/api/lead-lists', require('./routes/leadLists'));
app.use('/api/hq', require('./routes/hq'));
app.use('/api/chat', require('./routes/chat'));
app.use('/api/trainee', require('./routes/trainee'));

app.get('/health', (req, res) => res.json({ status: 'ok', uptime: process.uptime(), time: new Date() }));

app.use((err, req, res, next) => {
  console.error('[Error]', err.message);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

async function start() {
  try {
    console.log('[Server] Starting up...');
    await initDB();
    await seedDB();

    const socketService = initSocketService(io);
    await initAMI(io, socketService);
    initHopperService(io);
    initDialerEngine(io, socketService);

    const PORT = process.env.PORT || 5000;
    server.listen(PORT, '0.0.0.0', () => {
      console.log(`[Server] Listening on port ${PORT}`);
    });
  } catch (err) {
    console.error('[Server] Fatal startup error:', err);
    process.exit(1);
  }
}

start();

module.exports = { app, io };
