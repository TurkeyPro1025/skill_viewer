//! 加密凭据存储(与 Node credentials.js 文件格式兼容,可互相读取:
//! Windows DPAPI 主密钥 + AES-256-GCM 凭据文件)。
//! 注意:非 Windows 的 machine 兜底指纹与 Node 版(含 MAC)不同,
//! 跨实现仅 Windows/DPAPI 路径保证互通——桌面版 v1 只面向 Windows。
//! 密钥绝不以明文落盘。

use crate::util;
use aes_gcm::aead::{Aead, KeyInit, Payload};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::path::PathBuf;
use tokio::sync::Mutex;

const SALT: &[u8] = b"skill-viewer/credentials/v1";
const KEY_LEN: usize = 32;

pub struct CredentialStore {
    cred_file: PathBuf,
    master_file: PathBuf,
    inner: Mutex<Inner>,
}

struct Inner {
    master: Option<Vec<u8>>,
    master_kind: Option<String>,
    creds: BTreeMap<String, String>,
}

#[derive(Debug)]
pub enum CredError {
    NotInitialized,
}

impl CredentialStore {
    pub fn new(data_dir: &std::path::Path) -> Self {
        Self {
            cred_file: data_dir.join("credentials.enc"),
            master_file: data_dir.join(".masterkey"),
            inner: Mutex::new(Inner { master: None, master_kind: None, creds: BTreeMap::new() }),
        }
    }

    pub async fn init(&self) {
        let _ = std::fs::create_dir_all(self.master_file.parent().unwrap_or(std::path::Path::new(".")));
        let mut inner = self.inner.lock().await;

        let mut key: Option<Vec<u8>> = None;
        let mut kind: Option<String> = None;

        // 1) 已有主密钥(DPAPI 保护,与 Node 同一文件)。
        //    文件 = base64(DPAPI(32 字节主密钥));解开后直接就是主密钥。
        #[cfg(windows)]
        if let Some(blob_text) = std::fs::read_to_string(&self.master_file).ok() {
            let blob_text = blob_text.trim().to_string();
            if !blob_text.is_empty() {
                if let Some(dp_blob) = b64_decode(&blob_text) {
                    if let Some(master) = dpapi_unprotect(&dp_blob) {
                        if master.len() == KEY_LEN {
                            key = Some(master);
                            kind = Some("dpapi".into());
                        }
                    }
                }
            }
        }

        // 2) 生成新主密钥并落 OS 凭据库;失败则回退机器指纹派生
        if key.is_none() {
            let fresh: Vec<u8> = (0..KEY_LEN).map(|_| rand::random::<u8>()).collect();
            #[cfg(windows)]
            let stored = dpapi_protect(&fresh)
                .map(|protected| {
                    let _ = util::write_text_atomic(&self.master_file, &b64_encode(&protected));
                    true
                })
                .unwrap_or(false);
            #[cfg(not(windows))]
            let stored = false;
            if stored {
                key = Some(fresh);
                kind = Some("dpapi".into());
            } else {
                key = Some(scrypt_machine_key());
                kind = Some("machine".into());
            }
        }

        let master = key.unwrap();
        let master_kind = kind.unwrap();

        // 3) 读凭据文件(kind 匹配才解密)
        let mut creds = BTreeMap::new();
        if let Ok(text) = std::fs::read_to_string(&self.cred_file) {
            if let Ok(env) = serde_json::from_str::<Value>(&text) {
                if env.get("version").and_then(|v| v.as_i64()) == Some(1) {
                    let file_kind = env.get("kind").and_then(|v| v.as_str()).unwrap_or("");
                    if file_kind == master_kind {
                        if let Some(map) = decrypt_map(
                            &master,
                            env.get("iv").and_then(|v| v.as_str()).unwrap_or_default(),
                            env.get("tag").and_then(|v| v.as_str()).unwrap_or_default(),
                            env.get("ct").and_then(|v| v.as_str()).unwrap_or_default(),
                        ) {
                            for (k, v) in map {
                                creds.insert(k, v);
                            }
                        }
                    } else if !file_kind.is_empty() {
                        eprintln!("[credentials] 主密钥来源已变化({file_kind} → {master_kind}),已存密钥无法解密,需重新录入");
                    }
                }
            }
        }

        inner.master = Some(master);
        inner.master_kind = Some(master_kind);
        inner.creds = creds;
    }

    pub async fn kind(&self) -> String {
        self.inner.lock().await.master_kind.clone().unwrap_or_default()
    }

    pub async fn get(&self, name: &str) -> Option<String> {
        self.inner.lock().await.creds.get(name).cloned()
    }

    pub async fn set(&self, name: &str, value: &str) -> Result<(), CredError> {
        let mut inner = self.inner.lock().await;
        let Some(master) = inner.master.clone() else { return Err(CredError::NotInitialized) };
        inner.creds.insert(name.to_string(), value.to_string());
        let json_map: Value = serde_json::to_value(&inner.creds).unwrap_or(Value::Null);
        self.persist(&master, &inner.master_kind.clone().unwrap_or_default(), &json_map);
        Ok(())
    }

    pub async fn delete(&self, name: &str) {
        let mut inner = self.inner.lock().await;
        if inner.creds.remove(name).is_some() {
            let master = inner.master.clone().unwrap_or_default();
            let kind = inner.master_kind.clone().unwrap_or_default();
            let json_map: Value = serde_json::to_value(&inner.creds).unwrap_or(Value::Null);
            self.persist(&master, &kind, &json_map);
        }
    }

    fn persist(&self, master: &[u8], kind: &str, creds_json: &Value) {
        let plaintext = creds_json.to_string();
        let iv: [u8; 12] = rand::random();
        let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(master));
        let ct = cipher
            .encrypt(Nonce::from_slice(&iv), Payload { msg: plaintext.as_bytes(), aad: &[] })
            .expect("AES-GCM encrypt");
        let (ct, tag) = ct.split_at(ct.len() - 16);
        let body = json!({
            "version": 1,
            "kind": kind,
            "alg": "aes-256-gcm",
            "iv": b64_encode(&iv),
            "tag": b64_encode(tag),
            "ct": b64_encode(ct),
        });
        let _ = util::write_text_atomic(&self.cred_file, &body.to_string());
    }
}

fn decrypt_map(master: &[u8], iv_b64: &str, tag_b64: &str, ct_b64: &str) -> Option<BTreeMap<String, String>> {
    let iv = b64_decode(iv_b64)?;
    let tag = b64_decode(tag_b64)?;
    let ct = b64_decode(ct_b64)?;
    if iv.len() != 12 {
        return None;
    }
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(master));
    let mut buf = ct;
    buf.extend_from_slice(&tag);
    let plain = cipher.decrypt(Nonce::from_slice(&iv), Payload { msg: &buf, aad: &[] }).ok()?;
    serde_json::from_slice::<BTreeMap<String, String>>(&plain).ok()
}

fn scrypt_machine_key() -> Vec<u8> {
    let host = std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .unwrap_or_default();
    let user = std::env::var("USERNAME")
        .or_else(|_| std::env::var("USER"))
        .unwrap_or_default();
    let fingerprint = format!("{host}|{user}|");
    // scrypt 参数与 Node scryptSync 默认一致:N=16384(log2=14), r=8, p=1
    let params = scrypt::Params::new(14, 8, 1, KEY_LEN).expect("scrypt params");
    let mut out = vec![0u8; KEY_LEN];
    scrypt::scrypt(fingerprint.as_bytes(), SALT, &params, &mut out).expect("scrypt");
    out
}

/* ---------- DPAPI(Windows) ---------- */

#[cfg(windows)]
fn dpapi_protect(master: &[u8]) -> Option<Vec<u8>> {
    // 返回 DPAPI 保护后的 blob(调用方自行 base64 落盘,与 Node 文件格式一致)
    use windows::Win32::Foundation::{HLOCAL, LocalFree};
    use windows::Win32::Security::Cryptography::{
        CryptProtectData, CRYPT_INTEGER_BLOB, CRYPTPROTECT_UI_FORBIDDEN,
    };
    let input = master;
    unsafe {
        let in_blob = CRYPT_INTEGER_BLOB {
            cbData: input.len() as u32,
            pbData: input.as_ptr() as *mut u8,
        };
        let mut out_blob = CRYPT_INTEGER_BLOB { cbData: 0, pbData: std::ptr::null_mut() };
        CryptProtectData(
            &in_blob,
            None,
            None,
            None,
            None,
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut out_blob,
        )
        .ok()?;
        let slice = std::slice::from_raw_parts(out_blob.pbData, out_blob.cbData as usize);
        let out = slice.to_vec();
        let _ = LocalFree(HLOCAL(out_blob.pbData as *mut core::ffi::c_void));
        Some(out)
    }
}

#[cfg(windows)]
fn dpapi_unprotect(dp_blob: &[u8]) -> Option<Vec<u8>> {
    use windows::Win32::Foundation::{HLOCAL, LocalFree};
    use windows::Win32::Security::Cryptography::{
        CryptUnprotectData, CRYPT_INTEGER_BLOB, CRYPTPROTECT_UI_FORBIDDEN,
    };
    unsafe {
        let in_blob = CRYPT_INTEGER_BLOB {
            cbData: dp_blob.len() as u32,
            pbData: dp_blob.as_ptr() as *mut u8,
        };
        let mut out_blob = CRYPT_INTEGER_BLOB { cbData: 0, pbData: std::ptr::null_mut() };
        CryptUnprotectData(
            &in_blob,
            None,
            None,
            None,
            None,
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut out_blob,
        )
        .ok()?;
        let slice = std::slice::from_raw_parts(out_blob.pbData, out_blob.cbData as usize);
        let out = slice.to_vec();
        let _ = LocalFree(HLOCAL(out_blob.pbData as *mut core::ffi::c_void));
        Some(out)
    }
}

/* ---------- base64(标准字母表,无依赖) ---------- */

const B64: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

pub fn b64_encode(data: &[u8]) -> String {
    let mut out = String::with_capacity((data.len() + 2) / 3 * 4);
    for chunk in data.chunks(3) {
        let b = [chunk[0], *chunk.get(1).unwrap_or(&0), *chunk.get(2).unwrap_or(&0)];
        let n = ((b[0] as u32) << 16) | ((b[1] as u32) << 8) | b[2] as u32;
        out.push(B64[(n >> 18) as usize & 63] as char);
        out.push(B64[(n >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 { B64[(n >> 6) as usize & 63] as char } else { '=' });
        out.push(if chunk.len() > 2 { B64[n as usize & 63] as char } else { '=' });
    }
    out
}

pub fn b64_decode(s: &str) -> Option<Vec<u8>> {
    fn val(c: u8) -> Option<u32> {
        match c {
            b'A'..=b'Z' => Some((c - b'A') as u32),
            b'a'..=b'z' => Some((c - b'a' + 26) as u32),
            b'0'..=b'9' => Some((c - b'0' + 52) as u32),
            b'+' => Some(62),
            b'/' => Some(63),
            _ => None,
        }
    }
    let clean: Vec<u8> = s.bytes().filter(|c| !c.is_ascii_whitespace() && *c != b'=').collect();
    let mut out = Vec::with_capacity(clean.len() * 3 / 4);
    for chunk in clean.chunks(4) {
        let mut n: u32 = 0;
        for (i, c) in chunk.iter().enumerate() {
            n |= val(*c)? << (18 - 6 * i);
        }
        out.push((n >> 16) as u8);
        if chunk.len() > 2 {
            out.push((n >> 8) as u8);
        }
        if chunk.len() > 3 {
            out.push(n as u8);
        }
    }
    Some(out)
}
