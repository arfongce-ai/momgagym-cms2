// firebase.js — Firebase 연결 설정
// 이 파일은 앱이 어느 Firebase 창고에 연결할지 알려주는 "주소+열쇠" 파일입니다.
import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';

const firebaseConfig = {
  apiKey: "AIzaSyC9R63MgGXKE0lQ_hfCR8LHRmMRv1jiugk",
  authDomain: "momgagym-cms.firebaseapp.com",
  projectId: "momgagym-cms",
  storageBucket: "momgagym-cms.firebasestorage.app",
  messagingSenderId: "28887391734",
  appId: "1:28887391734:web:42eb4981c8dcacaccd7bd7"
};

const app = initializeApp(firebaseConfig);

// Firestore(데이터 창고) 연결
export const db = getFirestore(app);
// Authentication(로그인) 연결
export const auth = getAuth(app);
export default app;
