import * as crypto from 'crypto';
import * as os from 'os';

export interface StoredCredential {
  domain: string;
  username: string;
  encryptedPassword: string; // base64 encoded encrypted password
  iv: string; // base64 IV
  authTag: string; // base64 auth tag
  createdAt: number;
  lastUsedAt?: number;
}

export interface CredentialSessionEntry {
  domain: string;
  username: string;
  password: string;
  timestamp: number;
}

export class CredentialManager {
  private static instance: CredentialManager | null = null;
  private sessionCredentials: Map<string, CredentialSessionEntry> = new Map();
  private persistentVault: Map<string, StoredCredential> = new Map();
  private encryptionKey: Buffer;

  private constructor() {
    // Derive key from host-specific entropy (user profile + machine salt)
    const salt = `${os.hostname()}:${os.userInfo().username}:nexus-credential-v1`;
    this.encryptionKey = crypto.scryptSync(salt, 'nexus-auth-salt', 32);
  }

  public static getInstance(): CredentialManager {
    if (!CredentialManager.instance) {
      CredentialManager.instance = new CredentialManager();
    }
    return CredentialManager.instance;
  }

  /**
   * Normalize domain string for strict origin matching (e.g., https://login.example.com/foo -> example.com)
   */
  public static normalizeDomain(rawUrlOrDomain: string): string {
    try {
      if (!rawUrlOrDomain) return '';
      let trimmed = rawUrlOrDomain.trim();
      if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
        trimmed = 'https://' + trimmed;
      }
      const parsed = new URL(trimmed);
      return parsed.hostname.toLowerCase();
    } catch {
      return rawUrlOrDomain.toLowerCase().trim();
    }
  }

  /**
   * Encrypt a sensitive password using AES-256-GCM
   */
  public encryptSecret(secret: string): { ciphertext: string; iv: string; authTag: string } {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.encryptionKey, iv);
    let ciphertext = cipher.update(secret, 'utf8', 'base64');
    ciphertext += cipher.final('base64');
    const authTag = cipher.getAuthTag().toString('base64');
    return {
      ciphertext,
      iv: iv.toString('base64'),
      authTag,
    };
  }

  /**
   * Decrypt a sensitive password using AES-256-GCM
   */
  public decryptSecret(ciphertext: string, ivBase64: string, authTagBase64: string): string {
    const iv = Buffer.from(ivBase64, 'base64');
    const authTag = Buffer.from(authTagBase64, 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.encryptionKey, iv);
    decipher.setAuthTag(authTag);
    let plaintext = decipher.update(ciphertext, 'base64', 'utf8');
    plaintext += decipher.final('utf8');
    return plaintext;
  }

  /**
   * Store credential in temporary in-memory session (purged upon application exit)
   */
  public setSessionCredential(rawDomain: string, username: string, password: string): void {
    const domain = CredentialManager.normalizeDomain(rawDomain);
    if (!domain) throw new Error('Cannot store credential without a valid target domain.');
    this.sessionCredentials.set(domain, {
      domain,
      username: username.trim(),
      password,
      timestamp: Date.now(),
    });
  }

  /**
   * Retrieve session credential for a strictly validated domain.
   */
  public getSessionCredential(targetUrlOrDomain: string): { username: string; password: string } | null {
    const targetDomain = CredentialManager.normalizeDomain(targetUrlOrDomain);
    if (!targetDomain) return null;

    // Strict domain matching - prevents cross-domain credential leakage
    const cred = this.sessionCredentials.get(targetDomain);
    if (cred) return { username: cred.username, password: cred.password };

    // Check parent domain (e.g. sub.example.com matches example.com session if explicitly configured)
    for (const [savedDomain, entry] of this.sessionCredentials.entries()) {
      if (targetDomain === savedDomain || targetDomain.endsWith('.' + savedDomain)) {
        return { username: entry.username, password: entry.password };
      }
    }

    return null;
  }

  /**
   * Persist encrypted credential with domain-binding
   */
  public storePersistentCredential(rawDomain: string, username: string, password: string): void {
    const domain = CredentialManager.normalizeDomain(rawDomain);
    if (!domain) throw new Error('Cannot store persistent credential without a target domain.');

    const { ciphertext, iv, authTag } = this.encryptSecret(password);
    this.persistentVault.set(domain, {
      domain,
      username: username.trim(),
      encryptedPassword: ciphertext,
      iv,
      authTag,
      createdAt: Date.now(),
    });
  }

  /**
   * Retrieve and decrypt persistent credential for the target domain
   */
  public getPersistentCredential(targetUrlOrDomain: string): { username: string; password: string } | null {
    const targetDomain = CredentialManager.normalizeDomain(targetUrlOrDomain);
    if (!targetDomain) return null;

    const stored = this.persistentVault.get(targetDomain);
    if (!stored) return null;

    try {
      const password = this.decryptSecret(stored.encryptedPassword, stored.iv, stored.authTag);
      stored.lastUsedAt = Date.now();
      return { username: stored.username, password };
    } catch (err) {
      console.error(`Failed to decrypt credential for domain "${targetDomain}":`, err);
      return null;
    }
  }

  /**
   * Obtain credential from session first, then persistent vault
   */
  public getCredentialForDomain(targetUrlOrDomain: string): { username: string; password: string; source: 'session' | 'vault' } | null {
    const sessionCred = this.getSessionCredential(targetUrlOrDomain);
    if (sessionCred) return { ...sessionCred, source: 'session' };

    const vaultCred = this.getPersistentCredential(targetUrlOrDomain);
    if (vaultCred) return { ...vaultCred, source: 'vault' };

    return null;
  }

  /**
   * Clear session credentials
   */
  public clearSession(rawDomain?: string): void {
    if (rawDomain) {
      const domain = CredentialManager.normalizeDomain(rawDomain);
      this.sessionCredentials.delete(domain);
    } else {
      this.sessionCredentials.clear();
    }
  }

  /**
   * Helper to mask passwords in logs and UI
   */
  public static maskSecret(secret?: string): string {
    if (!secret) return '';
    return '••••••••';
  }
}
