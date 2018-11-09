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
    this.listMagazines()
      .then(() => {
        process.exit()
      })
      .catch(e => {
        console.log(e)
        process.exit(1)
      })
  }
  async listMagazines() {
    let maps = (
      (await db.maps.findOne({ key: "magazines_top" })) || {
        map: {}
      }
    ).map
    let ss = await firestore.collection("magazines").get()
    let magazines = [
      {
        owner: "admin",
        id: "admin",
        editors: "anyone",
        created_at: 0,
        title: `HACKER's CLUB MAGAZINE`,
        description: "ハッカー部の公式マガジンです。",
        file_id: "admin",
        updated_at: 0
      }
    ]
    ss.forEach(doc => {
      let magazine = doc.data()
      if (magazine.deleted == undefined) {
        magazines.push({
          file_id: magazine.file_id,
          title: magazine.title,
          url_id: magazine.url_id,
          description: magazine.description,
          created_at: magazine.created_at,
          updated_at: 0
        })
      }
    })
    let all_articles = []
    for (let v of magazines) {
      let ss = await firestore
        .collection("magazines")
        .doc(v.file_id)
        .collection("articles")
        .where("removed", "=", false)
        .orderBy("published_at", "desc")
        .limit(3)
        .get()
      v.articles = []
      ss.forEach(doc => {
        let article = doc.data()
        if (v.cover_image == undefined && article.eye_catch_url != undefined) {
          v.cover_image = article.eye_catch_url
        }
        if (v.updated_at === 0) {
          v.updated_at = article.published_at
        }
        let article_compact = {
          title: article.title,
          user_id: article.user_id,
          eye_catch_url: article.eye_catch_url,
          article_id: article.article_id
        }
        v.articles.push(article_compact)
        all_articles.push(article_compact)
      })
    }

    await this.updateAlisista(all_articles)
    let article_map = {}
    for (let v of all_articles) {
      article_map[v.article_id] = v
    }
    magazines = _(magazines).sortBy(v => {
      for (let v2 of v.articles) {
        v2 = article_map[v2.article_id]
      }
      return v.updated_at * -1
    })
    let map_updated = false
    let chunks = _(magazines).chunk(6)
    let page = 0
    for (let chunk of chunks) {
      page += 1
      let file_id = await this.drop(`/magazines_top/${page}.json`, {
        date: Date.now(),
        len: magazines.length,
        magazines: chunk
      })
      if (maps[page] == undefined) {
        map_updated = true
      }
      maps[page] = file_id
      console.log(`file_id...${file_id}`)
    }
    if (map_updated === true) {
      console.log("map updated...")
      console.log(maps)
      let url = `/maps/magazines_top.json`
      let map_id = await this.drop(url, {
        date: Date.now(),
        maps: maps
      })
      console.log(`map_id: ${map_id}`)
      await db.maps.update(
        { key: "magazines_top" },
        {
          $set: {
            key: "magazines_top",
            date: Date.now(),
            map: maps,
            id: map_id
          }
        },
        { upsert: true }
      )
    }
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
}

new Magazine()
