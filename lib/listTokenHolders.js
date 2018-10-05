const path = require("path")
require("dotenv").config({ path: path.resolve(__dirname, "../.env") })
const _ = require("underscore")
let firestore = require("./utils/firestore")
let admin = require("./utils/firestore").admin
let dropbox = require("./utils/dropbox")
let T = require("./utils/twitter")
const DB = require("monk")(process.env.MONGODB_URL)
const db = {
  tweeple: DB.get(`tweeple`)
}

class Holders {
  constructor() {
    this.listHolders()
      .then(() => {
        process.exit()
      })
      .catch(e => {
        console.log(e)
        process.exit(1)
      })
  }
  async updateTweeple(holders) {
    let ids = []
    for (let k in holders) {
      ids.push(holders[k].twitter)
    }
    console.log(ids)
    let tweeple = await db.tweeple.find({ id_str: { $in: ids } })
    let tweeple_map = {}
    for (let v of tweeple) {
      tweeple_map[v.id_str] = v
    }
    for (let k in holders) {
      if (
        tweeple_map[holders[k].twitter] == undefined ||
        tweeple_map[holders[k].twitter].updated <
          Date.now() - 1000 * 60 * 60 * 24 * 3
      ) {
        let account_searched = await this.lookupTweeple(holders[k].twitter)
        let account
        if (account_searched != undefined && account_searched[0] != undefined) {
          account = {
            id_str: account_searched[0].id_str,
            profile_image_url: account_searched[0].profile_image_url,
            followers_count: account_searched[0].followers_count,
            friends_count: account_searched[0].friends_count,
            statuses_count: account_searched[0].statuses_count,
            listed_count: account_searched[0].listed_count,
            description: account_searched[0].description,
            screen_name: account_searched[0].screen_name,
            name: account_searched[0].name,
            url: account_searched[0].url
          }
          if (account_searched[0].profile_banner_url != undefined) {
            account.profile_banner_url = account_searched[0].profile_banner_url
          }

          if (account != undefined) {
            account.updated = Date.now()
          }
        }
        console.log(account)
        await db.tweeple.update(
          { id_str: account.id_str },
          { $set: account },
          { upsert: true }
        )
        tweeple_map[account.id_str] = account
      }
      if (tweeple_map[holders[k].twitter] != undefined) {
        holders[k].screen_name = tweeple_map[holders[k].twitter].screen_name
        holders[k].photoURL = tweeple_map[holders[k].twitter].profile_image_url
        holders[k].displayName = tweeple_map[holders[k].twitter].name
      }
    }
  }
  async lookupTweeple(user_id) {
    let param = {
      include_entities: false,
      user_id: user_id
    }
    return new Promise((res, rej) => {
      T.get("users/lookup", param, (err, data, response) => {
        if (err) {
          rej(err)
        } else {
          res(data)
        }
      })
    })
  }

  async listHolders() {
    let users = await this.getUsers()
    let history = await this.getHistory()
    let amount = 0
    let holders = {}
    for (let record of history) {
      let user = users[record.uid]
      if (holders[record.uid] == undefined) {
        holders[record.uid] = {
          uid: record.uid,
          displayName: user.displayName,
          photoURL: user.photoURL,
          twitter: user.providerData[0].uid,
          amount: 0
        }
      }
      holders[record.uid].amount += record.amount
      amount += record.amount
      console.log(`${user.displayName} ${record.amount}`)
    }
    let divider = 100000000
    amount = Math.round(amount * divider) / divider
    await this.updateTweeple(holders)
    let ids_map = { holders: {}, history: {} }

    let chunks = _.chunk(history, 100)
    let page = 0
    for (let chunk of chunks) {
      page += 1
      let uids = _.uniq(_(chunk).pluck("uid"))
      let users_map = _(holders).pick(uids)
      let data = {
        history: chunk,
        holders: users_map,
        page: page,
        date: Date.now(),
        amount: amount
      }
      let file_id = await this.drop(`/aht/history_${page}.json`, data)
      console.log(`history page ${page} => ${file_id}`)
      ids_map.history[page] = file_id
    }

    let user_ranks = []
    for (let uid in holders) {
      holders[uid].amount = Math.round(holders[uid].amount * divider) / divider
      user_ranks.push(holders[uid])
    }
    user_ranks = _(user_ranks).sortBy(v => {
      return v.amount * -1
    })
    let prev_amount
    let rank = 0
    let pool = 0
    for (let user of user_ranks) {
      if (prev_amount == undefined || prev_amount !== user.amount) {
        rank += 1 + pool
        pool = 0
      } else {
        pool += 1
      }
      user.rank = rank
      prev_amount = user.amount
    }
    let user_chunks = _.chunk(user_ranks, 100)
    let user_page = 0
    for (let chunk of user_chunks) {
      user_page += 1
      let uids = _.uniq(_(chunk).pluck("uid"))
      let users_map = _(holders).pick(uids)
      let data = {
        amount: amount,
        users: chunk,
        holders: users_map,
        page: user_page,
        date: Date.now()
      }
      let file_id = await this.drop(`/aht/holders_${user_page}.json`, data)
      console.log(`holders page ${user_page} => ${file_id}`)
      ids_map.holders[user_page] = file_id
    }
    console.log(ids_map)
    ids_map.date = Date.now()
    let map_id = await this.drop("/maps/aht.json", ids_map)
    console.log(`map_id => ${map_id}`)
    process.exit()
  }
  mapUsers(users) {
    let users_map = {}
    for (let user of users) {
      users_map[user.uid] = user
    }
    return users_map
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
  async getUsers() {
    let users = await admin.auth().listUsers(1000)
    return this.mapUsers(users.users)
  }
  async getHistory() {
    let history = []
    let ss = await firestore.collection("history").get()
    ss.forEach(doc => {
      history.push(doc.data())
    })
    return _(history).sortBy(v => {
      return v.date * -1
    })
  }
}

new Holders()
