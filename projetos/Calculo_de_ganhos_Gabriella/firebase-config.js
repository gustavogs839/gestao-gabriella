// firebase-config.js
const firebaseConfig = {
    apiKey: "AIzaSyDz6JgSxOsfiB7smBOKtDBlb9waKKYdIQE",
    authDomain: "gestaogabriella-b6b5f.firebaseapp.com",
    projectId: "gestaogabriella-b6b5f",
    storageBucket: "gestaogabriella-b6b5f.firebasestorage.app",
    messagingSenderId: "751665904056",
    appId: "1:751665904056:web:8ff310e8b38effa6b4374d"
};

firebase.initializeApp(firebaseConfig);
var db = firebase.firestore(); // Usar var para garantir escopo global entre arquivos
var auth = firebase.auth();