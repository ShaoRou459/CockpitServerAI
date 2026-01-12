/*
 * Cryptographic utilities for secure API key storage
 *
 * Uses Web Crypto API with:
 * - PBKDF2 for key derivation from user session info
 * - AES-GCM for authenticated encryption
 *
 * The encryption key is derived from the user's session info (username + uid),
 * meaning the encrypted data can only be decrypted by the same user.
 */

import cockpit from 'cockpit';

// Constants for encryption
const PBKDF2_ITERATIONS = 100000;
const SALT_LENGTH = 16;
const IV_LENGTH = 12;
const KEY_LENGTH = 256;

// Static application salt - provides additional entropy
// This is not secret, just ensures keys are unique to this application
const APP_SALT = 'cockpit-ai-agent-v1';

/**
 * Derive an encryption key from user session info
 */
async function deriveKey(userInfo: { name: string; uid: number }): Promise<CryptoKey> {
    const encoder = new TextEncoder();

    // Combine user info with app salt to create key material
    const keyMaterial = encoder.encode(`${APP_SALT}:${userInfo.name}:${userInfo.uid}`);

    // Import the key material for PBKDF2
    const baseKey = await crypto.subtle.importKey(
        'raw',
        keyMaterial,
        'PBKDF2',
        false,
        ['deriveKey']
    );

    // Use a fixed salt derived from user info (deterministic)
    const salt = encoder.encode(`${APP_SALT}-salt-${userInfo.name}`);

    // Derive the actual encryption key
    return crypto.subtle.deriveKey(
        {
            name: 'PBKDF2',
            salt,
            iterations: PBKDF2_ITERATIONS,
            hash: 'SHA-256'
        },
        baseKey,
        { name: 'AES-GCM', length: KEY_LENGTH },
        false,
        ['encrypt', 'decrypt']
    );
}

/**
 * Encrypt a string value
 * Returns a base64-encoded string containing IV + ciphertext
 */
export async function encryptValue(plaintext: string): Promise<string> {
    try {
        const userInfo = await cockpit.user();
        const key = await deriveKey(userInfo);

        const encoder = new TextEncoder();
        const data = encoder.encode(plaintext);

        // Generate a random IV for each encryption
        const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));

        // Encrypt the data
        const ciphertext = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv },
            key,
            data
        );

        // Combine IV + ciphertext and encode as base64
        const combined = new Uint8Array(iv.length + ciphertext.byteLength);
        combined.set(iv, 0);
        combined.set(new Uint8Array(ciphertext), iv.length);

        return btoa(String.fromCharCode(...combined));
    } catch (error) {
        console.error('Encryption failed:', error);
        throw new Error('Failed to encrypt value');
    }
}

/**
 * Decrypt a string value
 * Expects a base64-encoded string containing IV + ciphertext
 */
export async function decryptValue(encrypted: string): Promise<string> {
    try {
        const userInfo = await cockpit.user();
        const key = await deriveKey(userInfo);

        // Decode from base64
        const combined = Uint8Array.from(atob(encrypted), c => c.charCodeAt(0));

        // Extract IV and ciphertext
        const iv = combined.slice(0, IV_LENGTH);
        const ciphertext = combined.slice(IV_LENGTH);

        // Decrypt the data
        const decrypted = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv },
            key,
            ciphertext
        );

        const decoder = new TextDecoder();
        return decoder.decode(decrypted);
    } catch (error) {
        console.error('Decryption failed:', error);
        throw new Error('Failed to decrypt value - key may have been encrypted by a different user');
    }
}

/**
 * Check if a string looks like an encrypted value (base64 with minimum length)
 */
export function isEncrypted(value: string): boolean {
    if (!value || value.length < 20) {
        return false;
    }

    // Check if it's valid base64 and has the right structure
    try {
        const decoded = atob(value);
        // Minimum: 12 bytes IV + 16 bytes (minimum AES-GCM ciphertext with auth tag)
        return decoded.length >= 28;
    } catch {
        return false;
    }
}

/**
 * Encrypt if not already encrypted, otherwise return as-is
 */
export async function ensureEncrypted(value: string): Promise<string> {
    if (!value) {
        return value;
    }

    if (isEncrypted(value)) {
        // Already encrypted, verify we can decrypt it
        try {
            await decryptValue(value);
            return value;
        } catch {
            // Can't decrypt, probably plaintext that looks like base64
            // Re-encrypt it
        }
    }

    return encryptValue(value);
}

/**
 * Decrypt if encrypted, otherwise return as-is (for migration)
 */
export async function ensureDecrypted(value: string): Promise<string> {
    if (!value) {
        return value;
    }

    if (isEncrypted(value)) {
        try {
            return await decryptValue(value);
        } catch {
            // Decryption failed, might be plaintext that looks like base64
            // Return as-is
            return value;
        }
    }

    return value;
}
