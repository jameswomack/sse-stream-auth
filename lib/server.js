/* jshint laxcomma:true */

module.exports = Server

var URL = require('url')  // jshint ignore:line
  , EE = require('events').EventEmitter
  , Client = require('./client')
  , CookieParser = require('restify-cookies')
  , merge = require('merge')
  , Validator = require('./server/event-source-request-validation')

function Server(options) {
  if(this.constructor !== Server)
    return new Server(options)

  EE.call(this)

  var defaults = {prefixes: ['/sse'], fallback: true, keepalive: 1000, authenticationResolver: null, needsAuth: false, create: false}
  options = merge(defaults, options)
  options.needsAuth = options.needsAuth || typeof options.authenticationResolver === 'function'

  this.prefixes = options.prefixes
  this.create = options.create
  this.authenticated = false
  this.needsAuth = options.needsAuth
  this.authenticationResolver = options.authenticationResolver
  this.options = options
  this.pool = {}
  this.interval = null
  this.Validator = Validator
}

var cons = Server
  , proto = cons.prototype = Object.create(EE.prototype)

proto.constructor = cons

proto.install = function(server) {
  var self = this
    , listeners = server.listeners('request')

  Validator.accept.prefixes = this.prefixes;

  server.removeAllListeners('request')

  server.on('request', on_request)

  server.once('listening', function() {
    self.interval = setInterval(function() {
      Object.keys(self.pool).forEach(function (poolKey) {
        var pool = self.pool[poolKey];
        for(var i = 0, len = pool.length; i < len; ++i) {
          pool[i].res.write(':keepalive '+Date.now()+'\n\n')
        }
      });
    }, self.options.keepalive)

    server.once('close', function() {
      clearInterval(self.interval)
      self.interval = null
    })
  })

  self.install = function() { throw new Error('cannot install twice') }

  return self

  function on_request(req, resp) {
    var okay = Validator.isOkay(req, self.create)

    if(!okay) {
      return defaultresponse(req, resp)
    }

    return self.handle(req, resp)
  }

  function defaultresponse(req, resp) {
    for(var i = 0, len = listeners.length; i < len; ++i) {
      listeners[i].call(server, req, resp)
    }
  }
}

proto.handle = function(req, resp) {
  var self = this

  function setup_client(){
    self.pool[req.params.channelName] = self.pool[req.params.channelName] || [];
    var client = new Client(req, resp)
      , idx = self.pool[req.params.channelName].push(client) - 1

    self.emit('connection', client)

    client.once('close', function() {
      self.pool[req.params.channelName].splice(idx, 1)
    })
  }

  if(self.needsAuth && !self.authenticated){
    CookieParser.parse(req, resp, function(){
      self.authenticationResolver(req, resp, function(error){
        if(error){
          throw error
        }else{
          self.authenticated = true
          setup_client()
        }
      })
    })
  }else{
    setup_client()
  }
}
