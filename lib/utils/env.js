let argv = require("minimist")(process.argv.slice(2))
let tail = argv.n
if (tail != undefined) {
  tail = `.${tail}`
} else {
  tail = ``
}
process.env.TAIL = tail
const path = require("path")
require("dotenv").config({ path: path.resolve(__dirname, `../../.env${tail}`) })
