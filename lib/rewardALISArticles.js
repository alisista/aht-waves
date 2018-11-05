require("./utils/env")
const _ = require("underscore")
let moment = require("moment")
require("moment-timezone")
let firestore = require("./utils/firestore")
let admin = require("./utils/firestore").admin
let dropbox = require("./utils/dropbox")
let alis = require("alis")
let T = require("./utils/twitter")
const DB = require("monk")(process.env.MONGODB_URL)
const db = {
  alis_articles: DB.get(`alis_articles`),
  cron: DB.get(`cron`)
}
let init = process.argv[2] || false

class ALIS {
  constructor() {
    this.rewardArticles()
      .then(() => {
        process.exit()
      })
      .catch(e => {
        console.log(e)
        process.exit(1)
      })
  }
  async rewardArticles() {
    let fs = firestore.collection("users_server").where("is_alis", "==", true)
    if (init === "init") {
      fs = fs.where("is_alis_init", "==", false)
    } else {
      let last = await db.cron.findOne({ key: "rewardALISArticles" })
      if (
        last != undefined &&
        last.last > Date.now() - 1000 * 60 * 60 * 24 * 2
      ) {
        console.log("to early...")
        process.exit(3)
      }
    }
    let ss = await fs.get()
    let users = []
    ss.forEach(doc => {
      let user = doc.data()
      user.uid = doc.id
      users.push(user)
    })
    const divider = 10000000000000000
    let start_date = moment.tz("2018-09-01", "Asia/Tokyo").format("x") * 1
    for (let user of users) {
      console.log(user)
      let articles = []
      await alis.p.users.user_id.articles.public(
        {
          user_id: user.alis.user_id,
          limit: 100
        },
        {
          getAllSync: json => {
            let isNext = false
            for (let article of json.Items) {
              let date =
                moment
                  .tz(article.published_at * 1000, "Asia/Tokyo")
                  .format("x") * 1
              if (start_date <= date) {
                isNext = true
                articles.push(article)
              } else {
                isNext = false
              }
            }
            return !isNext
          }
        }
      )
      let article_ids = _(articles).pluck("article_id")
      let existing_articles = await db.alis_articles.find({
        article_id: { $in: article_ids }
      })
      console.log(existing_articles)
      let articles_map = {}
      for (let article of existing_articles) {
        articles_map[article.article_id] = article
      }
      let updated = []
      let amount = 0
      for (let article of articles) {
        if (articles_map[article.article_id] != undefined) {
          article = articles_map[article.article_id]
        }
        let supplied = article.supplied || 0
        let token = await alis.p.articles.article_id.alistoken({
          article_id: article.article_id
        })
        let alis_token = Math.floor(token.alis_token / divider) / 100
        article.alis_token = alis_token
        article.aht = Math.round(alis_token * 100) / 1000
        let diff = alis_token - supplied
        if (diff !== 0) {
          amount += diff
          amount = Math.round(amount * 100) / 100
          article.supplied = alis_token

          article.supplied_at = Date.now()

          await db.alis_articles.update(
            { article_id: article.article_id },
            { $set: article },
            { upsert: true }
          )
          updated.push(article)
        }
      }
      let articles_formatted = _(updated).map(v => {
        return _(v).pick([
          "user_id",
          "published_at",
          "aht",
          "alis_token",
          "supplied_at",
          "user_id",
          "title",
          "topic",
          "article_id"
        ])
      })
      console.log(user.uid + ":" + amount)
      if (amount !== 0) {
        amount = Math.round(amount) / 10
        let userData = await admin.auth().getUser(user.uid)
        let payment = {
          displayName: userData.displayName,
          photoURL: userData.photoURL,
          date: Date.now(),
          type: "reward",
          amount: amount,
          to: user.uid,
          what_for: "ALIS記事報酬"
        }
        await this.registerHistory(payment)
        await this.addToUserHistory(payment)
      }
      await this.addArticles(articles_formatted, user.uid)
    }
    if (init !== "init") {
      await db.cron.update(
        { key: "rewardALISArticles" },
        { $set: { key: "rewardALISArticles", last: Date.now() } },
        { upsert: true }
      )
    }
  }
  async addArticles(articles, uid) {
    for (let article of articles) {
      await firestore
        .collection("users")
        .doc(uid)
        .collection("articles")
        .doc(article.article_id)
        .set(article)
    }
  }
  async addToUserHistory(payment) {
    await firestore
      .collection("users")
      .doc(payment.to)
      .collection("history")
      .doc(`${payment.date}_${payment.type}`)
      .set({
        amount: payment.amount,
        type: payment.type,
        payment_to: payment.to,
        reason: payment.what_for,
        photoURL: payment.photoURL,
        displayName: payment.displayName,
        uid: payment.to,
        date: payment.date
      })
    let user = await firestore
      .collection("users_server")
      .doc(payment.to)
      .get()
      .then(ss => {
        return ss.data()
      })
    if (user == undefined) {
      let amount = { aht: { paid: 0, earned: payment.amount } }
      await firestore
        .collection("users_server")
        .doc(payment.to)
        .set({
          amount: amount
        })
    } else {
      let amount = user.amount || {}
      if (amount.aht == undefined) {
        amount.aht = { paid: 0, earned: 0 }
      }
      amount.aht.earned += payment.amount
      await firestore
        .collection("users_server")
        .doc(payment.to)
        .update({
          is_alis_init: true,
          amount: amount
        })
    }
  }
  async registerHistory(payment) {
    return await firestore
      .collection("history")
      .doc(`${payment.date}_${payment.to}_admin`)
      .set({
        amount: payment.amount,
        type: payment.type,
        payment_to: payment.to,
        reason: payment.what_for,
        photoURL: payment.photoURL,
        displayName: payment.displayName,
        uid: payment.to,
        date: payment.date
      })
  }
}

new ALIS()
