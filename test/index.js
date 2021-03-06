/* jshint laxcomma:true */

var assert = require('assert')
  , sse = require('../index')
  , http = require('http')
  , EE = require('events').EventEmitter
  , Stream = require('stream').Stream

global.TEST = true

var tests = [
  test_install_modifies_listeners
, test_install_twice_raises
, test_server_emits_connections
, test_server_uses_custom_prefix
, test_server_ignores_appropriate_requests
, test_end_emits_end_event
, test_server_emits_keepalives_on_listening
, test_server_creates_client
, test_server_defaults_to_sse
]

start()

function setup() {

}

// integration tests because reasons.

function test_install_modifies_listeners() {
  var server = http.createServer()

  assert.equal(server.listeners('request').length, 0)
  sse().install(server)
  assert.equal(server.listeners('request').length, 1)

  sse({prefixes: ['/asdf'] }).install(server = http.createServer(function(/*r, s*/) { }))
  assert.equal(server.listeners('request').length, 1)

}

function test_install_twice_raises() {
  var server = http.createServer()
    , _ = sse()

  _.install(server)

  assert.throws(function() {
    _.install(server)
  })
}

function test_server_emits_connections() {
  var req = make_request()
    , res = make_response()
    , server = new EE()
    , conn = sse().install(server)
    , triggered = false

  conn.once('connection', function(client) {
    triggered = true
    assert.ok(req.nodelay)
    assert.equal(res.code, 200)
    assert.equal(res.headers['content-type'], 'text/event-stream')
    assert.equal(res.data, ':ok\n\n')
    assert.ok(client.writable)

    client.write('hello\nworld')
    assert.ok(client.writable)
    assert.equal(res.data, ':ok\n\nid: 0\n\ndata: hello\ndata: world\n\n')
    res.paused = Math.random()

    assert.equal(client.write('alright'), res.paused)
  })

  server.emit('request', req, res)

  assert.ok(triggered)
}

function test_server_creates_client(ready) {
  var server = new EE()
    , conn = sse({ create: true }).install(server)
    , req
    , res = make_response()
    , path = '/sse/foo'

  conn.once('connection', function(client) {
    assert.ok(client.req.path === path, 'we received the expected path')
    assert.ok(client.req.params.channelName === 'foo', 'we received the expected channelName')
    ready()
  })

  req = make_request('GET', path)
  server.emit('request', req, res)
}

function test_server_defaults_to_sse(ready) {
  var server = new EE()
    , conn = sse({ create: true }).install(server)
    , req
    , res = make_response()
    , path = '/sse'

  conn.once('connection', function(client) {
    assert.ok(client.req.path === path, 'we received the expected path')
    assert.ok(client.req.params.channelName === 'sse', 'we received the expected channelName')
    ready()
  })

  req = make_request('GET', path)
  server.emit('request', req, res)
}

function test_server_uses_custom_prefix(ready) {
  var server = new EE()
    , conn = sse({ prefixes: ['/ffe'] }).install(server)
    , req
    , res = make_response()

  conn.once('connection', function(client) {
    assert.ok(client.req.path === '/ffe/test', 'we received the expected path')
    assert.ok(client.req.params.channelName === 'test', 'we received the expected channelName')
    assert.ok(conn.Validator.accept.matchers.indexOf('/ffe/:channelName') !== -1, 'validator matchers contains ffe')
    ready()
  })

  req = make_request('GET', '/ffe/test')
  server.emit('request', req, res)
}

function test_server_ignores_appropriate_requests() {
  var server = new EE()
    , conn = sse().install(server)
    , req
    , res = make_response()

  conn.once('connection', function(/*client*/) {
    assert.fail('unexpected connection from '+req.method+' '+req.url+' accept: '+req.headers.accept)
  })

  req = make_request('POST')
  server.emit('request', req, res)

  req = make_request('GET', '/ffe/test')
  server.emit('request', req, res)

  req = make_request('GET', '/sse', 'not-event-stream')
  server.emit('request', req, res)

}

function test_end_emits_end_event() {
  var req = make_request()
    , res = make_response()
    , server = new EE()
    , conn = sse().install(server)
    , triggered = false

  conn.once('connection', function(client) {
    triggered = true
    assert.ok(req.nodelay)
    assert.equal(res.code, 200)
    assert.equal(res.headers['content-type'], 'text/event-stream')
    assert.equal(res.data, ':ok\n\n')
    assert.ok(client.writable)

    client.end()
    assert.ok(!client.writable)
    assert.ok(!res.writable)
    assert.equal(res.data, ':ok\n\nevent: end\ndata: 1\n\n')
  })

  server.emit('request', req, res)

  assert.ok(triggered)
}

function test_server_emits_keepalives_on_listening(ready) {
  var req = make_request()
    , res = make_response()
    , server = new EE()
    , wait = Math.random() * 100 + 20
    , keepalive = 10
    , conn = sse({keepalive: keepalive}).install(server)
    , expected = wait / keepalive

  assert.ok(!conn.interval)

  server.emit('listening')
  server.emit('request', req, res)

  setTimeout(function() {
    var count = 0
    res.data.replace(/:keepalive \d+/g, function() { ++count })

    assert.ok(res.data.slice(':ok\n\n'.length))
    assert.ok(Math.abs(count - expected) < 3)
    server.emit('close')
    assert.strictEqual(conn.interval, null)

    ready()
  }, wait)
}

// utils

function out(what) {
  process.stdout.write(what)
}

function make_request(method, url, accept) {
  var ee = new EE()

  ee.socket = {setNoDelay: function() { ee.nodelay = true }}
  ee.method = method || 'GET'
  ee.headers = {accept: accept || 'text/event-stream'}
  ee.url = url || 'http://localhost:80/sse'
  ee.path = url || '/sse'

  return ee
}

function make_response() {
  var stream = new Stream()

  stream.data = ''
  stream.writable = true
  stream.writeHead = function(code, headers) {
    stream.code = code
    stream.headers = headers
  }
  stream.write = function(x) {
    stream.data += x
    return stream.paused
  }
  stream.end = function(data) {
    if(arguments.length) this.write(data)

    this.writable = false
  }

  return stream
}

// test runner

function start() {
  Function.prototype.before = function(fn) {
    var self = this
    return function ret() {
      var args = [].slice.call(arguments)

      fn.call(ret, args)

      return self.apply(this, args)
    }
  }

  run()
}

function run() {
  if(!tests.length)
    return out('\n')

  var test = tests.shift()
    , now = Date.now()

  setup()

  out(test.name+' - ')
  test.length ? test(done) : (test(), done())

  function done() {
    out(''+(Date.now() - now)+'ms\n')
    run()
  }
}
