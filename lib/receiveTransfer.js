require("./utils/env")

const _ = require("underscore")
let firestore = require("./utils/firestore")
let fsdb = require("./utils/firestore").fsdb
const WavesAPI = require("@waves/waves-api")
const Waves = WavesAPI.create(WavesAPI[`${process.env.WAVES_NETWORK}_CONFIG`])

const divider = 100000000
class Receive {
  constructor() {
    this.checkPayments()
      .then(j => {})
      .catch(e => {
        console.log(e)
      })
  }
  async recordTransaction(tx, asset) {
    let tx_record = await fsdb.get("inbound_pool", tx.id)
    if (tx_record !== null) {
      return true
    } else {
      tx.uid = false
      if (asset != undefined) {
        tx.asset = asset
      }
      let tx_record = await fsdb.upsert(tx, "inbound_pool", tx.id)
      return false
    }
  }
  async getAsset(assetId) {
    let asset = await fsdb.get("assets", assetId)
    if (asset === null) {
      let tx = await Waves.API.Node.v1.transactions.get(assetId)
      await fsdb.upsert(tx, "assets", assetId)
      return tx
    } else {
      return asset
    }
  }
  async checkPayments() {
    let txList = await Waves.API.Node.v1.transactions.getList(
      process.env.WAVES_ADDRESS,
      1000
    )
    for (let v of txList) {
      if (v.recipient === process.env.WAVES_ADDRESS) {
        let asset
        if (v.assetId !== process.env.ASSET_ID) {
          if (v.assetId !== null) {
            let asset_full = await this.getAsset(v.assetId)
            asset = {
              assetId: asset_full.assetId,
              name: asset_full.name,
              decimals: asset_full.decimals
            }
          } else {
            asset = {
              assetId: "WAVES",
              name: "WAVES",
              decimals: 8
            }
          }
          console.log(asset)
          console.log(v.amount)
          console.log(
            v.amount / Math.pow(10, (asset || { decimals: 8 }).decimals)
          )
        }
        let exists = await this.recordTransaction(v, asset)
        if (exists) {
          break
        } else {
          console.log("==============================")
          console.log(v.sender)
          console.log(v)
          console.log(
            v.amount / Math.pow(10, (asset || { decimals: 8 }).decimals)
          )
        }
      }
    }
    await this.depositToUser()
  }
  async depositToUser() {
    let txs = await fsdb.get("inbound_pool", ["uid", "=", false])
    for (let tx of txs) {
      let uid = await this.getTxUser(tx)
      if (uid !== false) {
        let added = await this.addAmountToUser(uid, tx)
        if (added === true) {
          await this.addPaymentToUser(uid, tx)
          await fsdb.upsert({ uid: uid }, "inbound_pool", tx.id)
        }
      }
    }
  }
  async addAmountToUser(uid, tx) {
    const user_data = await fsdb.get("users_server", uid)
    if (user_data !== null) {
      let amount = user_data.amount || {
        aht: { tip: 0, tipped: 0, earned: 0, paid: 0 }
      }
      let asset = "aht"
      let decimals = 8
      let asset_name
      if (tx.asset != undefined) {
        asset = tx.asset.assetId
        decimals = tx.asset.decimals
        asset_name = tx.asset.name
      }
      if (typeof amount[asset] === "undefined") {
        amount[asset] = {
          tip: 0,
          tipped: 0,
          earned: 0,
          paid: 0,
          name: asset_name
        }
      }
      amount[asset].paid -= tx.amount / Math.pow(10, decimals)
      amount[asset].paid = this.round(amount[asset].paid)
      console.log(amount)
      await fsdb.upsert({ amount: amount }, "users_server", uid)
      return true
    } else {
      return false
    }
  }
  async addPaymentToUser(uid, tx) {
    let decimals = 8
    if (tx.asset != undefined) {
      decimals = tx.asset.decimals
    }
    let amount = this.round(tx.amount / Math.pow(10, decimals))
    let date = Date.now()
    let payment_id = `${date}_${amount}`
    let payment = {
      date: date,
      amount: amount,
      sent_at: tx.timestamp,
      status: "confirmed",
      tx: tx.id,
      block: tx.height,
      address: tx.sender,
      type: "inbound"
    }
    if (tx.asset != undefined) {
      payment.asset = tx.asset
    }
    let user = await fsdb.set(payment, "users", uid, "payment", payment_id)
  }

  round(num) {
    let divider = 100000000
    return Math.round(num * divider) / divider
  }
  async getTxUser(tx) {
    let user2 = await firestore
      .collection("addresses")
      .doc(tx.sender)
      .get()
    let user = await fsdb.get("addresses", tx.sender)
    if (user !== null) {
      return user.uid
    } else {
      return false
    }
  }
}

new Receive()
