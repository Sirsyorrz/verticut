const express = require('express');
const cors    = require('cors');
const path    = require('path');
const fs      = require('fs');

const { registerRoutes } = require('./routes');

function startServer(port, userDataPath) {
  return new Promise((resolve, reject) => {
    const uploadsDir = path.join(userDataPath, 'uploads');
    const outputsDir = path.join(userDataPath, 'outputs');
    fs.mkdirSync(uploadsDir, { recursive: true });
    fs.mkdirSync(outputsDir, { recursive: true });

    const app = express();
    app.use(cors());
    app.use(express.json({ limit: '10mb' }));
    app.use(express.static(path.join(__dirname, '..', 'static')));
    app.set('port', port);

    registerRoutes(app, uploadsDir, outputsDir);

    const server = app.listen(port, '127.0.0.1', () => {
      console.log(`VertiCut server on port ${port}`);
      resolve();
    });
    server.on('error', reject);
  });
}

module.exports = { startServer };
