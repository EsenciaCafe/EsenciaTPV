const firebaseConfig = {
  apiKey: import.meta.env.VITE_MENU_FIREBASE_API_KEY || 'AIzaSyA_knSYppsFYJkXQHroW83Txp-jWLIxAsE',
  authDomain: import.meta.env.VITE_MENU_FIREBASE_AUTH_DOMAIN || 'esenciacafe-44755.firebaseapp.com',
  projectId: import.meta.env.VITE_MENU_FIREBASE_PROJECT_ID || 'esenciacafe-44755',
  storageBucket: import.meta.env.VITE_MENU_FIREBASE_STORAGE_BUCKET || 'esenciacafe-44755.firebasestorage.app',
  messagingSenderId: import.meta.env.VITE_MENU_FIREBASE_MESSAGING_SENDER_ID || '1058059262944',
  appId: import.meta.env.VITE_MENU_FIREBASE_APP_ID || '1:1058059262944:web:e3c54feef2fb357ffa6985'
};

let contextPromise;

async function getContext() {
  if (!contextPromise) {
    contextPromise = Promise.all([
      import('firebase/app'),
      import('firebase/auth'),
      import('firebase/firestore')
    ]).then(async ([appApi, authApi, firestoreApi]) => {
      const app = appApi.getApps().find(candidate => candidate.name === 'esencia-menu')
        || appApi.initializeApp(firebaseConfig, 'esencia-menu');
      const auth = authApi.getAuth(app);
      await authApi.setPersistence(auth, authApi.browserLocalPersistence);
      const db = firestoreApi.getFirestore(app);
      return { auth, authApi, db, firestoreApi };
    });
  }
  return contextPromise;
}

export async function observeMenuUser(callback) {
  const { auth, authApi } = await getContext();
  return authApi.onAuthStateChanged(auth, callback);
}

export async function loginMenuWithPassword(email, password) {
  const { auth, authApi } = await getContext();
  return authApi.signInWithEmailAndPassword(auth, email, password);
}

export async function loginMenuWithGoogle() {
  const { auth, authApi } = await getContext();
  return authApi.signInWithPopup(auth, new authApi.GoogleAuthProvider());
}

export async function logoutMenuUser() {
  const { auth, authApi } = await getContext();
  return authApi.signOut(auth);
}

export async function getMenuUser() {
  const { auth } = await getContext();
  return auth.currentUser;
}

export async function loadMenuSections() {
  const { db, firestoreApi: f } = await getContext();
  const snapshot = await f.getDocs(f.collection(db, 'sections'));
  const sections = await Promise.all(snapshot.docs.map(async sectionDoc => {
    const [items, toppings] = await Promise.all([
      f.getDocs(f.collection(db, 'sections', sectionDoc.id, 'items')),
      f.getDocs(f.collection(db, 'sections', sectionDoc.id, 'toppings'))
    ]);
    return {
      id: sectionDoc.id,
      ...sectionDoc.data(),
      items: items.docs.map(item => ({ id: item.id, ...item.data() })),
      toppings: toppings.docs.map(topping => ({ id: topping.id, ...topping.data() }))
    };
  }));
  return sections.sort((a, b) => Number(a.order || 9999) - Number(b.order || 9999));
}

export async function setMenuEntityHidden(type, sectionId, entityId, hidden) {
  const { db, firestoreApi: f } = await getContext();
  const target = type === 'section'
    ? f.doc(db, 'sections', sectionId)
    : f.doc(db, 'sections', sectionId, type === 'item' ? 'items' : 'toppings', entityId);
  await f.updateDoc(target, { hidden, updatedAt: f.serverTimestamp() });
}

export async function saveMenuEntity(type, sectionId, entityId, values) {
  const { db, firestoreApi: f } = await getContext();
  const payload = { ...values, updatedAt: f.serverTimestamp() };
  if (type === 'section') {
    const targetId = entityId || values.id;
    if (!targetId) throw new Error('La sección necesita un identificador.');
    delete payload.id;
    await f.setDoc(f.doc(db, 'sections', targetId), payload, { merge: true });
    return targetId;
  }
  const path = type === 'item' ? 'items' : 'toppings';
  if (entityId) {
    await f.updateDoc(f.doc(db, 'sections', sectionId, path, entityId), payload);
    return entityId;
  }
  const created = await f.addDoc(f.collection(db, 'sections', sectionId, path), payload);
  return created.id;
}

export async function deleteMenuEntity(type, sectionId, entityId) {
  const { db, firestoreApi: f } = await getContext();
  if (type === 'section') {
    const section = (await loadMenuSections()).find(item => item.id === sectionId);
    await Promise.all([
      ...(section?.items || []).map(item => f.deleteDoc(f.doc(db, 'sections', sectionId, 'items', item.id))),
      ...(section?.toppings || []).map(item => f.deleteDoc(f.doc(db, 'sections', sectionId, 'toppings', item.id)))
    ]);
    await f.deleteDoc(f.doc(db, 'sections', sectionId));
    return;
  }
  await f.deleteDoc(f.doc(db, 'sections', sectionId, type === 'item' ? 'items' : 'toppings', entityId));
}

export async function loadMenuSettings() {
  const { db, firestoreApi: f } = await getContext();
  const snapshot = await f.getDoc(f.doc(db, 'settings', 'menu'));
  return snapshot.exists() ? snapshot.data() : {};
}

export async function saveMenuSettings(values) {
  const { db, firestoreApi: f } = await getContext();
  await f.setDoc(f.doc(db, 'settings', 'menu'), values, { merge: true });
}
