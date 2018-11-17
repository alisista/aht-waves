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
    this.alisista_map = {}
    this.issueMagazine()
      .then(() => {
        process.exit()
      })
      .catch(e => {
        console.log(e)
        process.exit(1)
      })
  }
  async updateAlisista(articles) {
    let ids = []
    for (let v of articles) {
      ids.push(v.user_id)
    }
    ids = _(ids).uniq()
    let alisista = await db.alisista.find({ user_id: { $in: ids } })
    let alisista_map = {}
    for (let v of alisista) {
      alisista_map[v.user_id] = v
    }
    for (let v of articles) {
      if (
        alisista_map[v.user_id] == undefined ||
        alisista_map[v.user_id].updated < Date.now() - 1000 * 60 * 60 * 24 * 7
      ) {
        let user = await alis.p.users.user_id.info({ user_id: v.user_id })
        alisista_map[v.user_id] = user
        alisista_map[v.user_id].updated = Date.now()
        await db.alisista.update(
          { user_id: v.user_id },
          { $set: alisista_map[v.user_id] },
          { upsert: true }
        )
      }
      if (alisista_map[v.user_id] != undefined) {
        v.user_display_name = alisista_map[v.user_id].user_display_name
        v.icon_image_url = alisista_map[v.user_id].icon_image_url
      }
      if (this.alisista_map[v.user_id] == undefined) {
        let ss = await firestore
          .collection("alis_pool")
          .doc(v.user_id)
          .get()
        this.alisista_map[v.user_id] = ss.exists
      }
      v.notip = !this.alisista_map[v.user_id]
    }
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
  rmFraction(num) {
    const divider = 100000000
    return Math.round(num * divider) / divider
  }
  async updateTips() {
    let updated = {}
    let ss = await firestore
      .collection("tip_pool")
      .where("processed", "==", false)
      .get()
    let tips = []
    ss.forEach(doc => {
      tips.push({ data: doc.data(), id: doc.id })
    })
    for (let tip of tips) {
      let ss2 = await firestore
        .collection("magazines")
        .doc(tip.data.magazine)
        .collection("articles")
        .doc(tip.data.article_id)
        .get()
      if (ss2.exists) {
        let article = ss2.data()
        let article_tip = article.tip || 0
        article_tip += tip.data.amount
        article_tip = this.rmFraction(article_tip)
        console.log(article_tip)
        await firestore
          .collection("magazines")
          .doc(tip.data.magazine)
          .collection("articles")
          .doc(tip.data.article_id)
          .update({ tip: article_tip, last_tip: tip.data.date })
        await firestore
          .collection("tip_pool")
          .doc(tip.id)
          .update({ processed: Date.now() })
        updated[tip.data.magazine] = Date.now()
      }
    }
    return updated
  }
  async updateCover(magazine, cover_image) {
    try {
      await firestore
        .collection("magazines")
        .doc(magazine.id)
        .update({ cover: cover_image })
    } catch (e) {
      await firestore
        .collection("magazines")
        .doc(magazine.id)
        .set({ cover: cover_image })
    }
  }
  async issueMagazine() {
    let tip_updated = await this.updateTips()
    let ss = await firestore.collection("magazines_pool").get()
    let magazines = []
    let magazines_map = {}
    ss.forEach(doc => {
      let magazine = doc.data()
      magazines_map[doc.id] = true
      magazines.push({ id: doc.id, data: magazine })
    })
    for (let k in tip_updated) {
      if (magazines_map[k] == undefined) {
        magazines.push({ id: k, data: { date: tip_updated[k] } })
      }
    }
    for (let magazine of magazines) {
      let maps = (
        (await db.maps.findOne({ key: "magazines", mid: magazine.id })) || {
          map: {}
        }
      ).map
      let map_updated = false
      let mapid = "admin"
      if (magazine.id !== "admin") {
        mapid = "map"
      }
      if (maps[mapid] == undefined) {
        maps[mapid] = {}
        map_updated = true
      }
      let ss = await firestore
        .collection("magazines")
        .doc(magazine.id)
        .collection("articles")
        .get()
      let articles = []
      ss.forEach(doc => {
        let article = doc.data()
        if (article.removed == undefined || article.removed === false) {
          articles.push(article)
        }
      })
      articles = _(articles)
        .sortBy(v => {
          return v.published_at * -1
        })
        .map(v => {
          return _(v).pick([
            "topic",
            "tip",
            "last_tip",
            "eye_catch_url",
            "overview",
            "user_id",
            "title",
            "published_at",
            "article_id",
            "uid"
          ])
        })
      let cover_image
      if (articles.length != 0) {
        cover_image = articles[0].eye_catch_url
      }
      if (cover_image != undefined) {
        await this.updateCover(magazine, cover_image)
      }
      await this.updateAlisista(articles)
      let chunks = _(articles).chunk(6)
      let page = 0
      for (let chunk of chunks) {
        page += 1
        let file_id = await this.drop(
          `/magazines/${magazine.id}/${page}.json`,
          {
            date: Date.now(),
            len: articles.length,
            articles: chunk
          }
        )
        maps[mapid][page] = file_id
        if (maps[mapid][page] == undefined) {
          map_updated = true
        }
        console.log(`file_id...${file_id}`)
      }
      let ss2 = await firestore
        .collection("magazines_pool")
        .doc(magazine.id)
        .get()
      if (ss2.exists && ss2.data().date == magazine.data.date) {
        await firestore
          .collection("magazines_pool")
          .doc(magazine.id)
          .delete()
      }
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
            "url_id",
            "description",
            "file_id",
            "cover"
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
        let url = `/maps/maps/magazines.json`
        if (magazine.id != undefined && magazine.id !== "admin") {
          url = `/magazines/${maps.id}.json`
        }
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
