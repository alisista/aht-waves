require("./utils/env")

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

    let asset = "aht"
    if (payment.asset != undefined) {
      asset = payment.asset
    }
    let divider = 100000000
    let earned = ss.amount[asset].earned || 0
    let paid = ss.amount[asset].paid || 0
    let tip = ss.amount[asset].tip || 0
    let tipped = ss.amount[asset].tipped || 0
    let current_amount = earned + tipped - (paid + tip)
    current_amount = Math.round(current_amount * divider) / divider
    return (
      ss != undefined &&
      ss.amount != undefined &&
      ss.amount.aht != undefined &&
      payment.amount <= current_amount
    )
  }
  async recordToPool(payment, tx_id, sent_at) {
    return await firestore
      .collection("payment_pool")
      .doc(payment.id)
      .update({ status: "sent", tx: tx_id, sent_at: sent_at })
  }
  async recordCancelToPool(payment, code = 1) {
    return await firestore
      .collection("payment_pool")
      .doc(payment.id)
      .update({ status: "canceled", cancel: code })
  }
  async confirmPool(payment, block) {
    return await firestore
      .collection("payment_pool")
      .doc(payment.id)
      .update({ status: "confirmed", block: block })
  }

  async addAmount(payment, tx_id, sent_at) {
    let asset = "aht"
    if (payment.val.asset != undefined) {
      asset = payment.val.asset
    }
    let amount = await firestore
      .collection("users_server")
      .doc(payment.val.uid)
      .get()
      .then(doc => {
        return doc.data().amount
      })
    let divider = 100000000
    amount[asset].paid =
      Math.round((amount[asset].paid + payment.val.amount) * divider) / divider
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
  async recordCancelToUserHistory(payment, code = 1) {
    return await firestore
      .collection("users")
      .doc(payment.val.uid)
      .collection("payment")
      .doc(`${payment.val.date}_${payment.val.amount}`)
      .update({ status: "canceled", cancel: code })
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
            if (err === 2 || err === 3) {
              await this.recordCancelToPool(v, err)
              await this.recordCancelToUserHistory(v, err)
            }
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
  async getToken(asset) {
    if (asset === "WAVES") {
      return {
        decimals: 8
      }
    } else {
      let ss = await firestore
        .collection("assets")
        .doc(asset)
        .get()
      if (ss.exists) {
        return ss.data()
      } else {
        return null
      }
    }
  }
  async sendToken(payment) {
    let sent_at = Date.now()
    let asset = process.env.ASSET_ID
    let decimals = process.env.ASSET_PRECISION
    if (payment.asset != undefined && payment.asset != "aht") {
      asset = payment.asset
    }
    let token = { decimals: 8 }
    if (payment.asset != undefined && payment.asset !== "aht") {
      token = await this.getToken(asset)
      if (token === null) {
        return { err: 3 }
      }
      decimals = token.decimals
    }
    if (decimals === 0 && payment.amount % 1 !== 0) {
      return { err: 2 }
    }
    let assetId = asset
    if (asset === "WAVES") {
      assetId = "WAVES"
    }
    const transferData = {
      recipient: payment.address,
      assetId: assetId,
      feeAssetId: "WAVES",
      amount: Math.round(payment.amount * 10 ** decimals),
      fee: FEE,
      timestamp: sent_at
    }
    console.log(transferData)
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
