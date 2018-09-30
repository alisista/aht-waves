const path = require("path")
require("dotenv").config({ path: path.resolve(__dirname, "../.env") })
const _ = require("underscore")
let firestore = require("./utils/firestore")

const WavesAPI = require("@waves/waves-api")
const Waves = WavesAPI.create(WavesAPI[`${process.env.WAVES_NETWORK}_CONFIG`])
const seed = Waves.Seed.fromExistingPhrase(process.env.WAVES_WALLET_PHRASE)

const FEE = 100000

const method = process.argv[2]

class Payment {
  constructor() {
    if (method == "confirm") {
      this.confirmPayment()
        .then(j => {})
        .catch(e => {})
    } else {
      this.checkPayments()
        .then(j => {})
        .catch(e => {
          console.log(e)
        })
    }
  }
  async isTransactionConfirmed(payment) {
    return await Waves.API.Node.v1.transactions.get(payment.tx).then(result => {
      return result.height
    })
  }
  async confirmPayment() {
    let payments = await this.getPayments("sent")
    for (let v of payments) {
      try {
        let block = await this.isTransactionConfirmed(v.val)
        if (block != null) {
          await this.confirmPool(v, block)
          await this.confirmUserHistory(v, block)
        }
      } catch (e) {
        console.log(e)
      }
    }
  }
  async getPayments(state = "requested") {
    let ss = await firestore
      .collection("payment_pool")
      .where("status", "==", state)
      .get()
    let payments = []
    ss.forEach(doc => {
      let payment = doc.data()
      let id = doc.id
      payments.push({ id: id, val: payment })
    })
    payments = _(payments).sortBy(v => {
      return v.date * 1
    })
    console.log(`${payments.length} payments to process...`)
    return payments
  }
  async isEnoughAmount(payment) {
    let ss = await firestore
      .collection("users_server")
      .doc(payment.uid)
      .get()
      .then(ss => {
        return ss.data()
      })

    return (
      ss != undefined &&
      ss.amount != undefined &&
      ss.amount.aht != undefined &&
      payment.amount <= ss.amount.aht.earned - ss.amount.aht.paid
    )
  }
  async recordToPool(payment, tx_id, sent_at) {
    return await firestore
      .collection("payment_pool")
      .doc(payment.id)
      .update({ status: "sent", tx: tx_id, sent_at: sent_at })
  }
  async recordCancelToPool(payment) {
    return await firestore
      .collection("payment_pool")
      .doc(payment.id)
      .update({ status: "canceled", cancel: 1 })
  }
  async confirmPool(payment, block) {
    return await firestore
      .collection("payment_pool")
      .doc(payment.id)
      .update({ status: "confirmed", block: block })
  }

  async addAmount(payment, tx_id, sent_at) {
    let amount = await firestore
      .collection("users_server")
      .doc(payment.val.uid)
      .get()
      .then(doc => {
        return doc.data().amount
      })
    amount.aht.paid += payment.val.amount
    await firestore
      .collection("users_server")
      .doc(payment.val.uid)
      .update({ amount: amount })
    return
  }
  async recordToUserHistory(payment, tx_id, sent_at) {
    return await firestore
      .collection("users")
      .doc(payment.val.uid)
      .collection("payment")
      .doc(`${payment.val.date}_${payment.val.amount}`)
      .update({ status: "sent", tx: tx_id, sent_at: sent_at })
  }
  async recordCancelToUserHistory(payment) {
    return await firestore
      .collection("users")
      .doc(payment.val.uid)
      .collection("payment")
      .doc(`${payment.val.date}_${payment.val.amount}`)
      .update({ status: "canceled", cancel: 1 })
  }
  async confirmUserHistory(payment, block) {
    return await firestore
      .collection("users")
      .doc(payment.val.uid)
      .collection("payment")
      .doc(`${payment.val.date}_${payment.val.amount}`)
      .update({ status: "confirmed", block: block })
  }

  async checkPayments() {
    let payments = await this.getPayments()
    for (let v of payments) {
      try {
        let isEnough = await this.isEnoughAmount(v.val)
        if (isEnough === false) {
          await this.recordCancelToPool(v)
          await this.recordCancelToUserHistory(v)
        } else {
          let { err, tx, sent_at } = await this.sendToken(v.val)
          if (err || tx == undefined || tx.id == undefined) {
            // something went wrong
            console.log(err)
          } else {
            let tx_id = tx.id
            console.log(`transaction[${tx_id}] succeeded!`)
            await this.recordToPool(v, tx_id, sent_at)
            await this.addAmount(v, tx_id, sent_at)
            await this.recordToUserHistory(v, tx_id, sent_at)
          }
        }
      } catch (e) {
        console.log(e)
      }
    }
  }
  async sendToken(payment) {
    let sent_at = Date.now()
    const transferData = {
      recipient: payment.address,
      assetId: process.env.ASSET_ID,
      feeAssetId: "WAVES",
      amount: payment.amount * 10 ** process.env.ASSET_PRECISION,
      fee: FEE,
      timestamp: sent_at
    }
    let err = null
    let tx = await Waves.API.Node.v1.assets
      .transfer(transferData, seed.keyPair)
      .then(j => {
        return j
      })
      .catch(e => {
        err = e
      })
    return { err: err, tx: tx, sent_at: sent_at }
  }
}

new Payment()
