/**
 * @file discord-rpc.js — Lightweight Discord IPC Rich Presence client.
 *
 * Implements the Discord IPC protocol over local named pipes (Windows) or
 * Unix domain sockets (Unix) without any external npm dependencies.
 *
 * @license AGPL-3.0-or-later
 * @copyright 2026 Shane W Watson
 */

const net = require('net');
const crypto = require('crypto');

class DiscordIPCClient {
  constructor(options = {}) {
    this.socket = null;
    this.connected = false;
    this.clientId = null;
    this.accessToken = null;
    this.logger = options.logger || console.log;
  }

  /**
   * Resolves the path to the Discord IPC pipe.
   * @param {number} id - Pipe ID (0 to 9).
   */
  getIPCPath(id = 0) {
    if (process.platform === 'win32') {
      return `\\\\.\\pipe\\discord-ipc-${id}`;
    }
    const { env: { XDG_RUNTIME_DIR, TMPDIR, TMP, TEMP } } = process;
    const prefix = XDG_RUNTIME_DIR || TMPDIR || TMP || TEMP || '/tmp';
    return `${prefix.replace(/\/$/, '')}/discord-ipc-${id}`;
  }

  /**
   * Establishes a connection to the Discord client.
   * @param {string} clientId - Discord application Client ID.
   * @param {string} [accessToken=null] - OAuth2 access token for authenticated RPC.
   */
  async connect(clientId, accessToken = null) {
    if (this.socket) {
      this.disconnect();
    }
    this.clientId = clientId;
    this.accessToken = accessToken;

    return new Promise((resolve, reject) => {
      let pathId = 0;
      const tryConnect = () => {
        if (pathId > 9) {
          reject(new Error('Could not find running Discord client (tried pipes 0-9)'));
          return;
        }
        const pipePath = this.getIPCPath(pathId);
        this.logger(`[discord-rpc] Attempting to connect to ${pipePath}...`);
        
        const socket = net.createConnection(pipePath);

        socket.on('connect', () => {
          this.logger(`[discord-rpc] Connected to ${pipePath}. Sending handshake...`);
          this.socket = socket;
          this.connected = true;

          // Once connected, set up close/error handlers for the socket
          socket.on('close', () => {
            this.logger('[discord-rpc] Socket closed');
            this.disconnect();
          });

          socket.on('error', (err) => {
            this.logger(`[discord-rpc] Socket error: ${err.message}`);
            this.disconnect();
          });

          this.sendHandshake()
            .then(() => {
              if (this.accessToken) {
                this.logger('[discord-rpc] Handshake success. Authenticating with access token...');
                return this.authenticate();
              }
              this.logger('[discord-rpc] Handshake success (unauthenticated mode)');
            })
            .then(() => {
              resolve();
            })
            .catch(err => {
              this.logger(`[discord-rpc] Connection post-handshake setup failed: ${err.message}`);
              this.disconnect();
              reject(err);
            });
        });

        socket.on('error', () => {
          socket.destroy();
          pathId++;
          tryConnect();
        });
      };

      tryConnect();
    });
  }

  /**
   * Disconnects the socket cleanly.
   */
  disconnect() {
    this.connected = false;
    if (this.socket) {
      this.logger('[discord-rpc] Disconnecting Discord IPC socket');
      try {
        this.socket.destroy();
      } catch (e) {
        this.logger(`[discord-rpc] Error destroying socket: ${e.message}`);
      }
      this.socket = null;
    }
  }

  /**
   * Packets have a header with opcode and payload length.
   * @param {number} op - Opcode.
   * @param {object} payload - Payload to stringify.
   */
  send(op, payload) {
    if (!this.socket || !this.connected) {
      this.logger('[discord-rpc] Cannot send: not connected');
      return;
    }
    const jsonStr = JSON.stringify(payload);
    const dataBuf = Buffer.from(jsonStr, 'utf8');
    const headerBuf = Buffer.alloc(8);
    headerBuf.writeUInt32LE(op, 0);
    headerBuf.writeUInt32LE(dataBuf.length, 4);
    try {
      this.socket.write(Buffer.concat([headerBuf, dataBuf]));
    } catch (err) {
      this.logger(`[discord-rpc] Socket write error: ${err.message}`);
      this.disconnect();
    }
  }

  /**
   * Send the initial handshake packet.
   */
  async sendHandshake() {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error('Handshake response timed out'));
      }, 5000);

      const onData = (data) => {
        try {
          if (data.length < 8) return;
          const op = data.readUInt32LE(0);
          const len = data.readUInt32LE(4);
          if (data.length < 8 + len) return; // Wait for full packet

          const payloadStr = data.toString('utf8', 8, 8 + len);
          const payload = JSON.parse(payloadStr);

          if (payload.evt === 'READY') {
            cleanup();
            resolve();
          } else if (payload.evt === 'ERROR') {
            cleanup();
            reject(new Error(`Handshake error: ${payload.data.message || payloadStr}`));
          }
        } catch (e) {
          cleanup();
          reject(e);
        }
      };

      const cleanup = () => {
        clearTimeout(timeout);
        if (this.socket) {
          this.socket.removeListener('data', onData);
        }
      };

      this.socket.on('data', onData);
      this.send(0, { v: 1, client_id: this.clientId });
    });
  }

  /**
   * Authenticate the connection with an OAuth2 access token.
   */
  async authenticate() {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error('Authentication response timed out'));
      }, 5000);

      const onData = (data) => {
        try {
          if (data.length < 8) return;
          const op = data.readUInt32LE(0);
          const len = data.readUInt32LE(4);
          if (data.length < 8 + len) return;

          const payloadStr = data.toString('utf8', 8, 8 + len);
          const payload = JSON.parse(payloadStr);

          if (payload.cmd === 'AUTHENTICATE') {
            if (payload.evt === 'ERROR') {
              cleanup();
              reject(new Error(`Authentication failed: ${payload.data.message || payloadStr}`));
            } else {
              cleanup();
              resolve();
            }
          }
        } catch (e) {
          cleanup();
          reject(e);
        }
      };

      const cleanup = () => {
        clearTimeout(timeout);
        if (this.socket) {
          this.socket.removeListener('data', onData);
        }
      };

      this.socket.on('data', onData);
      this.send(1, {
        cmd: 'AUTHENTICATE',
        args: { access_token: this.accessToken },
        nonce: crypto.randomUUID()
      });
    });
  }

  /**
   * Sets the Rich Presence activity.
   * @param {object} activity - Discord Rich Presence activity object.
   */
  setActivity(activity) {
    if (!this.connected) return;
    this.send(1, {
      cmd: 'SET_ACTIVITY',
      args: {
        pid: process.pid,
        activity: activity
      },
      nonce: crypto.randomUUID()
    });
  }
}

module.exports = DiscordIPCClient;
