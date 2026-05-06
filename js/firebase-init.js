const firebaseConfig = {
  apiKey:            'AIzaSyD-LXKfGOPLMhrcdjhjdXHt3z0_s6-8eI8',
  authDomain:        'global-golf-8c363.firebaseapp.com',
  projectId:         'global-golf-8c363',
  storageBucket:     'global-golf-8c363.firebasestorage.app',
  messagingSenderId: '65681812411',
  appId:             '1:65681812411:web:549074e32f4d59ba87329e',
};

firebase.initializeApp(firebaseConfig);

window.db   = firebase.firestore();
window.auth = firebase.auth();
