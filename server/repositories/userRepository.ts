import {
  db,
  doc,
  collection,
  getDoc,
  getDocs,
  setDoc,
  query,
  where,
  limit,
  DATABASE_PROVIDER,
  retryFirestoreOp,
} from '../services/firestoreDb';
import fs from 'fs';
import path from 'path';

export type UserRole = 'recruiter' | 'admin' | 'hr_manager';

export interface AppUserRecord {
  uid: string;
  email: string;
  displayName: string;
  photoURL: string;
  role: UserRole;
  emailVerified: boolean;
  authProvider: 'google' | 'firebase_google' | 'password';
  createdAt: string;
  lastLoginAt: string;
  updatedAt: string;
}

const USERS_COLLECTION = 'users';
const DATA_DIR = path.join(process.cwd(), 'data');
const LOCAL_USERS_FILE = path.join(DATA_DIR, 'users.json');

export class UserRepository {
  private localCache: Map<string, AppUserRecord> = new Map();

  constructor() {
    if (DATABASE_PROVIDER === 'local_json') {
      this.loadFromLocalJson();
    }
  }

  private loadFromLocalJson() {
    try {
      if (fs.existsSync(LOCAL_USERS_FILE)) {
        const raw = fs.readFileSync(LOCAL_USERS_FILE, 'utf-8');
        const list: AppUserRecord[] = JSON.parse(raw);
        for (const u of list) {
          this.localCache.set(u.uid, u);
        }
      }
    } catch (e) {
      console.warn('[UserRepository] Local JSON load warning:', e);
    }
  }

  private saveToLocalJson() {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      const list = Array.from(this.localCache.values());
      fs.writeFileSync(LOCAL_USERS_FILE, JSON.stringify(list, null, 2), 'utf-8');
    } catch (e) {
      console.warn('[UserRepository] Local JSON save warning:', e);
    }
  }

  private resolveDefaultRole(email: string): UserRole {
    const adminEmail = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
    if (adminEmail && email.toLowerCase() === adminEmail) {
      return 'admin';
    }
    return 'recruiter';
  }

  public async getUserByUid(uid: string): Promise<AppUserRecord | null> {
    if (!uid) return null;

    if (this.localCache.has(uid)) {
      return this.localCache.get(uid)!;
    }

    if (DATABASE_PROVIDER === 'firestore') {
      try {
        const docRef = doc(db, USERS_COLLECTION, uid);
        const snap = await retryFirestoreOp(() => getDoc(docRef));
        if (snap.exists()) {
          const user = snap.data() as AppUserRecord;
          this.localCache.set(user.uid, user);
          return user;
        }
      } catch (err) {
        console.warn(`[UserRepository] Firestore getUserByUid error for ${uid}:`, err);
      }
    }

    return null;
  }

  public async findUserByEmail(email: string): Promise<AppUserRecord | null> {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) return null;

    for (const cached of this.localCache.values()) {
      if (cached.email.toLowerCase() === normalizedEmail) {
        return cached;
      }
    }

    if (DATABASE_PROVIDER === 'firestore') {
      try {
        const q = query(
          collection(db, USERS_COLLECTION),
          where('email', '==', normalizedEmail),
          limit(1)
        );
        const snap = await retryFirestoreOp(() => getDocs(q));
        if (!snap.empty) {
          const user = snap.docs[0].data() as AppUserRecord;
          this.localCache.set(user.uid, user);
          return user;
        }
      } catch (err) {
        console.warn(`[UserRepository] Firestore findUserByEmail error:`, err);
      }
    }

    return null;
  }

  /**
   * Create or update a user record without creating duplicate accounts.
   * Deduplicates by UID first, then by verified email address.
   */
  public async upsertUser(params: {
    uid: string;
    email: string;
    displayName?: string;
    photoURL?: string;
    emailVerified?: boolean;
    authProvider: 'google' | 'firebase_google' | 'password';
  }): Promise<AppUserRecord> {
    const normalizedEmail = params.email.trim().toLowerCase();
    const nowIso = new Date().toISOString();

    // 1. Check existing user by UID
    let existing = await this.getUserByUid(params.uid);

    // 2. If not found by UID, check by verified email to prevent duplicate accounts
    if (!existing && normalizedEmail) {
      existing = await this.findUserByEmail(normalizedEmail);
    }

    const canonicalUid = existing?.uid || params.uid;
    const record: AppUserRecord = {
      uid: canonicalUid,
      email: normalizedEmail,
      displayName: (params.displayName || existing?.displayName || normalizedEmail.split('@')[0] || 'HR Recruiter').slice(0, 120),
      photoURL: (params.photoURL || existing?.photoURL || '').slice(0, 1024),
      role: existing?.role || this.resolveDefaultRole(normalizedEmail),
      emailVerified: Boolean(params.emailVerified ?? existing?.emailVerified ?? false),
      authProvider: params.authProvider,
      createdAt: existing?.createdAt || nowIso,
      lastLoginAt: nowIso,
      updatedAt: nowIso,
    };

    this.localCache.set(canonicalUid, record);

    if (DATABASE_PROVIDER === 'local_json') {
      this.saveToLocalJson();
    }

    if (DATABASE_PROVIDER === 'firestore') {
      try {
        const docRef = doc(db, USERS_COLLECTION, canonicalUid);
        await retryFirestoreOp(() => setDoc(docRef, record, { merge: true }));
      } catch (err) {
        console.error(`[UserRepository] Failed to persist user ${canonicalUid} to Firestore:`, err);
      }
    }

    return record;
  }
}

export const userRepository = new UserRepository();
