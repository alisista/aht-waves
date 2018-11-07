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

class Magazine {
  constructor() {
    this.updateMagazine()
      .then(() => {
        process.exit()
      })
      .catch(e => {
        console.log(e)
        process.exit(1)
      })
  }
  async drop(file_path, data) {
    await dropbox.filesUpload({
      path: file_path,
      contents: JSON.stringify(data),
      mode: "overwrite"
    })
    const result = await dropbox.sharingCreateSharedLink({
      path: file_path,
      short_url: false
    })
    const file_url = result.url.replace(/\?dl=0$/, "")
    const file_id = file_url.split("/")[4]
    return file_id
  }
  async updateMagazine() {
    let ss = await firestore.collection("magazines_updates").get()
    let magazines = []
    ss.forEach(doc => {
      let magazine = doc.data()
      magazines.push({ id: doc.id, data: magazine })
    })
    for (let magazine of magazines) {
      let maps = (
        (await db.maps.findOne({ key: "magazines", mid: magazine.id })) || {
          map: {}
        }
      ).map
      console.log(maps)
      let map_updated = true
      await firestore
        .collection("magazines_updates")
        .doc(magazine.id)
        .delete()
      if (magazine.id !== "admin") {
        let ss = await firestore
          .collection("magazines")
          .doc(magazine.id)
          .get()
        if (ss.exists) {
          let magazine_info = ss.data()
          let fields = [
            "owner",
            "id",
            "editors",
            "created_at",
            "title",
            "description",
            "file_id"
          ]
          for (let field of fields) {
            if (
              magazine_info[field] != undefined &&
              maps[field] != magazine_info[field]
            ) {
              maps[field] = magazine_info[field]
              map_updated = true
            }
          }
        }
      }
      if (map_updated === true) {
        console.log("map updated...")
        console.log(maps)
        let url = `/magazines/${maps.id}.json`
        let map_id = await this.drop(url, {
          date: Date.now(),
          maps: maps
        })
        console.log(`map_id: ${map_id}`)
        await db.maps.update(
          { key: "magazines", mid: magazine.id },
          {
            $set: { key: "magazines", date: Date.now(), map: maps, id: map_id }
          },
          { upsert: true }
        )
      }
    }
  }
}

new Magazine()
