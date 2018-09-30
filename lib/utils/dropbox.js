require("isomorphic-fetch")
const Dropbox = require("dropbox").Dropbox

const dropbox_credentials = {
  app_key: process.env.DROPBOX_APP_KEY,
  app_secret: process.env.DROPBOX_APP_SECRET,
  app_access_token: process.env.DROPBOX_APP_ACCESS_TOKEN
}

const dropbox = new Dropbox({
  accessToken: dropbox_credentials.app_access_token
})

module.exports = dropbox
