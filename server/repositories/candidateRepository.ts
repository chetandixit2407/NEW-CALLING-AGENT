import { Candidate } from '../../src/types';
import {
  db,
  doc,
  collection,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  runTransaction,
  DATABASE_PROVIDER,
  retryFirestoreOp,
} from '../services/firestoreDb';
import fs from 'fs';
import path from 'path';

const CANDIDATES_COLLECTION = 'candidates';
const DATA_DIR = path.join(process.cwd(), 'data');
const LOCAL_JSON_FILE = path.join(DATA_DIR, 'candidates.json');

export interface CallingLockResult {
  success: boolean;
  reason?: string;
  activeCallId?: string;
  candidate?: Candidate;
}

export class CandidateRepository {
  private localCache: Map<string, Candidate> = new Map();
  private isInitialized = false;

  constructor() {
    this.initialize();
  }

  private async initialize() {
    if (DATABASE_PROVIDER === 'local_json') {
      this.loadFromLocalJson();
    }
    this.isInitialized = true;
  }

  private loadFromLocalJson() {
    try {
      if (fs.existsSync(LOCAL_JSON_FILE)) {
        const raw = fs.readFileSync(LOCAL_JSON_FILE, 'utf-8');
        const list: Candidate[] = JSON.parse(raw);
        for (const c of list) {
          this.localCache.set(c.id, c);
        }
      }
    } catch (e) {
      console.warn('[CandidateRepository] Local JSON load error:', e);
    }
  }

  private saveToLocalJson() {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      const list = Array.from(this.localCache.values());
      fs.writeFileSync(LOCAL_JSON_FILE, JSON.stringify(list, null, 2), 'utf-8');
    } catch (e) {
      console.warn('[CandidateRepository] Local JSON save error:', e);
    }
  }

  /**
   * Retrieve a candidate by stable ID
   */
  public async getCandidate(candidateId: string): Promise<Candidate | null> {
    if (this.localCache.has(candidateId)) {
      return this.localCache.get(candidateId)!;
    }

    if (DATABASE_PROVIDER === 'firestore') {
      try {
        const docRef = doc(db, CANDIDATES_COLLECTION, candidateId);
        const snap = await retryFirestoreOp(() => getDoc(docRef));
        if (snap.exists()) {
          const cand = snap.data() as Candidate;
          this.localCache.set(cand.id, cand);
          return cand;
        }
      } catch (err) {
        console.warn(`[CandidateRepository] Firestore get error for candidate ${candidateId}:`, err);
      }
    }

    return null;
  }

  /**
   * Retrieve all candidates
   */
  public async getAllCandidates(): Promise<Candidate[]> {
    if (DATABASE_PROVIDER === 'firestore') {
      try {
        const colRef = collection(db, CANDIDATES_COLLECTION);
        const snap = await retryFirestoreOp(() => getDocs(colRef));
        const list: Candidate[] = [];
        snap.forEach((docSnap) => {
          const cand = docSnap.data() as Candidate;
          list.push(cand);
          this.localCache.set(cand.id, cand);
        });
        if (list.length > 0) return list;
      } catch (err) {
        console.warn('[CandidateRepository] Firestore getAllCandidates error, falling back to cache:', err);
      }
    }

    return Array.from(this.localCache.values());
  }

  /**
   * Save or overwrite a candidate document
   */
  public async saveCandidate(candidate: Candidate): Promise<void> {
    const updatedCandidate: Candidate = {
      ...candidate,
    };

    this.localCache.set(candidate.id, updatedCandidate);

    if (DATABASE_PROVIDER === 'local_json') {
      this.saveToLocalJson();
    }

    if (DATABASE_PROVIDER === 'firestore') {
      try {
        const docRef = doc(db, CANDIDATES_COLLECTION, candidate.id);
        await retryFirestoreOp(() =>
          setDoc(
            docRef,
            {
              ...updatedCandidate,
              updatedAt: new Date().toISOString(),
            },
            { merge: true }
          )
        );
      } catch (err) {
        console.warn(`[CandidateRepository] Failed to save candidate ${candidate.id} to Firestore:`, err);
      }
    }
  }

  /**
   * Partial update for a candidate
   */
  public async updateCandidate(candidateId: string, partial: Partial<Candidate>): Promise<Candidate | null> {
    let candidate = await this.getCandidate(candidateId);
    if (!candidate) return null;

    const merged: Candidate = {
      ...candidate,
      ...partial,
      id: candidateId, // Guarantee immutable ID
    };

    await this.saveCandidate(merged);
    return merged;
  }

  /**
   * Delete a candidate
   */
  public async deleteCandidate(candidateId: string): Promise<boolean> {
    this.localCache.delete(candidateId);

    if (DATABASE_PROVIDER === 'local_json') {
      this.saveToLocalJson();
    }

    if (DATABASE_PROVIDER === 'firestore') {
      try {
        const docRef = doc(db, CANDIDATES_COLLECTION, candidateId);
        await retryFirestoreOp(() => deleteDoc(docRef));
        return true;
      } catch (err) {
        console.warn(`[CandidateRepository] Failed to delete candidate ${candidateId}:`, err);
        return false;
      }
    }

    return true;
  }

  /**
   * Rule 16 Calling Lock: Atomically acquire lock before initiating an AI or Vapi call
   */
  public async acquireCallingLock(
    candidateId: string,
    callId: string,
    lockTimeoutMinutes: number = 10
  ): Promise<CallingLockResult> {
    const now = new Date();
    const nowIso = now.toISOString();

    if (DATABASE_PROVIDER === 'firestore') {
      try {
        const docRef = doc(db, CANDIDATES_COLLECTION, candidateId);
        const result = await runTransaction(db, async (transaction) => {
          const snap = await transaction.get(docRef);
          if (!snap.exists()) {
            return { success: false, reason: 'CANDIDATE_NOT_FOUND' };
          }

          const cand = snap.data() as any;
          const isCurrentlyCalling = cand.isCalling === true;
          const callStartedAt = cand.callStartedAt ? new Date(cand.callStartedAt).getTime() : 0;
          const lockExpired = now.getTime() - callStartedAt > lockTimeoutMinutes * 60 * 1000;

          if (isCurrentlyCalling && !lockExpired && cand.activeCallId !== callId) {
            return {
              success: false,
              reason: 'ALREADY_IN_CALL',
              activeCallId: cand.activeCallId,
            };
          }

          // Acquire lock
          transaction.update(docRef, {
            isCalling: true,
            activeCallId: callId,
            callStartedAt: nowIso,
            updatedAt: nowIso,
          });

          return { success: true, candidate: { ...cand, isCalling: true, activeCallId: callId } as Candidate };
        });

        if (result.success && result.candidate) {
          this.localCache.set(candidateId, result.candidate);
        }
        return result;
      } catch (err) {
        console.warn(`[CandidateRepository] Transaction lock error for ${candidateId}:`, err);
      }
    }

    // Local fallback check
    const local = this.localCache.get(candidateId);
    if (local) {
      const isCurrentlyCalling = (local as any).isCalling === true;
      const callStartedAt = (local as any).callStartedAt ? new Date((local as any).callStartedAt).getTime() : 0;
      const lockExpired = now.getTime() - callStartedAt > lockTimeoutMinutes * 60 * 1000;

      if (isCurrentlyCalling && !lockExpired && (local as any).activeCallId !== callId) {
        return { success: false, reason: 'ALREADY_IN_CALL', activeCallId: (local as any).activeCallId };
      }

      (local as any).isCalling = true;
      (local as any).activeCallId = callId;
      (local as any).callStartedAt = nowIso;
      return { success: true, candidate: local };
    }

    return { success: true };
  }

  /**
   * Rule 16 Calling Lock: Atomically release lock after call ends
   */
  public async releaseCallingLock(candidateId: string, callId?: string): Promise<boolean> {
    const nowIso = new Date().toISOString();

    if (DATABASE_PROVIDER === 'firestore') {
      try {
        const docRef = doc(db, CANDIDATES_COLLECTION, candidateId);
        await runTransaction(db, async (transaction) => {
          const snap = await transaction.get(docRef);
          if (!snap.exists()) return;

          const cand = snap.data() as any;
          if (!callId || cand.activeCallId === callId || !cand.activeCallId) {
            transaction.update(docRef, {
              isCalling: false,
              activeCallId: null,
              callEndedAt: nowIso,
              updatedAt: nowIso,
            });
          }
        });
      } catch (err) {
        console.warn(`[CandidateRepository] Error releasing lock for ${candidateId}:`, err);
      }
    }

    const local = this.localCache.get(candidateId);
    if (local) {
      (local as any).isCalling = false;
      (local as any).activeCallId = null;
      (local as any).callEndedAt = nowIso;
    }

    return true;
  }
}

export const candidateRepository = new CandidateRepository();
