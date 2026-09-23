import { 
  db, 
  collection, 
  doc, 
  getDocs, 
  setDoc, 
  updateDoc, 
  deleteDoc,
  onSnapshot 
} from './firebase';
import { Candidate, InterviewSlot } from '../types';
import { INITIAL_CANDIDATES, INITIAL_INTERVIEW_SLOTS } from '../data/mockCandidates';

const CANDIDATES_COLLECTION = 'candidates';
const SLOTS_COLLECTION = 'interview_slots';

/**
 * Service providing Firestore real-time synchronization with local state fallback
 */
export const firestoreDataService = {
  /**
   * Seed Firestore collections with initial recruitment records if empty
   */
  async seedInitialDataIfEmpty(): Promise<void> {
    try {
      const candidatesSnap = await getDocs(collection(db, CANDIDATES_COLLECTION));
      if (candidatesSnap.empty) {
        console.log('[Firestore] Seeding initial candidate roster to Firestore...');
        for (const candidate of INITIAL_CANDIDATES) {
          await setDoc(doc(db, CANDIDATES_COLLECTION, candidate.id), {
            ...candidate,
            updatedAt: new Date().toISOString()
          });
        }
      }

      const slotsSnap = await getDocs(collection(db, SLOTS_COLLECTION));
      if (slotsSnap.empty) {
        console.log('[Firestore] Seeding interview calendar slots to Firestore...');
        for (const slot of INITIAL_INTERVIEW_SLOTS) {
          await setDoc(doc(db, SLOTS_COLLECTION, slot.id), {
            ...slot,
            updatedAt: new Date().toISOString()
          });
        }
      }
    } catch (err) {
      console.warn('[Firestore] Seed operation notice (offline or rules fallback):', err);
    }
  },

  /**
   * Realtime subscriber for candidates
   */
  subscribeCandidates(
    onData: (candidates: Candidate[]) => void,
    onError?: (err: any) => void
  ): () => void {
    try {
      const unsub = onSnapshot(
        collection(db, CANDIDATES_COLLECTION),
        (snapshot) => {
          if (!snapshot.empty) {
            const list: Candidate[] = [];
            snapshot.forEach((docSnap) => {
              list.push(docSnap.data() as Candidate);
            });
            onData(list);
          } else {
            // First time load fallback
            onData(INITIAL_CANDIDATES);
          }
        },
        (error) => {
          console.warn('[Firestore] Candidates snapshot subscription fallback:', error);
          if (onError) onError(error);
        }
      );
      return unsub;
    } catch (e) {
      console.warn('[Firestore] Realtime subscription init error:', e);
      return () => {};
    }
  },

  /**
   * Realtime subscriber for interview slots
   */
  subscribeInterviewSlots(
    onData: (slots: InterviewSlot[]) => void,
    onError?: (err: any) => void
  ): () => void {
    try {
      const unsub = onSnapshot(
        collection(db, SLOTS_COLLECTION),
        (snapshot) => {
          if (!snapshot.empty) {
            const list: InterviewSlot[] = [];
            snapshot.forEach((docSnap) => {
              list.push(docSnap.data() as InterviewSlot);
            });
            onData(list);
          } else {
            onData(INITIAL_INTERVIEW_SLOTS);
          }
        },
        (error) => {
          console.warn('[Firestore] Slots snapshot subscription fallback:', error);
          if (onError) onError(error);
        }
      );
      return unsub;
    } catch (e) {
      console.warn('[Firestore] Realtime subscription init error:', e);
      return () => {};
    }
  },

  /**
   * Persist or update candidate in Firestore
   */
  async saveCandidate(candidate: Candidate): Promise<void> {
    try {
      const docRef = doc(db, CANDIDATES_COLLECTION, candidate.id);
      await setDoc(docRef, {
        ...candidate,
        updatedAt: new Date().toISOString()
      }, { merge: true });
    } catch (error) {
      console.warn('[Firestore] Failed to persist candidate to cloud:', error);
    }
  },

  /**
   * Persist or update interview slot in Firestore
   */
  async saveInterviewSlot(slot: InterviewSlot): Promise<void> {
    try {
      const docRef = doc(db, SLOTS_COLLECTION, slot.id);
      await setDoc(docRef, {
        ...slot,
        updatedAt: new Date().toISOString()
      }, { merge: true });
    } catch (error) {
      console.warn('[Firestore] Failed to persist interview slot to cloud:', error);
    }
  }
};
