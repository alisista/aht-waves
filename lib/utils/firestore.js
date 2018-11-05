const admin = require("firebase-admin")
const serviceAccount = require(`../../.service-account${process.env.TAIL}.json`)

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.FIRESTORE_DATABASE_URL
})
let firestore = admin.firestore()
firestore.settings({ timestampsInSnapshots: true })

module.exports = firestore
module.exports.admin = admin
