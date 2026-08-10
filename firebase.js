const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const path = require('path');

const serviceAccountPath = path.join(
  __dirname,
  'nequi-colombia-194a1-firebase-adminsdk-fbsvc-c0ec15ef2c.json'
);

let credentialOptions;
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  credentialOptions = cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT));
} else {
  credentialOptions = cert(serviceAccountPath);
}

initializeApp({
  credential: credentialOptions,
});

const db = getFirestore();

module.exports = { db, FieldValue };
