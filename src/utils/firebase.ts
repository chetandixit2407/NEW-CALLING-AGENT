import { initializeApp, getApps, getApp } from 'firebase/app';
import { 
  getFirestore, 
  doc, 
  getDocFromServer,
  collection,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot
} from 'firebase/firestore';
import { 
  getAuth, 
  GoogleAuthProvider, 
  signInWithPopup, 
  signOut, 
  onAuthStateChanged,
  User as FirebaseUser
} from 'firebase/auth';
import configData from '../../firebase-applet-config.json';

const firebaseConfig = {
  apiKey: configData.apiKey,
  authDomain: configData.authDomain,
  projectId: configData.projectId,
  storageBucket: configData.storageBucket,
  messagingSenderId: configData.messagingSenderId,
  appId: configData.appId,
};

const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);

export const db = configData.firestoreDatabaseId && configData.firestoreDatabaseId !== '(default)'
  ? getFirestore(app, configData.firestoreDatabaseId)
  : getFirestore(app);

export const auth = getAuth(app);
export const googleAuthProvider = new GoogleAuthProvider();
googleAuthProvider.setCustomParameters({ prompt: 'select_account' });

/**
 * Validates connection to Firestore backend
 */
export async function testFirestoreConnection(): Promise<boolean> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    return true;
  } catch (error: any) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.warn('[Firebase] Firestore client appears offline. Retrying with local cache.');
      return false;
    }
    // Permission denied on 'test/connection' is normal because of security rules
    return true;
  }
}

export { 
  signInWithPopup, 
  signOut, 
  onAuthStateChanged, 
  type FirebaseUser,
  doc,
  collection,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot
};
