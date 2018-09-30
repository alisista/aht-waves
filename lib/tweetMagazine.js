const path = require("path")
const alis = require("alis")
require("dotenv").config({ path: path.resolve(__dirname, "../.env") })
const _ = require("underscore")
const moment = require("moment")
let firestore = require("./utils/firestore")
const twit = require("twit")
let twitter_credentials = {
  consumer_key: process.env.TWITTER_CONSUMER_KEY_PREMIUM,
  consumer_secret: process.env.TWITTER_CONSUMER_SECRET_PREMIUM,
  access_token: process.env.TWITTER_ACCESS_TOKEN_TWEET,
  access_token_secret: process.env.TWITTER_ACCESS_TOKEN_SECRET_TWEET,
  timeout_ms: 60 * 1000
}
let T = new twit(twitter_credentials)

class Tweet {
  constructor() {
    this.tweetMagazine()
      .then(() => {
        process.exit()
      })
      .catch(e => {
        console.log(e)
        process.exit(1)
      })
  }
  async tweetMagazine() {
    let ss = await firestore
      .collection("magazines")
      .doc("admin")
      .collection("articles")
      .get()
    let articles = []
    let start = moment("2018-08-15").format("x") * 1
    ss.forEach(doc => {
      let article = doc.data()
      if (
        article.tweeted == undefined &&
        (article.removed == undefined || article.removed === false) &&
        article.published_at * 1000 >= start
      ) {
        articles.push(article)
      }
    })
    if (articles.length != 0) {
      articles = _(articles).sortBy(v => {
        return v.published_at
      })
      let chosen = articles.shift()
      let tweet_id = await this.postTweet(chosen)
      let ss = await firestore
        .collection("magazines")
        .doc("admin")
        .collection("articles")
        .doc(chosen.article_id)
        .update({ tweeted: tweet_id })
    }
  }
  async postTweet(article) {
    console.log("now tweeting...")
    let user = await alis.p.users.user_id.info({ user_id: article.user_id })
    let status = `『${article.title}』 by ${user.user_display_name ||
      article.user_id}\n #ALIS #ALISハッカー部公式マガジン\nhttps://alis.to/${
      article.user_id
    }/articles/${article.article_id}`
    let sts = {
      status: status
    }
    console.log(status)
    return new Promise((res, rej) => {
      T.post("statuses/update", sts, (err, data, response) => {
        if (err != null) {
          console.log(err)
          if (err.statusCode == 403 && err.allErrors[0].code == 187) {
            process.exit(7)
          } else {
            console.log("here???")
            process.exit(5)
          }
        } else {
          res(data.id_str)
        }
      })
    })
  }
}

new Tweet()
