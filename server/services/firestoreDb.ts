import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getFirestore,
  doc,
  collection,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  runTransaction,
  writeBatch,
  Firestore,
  onSnapshot,
} from 'firebase/firestore';
import configData from '../../firebase-applet-config.json';

// Initialize Firebase App for Server-side
const firebaseConfig = {
  apiKey: configData.apiKey,
  authDomain: configData.authDomain,
  projectId: configData.projectId,
  storageBucket: configData.storageBucket,
  messagingSenderId: configData.messagingSenderId,
  appId: configData.appId,
};

const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);

export const db: Firestore =
  configData.firestoreDatabaseId && configData.firestoreDatabaseId !== '(default)'
    ? getFirestore(app, configData.firestoreDatabaseId)
    : getFirestore(app);

export const DATABASE_PROVIDER = process.env.DATABASE_PROVIDER || 'firestore';

/**
 * Helper to safely retry a Firestore operation in case of transient network errors
 */
export async function retryFirestoreOp<T>(
  op: () => Promise<T>,
  retries: number = 2,
  delayMs: number = 300
): Promise<T> {
  try {
    return await op();
  } catch (err) {
    if (retries <= 0) throw err;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    return retryFirestoreOp(op, retries - 1, delayMs * 2);
  }
}

export {
  doc,
  collection,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  runTransaction,
  writeBatch,
  onSnapshot,
};
