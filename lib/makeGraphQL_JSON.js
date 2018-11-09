require("./utils/env")
const { exec } = require("child_process")
const rp = require("request-promise")
const _ = require("underscore")
const fs = require("fs")
class Magazine {
  constructor() {
    this.make()
      .then(() => {
        process.exit()
      })
      .catch(e => {
        console.log(e)
        process.exit(1)
      })
  }
  async make() {
    await this.clone()
    await this.makeJSON()
    await this.deploy()
  }
  async spawn(command) {
    return new Promise((res, rej) => {
      const ls = exec(command)
      ls.stdout.on("data", data => {
        console.log(`${data}`)
      })

      ls.stderr.on("data", data => {
        console.log(`${data}`)
      })

      ls.on("close", code => {
        console.log(`child process exited with code ${code}`)
        res(code)
      })
    })
  }

  async deploy() {
    let gitdir = `${__dirname}/../${process.env.SOURCE_PATH}`
    let network = ""
    if (process.env.WAVES_NETWORK !== "MAINNET") {
      network = `-${process.env.WAVES_NETWORK.toLowerCase()}`
    }
    console.log(network)
    await this.spawn(`cd ${gitdir} && npm run deploy${network}`)
  }
  async clone() {
    let gitdir = `${__dirname}/../${process.env.SOURCE_PATH}`
    let rootdir = `${__dirname}/..`
    let network = process.env.WAVES_NETWORK.toLowerCase()
    if (!fs.existsSync(gitdir)) {
      await this.spawn(
        `git clone git@github.com:alisista/alis-magazines-source.git ${gitdir}`
      )
      await this.spawn(
        `cd ${gitdir} && git remote add ${network} git@github.com:alisista/alis-magazines-${network}.git`
      )
      await this.spawn(
        `cd ${gitdir} && git config user.name "${
          process.env.GIT_CONFIG_USER_NAME
        }"`
      )
      await this.spawn(
        `cd ${gitdir} && git config user.email "${
          process.env.GIT_CONFIG_USER_EMAIL
        }"`
      )
      await this.spawn(`cd ${gitdir} && mkdir src/data`)
    } else {
      await this.spawn(`cd ${gitdir} && git pull`)
    }
    await this.spawn(
      `cp -v ${rootdir}/.env.source.${network}.production ${gitdir}/.env.production`
    )
    await this.spawn(`cd ${gitdir} && yarn`)
    await this.spawn(`cd ${gitdir} && git checkout ${network}`)
  }
  async makeJSON() {
    let body = JSON.parse(
      await rp(
        `https://dl.dropboxusercontent.com/s/${
          process.env.MAP_ID_MAGAZINES_TOP
        }/magazines_top.json`
      )
    )
    let magazines = []
    for (let page in body.maps || {}) {
      console.log(body.maps[page])
      let json = JSON.parse(
        await rp(
          `https://dl.dropboxusercontent.com/s/${body.maps[page]}/${page}.json`
        )
      )
      for (let magazine of json.magazines || []) {
        delete magazine.articles
        magazines.push(magazine)
      }
      magazines = magazines.concat(json.magazines || [])
    }
    fs.writeFileSync(
      `${__dirname}/../${process.env.SOURCE_PATH}/src/data/magazines.json`,
      JSON.stringify(magazines)
    )
  }
}

new Magazine()
