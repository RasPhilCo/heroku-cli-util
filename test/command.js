'use strict'
/* globals describe it beforeEach afterEach */

let nock = require('nock')
let co = require('co')
let expect = require('unexpected')
let proxyquire = require('proxyquire')

let cli = require('..')
let command = require('../lib/command')

describe('command', function () {
  beforeEach(function () {
    nock.disableNetConnect()
    nock.cleanAll()

    cli.mockConsole()
    cli.prompt = function () {
      return new Promise(function (resolve, reject) {
        resolve('2fa')
      })
    }
  })

  it('2fa should retry just the failing request', function () {
    let api = nock('https://api.heroku.com')

    api.post('/bizbaz', {}).
    reply(200, {value: 'bizbaz'})

    api.post('/foobar', {}).
    reply(403, {'id': 'two_factor'})

    let api2FA = nock('https://api.heroku.com', {
      reqheaders: {'Heroku-Two-Factor-Code': '2fa'}
    })

    api2FA.post('/foobar', {}).reply(200, {value: 'foobar'})

    return command(co.wrap(function * (context, heroku) {
      let bizbaz = yield heroku.post('/bizbaz', {body: {}})
      cli.log(bizbaz.value)

      let foobar = yield heroku.post('/foobar', {body: {}})
      cli.log(foobar.value)
    }))({})
    .then(() => {
      api.done()
      api2FA.done()
      expect(cli.stdout, 'to equal', 'bizbaz\nfoobar\n')
    })
  })

  it('non 2fa error should propagate', function () {
    let api = nock('https://api.heroku.com')
    api.post('/foobar', {}).
    reply(403, {'id': 'not_two_factor'})

    return expect(command(co.wrap(function * (context, heroku) {
      let foobar = yield heroku.post('/foobar', {body: {}})
    }))({}), 'to be rejected with', {statusCode: 403, body: { id: 'not_two_factor' }})
  })

  it('non json error should propagate', function () {
    let api = nock('https://api.heroku.com')
    api.post('/foobar', {}).
    reply(403, 'fizz')

    return expect(command(co.wrap(function * (context, heroku) {
      let foobar = yield heroku.post('/foobar', {body: {}})
    }))({}), 'to be rejected with', {body: 'fizz'})
  })

})
