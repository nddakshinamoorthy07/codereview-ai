/**
 * lib/firebase.js
 * Firebase + Firestore integration for CodeReview.ai
 *
 * Exports:
 *   db                — Firestore instance (usable in API routes + browser)
 *   saveToFirestore(report)   → Promise<string>  (document ID)
 */

import { initializeApp, getApps } from "firebase/app";
import {
  getFirestore,
  collection,
  addDoc,
  serverTimestamp,
} from "firebase/firestore";

// ---------------------------------------------------------------------------
// Config — all values come from environment variables
// ---------------------------------------------------------------------------
const firebaseConfig = {
  apiKey:            process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain:        process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId:         process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket:     process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId:             process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

// ---------------------------------------------------------------------------
// App initialization — guarded against double-init on Next.js hot reload
// Works in both Node.js (API routes) and the browser.
// ---------------------------------------------------------------------------
const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);

/** Firestore database instance — import this wherever you need Firestore */
export const db = getFirestore(app);

// ---------------------------------------------------------------------------
// saveToFirestore
// ---------------------------------------------------------------------------

/**
 * Writes a code health report to the "reports" Firestore collection.
 * Called from pages/api/analyze.js after a successful analysis.
 *
 * The saved document contains every field from the report object, plus
 * a server-side `savedAt` timestamp.
 *
 * @param {Object} report - Full report returned by analyzeCode()
 * @returns {Promise<string>} The Firestore document ID
 */
export async function saveToFirestore(report) {
  const docRef = await addDoc(collection(db, "reports"), {
    ...report,
    savedAt: serverTimestamp(),
  });
  return docRef.id;
}
