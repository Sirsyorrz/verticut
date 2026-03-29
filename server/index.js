const express = require('express');
const cors    = require('cors');
const path    = require('path');
const os      = require('os');

const { registerRoutes } = require('./routes');

function startServer(port, userDataPath) {
  return new Promise((resolve, reject) => {
    const outputsDir = os.tmpdir();

    const app = express();
    app.use(cors());
    app.use(express.json({ limit: '10mb' }));
    app.use(express.static(path.join(__dirname, '..', 'static')));
    app.set('port', port);

    registerRoutes(app, outputsDir);

    const server = app.listen(port, '127.0.0.1', () => {
      console.log(`VertiCut server on port ${port}`);
      resolve();
    });
    server.on('error', reject);
  });
}

module.exports = { startServer };
