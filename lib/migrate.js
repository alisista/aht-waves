require("./utils/env")
const alis = require("alis")
const _ = require("underscore")
let firestore = require("./utils/firestore")
let admin = require("./utils/firestore").admin
let dropbox = require("./utils/dropbox")
let T = require("./utils/twitter")
const DB = require("monk")(process.env.MONGODB_URL)
const db = {
  alisista: DB.get(`alisista`),
  maps: DB.get(`maps`)
}

class Migrate {
  constructor() {
    this.migrate()
      .then(() => {
        process.exit()
      })
      .catch(e => {
        console.log(e)
        process.exit(1)
      })
  }
  async migrate() {
    let ss = await firestore.collection("users_server").get()
    let alis_map = {}
    ss.forEach(doc => {
      let user = doc.data()
      if (user.alis != undefined) {
        alis_map[user.alis.user_id] = doc.id
      }
    })
    let ss2 = await firestore.collection("alis_pool").get()
    let alis = []
    ss2.forEach(doc => {
      alis.push({ id: doc.id, data: doc.data() })
    })
    for (let doc of alis) {
      let user = doc.data
      if (user.uid == undefined || user.uid !== alis_map[doc.id]) {
        let ss = await firestore
          .collection("alis_pool")
          .doc(doc.id)
          .update({ uid: alis_map[doc.id] })
      }
    }
  }
}

new Migrate()
