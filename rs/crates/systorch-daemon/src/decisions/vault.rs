//! Database payload encryption and a separate, native-only local-owner credential.
//! Back up this file WITH the database. It is never included in config exports.
use ring::aead::{Aad, LessSafeKey, Nonce, UnboundKey, AES_256_GCM};
use std::{
    io::Write,
    path::{Path, PathBuf},
};

pub struct Vault([u8; 64]);

pub fn path(config: &Path) -> PathBuf {
    config.with_file_name("systorch-owner.key")
}

impl Vault {
    pub fn digest(&self, bytes: &[u8]) -> String {
        let key = ring::hmac::Key::new(ring::hmac::HMAC_SHA256, &self.0[..32]);
        ring::hmac::sign(&key, bytes)
            .as_ref()
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect()
    }
    pub fn open(config: &Path, allow_create: bool) -> anyhow::Result<Self> {
        let path = path(config);
        if !path.exists() && allow_create {
            let mut options = std::fs::OpenOptions::new();
            options.write(true).create_new(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                options.mode(0o600);
            }
            match options.open(&path) {
                Ok(mut file) => {
                    let mut bytes = [0; 64];
                    getrandom::getrandom(&mut bytes)
                        .map_err(|_| anyhow::anyhow!("secure randomness unavailable"))?;
                    file.write_all(&bytes)?;
                    file.sync_all()?;
                }
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => (),
                Err(e) => return Err(e.into()),
            }
        }
        let bytes: [u8; 64] = std::fs::read(path)?.try_into().map_err(|_| {
            anyhow::anyhow!(
                "invalid SysTorch owner key; restore the original key with the database"
            )
        })?;
        Ok(Self(bytes))
    }

    pub fn owner_token(&self) -> String {
        format!(
            "st_owner_{}",
            self.0[32..]
                .iter()
                .map(|b| format!("{b:02x}"))
                .collect::<String>()
        )
    }

    fn key(&self) -> anyhow::Result<LessSafeKey> {
        UnboundKey::new(&AES_256_GCM, &self.0[..32])
            .map(LessSafeKey::new)
            .map_err(|_| anyhow::anyhow!("invalid encryption key"))
    }

    pub fn seal(&self, id: &str, bytes: &[u8]) -> anyhow::Result<Vec<u8>> {
        let mut nonce = [0; 12];
        getrandom::getrandom(&mut nonce)
            .map_err(|_| anyhow::anyhow!("secure randomness unavailable"))?;
        let mut data = bytes.to_vec();
        self.key()?
            .seal_in_place_append_tag(
                Nonce::assume_unique_for_key(nonce),
                Aad::from(id),
                &mut data,
            )
            .map_err(|_| anyhow::anyhow!("payload encryption failed"))?;
        Ok([nonce.as_slice(), data.as_slice()].concat())
    }

    pub fn open_payload(&self, id: &str, bytes: &[u8]) -> anyhow::Result<Vec<u8>> {
        let nonce: [u8; 12] = bytes
            .get(..12)
            .ok_or_else(|| anyhow::anyhow!("truncated encrypted payload"))?
            .try_into()?;
        let mut data = bytes[12..].to_vec();
        let plain = self
            .key()?
            .open_in_place(
                Nonce::assume_unique_for_key(nonce),
                Aad::from(id),
                &mut data,
            )
            .map_err(|_| {
                anyhow::anyhow!("payload authentication failed; restore the matching owner key")
            })?;
        Ok(plain.to_vec())
    }
}

/// Native RPC reads only the capability, never the payload encryption key.
pub fn local_owner_token(config: &Path) -> anyhow::Result<String> {
    Ok(Vault::open(config, false)?.owner_token())
}
