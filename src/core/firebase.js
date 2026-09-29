import { initializeApp } from 'firebase/app';
import { getAnalytics, isSupported } from 'firebase/analytics';

const firebaseConfig = {
  apiKey: "AIzaSyDrey5Oqr1Y37C_lZ-bGvAWAMOYYZRN3K0",
  authDomain: "universe-project-da6af.firebaseapp.com",
  projectId: "universe-project-da6af",
  storageBucket: "universe-project-da6af.firebasestorage.app",
  messagingSenderId: "107276148522",
  appId: "1:107276148522:web:13c8db9416ce66844b0853",
  measurementId: "G-R7ZCMTH3EC"
};

export const app = initializeApp(firebaseConfig);

export let analytics = null;
if (typeof window !== 'undefined') {
  isSupported().then((supported) => {
    if (supported) {
      analytics = getAnalytics(app);
    }
  }).catch(() => {});
}
