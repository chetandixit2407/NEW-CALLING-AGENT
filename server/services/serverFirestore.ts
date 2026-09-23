/**
 * Server-Side Firestore Access Provider
 * Utilizes the modular Firebase JS SDK configured safely in Node.js runtime environment.
 * Reuses the official credentials from firebase-applet-config.json.
 */
import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getFirestore,
  Firestore,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  collection,
  query,
  where,
  runTransaction,
  writeBatch,
  DocumentReference,
  CollectionReference,
} from 'firebase/firestore';
import fs from 'fs';
import path from 'path';

let serverDb: Firestore | null = null;
let initialized = false;

export function getServerFirestore(): Firestore | null {
  if (serverDb) return serverDb;
  if (initialized) return null;

  try {
    const configPath = path.join(process.cwd(), 'firebase-applet-config.json');
    if (!fs.existsSync(configPath)) {
      console.warn('[ServerFirestore] firebase-applet-config.json not found.');
      initialized = true;
      return null;
    }

    const configData = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    const firebaseConfig = {
      apiKey: configData.apiKey,
      authDomain: configData.authDomain,
      projectId: configData.projectId,
      storageBucket: configData.storageBucket,
      messagingSenderId: configData.messagingSenderId,
      appId: configData.appId,
    };

    const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig, 'server-backend');
    
    serverDb = configData.firestoreDatabaseId && configData.firestoreDatabaseId !== '(default)'
      ? getFirestore(app, configData.firestoreDatabaseId)
      : getFirestore(app);

    initialized = true;
    console.log(`[ServerFirestore] Connected successfully to Firestore database: ${configData.firestoreDatabaseId || '(default)'}`);
    return serverDb;
  } catch (err) {
    console.error('[ServerFirestore] Failed to initialize server Firestore:', err);
    initialized = true;
    return null;
  }
}

export {
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  collection,
  query,
  where,
  runTransaction,
  writeBatch,
  type DocumentReference,
  type CollectionReference,
  type Firestore,
};
