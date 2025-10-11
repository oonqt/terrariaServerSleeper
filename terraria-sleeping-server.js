// terraria-sleeping-server.js

const net = require('net');
const express = require('express');
const ms = require('ms');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { spawn } = require('child_process');
const Logger = require('./logger');
const { version } = require('./package.json');

const logger = new Logger('terraria-sleeping-server');
const tServerLogger = new Logger('terraria-server');

// Configuration

const IDLE_TIMEOUT = ms(process.env.IDLE_TIMEOUT, 10);
const WORLD_FILE = process.env.WORLD_FILE;
const NTFY_TOPIC  = process.env.NTFY_TOPIC;
const NTFY_AUTH   = process.env.NTFY_AUTH;

const DATA_ROOT = '/terraria';
const TSHOCK_CONF_FILE = path.join(DATA_ROOT, "config.json");
const SERVER_ROOT = '/tshock';
const SERVER_BINARY = path.join(SERVER_ROOT, 'TShock.Server');

// Validate essential config

if (!fs.existsSync(TSHOCK_CONF_FILE)) {
  logger.error('Missing tshock config.json file.');
  process.exit(1);
}

if (!IDLE_TIMEOUT || !WORLD_FILE) {
  logger.error('Missing required environment variables. Please set LISTEN_PORT, API_PORT, IDLE_TIMEOUT, and WORLD_FILE.');
  process.exit(1);
}

const tshockConfig = JSON.parse(fs.readFileSync(TSHOCK_CONF_FILE)).Settings;
const restAPIPort = tshockConfig.RestApiPort;
const maxPlayers = tshockConfig.MaxSlots;
const tshockServerPort = tshockConfig.ServerPort;

// Helper to send ntfy notifications (via HTTP POST):contentReference[oaicite:6]{index=6}
function sendNtfy(message, tag, priority) {
  if (!NTFY_TOPIC) return;
  
  let headers = {
    Title: 'Terraria Sleeping Server',
    Tags: tag,
    Priority: priority ? priority : 3
  };

  if (NTFY_AUTH) {
    headers['Authorization'] = `Bearer ${NTFY_AUTH}`;
  }

  axios.post(NTFY_TOPIC, message, { headers })
    .catch(err => logger.error('ntfy send error:', err.message));
}

// State variables
let dummyServer = null;
let apiServer = null;
let serverProcess = null;
let pollInterval = null;
let idleStart = null;

// Function to start dummy TCP listener and fake API
function startDummyServers() {
  // Start dummy TCP server (accepts Terraria client connections)
  dummyServer = net.createServer((socket) => {
    logger.info('Connection received on dummy server. Waking up real server...');
    socket.end(); // Immediately end the dummy connection

    // Stop the dummy and fake API servers
    dummyServer.close(() => logger.info('Dummy server closed'));
    dummyServer = null;

    if (apiServer) {
      apiServer.close(() => logger.info('Dummy API server closed'));
      apiServer = null;
    }

    // Start the real Terraria server
    startRealServer();
  });

  dummyServer.on('error', err => logger.error('Dummy server error:', err));

  dummyServer.listen(tshockServerPort, () => {
    logger.info(`Dummy TCP server listening on port ${tshockServerPort}`);
  });

  // Fake TShock API using Express
  const app = express();

  // Also handle /v2/server/status if polled
  app.get('/v2/server/status', (req, res) => {
    res.json({
      port: tshockServerPort,
      playercount: 'SLEEPING',
      maxplayers: maxPlayers,
      status: 200,
      players: []  // no players
    });
  });

  apiServer = app.listen(restAPIPort, () => logger.info(`Fake TShock API listening on port ${restAPIPort}`));

  apiServer.on('error', err => logger.error('Fake API server error:', err));
}

// Function to spawn the real Terraria server
function startRealServer() {
  logger.info('Spawning real Terraria/TShock server...');
  sendNtfy('Terraria server is starting', 'arrows_clockwise');
  // Spawn the server process with given binary and config
  serverProcess = spawn(SERVER_BINARY, ['-configpath', `${DATA_ROOT}`, '-world', path.join(DATA_ROOT, WORLD_FILE)], { 
    cwd: SERVER_ROOT,
    stdio: ['ignore', 'pipe', 'pipe'] 
  });

  serverProcess.stdout.on('data', (data) => {
    const lines = data.toString().split('\n').filter(Boolean);
    lines.forEach(line => tServerLogger.info(line));
  });

  serverProcess.stderr.on('data', (data) => {
    const lines = data.toString().split('\n').filter(Boolean);
    lines.forEach(line => tServerLogger.error(line));
  });

  serverProcess.on('error', err => {
    logger.error('Error starting server process:', err);
    sendNtfy('Terraria server failed to start', 'face_with_thermometer', 4);
    // If spawning fails, return to offline state
    clearInterval(pollInterval);
    pollInterval = null;
    startDummyServers();
  });

  serverProcess.on('exit', (code, signal) => {
    logger.info(`Terraria server process exited (code: ${code}, signal: ${signal})`);
    // Clear polling interval
    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
    // Return to offline (dummy) mode
    startDummyServers();
  });

  // Reset idle tracking
  idleStart = null;

  // Poll the TShock API every 5 seconds for player count
  pollInterval = setInterval(async () => {
    try {
      // Query server status; expects JSON with playercount
      const res = await axios.get(`http://localhost:${restAPIPort}/status`);
      const data = res.data;
      const count = data.playercount != null
        ? data.playercount
        : (data.players || []).length;
      // If no players online
      if (count === 0) {
        if (!idleStart) {
          idleStart = Date.now();
          logger.info('No players online. Starting idle timer...');
        } else if (Date.now() - idleStart >= IDLE_TIMEOUT) {
          logger.info('Idle timeout exceeded. Shutting down server...');
          sendNtfy('Terraria server is shutting down (idle)', 'stop_sign');
          // Gracefully kill the server process
          if (serverProcess) {
            serverProcess.kill();
            serverProcess = null;
          }
          // Stop polling; exit done in 'exit' handler above
          clearInterval(pollInterval);
          pollInterval = null;
        }
      } else {
        // Reset idle timer if players are online
        if (idleStart) {
          logger.info('Player connected, resetting idle timer.');
        }
        idleStart = null;
      }
    } catch (err) {
      // Ignore polling errors (e.g. server starting up not ready yet)
      logger.error('Error polling TShock API:', err.message);
    }
  }, 5000);
}

// Handle process signals to clean up
process.on('SIGINT', () => {
  logger.info('Received SIGINT, shutting down controller.');

  if (serverProcess) serverProcess.kill();
  if (dummyServer) dummyServer.close();
  if (apiServer) apiServer.close();
  
  process.exit(0);
});

// Start in offline mode: dummy TCP + fake API servers
logger.info(`Starting dummy terraria TCP & tshock API servers (Version: ${version})`);
startDummyServers();