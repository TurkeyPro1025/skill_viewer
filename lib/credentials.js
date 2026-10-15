'use strict';

/**
 * 加密凭据存储:API key 等机密绝不以明文落盘。
 * 主密钥优先放 OS 凭据库(Windows DPAPI / macOS Keychain / Linux secret-tool),
 * 均不可用时回退为机器指纹派生(scrypt)。凭据文件用 AES-256-GCM 加密,
 * 文件头记录主密钥来源,来源变化时宁可作废也不静默换钥。
 */

const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const SALT = 'skill-viewer/credentials/v1';
const KEY_LEN = 32;
const KEYRING_SERVICE = 'skill-viewer';
const KEYRING_ACCOUNT = 'masterkey';
const EXEC_OPTS = { timeout: 20000, maxBuffer: 64 * 1024 };

function maskSecret(value) {
  if (!value) return null;
  const v = String(value);
  if (v.length <= 8) return `${v.slice(0, 2)}***`;
  return `${v.slice(0, 3)}***${v.slice(-4)}`;
}

function machineFingerprint() {
  let mac = '';
  outer: for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list || []) {
      if (ni.internal || !ni.mac || ni.mac === '00:00:00:00:00:00') continue;
      mac = ni.mac;
      break outer;
    }
  }
  return `${os.hostname()}|${os.userInfo().username}|${mac}`;
}

/* ---- OS 凭据库适配(统一 get/set b64 接口) ---- */

function dpapiKeyring(masterFile) {
  // b64 直接内嵌命令行(仅 [A-Za-z0-9+/=],无注入面;数据 ~44 字符)。
  // 不能走 stdin:PowerShell -Command 下 [Console]::In.ReadToEnd() 会与宿主
  // 的 stdin 读取竞争而挂死(实测),故改用参数传递。
  const run = (op, b64) => {
    const script = `
Add-Type -AssemblyName System.Security
$in = '${b64}'
$bytes = [Convert]::FromBase64String($in)
$out = [Security.Cryptography.ProtectedData]::${op}($bytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
[Convert]::ToBase64String($out)
`;
    return execFileAsync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], EXEC_OPTS)
      .then(({ stdout }) => stdout.trim());
  };
  return {
    kind: 'dpapi',
    async get() {
      if (!fs.existsSync(masterFile)) return null;
      const blob = fs.readFileSync(masterFile, 'utf8').trim();
      if (!blob) return null;
      const b64 = await run('Unprotect', blob);
      Buffer.from(b64, 'base64'); // 校验格式,非法则抛错走兜底
      return b64;
    },
    async set(b64) {
      writeSecretFile(masterFile, await run('Protect', b64));
    },
  };
}

function keychainKeyring() {
  return {
    kind: 'keychain',
    async get() {
      const { stdout } = await execFileAsync('security', ['find-generic-password', '-s', KEYRING_SERVICE, '-a', KEYRING_ACCOUNT, '-w'], EXEC_OPTS);
      const v = stdout.trim();
      return v || null;
    },
    async set(b64) {
      await execFileAsync('security', ['add-generic-password', '-s', KEYRING_SERVICE, '-a', KEYRING_ACCOUNT, '-w', b64, '-U'], EXEC_OPTS);
    },
  };
}

function secretToolKeyring() {
  return {
    kind: 'secret-tool',
    async get() {
      const { stdout } = await execFileAsync('secret-tool', ['lookup', 'service', KEYRING_SERVICE, 'account', KEYRING_ACCOUNT], EXEC_OPTS);
      const v = stdout.trim();
      return v || null;
    },
    async set(b64) {
      await execFileAsync('secret-tool', ['store', '--label=skill-viewer', 'service', KEYRING_SERVICE, 'account', KEYRING_ACCOUNT], { ...EXEC_OPTS, input: `${b64}\n` });
    },
  };
}

function platformKeyring(masterFile) {
  if (process.platform === 'win32') return dpapiKeyring(masterFile);
  if (process.platform === 'darwin') return keychainKeyring();
  if (process.platform === 'linux') return secretToolKeyring();
  return null;
}

/* ---- AES-256-GCM ---- */

function encryptAesGcm(key, plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ct: ct.toString('base64') };
}

function decryptAesGcm(key, ivB64, tagB64, ctB64) {
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString('utf8');
}

function writeSecretFile(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, content, 'utf8');
  try { fs.chmodSync(tmp, 0o600); } catch { /* Windows 无此语义 */ }
  fs.renameSync(tmp, file);
}

/* ---- 存储本体 ---- */

function createCredentialStore({ dataDir }) {
  const credFile = path.join(dataDir, 'credentials.enc');
  let master = null;
  let masterKind = null;
  let creds = {};

  async function init() {
    fs.mkdirSync(dataDir, { recursive: true });
    const keyring = platformKeyring(path.join(dataDir, '.masterkey'));

    let key = null;
    let kind = null;
    if (keyring) {
      try {
        const existing = await keyring.get();
        if (existing && existing.length >= 40) {
          key = Buffer.from(existing, 'base64');
          kind = keyring.kind;
        }
      } catch { /* 未存过或读取失败 */ }
    }
    if (!key) {
      const fresh = crypto.randomBytes(KEY_LEN);
      let stored = false;
      if (keyring) {
        try {
          await keyring.set(fresh.toString('base64'));
          stored = true;
        } catch { /* 锁定/权限 → 兜底 */ }
      }
      if (stored) {
        key = fresh;
        kind = keyring.kind;
      } else {
        key = crypto.scryptSync(machineFingerprint(), SALT, KEY_LEN);
        kind = 'machine';
      }
    }
    master = key;
    masterKind = kind;

    creds = {};
    if (fs.existsSync(credFile)) {
      try {
        const env = JSON.parse(fs.readFileSync(credFile, 'utf8'));
        if (env.version === 1 && env.kind === masterKind) {
          creds = JSON.parse(decryptAesGcm(master, env.iv, env.tag, env.ct));
        } else if (env.kind && env.kind !== masterKind) {
          console.warn(`[credentials] 主密钥来源已变化(${env.kind} → ${masterKind}),已存密钥无法解密,需重新录入`);
        }
      } catch (err) {
        console.warn(`[credentials] 凭据文件解密失败,忽略并重新开始: ${err.message}`);
      }
    }
    return store;
  }

  function persist() {
    writeSecretFile(credFile, JSON.stringify({
      version: 1,
      kind: masterKind,
      alg: 'aes-256-gcm',
      ...encryptAesGcm(master, JSON.stringify(creds)),
    }));
  }

  const store = {
    init,
    get kind() {
      return masterKind;
    },
    get(name) {
      return typeof creds[name] === 'string' ? creds[name] : null;
    },
    set(name, value) {
      if (master === null) throw new Error('credential store 未初始化(需 await init())');
      creds[name] = String(value);
      persist();
    },
    delete(name) {
      if (name in creds) {
        delete creds[name];
        persist();
      }
    },
  };
  return store;
}

module.exports = { createCredentialStore, maskSecret };
