import { InterviewSlot } from '../../src/types';
import {
  db,
  doc,
  collection,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  runTransaction,
  DATABASE_PROVIDER,
  retryFirestoreOp,
} from '../services/firestoreDb';
import { INITIAL_INTERVIEW_SLOTS } from '../../src/data/mockCandidates';

const SLOTS_COLLECTION = 'interview_slots';

export interface SlotBookingResult {
  success: boolean;
  reason?: 'SLOT_NOT_FOUND' | 'ALREADY_BOOKED' | 'CAPACITY_REACHED' | 'TRANSACTION_FAILED';
  slot?: InterviewSlot;
}

export class InterviewSlotRepository {
  private localCache: Map<string, InterviewSlot> = new Map();

  constructor() {
    this.initialize();
  }

  private initialize() {
    for (const slot of INITIAL_INTERVIEW_SLOTS) {
      this.localCache.set(slot.id, slot);
    }
  }

  public async getAllSlots(): Promise<InterviewSlot[]> {
    if (DATABASE_PROVIDER === 'firestore') {
      try {
        const colRef = collection(db, SLOTS_COLLECTION);
        const snap = await retryFirestoreOp(() => getDocs(colRef));
        if (!snap.empty) {
          const list: InterviewSlot[] = [];
          snap.forEach((docSnap) => {
            const slot = docSnap.data() as InterviewSlot;
            list.push(slot);
            this.localCache.set(slot.id, slot);
          });
          return list;
        }
      } catch (err) {
        console.warn('[InterviewSlotRepository] Firestore fetch error, falling back to cache:', err);
      }
    }

    return Array.from(this.localCache.values());
  }

  public async getSlot(slotId: string): Promise<InterviewSlot | null> {
    if (this.localCache.has(slotId)) {
      return this.localCache.get(slotId)!;
    }

    if (DATABASE_PROVIDER === 'firestore') {
      try {
        const docRef = doc(db, SLOTS_COLLECTION, slotId);
        const snap = await retryFirestoreOp(() => getDoc(docRef));
        if (snap.exists()) {
          const slot = snap.data() as InterviewSlot;
          this.localCache.set(slot.id, slot);
          return slot;
        }
      } catch (err) {
        console.warn(`[InterviewSlotRepository] Error fetching slot ${slotId}:`, err);
      }
    }

    return null;
  }

  /**
   * Step 8 & 15: Atomically book an interview slot with concurrency protection
   */
  public async bookSlot(
    slotId: string,
    candidateId: string,
    candidateName: string
  ): Promise<SlotBookingResult> {
    const nowIso = new Date().toISOString();

    if (DATABASE_PROVIDER === 'firestore') {
      try {
        const docRef = doc(db, SLOTS_COLLECTION, slotId);
        const bookingResult = await runTransaction(db, async (transaction) => {
          const snap = await transaction.get(docRef);
          if (!snap.exists()) {
            return { success: false, reason: 'SLOT_NOT_FOUND' as const };
          }

          const slot = snap.data() as InterviewSlot;
          const maxCapacity = slot.maxCapacity || 1;
          const bookedCount = slot.bookedCount || (slot.bookedCandidateId ? 1 : 0);

          if (!slot.isAvailable || bookedCount >= maxCapacity) {
            return { success: false, reason: 'ALREADY_BOOKED' as const };
          }

          const updatedSlot: InterviewSlot = {
            ...slot,
            bookedCandidateId: candidateId,
            bookedCandidateName: candidateName,
            bookedCount: bookedCount + 1,
            isAvailable: false,
          };

          transaction.update(docRef, {
            bookedCandidateId: candidateId,
            bookedCandidateName: candidateName,
            bookedCount: bookedCount + 1,
            isAvailable: false,
            reservedAt: nowIso,
            updatedAt: nowIso,
          });

          return { success: true, slot: updatedSlot };
        });

        if (bookingResult.success && bookingResult.slot) {
          this.localCache.set(slotId, bookingResult.slot);
        }
        return bookingResult;
      } catch (err) {
        console.warn(`[InterviewSlotRepository] Slot booking transaction error for ${slotId}:`, err);
        return { success: false, reason: 'TRANSACTION_FAILED' };
      }
    }

    // Local fallback
    const local = this.localCache.get(slotId);
    if (!local) return { success: false, reason: 'SLOT_NOT_FOUND' };
    if (!local.isAvailable || (local.bookedCount || 0) >= (local.maxCapacity || 1)) {
      return { success: false, reason: 'ALREADY_BOOKED' };
    }

    local.bookedCandidateId = candidateId;
    local.bookedCandidateName = candidateName;
    local.bookedCount = (local.bookedCount || 0) + 1;
    local.isAvailable = false;
    return { success: true, slot: local };
  }

  /**
   * Release or cancel an interview slot reservation
   */
  public async releaseSlot(slotId: string, candidateId?: string): Promise<boolean> {
    const nowIso = new Date().toISOString();

    if (DATABASE_PROVIDER === 'firestore') {
      try {
        const docRef = doc(db, SLOTS_COLLECTION, slotId);
        await runTransaction(db, async (transaction) => {
          const snap = await transaction.get(docRef);
          if (!snap.exists()) return;

          const slot = snap.data() as InterviewSlot;
          if (!candidateId || slot.bookedCandidateId === candidateId) {
            transaction.update(docRef, {
              bookedCandidateId: null,
              bookedCandidateName: null,
              bookedCount: 0,
              isAvailable: true,
              updatedAt: nowIso,
            });
          }
        });
      } catch (err) {
        console.warn(`[InterviewSlotRepository] Error releasing slot ${slotId}:`, err);
      }
    }

    const local = this.localCache.get(slotId);
    if (local) {
      local.bookedCandidateId = undefined;
      local.bookedCandidateName = undefined;
      local.bookedCount = 0;
      local.isAvailable = true;
    }

    return true;
  }

  /**
   * Save or seed an interview slot
   */
  public async saveSlot(slot: InterviewSlot): Promise<void> {
    this.localCache.set(slot.id, slot);

    if (DATABASE_PROVIDER === 'firestore') {
      try {
        const docRef = doc(db, SLOTS_COLLECTION, slot.id);
        await retryFirestoreOp(() =>
          setDoc(
            docRef,
            {
              ...slot,
              updatedAt: new Date().toISOString(),
            },
            { merge: true }
          )
        );
      } catch (err) {
        console.warn(`[InterviewSlotRepository] Failed to save slot ${slot.id} to Firestore:`, err);
      }
    }
  }
}

export const interviewSlotRepository = new InterviewSlotRepository();
