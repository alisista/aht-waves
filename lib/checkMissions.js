require("./utils/env")
const _ = require("underscore")
let firestore = require("./utils/firestore")

class Missions {
  constructor() {
    this.checkMissions()
      .then(j => {})
      .catch(e => {
        console.log(e)
      })
  }
  async getMissions() {
    let ss = await firestore
      .collection("mission_pool")
      .where("confirmed", "==", false)
      .get()
    let missions = []
    ss.forEach(doc => {
      let mission = doc.data()
      let id = doc.id
      missions.push({ id: id, val: mission })
    })
    missions = _(missions).sortBy(v => {
      return v.date * 1
    })
    return missions
  }
  async isMissionExists(mission) {
    return await firestore
      .collection("history")
      .where("type", "==", "mission")
      .where("mission_id", "==", mission.mission_id)
      .where("uid", "==", mission.uid)
      .get()
      .then(data => {
        return data.exists === true
      })
  }
  async isAccountsUsed(mission) {
    let used = []
    for (let task of mission.tasks) {
      if (task !== false) {
        let exists = await firestore
          .collection("social_pool")
          .doc(`${task.task_id}_${task.id}`)
          .get()
          .then(data => {
            return data.exists
          })
        if (exists === true) {
          used.push(task.task_id)
        }
      }
    }
    return used
  }
  async registerSocialAccounts(mission) {
    for (let task of mission.tasks) {
      await firestore
        .collection("social_pool")
        .doc(`${task.task_id}_${task.id}`)
        .set({ uid: mission.uid })
    }
    return
  }
  async registerHistory(mission) {
    return await firestore
      .collection("history")
      .doc(`${mission.mission_id}_${mission.uid}`)
      .set({
        amount: 100,
        type: "mission",
        mission_id: mission.mission_id,
        uid: mission.uid,
        date: mission.date
      })
  }
  async revokeMission(mission, revoke) {
    let user_missions = await firestore
      .collection("users")
      .doc(mission.val.uid)
      .get()
      .then(ss => {
        let user_missions = ss.data().missions
        return user_missions
      })
    user_missions[mission.val.mission_id].confirmed = false
    user_missions[mission.val.mission_id].revoke = revoke
    console.log(user_missions)
    await firestore
      .collection("users")
      .doc(mission.val.uid)
      .update({ missions: user_missions })
    await firestore
      .collection("mission_pool")
      .doc(mission.id)
      .delete()
    return
  }
  async markConfirmed(mission) {
    return await firestore
      .collection("mission_pool")
      .doc(mission.id)
      .update({ confirmed: true })
  }

  async addToUserHistory(mission) {
    await firestore
      .collection("users")
      .doc(mission.uid)
      .collection("history")
      .doc(mission.uid)
      .set({
        amount: 100,
        type: "mission",
        mission_id: mission.mission_id,
        date: mission.date
      })
    let amount = await firestore
      .collection("users_server")
      .doc(mission.uid)
      .get()
      .then(ss => {
        return ss.data().amount || {}
      })
    if (amount.aht == undefined) {
      amount.aht = { paid: 0, earned: 0 }
    }
    amount.aht.earned += 100
    await firestore
      .collection("users_server")
      .doc(mission.uid)
      .update({
        amount: amount
      })
    return
  }
  async checkMissions() {
    let missions = await this.getMissions()
    for (let v of missions) {
      try {
        if ((await this.isMissionExists(v.val)) === false) {
          let duplicates = await this.isAccountsUsed(v.val)
          if (duplicates.length !== 0) {
            await this.revokeMission(v, duplicates)
          } else {
            console.log(
              `verified adding [${v.val.mission_id}:${v.val.uid}] to history...`
            )
            await this.registerSocialAccounts(v.val)
            await this.registerHistory(v.val)
            await this.addToUserHistory(v.val)
            await this.markConfirmed(v)
          }
        } else {
          console.log(
            `mission [${v.val.mission_id}:${v.val.uid}] already registered`
          )
          await this.markConfirmed(v)
        }
      } catch (e) {
        console.log(e)
      }
    }
  }
}

new Missions()
