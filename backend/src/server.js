require('dotenv').config();
const express = require('express');
const cors = require('cors');
const connectDB = require('./config/db');
const logRoutes = require('./routes/logroutes');
const aiRoutes = require('./routes/airoutes');


const app = express();
const PORT = process.env.PORT || 5000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/log_analyzer';

app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.get('/health', (_req, res) => res.json({ ok: true }));
app.use('/api', logRoutes);
app.use('/api/ai', aiRoutes);

async function startServer(port) {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, () => {
      console.log(`Backend running on http://localhost:${port}`);
      resolve(server);
    });

    server.on('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        reject(new Error(`Port ${port} is already in use. Try another port or stop the process using it.`));
      } else {
        reject(error);
      }
    });
  });
}

connectDB(MONGODB_URI)
  .then(async () => {
    try {
      await startServer(PORT);
    } catch (err) {
      if (err.message.includes('already in use')) {
        const fallbackPort = Number(PORT) + 1;
        console.warn(err.message);
        console.warn(`Trying fallback port ${fallbackPort}...`);
        await startServer(fallbackPort);
      } else {
        throw err;
      }
    }
  })
  .catch((err) => {
    console.error('Startup failed:', err.message);
    process.exit(1);
  });
