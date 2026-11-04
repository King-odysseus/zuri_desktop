/**
 * Minimal MCP client for user-configured local servers.
 *
 * Each operation owns its child process. That keeps a crashed or hostile server
 * from surviving between requests, and makes shutdown deterministic. Commands are
 * passed to spawn without a shell because connector configuration is a user input
 * boundary, not a command script.
 */

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

export const MCP_PROTOCOL_VERSION = '2024-11-05';
export const MCP_TIMEOUT_MS = 15_000;
const MAX_LINE_LENGTH = 1_000_000;
const SERVER_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const TOOL_NAME = /^[A-Za-z0-9_.-]{1,120}$/;

export function validateMcpServerConfig(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return 'MCP server must be an object.';
  if (typeof value.id !== 'string' || !SERVER_ID.test(value.id)) return 'MCP server id must use lowercase letters, numbers, underscores or hyphens.';
  if (typeof value.name !== 'string' || value.name.trim() === '' || value.name.length > 120) return 'MCP server name is required and must be at most 120 characters.';
  if (typeof value.command !== 'string' || value.command.trim() === '' || value.command.length > 300 || /[\r\n]/.test(value.command)) return 'MCP server command is required and cannot contain line breaks.';
  if (value.args !== undefined && (!Array.isArray(value.args) || value.args.some((arg) => typeof arg !== 'string' || arg.length > 10_000))) return 'MCP server args must be text values.';
  if (value.cwd !== undefined && value.cwd !== '' && (typeof value.cwd !== 'string' || value.cwd.length > 500 || /[\r\n]/.test(value.cwd))) return 'MCP server cwd must be a valid text path.';
  if (value.env !== undefined && (value.env === null || typeof value.env !== 'object' || Array.isArray(value.env) || Object.keys(value.env).length > 40)) return 'MCP server env must be an object with at most 40 entries.';
  if (value.env && Object.entries(value.env).some(([key, item]) => !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(key) || typeof item !== 'string' || item.length > 4000 || /[\r\n]/.test(item))) return 'MCP server env keys or values are invalid.';
  return null;
}

function cleanConfig(server) {
  const error = validateMcpServerConfig(server);
  if (error) throw new Error(error);
  return {
    id: server.id,
    name: server.name.trim(),
    command: server.command.trim(),
    args: Array.isArray(server.args) ? server.args.slice(0, 40) : [],
    ...(server.cwd ? { cwd: server.cwd.trim() } : {}),
    ...(server.env ? { env: { ...server.env } } : {}),
  };
}

function safeToolName(value) {
  return typeof value === 'string' && TOOL_NAME.test(value) ? value : '';
}

export function mcpToolName(serverId, toolName) {
  return `mcp__${serverId}__${toolName}`;
}

function serverTools(settings) {
  return Array.isArray(settings?.mcpServers)
    ? settings.mcpServers.filter((server) => server?.enabled === true).map(cleanConfig)
    : [];
}

function withTimeout(promise, milliseconds, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), milliseconds);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function requestServer(server, requests) {
  const config = cleanConfig(server);
  const child = spawn(config.command, config.args, {
    cwd: config.cwd || undefined,
    env: { ...process.env, ...(config.env ?? {}) },
    shell: false,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let buffer = '';
  const pending = new Map();
  let nextId = 1;
  const close = () => {
    if (!child.killed) child.kill();
  };
  const failAll = (error) => {
    for (const entry of pending.values()) entry.reject(error);
    pending.clear();
  };
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    if (buffer.length > MAX_LINE_LENGTH) {
      failAll(new Error('MCP server response was too large.'));
      close();
      return;
    }
    for (;;) {
      const newline = buffer.indexOf('\n');
      if (newline < 0) break;
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line === '') continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        failAll(new Error('MCP server returned invalid JSON.'));
        close();
        return;
      }
      if (message.id === undefined || message.id === null) continue;
      const entry = pending.get(String(message.id));
      if (!entry) continue;
      pending.delete(String(message.id));
      if (message.error) entry.reject(new Error(String(message.error.message ?? 'MCP request failed.')));
      else entry.resolve(message.result ?? {});
    }
  });
  child.on('error', (error) => failAll(new Error(`MCP server could not start: ${error.message}`)));
  child.on('exit', (code) => failAll(new Error(`MCP server stopped${code === null ? '' : ` with code ${code}`}.`)));

  const request = (method, params = {}) => {
    const id = String(nextId++);
    const message = JSON.stringify({ jsonrpc: '2.0', id: Number(id), method, params });
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      child.stdin.write(`${message}\n`, (error) => {
        if (error) {
          pending.delete(id);
          reject(new Error(`MCP request could not be sent: ${error.message}`));
        }
      });
    });
  };

  try {
    await withTimeout(request('initialize', {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'Zuri Desktop', version: '1.0.0' },
    }), MCP_TIMEOUT_MS, 'MCP server did not complete its handshake in time.');
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} })}\n`);
    const results = [];
    for (const entry of requests) {
      results.push(await withTimeout(request(entry.method, entry.params), MCP_TIMEOUT_MS, 'MCP server timed out.'));
    }
    return results;
  } finally {
    failAll(new Error('MCP server closed.'));
    close();
  }
}

export async function discoverMcpTools(server) {
  const [result] = await requestServer(server, [{ method: 'tools/list', params: {} }]);
  const tools = Array.isArray(result?.tools) ? result.tools : [];
  return tools.flatMap((tool) => {
    const name = safeToolName(tool?.name);
    if (name === '') return [];
    return [{
      name: mcpToolName(server.id, name),
      label: `${server.name}: ${name}`,
      description: typeof tool.description === 'string' && tool.description.trim() !== '' ? tool.description.slice(0, 1000) : `Run ${name} through ${server.name}.`,
      requiresConfirmation: true,
      mcpServerId: server.id,
      mcpToolName: name,
      parameters: tool.inputSchema && typeof tool.inputSchema === 'object' ? tool.inputSchema : { type: 'object', properties: {} },
    }];
  });
}

export async function listMcpTools(settings) {
  const all = [];
  for (const server of serverTools(settings)) {
    try {
      all.push(...await discoverMcpTools(server));
    } catch (error) {
      console.warn(`[zuri:mcp] ${server.id}: ${error.message}`);
    }
  }
  return all;
}

export async function callMcpTool(server, tool, args = {}) {
  const [result] = await requestServer(server, [{
    method: 'tools/call',
    params: { name: tool, arguments: args && typeof args === 'object' ? args : {} },
  }]);
  if (result?.isError === true) throw new Error('The MCP server reported that the tool failed.');
  return result;
}

export async function testMcpServer(server) {
  const tools = await discoverMcpTools(cleanConfig(server));
  return { server: { id: server.id, name: server.name }, tools };
}

export function publicMcpServer(server) {
  const config = cleanConfig(server);
  return { ...config, env: Object.keys(config.env ?? {}).reduce((result, key) => ({ ...result, [key]: '[stored]' }), {}) };
}
