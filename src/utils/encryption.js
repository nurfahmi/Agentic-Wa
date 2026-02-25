const crypto = require('crypto');
const config = require('../config');

const ALGORITHM = 'aes-256-gcm';

function deriveKey(salt) {
  return crypto.scryptSync(config.encryptionKey || 'default-key', salt, 32);
}

function encrypt(text) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(16);
  const key = deriveKey(salt);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  // Format: salt:iv:authTag:encrypted
  return `${salt.toString('hex')}:${iv.toString('hex')}:${authTag}:${encrypted}`;
}

function decrypt(encryptedText) {
  const parts = encryptedText.split(':');

  let salt, ivHex, authTagHex, encrypted;
  if (parts.length === 4) {
    // New format: salt:iv:authTag:encrypted
    [salt, ivHex, authTagHex, encrypted] = parts;
    salt = Buffer.from(salt, 'hex');
  } else {
    // Legacy format: iv:authTag:encrypted (static salt)
    [ivHex, authTagHex, encrypted] = parts;
    salt = 'salt';
  }

  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const key = deriveKey(salt);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

module.exports = { encrypt, decrypt };

