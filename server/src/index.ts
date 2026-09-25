import compression from 'compression';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import path from 'path';
import fs from 'fs';
import { config } from './config';
import { errorHandler } from './lib/http';
import { startJobs } from './jobs';
import authRoutes from './routes/auth';
import walletRoutes from './routes/wallet';
import eventRoutes from './routes/events';
import betRoutes from './routes/bets';
import adminRoutes from './routes/admin';
import casinoRoutes from './routes/casino';

const app = express();
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression({ filter: (req, res) => !req.path.endsWith('/live/stream') && compression.filter(req, res) }));
app.use(cors({ origin: config.clientUrl.split(','), credentials: true }));
app.use(express.json({ limit: '200kb' }));
app.use(cookieParser());
app.use(morgan(config.env === 'production' ? 'combined' : 'dev'));

app.get('/api/health', (_req, res) => res.json({ ok: true, time: new Date() }));
app.use('/api/auth', authRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/bets', betRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/casino', casinoRoutes);
app.use('/api', eventRoutes);

// Serve the built frontend when it sits next to the server (single-container deploy)
const clientDist = path.resolve(__dirname, '../../client/dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist, { maxAge: '1h', index: false }));
  app.get(/^\/(?!api).*/, (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
}

app.use(errorHandler);

app.listen(config.port, () => {
  console.log(`WavyBet API listening on :${config.port}`);
  startJobs();
});
