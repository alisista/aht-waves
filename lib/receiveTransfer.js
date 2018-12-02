require("./utils/env")

const _ = require("underscore")
let firestore = require("./utils/firestore")

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
  async recordTransaction(tx) {
    let tx_record = await firestore
      .collection("inbound_pool")
      .doc(tx.id)
      .get()
    if (tx_record.exists) {
      return true
    } else {
      tx.uid = false
      let tx_record = await firestore
        .collection("inbound_pool")
        .doc(tx.id)
        .set(tx)
      return false
    }
  }
  async checkPayments() {
    let txList = await Waves.API.Node.v1.transactions.getList(
      process.env.WAVES_ADDRESS,
      1000
    )
    console.log(txList.length)
    for (let v of txList) {
      if (
        v.assetId === process.env.ASSET_ID &&
        v.recipient === process.env.WAVES_ADDRESS
      ) {
        let exists = await this.recordTransaction(v)
        if (exists) {
          break
        } else {
          console.log("==============================")
          console.log(v.sender)
          console.log(v)
          console.log(v.amount / divider)
        }
      }
    }
    await this.depositToUser()
  }
  async depositToUser() {
    let tx_records = await firestore
      .collection("inbound_pool")
      .where("uid", "=", false)
      .get()
    let txs = []
    tx_records.forEach(ss => {
      txs.push(ss.data())
    })
    for (let tx of txs) {
      let uid = await this.getTxUser(tx)
      if (uid !== false) {
        let added = await this.addAmountToUser(uid, tx)
        if (added === true) {
          await this.addPaymentToUser(uid, tx)
          await firestore
            .collection("inbound_pool")
            .doc(tx.id)
            .update({ uid: uid })
        }
      }
    }
  }
  async addAmountToUser(uid, tx) {
    let user = await firestore
      .collection("users_server")
      .doc(uid)
      .get()
    if (user.exists) {
      const user_data = user.data()
      let amount = user_data.amount || {
        aht: { tip: 0, tipped: 0, earned: 0, paid: 0 }
      }
      if (typeof amount.aht == undefined) {
        amount.aht += { tip: 0, tipped: 0, earned: 0, paid: 0 }
      }
      amount.aht.paid -= tx.amount / divider
      amount.aht.paid = this.round(amount.aht.paid)
      await firestore
        .collection("users_server")
        .doc(uid)
        .update({ amount: amount })
      return true
    } else {
      return false
    }
  }
  async addPaymentToUser(uid, tx) {
    let amount = this.round(tx.amount / divider)
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
    let user = await firestore
      .collection("users")
      .doc(uid)
      .collection("payment")
      .doc(payment_id)
      .set(payment)
  }

  round(num) {
    let divider = 100000000
    return Math.round(num * divider) / divider
  }
  async getTxUser(tx) {
    console.log(tx.sender)
    let user = await firestore
      .collection("addresses")
      .doc(tx.sender)
      .get()
    if (user.exists) {
      return user.data().uid
    } else {
      return false
    }
  }
}

new Receive()
