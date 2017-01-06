const co = require('co')
const cli = require('..')

const netrc = () => require('netrc-parser')

function basicAuth (username, password) {
  let auth = [username, password].join(':')
  auth = new Buffer(auth).toString('base64')
  return `Basic ${auth}`
}

function createOAuthToken (username, password, secondFactor) {
  const os = require('os')

  let headers = {
    Authorization: basicAuth(username, password)
  }

  if (secondFactor) headers['Heroku-Two-Factor-Code'] = secondFactor

  return cli.heroku.post('/oauth/authorizations', {
    headers,
    body: {
      scope: ['global'],
      description: `Heroku CLI login from ${os.hostname()} at ${new Date()}`,
      expires_in: 60 * 60 * 24 * 365 // 1 year
    }
  }).then(function (auth) {
    return {token: auth.access_token.token, email: auth.user.email}
  })
}

function saveToken ({email, token}) {
  console.dir(netrc())
  const hosts = ['api.heroku.com', 'git.heroku.com']
  hosts.forEach(host => {
    netrc().machines[host].login = email
    netrc().machines[host].password = token
  })
  netrc().save()
}

function * loginUserPass ({save}) {
  const {prompt} = require('./prompt')

  cli.log('Enter your Heroku credentials:')
  let email = yield prompt('Email')
  let password = yield prompt('Password', {hide: true})

  let auth
  try {
    auth = yield createOAuthToken(email, password)
  } catch (err) {
    if (!err.body || err.body.id !== 'two_factor') throw err
    let secondFactor = yield prompt('Two-factor code', {mask: true})
    auth = yield createOAuthToken(email, password, secondFactor)
  }
  if (save) saveToken(auth)
  return auth
}

function * loginSSO ({save}) {
  const {prompt} = require('./prompt')

  let url = process.env['SSO_URL']
  if (!url) {
    let org = process.env['HEROKU_ORGANIZATION']
    if (!org) {
      org = yield prompt('Enter your organization name')
    }
    url = `https://sso.heroku.com/saml/${encodeURIComponent(org)}/init?cli=true`
  }

  const open = require('./open')

  let openError
  yield cli.action('Opening browser for login', open(url)
    .catch(function (err) {
      openError = err
    })
  )

  if (openError) {
    cli.console.error(openError.message)
  }

  let token = yield prompt('Enter your access token (typing will be hidden)', {hide: true})

  let account = yield cli.heroku.get('/account', {
    headers: {
      Authorization: `Bearer ${token}`
    }
  })

  if (save) saveToken({token, email: account.email})
  return {token: token, email: account.email}
}

function * login (options = {}) {
  if (options['sso']) {
    return yield loginSSO(options)
  } else {
    return yield loginUserPass(options)
  }
}

function token () {
  if (process.env.HEROKU_API_KEY) return process.env.HEROKU_API_KEY
  try {
    let host = netrc().machines['api.heroku.com']
    if (host) return host.password
  } catch (err) { if (err.code !== 'ENOENT') throw err }
}

module.exports = {
  login: co.wrap(login),
  token
}