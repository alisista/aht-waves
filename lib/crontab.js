let fs = require("fs")
let path = require("path")
let cp = require("child_process")
let custom = process.argv[2] || "default"

let crons = JSON.parse(
  fs.readFileSync(path.resolve(__dirname + "/cron.json"), "utf8")
)
for (let v of crons) {
  let t = 1000
  for (let v2 of v.t) {
    t *= v2
  }
  v.t = t
}
console.log(crons)

class Cron {
  constructor() {
    this.cur = 0
    this.allskip = true
    this.last = {}
    this.go()
  }
  go() {
    console.log("=====================")
    let cr = crons[this.cur]
    if (crons[this.cur] == undefined) {
      this.cur = 0

      cr = crons[this.cur]
      this.restart(cr)
    } else {
      this.go2(cr)
    }
  }
  restart(cr) {
    if (this.allskip == true) {
      console.log("10 second")
      setTimeout(() => {
        this.go2(cr)
      }, 1000 * 10)
    } else {
      this.allskip = true
      this.go2(cr)
    }
  }
  go2(cr) {
    if (
      cr.t != undefined &&
      this.last[this.cur] != undefined &&
      Date.now() - this.last[this.cur] < cr.t
    ) {
      console.log("skip...")
      this.next()
    } else {
      this.allskip = false
      this.last[this.cur] = Date.now()
      let cm = cr.cm
      if (cm == undefined) {
        cm = "node"
      }
      let p = cr.p
      if (p[0].match(/\./) == null) {
        p[0] = path.resolve(__dirname + "/" + p[0] + ".js")
      }
      let cl = cp.spawn(cm, p)
      cl.stdout.setEncoding("utf8")
      cl.stdout.on("data", data => {
        console.log(data)
      })
      cl.stderr.setEncoding("utf8")
      cl.stderr.on("data", data => {
        console.log(data)
      })
      cl.stderr.on("close", data => {
        this.next()
      })
    }
  }
  next() {
    this.cur += 1
    this.go()
  }
}
new Cron()
