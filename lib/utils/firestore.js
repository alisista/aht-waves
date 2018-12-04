const admin = require("firebase-admin")
const serviceAccount = require(`../../.service-account${process.env.TAIL}.json`)

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.FIRESTORE_DATABASE_URL
})
let firestore = admin.firestore()
firestore.settings({ timestampsInSnapshots: true })
class fsdb {
  static build(...arr) {
    let i = 0
    let fs = firestore
    for (let v of arr) {
      if (Array.isArray(v)) {
        fs = fs.where(...v)
      } else if (i % 2 === 0) {
        fs = fs.collection(v)
        i += 1
      } else {
        fs = fs.doc(v)
        i += 1
      }
    }
    return { i: i, fs: fs }
  }
  static async get(...arr) {
    let { i, fs } = this.build.apply(null, arr)
    let ss = await fs.get()
    if (i % 2 === 1) {
      let docs = []
      ss.forEach(doc => {
        docs.push(doc.data())
      })
      return docs
    } else {
      if (ss.exists) {
        return ss.data()
      } else {
        return null
      }
    }
  }
  static async upsert(obj, ...arr) {
    let { i, fs } = this.build.apply(null, arr)
    return await fs.set(obj, { merge: true })
  }
  static async set(obj, ...arr) {
    let { i, fs } = this.build.apply(null, arr)
    return await fs.set(obj)
  }
}
module.exports = firestore
module.exports.admin = admin
module.exports.fsdb = fsdb
