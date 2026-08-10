const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const path = require('path');

const serviceAccountPath = path.join(
  __dirname,
  'nequi-colombia-194a1-firebase-adminsdk-fbsvc-c0ec15ef2c.json'
);

initializeApp({
  credential: cert(serviceAccountPath),
});

const db = getFirestore();

module.exports = { db, FieldValue };
